/* ==========================================================================
   RELM Sports — replica interactions
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------ sticky header shadow */
  var header = document.getElementById("siteHeader");

  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ------------------------------------------------ mobile navigation */
  var nav = document.getElementById("mainNav");
  var navToggle = document.getElementById("navToggle");
  var navClose = document.getElementById("navClose");
  var backdrop = document.getElementById("navBackdrop");

  function openNav() {
    if (!nav) return;
    nav.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeNav() {
    if (!nav) return;
    nav.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-open");
    document.body.style.overflow = "";
    nav.querySelectorAll("li.is-open").forEach(function (li) {
      li.classList.remove("is-open");
    });
  }

  if (navToggle) navToggle.addEventListener("click", openNav);
  if (navClose) navClose.addEventListener("click", closeNav);
  if (backdrop) backdrop.addEventListener("click", closeNav);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeNav();
  });

  /* expand dropdowns on touch / small screens */
  document.querySelectorAll(".nav__list > li.has-dropdown").forEach(function (li) {
    var link = li.querySelector(":scope > a");
    if (!link) return;

    link.addEventListener("click", function (e) {
      if (window.matchMedia("(max-width: 991px)").matches) {
        e.preventDefault();
        li.classList.toggle("is-open");
      }
    });
  });

  /* ------------------------------------------------ hero slideshow */
  var slides = document.querySelectorAll(".hero__slides span");

  if (slides.length > 1) {
    var current = 0;
    slides[current].classList.add("is-active");

    setInterval(function () {
      slides[current].classList.remove("is-active");
      current = (current + 1) % slides.length;
      slides[current].classList.add("is-active");
    }, 6000);
  } else if (slides.length === 1) {
    slides[0].classList.add("is-active");
  }

  /* ------------------------------------------------ news category filters */
  var filterBar = document.querySelector("[data-filters]");

  if (filterBar) {
    var filterButtons = filterBar.querySelectorAll("button");
    var cards = document.querySelectorAll("[data-categories]");

    filterBar.addEventListener("click", function (e) {
      var button = e.target.closest("button");
      if (!button) return;

      var filter = button.getAttribute("data-filter");

      filterButtons.forEach(function (b) {
        b.classList.toggle("is-active", b === button);
      });

      cards.forEach(function (card) {
        var cats = card.getAttribute("data-categories") || "";
        var show = filter === "all" || cats.split(" ").indexOf(filter) > -1;
        card.style.display = show ? "" : "none";
      });
    });
  }

  /* ------------------------------------------------ newsletter form */
  document.querySelectorAll("[data-validate]").forEach(function (form) {
    var message = form.parentElement.querySelector(".form-message");
    var isSubscribe = form.hasAttribute("data-subscribe");

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var invalid = false;

      form.querySelectorAll("input[required], textarea[required]").forEach(function (input) {
        var field = input.closest(".field");
        var ok = input.checkValidity() && input.value.trim() !== "";

        if (field) field.classList.toggle("field--error", !ok);
        if (!ok) invalid = true;
      });

      if (!message) return;

      message.classList.remove("form-message--ok", "form-message--error");
      message.classList.add("is-visible");

      if (invalid) {
        message.classList.add("form-message--error");
        message.textContent = "Please check the highlighted fields and try again.";
        return;
      }

      message.classList.add("form-message--ok");
      message.textContent = isSubscribe
        ? "Thanks! You are signed up for RELM news and updates."
        : "Thanks for reaching out — we will get back to you shortly.";

      form.reset();
    });

    form.querySelectorAll("input, textarea").forEach(function (input) {
      input.addEventListener("input", function () {
        var field = input.closest(".field");
        if (field && input.checkValidity()) field.classList.remove("field--error");
      });
    });
  });

  /* ------------------------------------------------ current year */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
})();
