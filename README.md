# RELM Sports — static replica + working accounts & tournament applications

A hand-built HTML/CSS/JS replica of relmsports.com with a working account system and
online tournament applications, so you can actually **create an account and apply for events**.

The site is plain HTML/CSS/JS (no build step) plus a small JSON API. The same API code runs
locally with `node server.js` **and** on Vercel as a serverless function, so what you test
locally is what you get in production.

## Run it locally

```powershell
cd C:\Users\USER\OneDrive\Desktop\relmsports
node server.js
```

Then open **http://localhost:3000/**

> Node.js is already installed (v24). There are **no dependencies** — nothing to `npm install`.

Settings come from a local `.env` (copied from `.env.example`). Change the port if 3000 is busy:

```powershell
$env:PORT = 8080; node server.js
```

## Try the flow

1. Open http://localhost:3000/tournaments.html
2. Any tournament card → **Apply now**
3. Guests can browse everything; the application form itself asks you to sign in →
   **Create an account**
4. Sign up, and you land straight back on that tournament's application form (your chosen
   event is preserved through the `?next=` link)
5. Fill in team name, division, contact details → **Submit application**
6. **My Account** lists every application with its status, and lets you withdraw or apply again

### Organizer (admin) view

Sign in with the admin email to get the dashboard at http://localhost:3000/admin.html —
every application, searchable, with Confirm / Decline / Reset actions and CSV export.

The admin email defaults to **relmtournaments@outlook.com** and is configured with the
`ADMIN_EMAILS` environment variable (comma-separated list), both locally and on Vercel.

## Deploy to Vercel (via GitHub)

The project is ready to import into Vercel as-is.

1. **Push the project to GitHub.** (Initialize a repo, commit, and push. `data/users.json`,
   `data/applications.json` and `data/.secret` are git-ignored so real accounts are never
   published.)
2. In **Vercel → Add New → Project**, import the GitHub repository.
3. Framework preset: **Other**. Leave the build command empty. `vercel.json` only needs a small
   amount of routing:
   - the static HTML/CSS/JS is served **natively** by Vercel straight from the project root, so
     every asset keeps its correct MIME type and there is no build step;
   - only `/api/*` is rewritten to a single serverless function, `api/relm.js`, which re-exports
     the handler from `server.js` (so production runs the exact code you run locally).

   There are no `builds`, no `includeFiles` and no dependencies — the function pulls in
   `server.js`, `lib/**` and `data/events.json` automatically through `require`.
4. Under **Settings → Environment Variables**, add:
   | Name | Value |
   | --- | --- |
   | `ADMIN_EMAILS` | `relmtournaments@outlook.com` |
   | `SECRET` | a long random string (see below) |
   | `NODE_ENV` | `production` |
5. **Deploy**, then open the deployment URL and repeat the flow above.

Generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Data storage on Vercel (important)

