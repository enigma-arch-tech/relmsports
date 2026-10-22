/* ==========================================================================
   RELM Sports — shared API client
   Handles the session token, auth state in the header and small UI helpers.
   ========================================================================== */

(function () {
  "use strict";

  var TOKEN_KEY = "relm.token";

  /* ------------------------------------------------------------- session */

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* storage unavailable — session stays in memory only */
    }
  }

  /* ----------------------------------------------------------------- api */

  function api(path, options) {
    var opts = options || {};
    var headers = { "Content-Type": "application/json" };
    var token = getToken();
    if (token) headers.Authorization = "Bearer " + token;

    return fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!response.ok) {
            var error = new Error(data.error || "Request failed");
            error.status = response.status;
            error.data = data;
            throw error;
          }
          return data;
        });
    });
  }

  /* ----------------------------------------------------------------- auth */

  var cachedUser = null;

  function me(force) {
    if (cachedUser && !force) return Promise.resolve(cachedUser);
    if (!getToken()) return Promise.resolve(null);

    return api("/api/auth/me")
      .then(function (data) {
        cachedUser = data.user;
        return cachedUser;
      })
      .catch(function (err) {
        /* Only discard the token when the server explicitly rejects it (401/403).
           A network blip or 5xx must not log the user out. */
        if (err && (err.status === 401 || err.status === 403)) {
          setToken("");
        }
        cachedUser = null;
        return null;
      });
  }

  function signup(payload) {
    return api("/api/auth/signup", { method: "POST", body: payload }).then(function (data) {
      setToken(data.token);
      cachedUser = data.user;
      return data.user;
    });
  }

  function login(payload) {
    return api("/api/auth/login", { method: "POST", body: payload }).then(function (data) {
      setToken(data.token);
      cachedUser = data.user;
      return data.user;
    });
  }

  function logout() {
    return api("/api/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () {
        setToken("");
        cachedUser = null;
      });
  }

  /* Admin sign-in uses a dedicated, unlinked endpoint. Keeping it out of the
     public login() flow means admin credentials never touch the account page. */
  function adminLogin(payload) {
    return api("/api/admin/login", { method: "POST", body: payload }).then(function (data) {
      setToken(data.token);
      cachedUser = data.user;
      return data.user;
    });
  }

  function adminSession() {
    return api("/api/admin/session");
  }

  /* ------------------------------------------------------------ auth UI */

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join("");
  }

  function renderAuthSlots(user) {
    document.querySelectorAll("[data-auth-slot]").forEach(function (slot) {
      var loginHref = "/account.html";
      var next = slot.getAttribute("data-auth-next");
      if (next) loginHref += "?next=" + encodeURIComponent(next);

      if (!user) {
        slot.innerHTML = '<a href="' + loginHref + '">Login</a>';
        return;
      }

      slot.innerHTML =
        '<a class="account-chip" href="/account.html" title="' +
        escapeHtml(user.email) +
        '"><span class="account-chip__avatar">' +
        escapeHtml(initials(user.name)) +
        "</span><span>" +
        escapeHtml(user.name.split(" ")[0]) +
        "</span></a>" +
        '<button type="button" class="account-logout" data-logout>Log out</button>';
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-logout]");
    if (!button) return;
    event.preventDefault();
    logout().then(function () {
      window.location.href = "/";
    });
  });

  function refreshAuthUI() {
    return me(true).then(function (user) {
      renderAuthSlots(user);
      document.dispatchEvent(new CustomEvent("relm:auth", { detail: { user: user } }));
      return user;
    });
  }

  /* --------------------------------------------------------------- toast */

  function toast(message, variant) {
    var el = document.createElement("div");
    el.className = "toast toast--" + (variant || "info");
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.appendChild(el);

    requestAnimationFrame(function () {
      el.classList.add("is-visible");
    });

    setTimeout(function () {
      el.classList.remove("is-visible");
      setTimeout(function () {
        el.remove();
      }, 300);
    }, 4200);
  }

  /* --------------------------------------------------------- form helpers */

  function showErrors(form, errors) {
    clearErrors(form);
    var firstField = null;

    Object.keys(errors || {}).forEach(function (key) {
      var holder = form.querySelector('[data-error="' + key + '"]');
      if (holder) {
        holder.textContent = errors[key];
        holder.classList.add("is-visible");
      }

      var input = form.querySelector('[name="' + key + '"]');
      if (input) {
        var field = input.closest(".field") || input.parentElement;
        if (field) field.classList.add("field--error");
        if (!firstField) firstField = input;
      }
    });

    if (firstField) firstField.focus();
  }

  function clearErrors(form) {
    form.querySelectorAll("[data-error]").forEach(function (el) {
      el.textContent = "";
      el.classList.remove("is-visible");
    });
    form.querySelectorAll(".field--error").forEach(function (el) {
      el.classList.remove("field--error");
    });
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || "Please wait…";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  window.RELM = {
    api: api,
    me: me,
    signup: signup,
    login: login,
    adminLogin: adminLogin,
    adminSession: adminSession,
    logout: logout,
    getToken: getToken,
    refreshAuthUI: refreshAuthUI,
    renderAuthSlots: renderAuthSlots,
    toast: toast,
    showErrors: showErrors,
    clearErrors: clearErrors,
    setBusy: setBusy,
    escapeHtml: escapeHtml
  };

  document.addEventListener("DOMContentLoaded", function () {
    refreshAuthUI();
  });
})();
