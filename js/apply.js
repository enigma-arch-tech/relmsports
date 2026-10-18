/* ==========================================================================
   RELM Sports — tournament application form
   ========================================================================== */

(function () {
  "use strict";

  var RELM = window.RELM;
  var eventId = new URLSearchParams(window.location.search).get("event");

  // Keep the header "Login" link pointing back at this exact event.
  if (eventId) {
    document.querySelectorAll("[data-auth-slot]").forEach(function (slot) {
      slot.setAttribute("data-auth-next", "/apply.html?event=" + encodeURIComponent(eventId));
    });
  }

  var detail = document.getElementById("eventDetail");
  var formCard = document.getElementById("applyCard");
  var form = document.getElementById("applyForm");
  var picker = document.getElementById("eventPicker");
  var guestNotice = document.getElementById("guestNotice");
  var doneCard = document.getElementById("applyDone");
  var successText = document.getElementById("applyDoneText");
  var divisionSelect = document.getElementById("division");
  var heading = document.getElementById("applyHeading");
  var costSummary = document.getElementById("costSummary");
  var submitButton = form ? form.querySelector('button[type="submit"]') : null;
  var user = null;

  /* ------------------------------------------------------- formatting */

  function formatMoney(amount) {
    var value = Number(amount) || 0;
    return "$" + value.toLocaleString("en-CA");
  }

  function detailItem(label, value) {
    if (!value) return "";
    return "<div><dt>" + RELM.escapeHtml(label) + "</dt><dd>" + RELM.escapeHtml(value) + "</dd></div>";
  }

  /* ----------------------------------------------------- event detail */

  function renderDetail(ev) {
    document.title = "Apply — " + ev.title + " | RELM Sports";
    if (heading) heading.textContent = "Apply: " + ev.title;

    var groups = (ev.groups || [])
      .map(function (group) {
        return "<span>" + RELM.escapeHtml(group) + "</span>";
      })
      .join("");

    var facts = ev.detail || {};

    var feeRows = (ev.fees || [])
      .map(function (fee) {
        return (
          '<div class="fee-list__row"><dt>' +
          RELM.escapeHtml(fee.label) +
          "</dt><dd>" +
          RELM.escapeHtml(fee.value) +
          "</dd></div>"
        );
      })
      .join("");

    detail.innerHTML =
      '<div class="event-detail__media"><img src="' +
      RELM.escapeHtml(ev.image) +
      '" alt="' +
      RELM.escapeHtml(ev.title) +
      '" /></div>' +
      '<div class="event-detail__body">' +
      "<h2>" +
      RELM.escapeHtml(ev.title) +
      "</h2>" +
      '<ul class="t-meta">' +
      '<li><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><div><span class="t-meta__label">Date</span><span class="t-meta__value">' +
      RELM.escapeHtml(ev.date) +
      "</span></div></li>" +
      '<li><i class="fa-solid fa-location-dot" aria-hidden="true"></i><div><span class="t-meta__label">Location</span><span class="t-meta__value">' +
      RELM.escapeHtml(ev.location) +
      "</span></div></li>" +
      '<li><i class="fa-solid fa-dollar-sign" aria-hidden="true"></i><div><span class="t-meta__label">Cost</span><span class="t-meta__value">' +
      RELM.escapeHtml(ev.costLabel || "") +
      "</span></div></li>" +
      '<li><i class="fa-solid fa-people-group" aria-hidden="true"></i><div><span class="t-meta__label">Teams applied</span><span class="t-meta__value">' +
      RELM.escapeHtml(String(ev.registeredTeams || 0)) +
      "</span></div></li>" +
      "</ul>" +
      (feeRows
        ? '<div class="fee-panel"><h3 class="fee-panel__title"><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i> Tournament Fees</h3><dl class="fee-list">' +
          feeRows +
          "</dl></div>"
        : "") +
      (facts.ages || facts.levels || facts.sanction || facts.gameGuarantee || facts.contact
        ? '<dl class="event-facts">' +
          detailItem("Ages", facts.ages) +
          detailItem("Levels", facts.levels) +
          detailItem("Sanction #", facts.sanction) +
          detailItem("Game guarantee", facts.gameGuarantee) +
          detailItem("Contact", facts.contact) +
          "</dl>"
        : "") +
      '<p class="event-detail__label">Divisions offered</p>' +
      '<div class="event-detail__groups">' +
      groups +
      "</div>" +
      "</div>";
  }

  /* ------------------------------------------------------- event picker */

  function renderPicker(events) {
    if (!picker) return;
    picker.innerHTML = (events || [])
      .map(function (ev) {
        return (
          '<a class="picker-card" href="/apply.html?event=' +
          encodeURIComponent(ev.id) +
          '">' +
          '<span class="picker-card__media"><img src="' +
          RELM.escapeHtml(ev.image) +
          '" alt="' +
          RELM.escapeHtml(ev.title) +
          '" /></span>' +
          '<span class="picker-card__body">' +
          "<h3>" +
          RELM.escapeHtml(ev.title) +
          "</h3>" +
          '<span class="picker-card__meta">' +
          RELM.escapeHtml(ev.date) +
          " &middot; " +
          RELM.escapeHtml(ev.location) +
          "</span>" +
          (ev.costLabel
            ? '<span class="picker-card__price">' + RELM.escapeHtml(ev.costLabel) + "</span>"
            : "") +
          "</span></a>"
        );
      })
      .join("");

    picker.hidden = false;
    if (detail) detail.hidden = true;
    if (formCard) formCard.hidden = true;
  }

  /* --------------------------------------------------------- load error */

  function renderLoadError() {
    if (heading) heading.textContent = "Apply for a tournament";
    if (detail) {
      detail.hidden = false;
      detail.innerHTML =
        '<div class="event-detail__body">' +
        "<h2>We couldn&rsquo;t load this tournament</h2>" +
        "<p>The application service is temporarily unavailable. Please refresh the page, or " +
        '<a href="/tournaments.html">browse all tournaments</a> and try again.</p>' +
        "</div>";
    }
    if (formCard) formCard.hidden = true;
    if (guestNotice) guestNotice.hidden = true;
    if (picker) picker.hidden = true;
  }

  /* ------------------------------------------------------------ guard */

  function showGuest() {
    if (detail) detail.hidden = false;
    if (guestNotice) guestNotice.hidden = false;
    if (formCard) formCard.hidden = true;

    var next = "/apply.html?event=" + encodeURIComponent(eventId || "");
    guestNotice.querySelectorAll("[data-next-link]").forEach(function (link) {
      link.href = "/account.html?next=" + encodeURIComponent(next);
    });
    guestNotice.querySelectorAll("[data-next-link-register]").forEach(function (link) {
      link.href = "/account.html?next=" + encodeURIComponent(next) + "&tab=signup";
    });
  }

  /* ------------------------------------------------------- cost summary */

  function renderCostSummary(ev) {
    if (!costSummary || !form) return;

    var teams = Number(form.querySelector('[name="teams"]').value) || 1;
    if (teams < 1) teams = 1;

    var cost = Number(ev.cost) || 0;
    var total = cost * teams;

    if (!cost) {
      costSummary.hidden = true;
      return;
    }

    costSummary.hidden = false;
    costSummary.innerHTML =
      '<h3 class="cost-summary__title"><i class="fa-solid fa-sack-dollar" aria-hidden="true"></i> Your tournament cost</h3>' +
      '<dl class="cost-summary__list">' +
      '<div class="cost-summary__row"><dt>Registration</dt><dd>' +
      formatMoney(total) +
      "</dd></div>" +
      '<div class="cost-summary__row cost-summary__row--total"><dt>Total Cost</dt><dd>' +
      formatMoney(total) +
      "</dd></div>" +
      "</dl>" +
      '<p class="cost-summary__note">All amounts are in Canadian dollars. Tournament fees are confirmed once your entry is accepted.</p>';
  }

  /* ------------------------------------------------------------- form */

  function fillForm(ev, account) {
    divisionSelect.innerHTML =
      '<option value="">Select a division\u2026</option>' +
      (ev.groups || [])
        .map(function (group) {
          return (
            '<option value="' + RELM.escapeHtml(group) + '">' + RELM.escapeHtml(group) + "</option>"
          );
        })
        .join("");

    if (account) {
      form.querySelector('[name="contactName"]').value = account.name || "";
      form.querySelector('[name="email"]').value = account.email || "";
    }

    form.querySelector('[name="teams"]').addEventListener("input", function () {
      renderCostSummary(ev);
    });

    renderCostSummary(ev);
  }

  /* ----------------------------------------------------------- submit */

  function handleSubmit(event) {
    event.preventDefault();
    RELM.clearErrors(form);

    var payload = {
      eventId: eventId,
      teamName: form.querySelector('[name="teamName"]').value,
      contactName: form.querySelector('[name="contactName"]').value,
      email: form.querySelector('[name="email"]').value,
      division: form.querySelector('[name="division"]').value,
      teams: Number(form.querySelector('[name="teams"]').value) || 1,
      notes: form.querySelector('[name="notes"]').value
    };

    RELM.setBusy(submitButton, true, "Submitting\u2026");

    RELM.api("/api/applications", { method: "POST", body: payload })
      .then(function (result) {
        RELM.setBusy(submitButton, false);
        var app = result.application;

        successText.innerHTML =
          "Your application for <strong>" +
          RELM.escapeHtml(app.event.title) +
          "</strong> (" +
          RELM.escapeHtml(app.division) +
          (app.teams > 1 ? ", " + app.teams + " teams" : "") +
          ") has been received. Total tournament cost: <strong>" +
          formatMoney(app.total) +
          "</strong>, with a deposit of <strong>" +
          formatMoney(app.depositDue) +
          "</strong> due at registration. We will email " +
          RELM.escapeHtml(app.email) +
          " once your spot is confirmed.";

        formCard.hidden = true;
        doneCard.hidden = false;
        doneCard.scrollIntoView({ behavior: "smooth", block: "center" });
      })
      .catch(function (err) {
        RELM.setBusy(submitButton, false);
        var errors =
          (err && err.data && err.data.errors) || {
            form: (err && err.message) || "Something went wrong. Please try again."
          };
        RELM.showErrors(form, errors);
      });
  }

  /* ------------------------------------------------------------- boot */

  function loadEvents() {
    return RELM.api("/api/events").then(function (data) {
      return data.events || [];
    });
  }

  function init() {
    if (!eventId) {
      if (heading) heading.textContent = "Choose a tournament";
      loadEvents()
        .then(renderPicker)
        .catch(function () {
          renderLoadError();
          RELM.toast("Could not load tournaments.", "error");
        });
      return;
    }

    loadEvents()
      .then(function (events) {
        var ev = events.find(function (item) {
          return item.id === eventId;
        });

        if (!ev) {
          if (heading) heading.textContent = "Choose a tournament";
          renderPicker(events);
          return;
        }

        renderDetail(ev);

        return RELM.me().then(function (account) {
          user = account;
          if (!account) {
            showGuest();
            return;
          }
          formCard.hidden = false;
          fillForm(ev, account);
        });
      })
      .catch(function () {
        renderLoadError();
        RELM.toast("Could not load this tournament.", "error");
      });
  }

  if (form) form.addEventListener("submit", handleSubmit);
  init();
})();
