/* ==========================================================================
   RELM Sports — administrator sign in (/admin/login)

   The credentials are checked server-side by POST /api/admin/login against
   ADMIN_EMAIL / ADMIN_PASSWORD. Nothing about the admin account is stored in
   this file or anywhere in the client bundle.
   ========================================================================== */

(function () {
  "use strict";

  var RELM = window.RELM;
  var form = document.getElementById("adminLoginForm");

  // Already signed in as an administrator? Go straight to the dashboard.
  RELM.adminSession()
    .then(function () {
      window.location.replace("/admin.html");
    })
    .catch(function () {
      /* not signed in — stay on this page */
    });

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var email = form.querySelector('[name="email"]').value.trim();
    var password = form.querySelector('[name="password"]').value;
    var submit = form.querySelector('button[type="submit"]');

    RELM.clearErrors(form);
    RELM.setBusy(submit, true, "Signing in\u2026");

    RELM.adminLogin({ email: email, password: password })
      .then(function () {
        window.location.replace("/admin.html");
      })
      .catch(function (err) {
        RELM.setBusy(submit, false);
        RELM.showErrors(form, (err.data && err.data.errors) || { form: err.message });
      });
  });
})();