Vercel functions have **no persistent disk**. Add a **Vercel KV** (or **Upstash Redis**) store
to Project → Storage, connect it, and Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`
(the code also accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). When present,
accounts and applications are stored there and survive deployments.

If no store is connected the API falls back to a temp folder that persists only for the life
of a warm function instance — fine for a demo, but sign-ups and applications can disappear on
a cold start. Because all `/api/*` routes run in one function, that fallback stays consistent
while the instance is warm. If the temp folder is not writable either, accounts and applications
are held in memory for the life of the instance instead of failing. Reading tournament data is
always safe: `lib/store.js` looks in the writable data dir, then the copy bundled with the
function, then the `require`d copy.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Homepage (12 sections, hero slideshow) |
| `about.html` | About us, Our Values, our team |
| `tournaments.html` | All 7 tournaments, each with an **Apply now** button |
| `apply.html` | Application form — `apply.html?event=<id>`, or a picker with no `?event` |
| `account.html` | Sign up, sign in, my applications |
| `admin.html` | Organizer dashboard (admin accounts only) |
| `news.html` | News grid with category filters |
| `contact.html` | Contact details and form |

Tournament ids: `bmha`, `adult`, `spring-cup`, `boys-showcase`, `girls-challenge`, `ringette`, `d3`.

## Tournament pricing

Prices mirror the live relmsports.com tournament pages, which list a **Cost** on the event page
alongside Date and Location, plus a "Tournament Fees" block. Every tournament is priced per team,
in Canadian dollars:

| Tournament | Registration | Deposit at registration |
| --- | --- | --- |
| BMHA Mid-Season Tilt | $1,975 | 40% non-refundable (EMT/cheque preferred; credit card adds 4%) |
| Adult Hockey Classic | $1,500 | 40% non-refundable |
| RELM Spring Cup (House League) | $1,600 | 40% non-refundable |
| Ontario Prospects Junior Boys Showcase | $2,250 (+$250 per individual player) | 40% non-refundable |
| Ontario Prospects Girls Hockey Challenge | $1,950 | 40% non-refundable |
| Ontario Prospects Ringette Invitational | $1,950 | 40% non-refundable |
| Ontario Prospects D3 Boys Hockey Challenge | $2,250 | 40% non-refundable |

Every event collects a **40% non-refundable deposit due at registration**. If you are applying for an
event that is 90 days or less away, full payment is required at registration.

In the replica the price shows up in four places:

1. A **Cost** row on every tournament card (homepage and `tournaments.html`).
2. The event detail on `apply.html` — Cost in the meta row, a **Tournament Fees** panel, and a
   sidebar with Ages, Levels, Sanction #, Game guarantee and Contact.
3. A live **cost summary** in the application form that recalculates as you change the number of
   teams, showing the registration total and the total cost.
4. **My applications** (`account.html`) and the **admin dashboard** show the fee, total and deposit
   for each entry, and the figures are included in the admin CSV export.

The application records `costPerTeam`, `total` and `depositDue`. Applications submitted before
pricing was added still display a fee, computed from the tournament's current price.

## How it works

```
server.js            entry point: the shared request handler plus the local HTTP listener used
                     by `node server.js`
api/relm.js          the Vercel serverless function — re-exports server.js's handler so /api/*
                     runs the same code in production
lib/env.js           loads a local .env when present
lib/store.js         storage: Vercel KV / Upstash Redis, else the filesystem, else memory
lib/core.js          the API router (accounts, applications, admin) — shared by every entry point
data/events.json     the 7 tournaments — the single source of truth for dates, pricing and details
data/users.json      accounts (local only) — salted scrypt password hashes
data/applications.json   submitted applications (local only)
data/.secret         auto-generated key used to sign session tokens (local only)
tests/run.js         starts an isolated server and runs the end-to-end suite
tests/e2e.js         the end-to-end API suite
```

- Passwords are hashed with `scrypt` + a per-user random salt; plain passwords are never stored.
- Sessions are stateless HMAC-signed tokens, valid for 30 days, sent as `Authorization: Bearer …`.
- `data/` is blocked from public requests by the dev server, and `data/users.json`,
  `data/applications.json` and `data/.secret` are excluded from the Vercel deployment via
  `.vercelignore` so they can never be downloaded.
- `SECRET` keeps tokens valid across serverless instances. Without it (and without a store) a
  fresh secret is generated per cold start, which logs users out.
- Set `RELM_DATA_DIR` to keep local data somewhere else (the test suite uses this to run against a
  throwaway directory without touching real accounts).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Local dev server port (default `3000`) |
| `NODE_ENV` | `production` on Vercel |
| `ADMIN_EMAILS` | Comma-separated emails that get admin access (default `relmtournaments@outlook.com`) |
| `SECRET` | HMAC key for session tokens — set a long random value in production |
| `RELM_DATA_DIR` | Override the local data folder |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV connection (injected automatically) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis connection |

### API

| Method | Endpoint | Notes |
| --- | --- | --- |
| `GET` | `/api/events` | all tournaments + registered team counts |
| `POST` | `/api/auth/signup` | name, email, password → account + token |
| `POST` | `/api/auth/login` | email, password → token |
| `GET` | `/api/auth/me` | current account |
| `POST` | `/api/auth/logout` | discards the client token |
| `GET` / `POST` | `/api/applications` | list mine / submit one (auth required) |
| `DELETE` | `/api/applications/:id` | withdraw my application |
| `PATCH` | `/api/applications/:id` | set status (admin only) |
| `GET` | `/api/admin/applications` | every application (admin only) |

### Tests

```powershell
node tests/run.js
```

Starts the server on a random port with its own temporary data directory, runs the end-to-end
suite (static files, signup/login, applications, permissions, admin, withdraw) and cleans up.

### Editing tournaments

Edit `data/events.json` — the apply page, the event picker, the pricing panels and the registered-team
counts all read from it. Each event carries `cost` (number), `costLabel` (what visitors see),
`deposit`, a `fees` list for the Tournament Fees panel, and a `detail` object (ages, levels, sanction,
game guarantee, contact). Keep the `id` values in sync with the `#anchors` on `tournaments.html`.
The homepage and `tournaments.html` cards are still static HTML, so add a matching card (including its
Cost row) there for a brand-new event.

## Notes

- Design, colours, fonts and imagery mirror the live site (assets are hotlinked from
  `relmsports.com/wp-content/...`, so an internet connection is needed for images).
- Nav items that do not exist on the live site yet (Development, Wranglers, FAQ's,
  Local Attractions, Cancellation Policy) remain `#` placeholders.
- This is a replica, not a production system: there is no email delivery, payment or rate limiting.
  Pricing is recorded on the application but **no money is charged** — fees and deposits are shown
  for acceptance and settled outside the site (EMT, cheque or card as the live site does).
