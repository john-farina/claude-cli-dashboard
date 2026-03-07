(function() {
  "use strict";

  let _activeCard = null;
  let _searchBar = null;
  let _matches = [];
  let _currentMatch = -1;
  let _originalHTML = null;

  function openForCard(card) {
    if (_activeCard === card && _searchBar && !_searchBar.classList.contains("hidden")) {
      _searchBar.querySelector("input").focus();
      _searchBar.querySelector("input").select();
      return;
    }
    closeSearch();
    _activeCard = card;

    if (!_searchBar) {
      _searchBar = document.createElement("div");
      _searchBar.className = "output-search-bar";
      _searchBar.innerHTML = `
        <input type="text" placeholder="Search output..." spellcheck="false" autocomplete="off">
        <span class="output-search-count"></span>
        <button class="output-search-prev" title="Previous (Shift+Enter)">&#9650;</button>
        <button class="output-search-next" title="Next (Enter)">&#9660;</button>
        <button class="output-search-close" title="Close (Esc)">&times;</button>
      `;

      const input = _searchBar.querySelector("input");
      const countEl = _searchBar.querySelector(".output-search-count");

      input.addEventListener("input", () => {
        _doSearch(input.value, countEl);
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) prevMatch(); else nextMatch();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
        }
      });

      _searchBar.querySelector(".output-search-prev").addEventListener("click", prevMatch);
      _searchBar.querySelector(".output-search-next").addEventListener("click", nextMatch);
      _searchBar.querySelector(".output-search-close").addEventListener("click", closeSearch);
    }

    // Insert search bar at top of terminal area
    const terminal = card.querySelector(".terminal");
    if (terminal) {
      terminal.parentNode.insertBefore(_searchBar, terminal);
      _originalHTML = terminal.innerHTML;
    }

    _searchBar.classList.remove("hidden");
    _searchBar.querySelector("input").value = "";
    _searchBar.querySelector(".output-search-count").textContent = "";
    _searchBar.querySelector("input").focus();
  }

  function closeSearch() {
    if (_searchBar) _searchBar.classList.add("hidden");
    // Restore original terminal HTML (remove highlights)
    if (_activeCard && _originalHTML !== null) {
      const terminal = _activeCard.querySelector(".terminal");
      if (terminal) terminal.innerHTML = _originalHTML;
    }
    _matches = [];
    _currentMatch = -1;
    _originalHTML = null;
    _activeCard = null;
  }

  function _doSearch(query, countEl) {
    if (!_activeCard) return;
    const terminal = _activeCard.querySelector(".terminal");
    if (!terminal || !_originalHTML) return;

    _matches = [];
    _currentMatch = -1;

    if (!query || query.length < 2) {
      terminal.innerHTML = _originalHTML;
      countEl.textContent = "";
      return;
    }

    // Highlight matches in terminal text nodes
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("(" + escaped + ")", "gi");

    // Restore original HTML first, then walk text nodes
    terminal.innerHTML = _originalHTML;
    const walker = document.createTreeWalker(terminal, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    let matchIndex = 0;
    for (const node of textNodes) {
      if (!regex.test(node.textContent)) continue;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;
      while ((match = regex.exec(node.textContent)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx, match.index)));
        }
        const mark = document.createElement("mark");
        mark.className = "output-search-highlight";
        mark.dataset.matchIndex = matchIndex++;
        mark.textContent = match[0];
        frag.appendChild(mark);
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < node.textContent.length) {
        frag.appendChild(document.createTextNode(node.textContent.slice(lastIdx)));
      }
      node.parentNode.replaceChild(frag, node);
    }

    _matches = terminal.querySelectorAll(".output-search-highlight");
    countEl.textContent = _matches.length > 0 ? _matches.length + " found" : "No matches";

    if (_matches.length > 0) {
      // Start at last match (most recent output) for better UX
      _currentMatch = _matches.length - 1;
      _highlightCurrent();
    }
  }

  function nextMatch() {
    if (_matches.length === 0) return;
    _currentMatch = (_currentMatch + 1) % _matches.length;
    _highlightCurrent();
  }

  function prevMatch() {
    if (_matches.length === 0) return;
    _currentMatch = (_currentMatch - 1 + _matches.length) % _matches.length;
    _highlightCurrent();
  }

  function _highlightCurrent() {
    _matches.forEach((m, i) => {
      m.classList.toggle("current", i === _currentMatch);
    });
    if (_matches[_currentMatch]) {
      _matches[_currentMatch].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (_searchBar) {
      const countEl = _searchBar.querySelector(".output-search-count");
      countEl.textContent = (_currentMatch + 1) + " of " + _matches.length;
    }
  }

  function isOpen() {
    return _activeCard !== null && _searchBar && !_searchBar.classList.contains("hidden");
  }

  window.OutputSearch = { openForCard, closeSearch, isOpen, nextMatch, prevMatch };
})();
