(function () {
  "use strict";

  // ---- Theme toggle ----
  var root = document.documentElement;
  var stored = localStorage.getItem("theme");
  if (stored) root.setAttribute("data-theme", stored);

  var toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var current = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
      var next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
    });
  }

  // ---- Catalogue filter + search (progressive enhancement) ----
  var grid = document.getElementById("project-grid");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".card"));
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  var search = document.getElementById("search");
  var noResults = document.getElementById("no-results");
  var activeFilter = "all";

  function applyFilters() {
    var query = search ? search.value.trim().toLowerCase() : "";
    var visibleCount = 0;
    cards.forEach(function (card) {
      var matchesStatus = activeFilter === "all" || card.dataset.status === activeFilter;
      var matchesQuery = !query || card.dataset.search.indexOf(query) !== -1;
      var visible = matchesStatus && matchesQuery;
      card.hidden = !visible;
      if (visible) visibleCount++;
    });
    if (noResults) noResults.hidden = visibleCount !== 0;
  }

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      chips.forEach(function (c) { c.classList.remove("is-active"); });
      chip.classList.add("is-active");
      activeFilter = chip.dataset.filter;
      applyFilters();
    });
  });

  if (search) {
    search.addEventListener("input", applyFilters);
  }
})();
