/* ==========================================================================
   RELM Sports — account page (sign up, sign in, my applications)
   ========================================================================== */

(function () {
  "use strict";

  var RELM = window.RELM;
  var tabs = document.querySelectorAll("[data-tab]");
  var panels = document.querySelectorAll("[data-panel]");
  var authCard = document.getElementById("authCard");
  var dashboard = document.getElementById("dashboard");
  var welcome = document.getElementById("welcomeName");
  var accountEmail = document.getElementById("accountEmail");
  var accountSince = document.getElementById("accountSince");
  var list = document.getElementById("applicationsList");
  var emptyState = document.getElementById("applicationsEmpty");
  var summary = document.getElementById("applicationsSummary");
  var params = new URLSearchParams(window.location.search);
  var nextUrl = params.get("next");
  var tabParam = params.get("tab");

  /* ------------------------------------------------------------- tabs */

  function showTab(name) {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute("data-tab") === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      showTab(tab.getAttribute("data-tab"));
    });
  });

  /* ------------------------------------------------------------ signup */

  var signupForm = document.getElementById("signupForm");

  signupForm.addEventListener("submit", function (event) {
    event.preventDefault();
    RELM.clearErrors(signupForm);

    var button = signupForm.querySelector("button[type=submit]");
    var data = Object.fromEntries(new FormData(signupForm).entries());

    if (data.password !== data.confirm) {
      RELM.showErrors(signupForm, { password: "Passwords do not match." });
      return;
    }

    RELM.setBusy(button, true, "Creating account…");

    RELM.signup({ name: data.name, email: data.email, password: data.password })
      .then(function (user) {
        RELM.toast("Welcome, " + user.name.split(" ")[0] + "! Your account is ready.", "ok");
        if (nextUrl) {
          window.location.href = nextUrl;
          return;
        }
        loadDashboard(user);
      })
      .catch(function (err) {
        var errors = (err.data && err.data.errors) || { form: err.message };
        RELM.showErrors(signupForm, errors);
      })
      .finally(function () {
        RELM.setBusy(button, false);
      });
  });

  /* ------------------------------------------------------------- login */

  var loginForm = document.getElementById("loginForm");

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    RELM.clearErrors(loginForm);

    var button = loginForm.querySelector("button[type=submit]");
    var data = Object.fromEntries(new FormData(loginForm).entries());

    RELM.setBusy(button, true, "Signing in…");

    RELM.login({ email: data.email, password: data.password })
      .then(function (user) {
        RELM.toast("Signed in as " + user.email, "ok");
        if (nextUrl) {
          window.location.href = nextUrl;
          return;
        }
        loadDashboard(user);
      })
      .catch(function (err) {
        var errors = (err.data && err.data.errors) || { form: err.message };
        RELM.showErrors(loginForm, errors);
      })
      .finally(function () {
        RELM.setBusy(button, false);
      });
  });

  /* ---------------------------------------------------------- dashboard */

  var STATUS_LABEL = {
    pending: "Pending review",
    confirmed: "Confirmed",
    declined: "Not accepted",
    withdrawn: "Withdrawn"
  };

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatMoney(amount) {
    return "$" + (Number(amount) || 0).toLocaleString("en-CA");
  }

  function renderApplications(applications) {
    list.innerHTML = "";

    var active = applications.filter(function (app) {
      return app.status !== "withdrawn";
    });

    emptyState.hidden = active.length > 0;

    summary.textContent =
      active.length === 1
        ? "You have 1 active application."
        : "You have " + active.length + " active applications.";

    applications.forEach(function (app) {
      var item = document.createElement("article");
      item.className = "application" + (app.status === "withdrawn" ? " is-withdrawn" : "");

      var event = app.event || {};
      var groups = (event.groups || []).join(", ");
      // Applications submitted before pricing existed fall back to the event's current fee.
      var teams = Number(app.teams) || 1;
      var costPerTeam = Number(app.costPerTeam) || Number(event.cost) || 0;
      var total = Number(app.total) || costPerTeam * teams;
      var depositDue = Number(app.depositDue) || (Number(event.deposit) || 0) * teams;

      item.innerHTML =
        '<div class="application__media">' +
        (event.image
          ? '<img src="' + RELM.escapeHtml(event.image) + '" alt="" />'
          : "") +
        "</div>" +
        '<div class="application__body">' +
        '<div class="application__head">' +
        "<h3>" +
        RELM.escapeHtml(event.title || "Tournament") +
        "</h3>" +
        '<span class="status status--' +
        RELM.escapeHtml(app.status) +
        '">' +
        RELM.escapeHtml(STATUS_LABEL[app.status] || app.status) +
        "</span>" +
        "</div>" +
        '<ul class="application__meta">' +
        "<li><strong>Date</strong> " + RELM.escapeHtml(event.date || "—") + "</li>" +
        "<li><strong>Location</strong> " + RELM.escapeHtml(event.location || "—") + "</li>" +
        "<li><strong>Team</strong> " + RELM.escapeHtml(app.teamName) + "</li>" +
        "<li><strong>Division</strong> " + RELM.escapeHtml(app.division) + "</li>" +
        "<li><strong>Teams</strong> " + RELM.escapeHtml(String(app.teams)) + "</li>" +
        (costPerTeam
          ? "<li><strong>Fee</strong> " + RELM.escapeHtml(formatMoney(costPerTeam)) + " per team</li>" +
            "<li><strong>Total</strong> " + RELM.escapeHtml(formatMoney(total)) + " CAD</li>" +
            (depositDue
              ? "<li><strong>Deposit due</strong> " + RELM.escapeHtml(formatMoney(depositDue)) + "</li>"
              : "")
          : "") +
        "<li><strong>Submitted</strong> " + RELM.escapeHtml(formatDate(app.createdAt)) + "</li>" +
        "</ul>" +
        (app.notes ? '<p class="application__notes">' + RELM.escapeHtml(app.notes) + "</p>" : "") +
        (groups ? '<p class="application__groups"><strong>Groups at this event:</strong> ' + RELM.escapeHtml(groups) + "</p>" : "") +
        '<div class="application__actions">' +
        (app.status === "withdrawn"
          ? '<a class="btn btn--sm btn--ghost" href="/apply.html?event=' +
            RELM.escapeHtml(app.eventId) +
            '">Apply again</a>'
          : '<button class="btn btn--sm btn--ghost" type="button" data-withdraw="' +
            RELM.escapeHtml(app.id) +
            '">Withdraw</button>') +
        '<a class="link-arrow" href="/apply.html?event=' +
        RELM.escapeHtml(app.eventId) +
        '">View event <i class="fa-solid fa-arrow-right-long"></i></a>' +
        "</div>" +
        "</div>";

      list.appendChild(item);
    });
  }

  function loadApplications() {
    return RELM.api("/api/applications").then(function (data) {
      renderApplications(data.applications || []);
    });
  }

  function loadDashboard(user) {
    authCard.hidden = true;
    dashboard.hidden = false;

    welcome.textContent = user.name.split(" ")[0];
    accountEmail.textContent = user.email;
    accountSince.textContent = formatDate(user.createdAt);

    var adminLink = document.getElementById("adminLink");
    if (adminLink && user.role === "admin") adminLink.hidden = false;

    return loadApplications();
  }

  list.addEventListener("click", function (event) {
    var button = event.target.closest("[data-withdraw]");
    if (!button) return;

    var id = button.getAttribute("data-withdraw");
    if (!window.confirm("Withdraw this application? You can apply again at any time.")) return;

    RELM.setBusy(button, true, "Withdrawing…");
    RELM.api("/api/applications/" + id, { method: "DELETE" })
      .then(function () {
        RELM.toast("Application withdrawn.", "ok");
        return loadApplications();
      })
      .catch(function (err) {
        RELM.toast(err.message, "error");
        RELM.setBusy(button, false);
      });
  });

  /* --------------------------------------------------------------- init */

  RELM.me().then(function (user) {
    if (user) {
      loadDashboard(user);
      return;
    }
    if (tabParam === "login" || tabParam === "signup") showTab(tabParam);
    else showTab(nextUrl ? "login" : "signup");
  });
})();
