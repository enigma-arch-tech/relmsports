/* ==========================================================================
   RELM Sports — admin dashboard (all tournament applications)
   ========================================================================== */

(function () {
  "use strict";

  var RELM = window.RELM;
  var table = document.getElementById("adminTable");
  var body = document.getElementById("adminRows");
  var gate = document.getElementById("adminGate");
  var dashboard = document.getElementById("adminDashboard");
  var countEl = document.getElementById("adminCount");
  var searchInput = document.getElementById("adminSearch");
  var exportButton = document.getElementById("adminExport");
  var applications = [];
  var query = "";

  var STATUS_LABEL = {
    pending: "Pending",
    confirmed: "Confirmed",
    declined: "Declined",
    withdrawn: "Withdrawn"
  };

  function formatDate(value) {
    if (!value) return "";
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatMoney(amount) {
    return "$" + (Number(amount) || 0).toLocaleString("en-CA");
  }

  function matches(app) {
    if (!query) return true;
    var haystack = [
      app.teamName,
      app.contactName,
      app.email,
      app.division,
      app.event ? app.event.title : "",
      app.account ? app.account.name : ""
    ]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(query) > -1;
  }

  function render() {
    var rows = applications.filter(matches);
    body.innerHTML = "";

    countEl.textContent =
      rows.length + " of " + applications.length + " application" + (applications.length === 1 ? "" : "s");

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="admin-empty">No applications match your search yet.</td></tr>';
      return;
    }

    rows.forEach(function (app) {
      var tr = document.createElement("tr");
      var event = app.event || {};
      var teams = Number(app.teams) || 1;
      var costPerTeam = Number(app.costPerTeam) || Number(event.cost) || 0;
      var total = Number(app.total) || costPerTeam * teams;
      var depositDue = Number(app.depositDue) || (Number(event.deposit) || 0) * teams;

      tr.innerHTML =
        "<td><strong>" +
        RELM.escapeHtml(app.teamName) +
        "</strong><br /><span class=\"muted\">" +
        RELM.escapeHtml(event.title || "Unknown event") +
        " &middot; " +
        RELM.escapeHtml(event.date || "") +
        "</span></td>" +
        "<td>" +
        RELM.escapeHtml(app.division) +
        "</td>" +
        "<td>" +
        RELM.escapeHtml(String(app.teams)) +
        "</td>" +
        "<td>" +
        (costPerTeam
          ? RELM.escapeHtml(formatMoney(costPerTeam)) +
            "<br /><span class=\"muted\">" +
            RELM.escapeHtml(formatMoney(total)) +
            " total" +
            (depositDue ? " &middot; " + RELM.escapeHtml(formatMoney(depositDue)) + " deposit" : "") +
            "</span>"
          : '<span class="muted">—</span>') +
        "</td>" +
        "<td>" +
        RELM.escapeHtml(app.contactName) +
        "<br /><span class=\"muted\">" +
        RELM.escapeHtml(app.email) +
        "</span></td>" +
        "<td>" +
        RELM.escapeHtml(app.email) +
        "</td>" +
        "<td>" +
        RELM.escapeHtml(formatDate(app.createdAt)) +
        "</td>" +
        '<td><span class="status status--' +
        RELM.escapeHtml(app.status) +
        '">' +
        RELM.escapeHtml(STATUS_LABEL[app.status] || app.status) +
        "</span></td>" +
        '<td class="admin-actions">' +
        '<button type="button" data-set="confirmed" data-id="' + RELM.escapeHtml(app.id) + '">Confirm</button>' +
        '<button type="button" data-set="declined" data-id="' + RELM.escapeHtml(app.id) + '">Decline</button>' +
        '<button type="button" data-set="pending" data-id="' + RELM.escapeHtml(app.id) + '">Reset</button>' +
        "</td>";

      body.appendChild(tr);
    });
  }

  function load() {
    return RELM.api("/api/admin/applications").then(function (data) {
      applications = data.applications || [];
      render();
    });
  }

  body.addEventListener("click", function (event) {
    var button = event.target.closest("[data-set]");
    if (!button) return;

    var id = button.getAttribute("data-id");
    var status = button.getAttribute("data-set");

    button.disabled = true;
    RELM.api("/api/applications/" + id, { method: "PATCH", body: { status: status } })
      .then(function () {
        RELM.toast("Application marked " + status + ".", "ok");
        return load();
      })
      .catch(function (err) {
        RELM.toast(err.message, "error");
        button.disabled = false;
      });
  });

  searchInput.addEventListener("input", function () {
    query = searchInput.value.trim().toLowerCase();
    render();
  });

  exportButton.addEventListener("click", function () {
    var header = ["Event", "Team", "Division", "Teams", "Fee per team", "Total (CAD)", "Deposit due", "Contact", "Email", "Status", "Submitted", "Notes"];
    var lines = [header.join(",")];

    applications.forEach(function (app) {
      var event = app.event || {};
      var teams = Number(app.teams) || 1;
      var costPerTeam = Number(app.costPerTeam) || Number(event.cost) || 0;
      var total = Number(app.total) || costPerTeam * teams;
      var depositDue = Number(app.depositDue) || (Number(event.deposit) || 0) * teams;
      lines.push(
        [
          event.title || "",
          app.teamName,
          app.division,
          app.teams,
          costPerTeam || "",
          total || "",
          depositDue || "",
          app.contactName,
          app.email,
          STATUS_LABEL[app.status] || app.status,
          formatDate(app.createdAt),
          app.notes || ""
        ]
          .map(function (value) {
            return '"' + String(value).replace(/"/g, '""') + '"';
          })
          .join(",")
      );
    });

    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "relm-applications.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  /* --------------------------------------------------------------- init */

  // Route guard: anyone who is not signed in as an administrator is sent to
  // the unlinked admin sign-in page. The data itself is also protected
  // server-side (/api/admin/* requires the admin role).
  RELM.me().then(function (user) {
    if (!user || user.role !== "admin") {
      window.location.replace("/admin/login");
      return;
    }
    dashboard.hidden = false;
    if (gate) gate.hidden = true;
    load().catch(function (err) {
      RELM.toast(err.message, "error");
    });
  });
})();
