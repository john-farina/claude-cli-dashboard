// --- Accent Color Presets ---
const ACCENT_PRESETS = {
  gold:   { accent: "#c9a84c", hover: "#d4b55a", r: 201, g: 168, b: 76 },
  cyan:   { accent: "#00e5ff", hover: "#1ee8ff", r: 0,   g: 229, b: 255 },
  rose:   { accent: "#c64c75", hover: "#ce6387", r: 198, g: 76,  b: 117 },
  violet: { accent: "#894cc6", hover: "#9863ce", r: 137, g: 76,  b: 198 },
  green:  { accent: "#4cc67f", hover: "#63ce90", r: 76,  g: 198, b: 127 },
  orange: { accent: "#c67f4c", hover: "#ce9063", r: 198, g: 127, b: 76 },
  blue:   { accent: "#4c7fc6", hover: "#6390ce", r: 76,  g: 127, b: 198 },
  coral:  { accent: "#c6614c", hover: "#ce7563", r: 198, g: 97,  b: 76 },
};

const CLAUDE_STAR_PATH = "M 233.96 800.21 L 468.64 668.54 472.59 657.1 468.64 650.74 457.21 650.74 417.99 648.32 283.89 644.7 167.6 639.87 54.93 633.83 26.58 627.79 0 592.75 2.74 575.28 26.58 559.25 60.72 562.23 136.19 567.38 249.42 575.19 331.57 580.03 453.26 592.67 472.59 592.67 475.33 584.86 468.72 580.03 463.57 575.19 346.39 495.79 219.54 411.87 153.1 363.54 117.18 339.06 99.06 316.11 91.25 266.01 123.87 230.09 167.68 233.07 178.87 236.05 223.25 270.2 318.04 343.57 441.83 434.74 459.95 449.8 467.19 444.64 468.08 441.02 459.95 427.41 392.62 305.72 320.78 181.93 288.81 130.63 280.35 99.87 C 277.37 87.22 275.19 76.59 275.19 63.62 L 312.32 13.21 332.86 6.6 382.39 13.21 403.25 31.33 434.01 101.72 483.87 212.54 561.18 363.22 583.81 407.92 595.89 449.32 600.4 461.96 608.21 461.96 608.21 454.71 614.58 369.83 626.34 265.61 637.77 131.52 641.72 93.75 660.4 48.48 697.53 24 726.52 37.85 750.36 72 747.06 94.07 732.89 186.2 705.1 330.52 686.98 427.17 697.53 427.17 709.61 415.09 758.5 350.17 840.64 247.49 876.89 206.74 919.17 161.72 946.31 140.3 997.61 140.3 1035.38 196.43 1018.47 254.42 965.64 321.42 921.83 378.2 859.01 462.77 819.79 530.42 823.41 535.81 832.75 534.93 974.66 504.72 1051.33 490.87 1142.82 475.17 1184.21 494.5 1188.72 514.15 1172.46 554.34 1074.6 578.5 959.84 601.45 788.94 641.88 786.85 643.41 789.26 646.39 866.26 653.64 899.19 655.41 979.81 655.41 1129.93 666.6 1169.15 692.54 1192.67 724.27 1188.72 748.43 1128.32 779.19 1046.82 759.87 856.59 714.6 791.36 698.34 782.34 698.34 782.34 703.73 836.7 756.89 936.32 846.85 1061.07 962.82 1067.44 991.49 1051.41 1014.12 1034.5 1011.7 924.89 929.23 882.6 892.11 786.85 811.49 780.48 811.49 780.48 819.95 802.55 852.24 919.09 1027.41 925.13 1081.13 916.67 1098.6 886.47 1109.15 853.29 1103.11 785.07 1007.36 714.68 899.52 657.91 802.87 650.98 806.82 617.48 1167.7 601.77 1186.15 565.53 1200 535.33 1177.05 519.3 1139.92 535.33 1066.55 554.66 970.79 570.36 894.68 584.54 800.13 592.99 768.72 592.43 766.63 585.5 767.52 514.23 865.37 405.83 1011.87 320.05 1103.68 299.52 1111.81 263.92 1093.37 267.22 1060.43 287.11 1031.11 405.83 880.11 477.42 786.52 523.65 732.48 523.33 724.67 520.59 724.67 205.29 929.4 149.15 936.64 124.99 914.01 127.97 876.89 139.41 864.81 234.2 799.57 233.88 799.89 Z";

function _hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
}

function _isLight(hex) {
  const { r, g, b } = _hexToRgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 128;
}

function _lightenHex(hex, amount) {
  const { r, g, b } = _hexToRgb(hex);
  const lr = Math.min(255, r + amount);
  const lg = Math.min(255, g + amount);
  const lb = Math.min(255, b + amount);
  return "#" + [lr, lg, lb].map(v => v.toString(16).padStart(2, "0")).join("");
}

function applyAccentColor(key) {
  // Resolve to accent hex + rgb — either from presets or a raw hex value
  let accent, hover, r, g, b;
  const preset = ACCENT_PRESETS[key];
  if (preset) {
    ({ accent, hover, r, g, b } = preset);
  } else if (/^#[0-9a-fA-F]{6}$/.test(key)) {
    accent = key;
    hover = _lightenHex(key, 20);
    ({ r, g, b } = _hexToRgb(key));
  } else {
    return;
  }
  const s = document.documentElement.style;
  s.setProperty("--accent", accent);
  s.setProperty("--accent-hover", hover);
  s.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.22)`);
  s.setProperty("--accent-subtle", `rgba(${r}, ${g}, ${b}, 0.07)`);
  s.setProperty("--border-glow", `rgba(${r}, ${g}, ${b}, 0.15)`);
  s.setProperty("--card-shadow-hover", `0 8px 40px rgba(0,0,0,0.5), 0 0 24px rgba(${r},${g},${b},0.07)`);
  s.setProperty("--header-border", `rgba(${r}, ${g}, ${b}, 0.12)`);
  s.setProperty("--status-asking-bg", `rgba(${r}, ${g}, ${b}, 0.1)`);
  s.setProperty("--status-asking-color", accent);
  // Update favicon to match accent color
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 1200 1200"><path fill="${accent}" d="${CLAUDE_STAR_PATH}"/></svg>`;
  const faviconEl = document.querySelector('link[rel="icon"]');
  if (faviconEl) faviconEl.href = "data:image/svg+xml," + encodeURIComponent(faviconSvg);
}

// --- Background Color System ---
// One base color → all surface/border/text-dim variants derived automatically.
// Offsets match the default theme: #121212 base with warm-tinted lighter layers.
const BG_PRESETS = {
  default:  "#121212",
  midnight: "#11141e",
  ember:    "#1c120e",
  plum:     "#18101e",
  forest:   "#0e1812",
};

function _getCustomBgColors() {
  try { return JSON.parse(localStorage.getItem("customBgColors") || "[]"); } catch { return []; }
}

function _saveCustomBgColors(colors) {
  localStorage.setItem("customBgColors", JSON.stringify(colors));
}

// Highlight the active swatch in a color grid via .active class.
function _highlightSwatch(gridId, dataAttr, activeKey) {
  const swatches = document.querySelectorAll("#" + gridId + " .accent-swatch");
  const escaped = CSS.escape(activeKey);
  const target = document.querySelector("#" + gridId + " [" + dataAttr + '="' + escaped + '"]');
  swatches.forEach(s => s.classList.remove("active"));
  if (target) target.classList.add("active");
  requestAnimationFrame(() => {
    swatches.forEach(s => { if (s !== target) s.classList.remove("active"); });
    if (target) target.classList.add("active");
  });
}

function _selectBg(key) {
  const hex = BG_PRESETS[key] || key;
  if (hex === BG_PRESETS.default) {
    localStorage.removeItem("bgColor");
    _removeBgOverrides();
  } else {
    localStorage.setItem("bgColor", hex);
    applyBgColor(hex);
  }
  _highlightSwatch("bg-color-grid", "data-bg", key);
  fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bgColor: hex === BG_PRESETS.default ? null : hex }),
  }).catch(() => {});
}

let _iroBgPicker = null;
let _bgColorBeforeOpen = null;

function renderBgGrid(grid) {
  const current = localStorage.getItem("bgColor") || "default";
  grid.innerHTML = "";

  // Built-in presets
  for (const [key, hex] of Object.entries(BG_PRESETS)) {
    const isActive = (key === "default" && !localStorage.getItem("bgColor")) || hex === current;
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    swatch.style.background = hex;
    swatch.title = key.charAt(0).toUpperCase() + key.slice(1);
    swatch.setAttribute("data-bg", key);
    swatch.addEventListener("click", () => {
      _closeBgPicker();
      _selectBg(key);
    });
    grid.appendChild(swatch);
  }

  // Custom colors
  const customs = _getCustomBgColors();
  for (const hex of customs) {
    const isActive = hex === current;
    const wrap = document.createElement("span");
    wrap.className = "accent-swatch-wrap";
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.setAttribute("data-bg", hex);
    swatch.addEventListener("click", () => {
      _closeBgPicker();
      _selectBg(hex);
    });
    const del = document.createElement("button");
    del.className = "accent-swatch-delete";
    del.textContent = "×";
    del.title = "Remove custom color";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const updated = _getCustomBgColors().filter(c => c !== hex);
      _saveCustomBgColors(updated);
      if (current === hex) _selectBg("default");
      renderBgGrid(grid);
    });
    wrap.appendChild(swatch);
    wrap.appendChild(del);
    grid.appendChild(wrap);
  }

  // "+" button
  const addBtn = document.createElement("button");
  addBtn.className = "accent-swatch accent-swatch-add";
  addBtn.textContent = "+";
  addBtn.title = "Add custom background color";
  addBtn.addEventListener("click", () => _openBgPicker(grid));
  grid.appendChild(addBtn);
}

function _openBgPicker(grid) {
  const container = document.getElementById("bg-picker-container");
  const wheelEl = document.getElementById("bg-picker-wheel");
  if (!container || !wheelEl) return;

  _bgColorBeforeOpen = localStorage.getItem("bgColor") || BG_PRESETS.default;
  container.classList.remove("hidden");

  if (!_iroBgPicker) {
    _iroBgPicker = new iro.ColorPicker("#bg-picker-wheel", {
      width: 220,
      color: _bgColorBeforeOpen,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.1)",
      handleRadius: 8,
      layout: [
        { component: iro.ui.Wheel, options: {} },
        { component: iro.ui.Slider, options: { sliderType: "value" } },
      ],
    });
    _iroBgPicker.on("color:change", (color) => {
      applyBgColor(color.hexString);
    });

  } else {
    _iroBgPicker.color.hexString = _bgColorBeforeOpen;
  }
}

function _closeBgPicker() {
  const container = document.getElementById("bg-picker-container");
  if (container) container.classList.add("hidden");
}

document.getElementById("bg-picker-save").onclick = () => {
  if (!_iroBgPicker) return;
  const hex = _iroBgPicker.color.hexString.toLowerCase();
  const customs = _getCustomBgColors();
  const isPreset = Object.values(BG_PRESETS).includes(hex);
  if (!isPreset && !customs.includes(hex)) {
    customs.push(hex);
    _saveCustomBgColors(customs);
  }
  _selectBg(hex);
  // Rebuild grid to show new custom swatch
  const grid = document.getElementById("bg-color-grid");
  if (grid) renderBgGrid(grid);
  _closeBgPicker();
};

document.getElementById("bg-picker-cancel").onclick = () => {
  if (_bgColorBeforeOpen && _bgColorBeforeOpen !== BG_PRESETS.default) {
    applyBgColor(_bgColorBeforeOpen);
  } else {
    _removeBgOverrides();
  }
  _closeBgPicker();
};

// --- Terminal Color System ---
// Independent terminal background color. "Auto" = derived from bg color (default behavior).
const TERMINAL_PRESETS = {
  auto:     null,       // derived from bg color
  default:  "#0e0e0d",  // the original CSS default
  midnight: "#0c0e16",
  ember:    "#140e0a",
  plum:     "#120a16",
};

function applyTerminalColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  document.documentElement.style.setProperty("--terminal-bg", hex);
  _applyTerminalTextColor(hex);
}

// Default AnsiUp palette (first 16 entries) — saved on first call
let _ansiUpDefaultPalette = null;
const _ansiLightPalette = [
  // black,       red,         green,       yellow,      blue,        magenta,     cyan,        white
  [0x1a,0x1a,0x1a],[0xcf,0x22,0x2e],[0x1a,0x7f,0x37],[0x7a,0x6a,0x00],[0x05,0x50,0xae],[0x82,0x50,0xdf],[0x0c,0x7d,0x9d],[0x55,0x55,0x55],
  // bright: black, red,       green,       yellow,      blue,        magenta,     cyan,        white
  [0x66,0x66,0x66],[0xd1,0x24,0x2f],[0x1a,0x9f,0x37],[0x8a,0x75,0x00],[0x09,0x69,0xda],[0x82,0x50,0xdf],[0x0c,0x7d,0x9d],[0x1a,0x1a,0x1a],
];

function _applyTerminalTextColor(hex) {
  const s = document.documentElement.style;
  const light = _isLight(hex);
  if (light) {
    s.setProperty("--terminal-text", "#1a1a1a");
    s.setProperty("--terminal-text-dim", "#555");
    s.setProperty("--terminal-link-color", "#333");
  } else {
    s.removeProperty("--terminal-text");
    s.removeProperty("--terminal-text-dim");
    s.removeProperty("--terminal-link-color");
  }
  // Swap AnsiUp palette for light/dark terminal (ansiUp may not be initialized yet during early theme load)
  try {
    if (ansiUp && ansiUp.palette_256) {
      if (!_ansiUpDefaultPalette) _ansiUpDefaultPalette = ansiUp.palette_256.slice(0, 16).map(c => [...c]);
      const src = light ? _ansiLightPalette : _ansiUpDefaultPalette;
      for (let i = 0; i < 16; i++) ansiUp.palette_256[i] = [...src[i]];
    }
  } catch (_) { /* ansiUp not yet initialized */ }
}

function _getCustomTerminalColors() {
  try { return JSON.parse(localStorage.getItem("customTerminalColors") || "[]"); } catch { return []; }
}

function _saveCustomTerminalColors(colors) {
  localStorage.setItem("customTerminalColors", JSON.stringify(colors));
}

function _selectTerminal(key) {
  if (key === "auto") {
    localStorage.removeItem("terminalColor");
    document.documentElement.style.removeProperty("--terminal-bg");
    document.documentElement.style.removeProperty("--terminal-text");
    document.documentElement.style.removeProperty("--terminal-text-dim");
    document.documentElement.style.removeProperty("--terminal-link-color");
    const bg = localStorage.getItem("bgColor");
    if (bg) applyBgColor(bg);
  } else {
    const hex = TERMINAL_PRESETS[key] || key;
    localStorage.setItem("terminalColor", hex);
    applyTerminalColor(hex);
  }
  _highlightSwatch("terminal-color-grid", "data-terminal", key);
}

let _iroTerminalPicker = null;
let _terminalColorBeforeOpen = null;

function renderTerminalGrid(grid) {
  const current = localStorage.getItem("terminalColor");
  grid.innerHTML = "";

  for (const [key, hex] of Object.entries(TERMINAL_PRESETS)) {
    const isActive = (key === "auto" && !current) || (hex && hex === current);
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    if (key === "auto") {
      // Show a gradient/auto indicator
      swatch.style.background = "conic-gradient(#0e0e0d, #080c18, #0a0a0a, #0e0e0d)";
      swatch.title = "Auto (derived from background)";
    } else {
      swatch.style.background = hex;
      swatch.title = key.charAt(0).toUpperCase() + key.slice(1);
    }
    swatch.setAttribute("data-terminal", key);
    swatch.addEventListener("click", () => {
      _closeTerminalPicker();
      _selectTerminal(key);
    });
    grid.appendChild(swatch);
  }

  const customs = _getCustomTerminalColors();
  for (const hex of customs) {
    const isActive = hex === current;
    const wrap = document.createElement("span");
    wrap.className = "accent-swatch-wrap";
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.setAttribute("data-terminal", hex);
    swatch.addEventListener("click", () => {
      _closeTerminalPicker();
      _selectTerminal(hex);
    });
    const del = document.createElement("button");
    del.className = "accent-swatch-delete";
    del.textContent = "×";
    del.title = "Remove custom color";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const updated = _getCustomTerminalColors().filter(c => c !== hex);
      _saveCustomTerminalColors(updated);
      if (current === hex) _selectTerminal("auto");
      renderTerminalGrid(grid);
    });
    wrap.appendChild(swatch);
    wrap.appendChild(del);
    grid.appendChild(wrap);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "accent-swatch accent-swatch-add";
  addBtn.textContent = "+";
  addBtn.title = "Add custom terminal color";
  addBtn.addEventListener("click", () => _openTerminalPicker(grid));
  grid.appendChild(addBtn);
}

function _openTerminalPicker(grid) {
  const container = document.getElementById("terminal-picker-container");
  const wheelEl = document.getElementById("terminal-picker-wheel");
  if (!container || !wheelEl) return;

  _terminalColorBeforeOpen = localStorage.getItem("terminalColor") || TERMINAL_PRESETS.default;
  container.classList.remove("hidden");

  if (!_iroTerminalPicker) {
    _iroTerminalPicker = new iro.ColorPicker("#terminal-picker-wheel", {
      width: 220,
      color: _terminalColorBeforeOpen,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.1)",
      handleRadius: 8,
      layout: [
        { component: iro.ui.Wheel, options: {} },
        { component: iro.ui.Slider, options: { sliderType: "value" } },
      ],
    });
    _iroTerminalPicker.on("color:change", (color) => {
      applyTerminalColor(color.hexString);
    });

  } else {
    _iroTerminalPicker.color.hexString = _terminalColorBeforeOpen;
  }
}

function _closeTerminalPicker() {
  const container = document.getElementById("terminal-picker-container");
  if (container) container.classList.add("hidden");
}

document.getElementById("terminal-picker-save").onclick = () => {
  if (!_iroTerminalPicker) return;
  const hex = _iroTerminalPicker.color.hexString.toLowerCase();
  const customs = _getCustomTerminalColors();
  const isPreset = Object.values(TERMINAL_PRESETS).some(v => v === hex);
  if (!isPreset && !customs.includes(hex)) {
    customs.push(hex);
    _saveCustomTerminalColors(customs);
  }
  _selectTerminal(hex);
  const grid = document.getElementById("terminal-color-grid");
  if (grid) renderTerminalGrid(grid);
  _closeTerminalPicker();
};

document.getElementById("terminal-picker-cancel").onclick = () => {
  if (_terminalColorBeforeOpen) {
    applyTerminalColor(_terminalColorBeforeOpen);
  } else {
    document.documentElement.style.removeProperty("--terminal-bg");
    document.documentElement.style.removeProperty("--terminal-text");
    document.documentElement.style.removeProperty("--terminal-text-dim");
    document.documentElement.style.removeProperty("--terminal-link-color");
    const bg = localStorage.getItem("bgColor");
    if (bg) applyBgColor(bg);
  }
  _closeTerminalPicker();
};

// Apply saved terminal color on load
const _savedTerminal = localStorage.getItem("terminalColor");
if (_savedTerminal) applyTerminalColor(_savedTerminal);

// --- Shell Terminal Color System ---
const SHELL_PRESETS = {
  default:  "#0d1117",
  midnight: "#0a0e18",
  ember:    "#160e0a",
  neutral:  "#101010",
};

function applyShellColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const { r, g, b } = _hexToRgb(hex);
  const light = _isLight(hex);
  const dir = light ? -1 : 1;

  function shellDerive(offset) {
    const o = offset * dir;
    const dr = Math.min(255, Math.max(0, r + o));
    const dg = Math.min(255, Math.max(0, g + o));
    const db = Math.min(255, Math.max(0, b + o));
    return `#${dr.toString(16).padStart(2,"0")}${dg.toString(16).padStart(2,"0")}${db.toString(16).padStart(2,"0")}`;
  }

  const s = document.documentElement.style;
  s.setProperty("--shell-bg", hex);
  s.setProperty("--shell-header-bg", shellDerive(10));
  s.setProperty("--shell-header-hover", shellDerive(16));
  s.setProperty("--shell-text-dim", light ? "#555" : "");
  if (light) {
    s.setProperty("--shell-pill-bg", "rgba(0,0,0,0.06)");
    s.setProperty("--shell-pill-border", "rgba(0,0,0,0.08)");
    s.setProperty("--shell-pill-hover", "rgba(0,0,0,0.12)");
    s.setProperty("--shell-pill-hover-border", "rgba(0,0,0,0.15)");
  } else {
    s.removeProperty("--shell-pill-bg");
    s.removeProperty("--shell-pill-border");
    s.removeProperty("--shell-pill-hover");
    s.removeProperty("--shell-pill-hover-border");
    s.removeProperty("--shell-text-dim");
  }

  if (window._shellXterm) {
    const fg = light ? "#1a1a1a" : "#e6edf3";
    const theme = Object.assign({}, window._shellXterm.options.theme, {
      background: hex,
      foreground: fg,
      cursor: fg,
      selectionBackground: light ? "rgba(0,100,200,0.25)" : "rgba(56,139,253,0.4)",
    });
    if (light) {
      // Swap ANSI colors for light background readability
      theme.black = "#1a1a1a";
      theme.white = "#555";
      theme.brightBlack = "#666";
      theme.brightWhite = "#1a1a1a";
      theme.yellow = "#7a6a00";
      theme.brightYellow = "#8a7500";
      theme.green = "#1a7f37";
      theme.brightGreen = "#1a9f37";
      theme.blue = "#0550ae";
      theme.brightBlue = "#0969da";
      theme.red = "#cf222e";
      theme.brightRed = "#d1242f";
      theme.magenta = "#8250df";
      theme.brightMagenta = "#8250df";
      theme.cyan = "#0c7d9d";
      theme.brightCyan = "#0c7d9d";
    } else {
      // Restore default dark ANSI colors
      theme.black = "#484f58";
      theme.white = "#b1bac4";
      theme.brightBlack = "#6e7681";
      theme.brightWhite = "#f0f6fc";
      theme.yellow = "#d29922";
      theme.brightYellow = "#e3b341";
      theme.green = "#3fb950";
      theme.brightGreen = "#56d364";
      theme.blue = "#58a6ff";
      theme.brightBlue = "#79c0ff";
      theme.red = "#ff7b72";
      theme.brightRed = "#ffa198";
      theme.magenta = "#bc8cff";
      theme.brightMagenta = "#d2a8ff";
      theme.cyan = "#39d353";
      theme.brightCyan = "#56d364";
    }
    window._shellXterm.options.theme = theme;
  }
}

function _getCustomShellColors() {
  try { return JSON.parse(localStorage.getItem("customShellColors") || "[]"); } catch { return []; }
}

function _saveCustomShellColors(colors) {
  localStorage.setItem("customShellColors", JSON.stringify(colors));
}

function _selectShell(key) {
  const hex = SHELL_PRESETS[key] || key;
  if (hex === SHELL_PRESETS.default) {
    localStorage.removeItem("shellColor");
    const s = document.documentElement.style;
    ["--shell-bg","--shell-header-bg","--shell-header-hover","--shell-text-dim",
     "--shell-pill-bg","--shell-pill-border","--shell-pill-hover","--shell-pill-hover-border"
    ].forEach(v => s.removeProperty(v));
    if (window._shellXterm) {
      window._shellXterm.options.theme = Object.assign({}, window._shellXterm.options.theme, {
        background: "#0d1117", foreground: "#e6edf3", cursor: "#e6edf3",
        selectionBackground: "rgba(56,139,253,0.4)",
        black:"#484f58",white:"#b1bac4",brightBlack:"#6e7681",brightWhite:"#f0f6fc",
        yellow:"#d29922",brightYellow:"#e3b341",green:"#3fb950",brightGreen:"#56d364",
        blue:"#58a6ff",brightBlue:"#79c0ff",red:"#ff7b72",brightRed:"#ffa198",
        magenta:"#bc8cff",brightMagenta:"#d2a8ff",cyan:"#39d353",brightCyan:"#56d364",
      });
    }
  } else {
    localStorage.setItem("shellColor", hex);
    applyShellColor(hex);
  }
  _highlightSwatch("shell-color-grid", "data-shell", key);
}

let _iroShellPicker = null;
let _shellColorBeforeOpen = null;

function renderShellGrid(grid) {
  const current = localStorage.getItem("shellColor") || "default";
  grid.innerHTML = "";

  for (const [key, hex] of Object.entries(SHELL_PRESETS)) {
    const isActive = (key === "default" && !localStorage.getItem("shellColor")) || hex === current;
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    swatch.style.background = hex;
    swatch.title = key.charAt(0).toUpperCase() + key.slice(1);
    swatch.setAttribute("data-shell", key);
    swatch.addEventListener("click", () => {
      _closeShellPicker();
      _selectShell(key);
    });
    grid.appendChild(swatch);
  }

  const customs = _getCustomShellColors();
  for (const hex of customs) {
    const isActive = hex === current;
    const wrap = document.createElement("span");
    wrap.className = "accent-swatch-wrap";
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (isActive ? " active" : "");
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.setAttribute("data-shell", hex);
    swatch.addEventListener("click", () => {
      _closeShellPicker();
      _selectShell(hex);
    });
    const del = document.createElement("button");
    del.className = "accent-swatch-delete";
    del.textContent = "×";
    del.title = "Remove custom color";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const updated = _getCustomShellColors().filter(c => c !== hex);
      _saveCustomShellColors(updated);
      if (current === hex) _selectShell("default");
      renderShellGrid(grid);
    });
    wrap.appendChild(swatch);
    wrap.appendChild(del);
    grid.appendChild(wrap);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "accent-swatch accent-swatch-add";
  addBtn.textContent = "+";
  addBtn.title = "Add custom shell color";
  addBtn.addEventListener("click", () => _openShellPicker(grid));
  grid.appendChild(addBtn);
}

function _openShellPicker(grid) {
  const container = document.getElementById("shell-picker-container");
  const wheelEl = document.getElementById("shell-picker-wheel");
  if (!container || !wheelEl) return;

  _shellColorBeforeOpen = localStorage.getItem("shellColor") || SHELL_PRESETS.default;
  container.classList.remove("hidden");

  if (!_iroShellPicker) {
    _iroShellPicker = new iro.ColorPicker("#shell-picker-wheel", {
      width: 220,
      color: _shellColorBeforeOpen,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.1)",
      handleRadius: 8,
      layout: [
        { component: iro.ui.Wheel, options: {} },
        { component: iro.ui.Slider, options: { sliderType: "value" } },
      ],
    });
    _iroShellPicker.on("color:change", (color) => {
      applyShellColor(color.hexString);
    });

  } else {
    _iroShellPicker.color.hexString = _shellColorBeforeOpen;
  }
}

function _closeShellPicker() {
  const container = document.getElementById("shell-picker-container");
  if (container) container.classList.add("hidden");
}

document.getElementById("shell-picker-save").onclick = () => {
  if (!_iroShellPicker) return;
  const hex = _iroShellPicker.color.hexString.toLowerCase();
  const customs = _getCustomShellColors();
  const isPreset = Object.values(SHELL_PRESETS).includes(hex);
  if (!isPreset && !customs.includes(hex)) {
    customs.push(hex);
    _saveCustomShellColors(customs);
  }
  _selectShell(hex);
  const grid = document.getElementById("shell-color-grid");
  if (grid) renderShellGrid(grid);
  _closeShellPicker();
};

document.getElementById("shell-picker-cancel").onclick = () => {
  if (_shellColorBeforeOpen && _shellColorBeforeOpen !== SHELL_PRESETS.default) {
    applyShellColor(_shellColorBeforeOpen);
  } else {
    const s = document.documentElement.style;
    ["--shell-bg","--shell-header-bg","--shell-header-hover","--shell-text-dim",
     "--shell-pill-bg","--shell-pill-border","--shell-pill-hover","--shell-pill-hover-border"
    ].forEach(v => s.removeProperty(v));
  }
  _closeShellPicker();
};

// Apply saved shell color on load
const _savedShell = localStorage.getItem("shellColor");
if (_savedShell) applyShellColor(_savedShell);

function applyBgColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const { r, g, b } = _hexToRgb(hex);
  const lum = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  const light = lum > 128;
  // Flip direction for light backgrounds: surfaces go darker, not lighter
  const dir = light ? -1 : 1;

  const baseWarm = (r - b) / Math.max(lum, 1);

  function derive(offset) {
    const o = offset * dir;
    const warm = Math.round(o * 0.15 * (1 + (light ? -baseWarm : baseWarm)));
    const dr = Math.min(255, Math.max(0, r + o + Math.round(warm * 0.5)));
    const dg = Math.min(255, Math.max(0, g + o));
    const db = Math.min(255, Math.max(0, b + o - Math.round(warm * 0.5)));
    return `#${dr.toString(16).padStart(2,"0")}${dg.toString(16).padStart(2,"0")}${db.toString(16).padStart(2,"0")}`;
  }

  const s = document.documentElement.style;
  s.setProperty("--bg", hex);
  s.setProperty("--bg-gradient", `linear-gradient(135deg, ${hex} 0%, ${derive(8)} 50%, ${derive(2)} 100%)`);
  if (!localStorage.getItem("terminalColor")) {
    s.setProperty("--terminal-bg", derive(-4));
    // Also flip terminal text if auto-derived terminal is light
    _applyTerminalTextColor(derive(-4));
  }
  s.setProperty("--input-bg", derive(3));
  s.setProperty("--header-bg", `linear-gradient(180deg, ${derive(8)} 0%, ${derive(4)} 100%)`);
  s.setProperty("--surface", derive(12));
  s.setProperty("--modal-bg", derive(12));
  s.setProperty("--surface-raised", derive(20));
  s.setProperty("--border", derive(33));
  s.setProperty("--scrollbar-thumb", derive(33));
  s.setProperty("--scrollbar-hover", derive(50));
  s.setProperty("--gray", derive(64));
  s.setProperty("--text-dim", light ? derive(64) : derive(104));
  // Flip main text color for light/dark
  s.setProperty("--text", light ? "#1a1a1a" : "#ede8e0");
  s.setProperty("--header-border", light ? "rgba(0,0,0,0.1)" : "rgba(201,168,76,0.12)");
  s.setProperty("--modal-backdrop", light ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.7)");
  s.setProperty("--card-shadow", light
    ? "0 4px 24px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)"
    : "0 4px 24px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)");
}

const _savedBg = localStorage.getItem("bgColor");
if (_savedBg) applyBgColor(_savedBg);

function _getCustomColors() {
  try { return JSON.parse(localStorage.getItem("customAccentColors") || "[]"); } catch { return []; }
}

function _saveCustomColors(colors) {
  localStorage.setItem("customAccentColors", JSON.stringify(colors));
}

function _selectAccent(key) {
  applyAccentColor(key);
  localStorage.setItem("accentColor", key);
  _highlightSwatch("accent-color-grid", "data-accent", key);
  fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accentColor: key }),
  }).catch(() => {});
}

let _iroColorPicker = null;
let _iroColorBeforeOpen = null;

function renderAccentGrid(grid) {
  const current = localStorage.getItem("accentColor") || "gold";
  grid.innerHTML = "";

  // Built-in presets
  for (const [key, preset] of Object.entries(ACCENT_PRESETS)) {
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (key === current ? " active" : "");
    swatch.style.background = preset.accent;
    swatch.title = key.charAt(0).toUpperCase() + key.slice(1);
    swatch.setAttribute("data-accent", key);
    swatch.addEventListener("click", () => {
      _closeAccentPicker();
      _selectAccent(key);
    });
    grid.appendChild(swatch);
  }

  // Custom colors from localStorage
  const customs = _getCustomColors();
  for (const hex of customs) {
    const wrap = document.createElement("span");
    wrap.className = "accent-swatch-wrap";
    const swatch = document.createElement("button");
    swatch.className = "accent-swatch" + (hex === current ? " active" : "");
    swatch.style.background = hex;
    swatch.title = hex;
    swatch.setAttribute("data-accent", hex);
    swatch.addEventListener("click", () => {
      _closeAccentPicker();
      _selectAccent(hex);
    });
    const del = document.createElement("button");
    del.className = "accent-swatch-delete";
    del.textContent = "×";
    del.title = "Remove custom color";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const updated = _getCustomColors().filter(c => c !== hex);
      _saveCustomColors(updated);
      if (current === hex) _selectAccent("gold");
      renderAccentGrid(grid);
    });
    wrap.appendChild(swatch);
    wrap.appendChild(del);
    grid.appendChild(wrap);
  }

  // "+" button to open iro.js color picker
  const addBtn = document.createElement("button");
  addBtn.className = "accent-swatch accent-swatch-add";
  addBtn.textContent = "+";
  addBtn.title = "Add custom color";
  addBtn.addEventListener("click", () => _openAccentPicker(grid));
  grid.appendChild(addBtn);
}

function _openAccentPicker(grid) {
  const container = document.getElementById("accent-picker-container");
  const wheelEl = document.getElementById("accent-picker-wheel");
  if (!container || !wheelEl) return;

  // Remember current color so we can revert on cancel
  _iroColorBeforeOpen = localStorage.getItem("accentColor") || "gold";
  const currentHex = ACCENT_PRESETS[_iroColorBeforeOpen]?.accent || _iroColorBeforeOpen;

  container.classList.remove("hidden");

  if (!_iroColorPicker) {
    _iroColorPicker = new iro.ColorPicker("#accent-picker-wheel", {
      width: 220,
      color: currentHex,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.1)",
      handleRadius: 8,
      layout: [
        { component: iro.ui.Wheel, options: {} },
        { component: iro.ui.Slider, options: { sliderType: "value" } },
      ],
    });
    _iroColorPicker.on("color:change", (color) => {
      applyAccentColor(color.hexString);
    });

  } else {
    _iroColorPicker.color.hexString = currentHex;
  }
}

function _closeAccentPicker() {
  const container = document.getElementById("accent-picker-container");
  if (container) container.classList.add("hidden");
}

document.getElementById("accent-picker-save").onclick = () => {
  if (!_iroColorPicker) return;
  const hex = _iroColorPicker.color.hexString.toLowerCase();
  const customs = _getCustomColors();
  const isPreset = Object.values(ACCENT_PRESETS).some(p => p.accent === hex);
  if (!isPreset && !customs.includes(hex)) {
    customs.push(hex);
    _saveCustomColors(customs);
  }
  _selectAccent(hex);
  const grid = document.getElementById("accent-color-grid");
  if (grid) renderAccentGrid(grid);
  _closeAccentPicker();
};

document.getElementById("accent-picker-cancel").onclick = () => {
  applyAccentColor(_iroColorBeforeOpen);
  _closeAccentPicker();
};

// Apply immediately from localStorage to prevent flash of default color
const _savedAccent = localStorage.getItem("accentColor");
if (_savedAccent) applyAccentColor(_savedAccent);

const grid = document.getElementById("agents-grid");
const minimizedBar = document.getElementById("minimized-bar");
const emptyState = document.getElementById("empty-state");
const connDot = document.getElementById("connection-dot");
const newAgentBtn = document.getElementById("new-agent-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalCancel = document.getElementById("modal-cancel");
const newAgentForm = document.getElementById("new-agent-form");
const wsModalOverlay = document.getElementById("workspace-modal-overlay");
const wsCancel = document.getElementById("workspace-cancel");
const wsForm = document.getElementById("workspace-form");

const sessionSearch = document.getElementById("session-search");
const sessionList = document.getElementById("session-list");
const sessionSelectedInfo = document.getElementById("session-selected-info");
const sessionSelectedLabel = document.getElementById("session-selected-label");
const sessionDeselect = document.getElementById("session-deselect");
const promptLabel = document.getElementById("prompt-label");

const ansiUp = new AnsiUp();
marked.use({
  gfm: true, breaks: true,
  renderer: {
    html(token) {
      const text = typeof token === 'string' ? token : (token.raw || token.text || '');
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    link(token) {
      const href = typeof token === 'string' ? token : (token.href || '');
      const text = typeof token === 'string' ? token : (token.text || href);
      // Block dangerous URI schemes (javascript:, data:, vbscript:, etc.)
      const cleanHref = href.replace(/[\x00-\x1f\x7f]/g, '').trim();
      if (/^(?:javascript|data|vbscript):/i.test(cleanHref)) {
        return escapeHtml(text);
      }
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  }
});

// Clean up any old theme data
localStorage.removeItem("ceo-theme");

// --- WebSocket staleness tracking ---
let _lastWsMessage = Date.now();

// Global focusout listener — catches ALL focus losses from card inputs.
// If focus jumps to a different card's textarea without user intent, refocus the original.
let _userClickedAt = 0; // timestamp of last mousedown/touchstart
let _focusGuardInterval = null; // single global guard — prevents two cards' guards from fighting
document.addEventListener("mousedown", () => { _userClickedAt = Date.now(); }, true);
document.addEventListener("touchstart", () => { _userClickedAt = Date.now(); }, true);

document.addEventListener("focusout", (e) => {
  const textarea = e.target;
  if (!textarea.matches || !textarea.matches(".card-input textarea")) return;

  // Skip expected blurs (e.g. user submitting input)
  if (textarea._expectedBlur) {
    textarea._expectedBlur = false;
    return;
  }

  // Guard: if a card textarea loses focus without a recent user click/touch,
  // it's programmatic — aggressively refocus over the next 500ms.
  // Uses a SINGLE global guard to prevent two cards' guards from fighting each other.
  const isUserAction = (Date.now() - _userClickedAt) < 200;
  if (!isUserAction && !_reloadingPage) {
    if (_focusGuardInterval) clearInterval(_focusGuardInterval);
    const guardUntil = Date.now() + 500;
    const doRestore = () => {
      if (Date.now() > guardUntil) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if ((Date.now() - _userClickedAt) < 200) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if (!textarea.isConnected) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if (document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
    };
    doRestore();
    queueMicrotask(doRestore);
    requestAnimationFrame(doRestore);
    _focusGuardInterval = setInterval(() => {
      if (Date.now() > guardUntil || (Date.now() - _userClickedAt) < 200) {
        clearInterval(_focusGuardInterval);
        _focusGuardInterval = null;
        return;
      }
      doRestore();
    }, 50);
  }
}, true);

// === LAST-ACTIVE TEXTAREA TRACKER ===
// Catches ANY focus loss that the per-blur guard misses.
// If focus ends up on body/document and no user interaction caused it, restore the textarea.
let _lastActiveTextarea = null;
let _lastActiveTextareaAt = 0;

// Track when a card textarea gains focus (user-initiated or restored)
document.addEventListener("focusin", (e) => {
  if (e.target.matches && e.target.matches(".card-input textarea")) {
    _lastActiveTextarea = e.target;
    _lastActiveTextareaAt = Date.now();
  } else if (e.target !== document.body && e.target !== document.documentElement) {
    // User intentionally focused something else — clear the tracker
    // (but not for body/documentElement, which indicates programmatic focus loss)
    if ((Date.now() - _userClickedAt) < 300) {
      _lastActiveTextarea = null;
    }
  }
}, true);

// Catch focus arriving at body/non-interactive elements — restore last textarea
// Uses rAF to let the browser settle (some blur→focus sequences are two-step)
let _bodyFocusRafId = null;
document.addEventListener("focusin", (e) => {
  // Only care about focus landing on body or the document element
  if (e.target !== document.body && e.target !== document.documentElement) return;
  if (!_lastActiveTextarea) return;
  if (_reloadingPage) return;
  // If user just clicked, they intended to move focus
  if ((Date.now() - _userClickedAt) < 300) return;
  // Only restore if the textarea was active recently (within 2s)
  if (Date.now() - _lastActiveTextareaAt > 2000) return;

  if (_bodyFocusRafId) cancelAnimationFrame(_bodyFocusRafId);
  _bodyFocusRafId = requestAnimationFrame(() => {
    _bodyFocusRafId = null;
    if ((Date.now() - _userClickedAt) < 300) return;
    if (!_lastActiveTextarea || !_lastActiveTextarea.isConnected) return;
    if (document.activeElement === document.body || document.activeElement === document.documentElement) {
      _lastActiveTextarea.focus({ preventScroll: true });
    }
  });
}, true);

// --- Tab notifications (title flash + native/browser notifications + dock badge) ---
let TAB_TITLE_DEFAULT = "CEO Dashboard";
let _tabFlashInterval = null;
let _prevAttentionAgents = new Set(); // track which agents already triggered a notification
const _isNativeApp = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ceoBridge);

// Clear badge on page load — agents haven't loaded yet so badge should be 0
if (_isNativeApp) {
  try { window.webkit.messageHandlers.ceoBridge.postMessage({ action: "setBadge", count: 0 }); } catch {}
}

// Request notification permission on first user interaction (browser fallback)
if (!_isNativeApp) {
  document.addEventListener("click", function _reqNotif() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    document.removeEventListener("click", _reqNotif);
  }, { once: true });
}

function _sendNativeBridge(msg) {
  try { window.webkit.messageHandlers.ceoBridge.postMessage(msg); } catch {}
}

// Tracks agents the user has already "seen" waiting — keyed by name:waitGen.
// When the app is visible and an agent is waiting, it's marked as seen.
// Only unseen waiting agents contribute to badge count and trigger notifications.
const _seenWaiting = new Set();
let _firstUpdateDone = false; // suppress notifications on initial load

function updateTabNotifications() {
  const needsInput = [];
  for (const [name, agent] of agents) {
    if ((agent.status === "waiting" || agent.status === "asking") && !isDismissed(name, agent._waitGen)) {
      needsInput.push(name);
    }
  }

  // On first update, mark all currently-waiting agents as already seen
  // (they were waiting before we opened — don't re-alert)
  if (!_firstUpdateDone) {
    _firstUpdateDone = true;
    for (const name of needsInput) {
      const agent = agents.get(name);
      _seenWaiting.add(`${name}:${agent._waitGen}`);
    }
    // Badge 0 on initial load — everything is "seen"
    if (_isNativeApp) _sendNativeBridge({ action: "setBadge", count: 0 });
    return;
  }

  // If app is visible, mark all current waiting agents as seen + clear badge
  if (!document.hidden) {
    for (const name of needsInput) {
      const agent = agents.get(name);
      _seenWaiting.add(`${name}:${agent._waitGen}`);
    }
    if (_isNativeApp) _sendNativeBridge({ action: "setBadge", count: 0 });
    if (_tabFlashInterval) {
      clearInterval(_tabFlashInterval);
      _tabFlashInterval = null;
      document.title = TAB_TITLE_DEFAULT;
    }
    _prevAttentionAgents = new Set(needsInput);
    return;
  }

  // App is hidden — count unseen agents for badge
  const unseen = [];
  for (const name of needsInput) {
    const agent = agents.get(name);
    const key = `${name}:${agent._waitGen}`;
    if (!_seenWaiting.has(key)) unseen.push(name);
  }

  if (_isNativeApp) {
    _sendNativeBridge({ action: "setBadge", count: unseen.length });
  }

  if (unseen.length > 0) {
    // Flash the tab title
    if (!_tabFlashInterval) {
      let on = true;
      _tabFlashInterval = setInterval(() => {
        const label = unseen.length === 1 ? unseen[0] : `${unseen.length} agents`;
        document.title = on ? `\u26a0 ${label} needs input` : TAB_TITLE_DEFAULT;
        on = !on;
      }, 1000);
    }

    // Send notification for newly-waiting agents only
    for (const name of unseen) {
      if (!_prevAttentionAgents.has(name)) {
        const agent = agents.get(name);
        const body = agent.status === "waiting" ? "Needs your input" : "Has a question";
        if (_isNativeApp) {
          _sendNativeBridge({ action: "sendNotification", title: name, body, tag: `ceo-${name}` });
        } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`${TAB_TITLE_DEFAULT} — ${name}`, { body, tag: `ceo-${name}` });
        }
      }
    }
  } else {
    if (_tabFlashInterval) {
      clearInterval(_tabFlashInterval);
      _tabFlashInterval = null;
      document.title = TAB_TITLE_DEFAULT;
    }
  }

  _prevAttentionAgents = new Set(unseen);
}

// When app becomes visible — mark everything as seen, clear badge.
// Also check if WebSocket is stale and reconnect (WKWebView + mobile Safari
// can suspend the content process, killing the WS without firing onclose).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateTabNotifications();
    _reconnectIfStale();
  }
});
window.addEventListener("focus", () => {
  updateTabNotifications();
  _reconnectIfStale();
});

// --- Periodic liveness heartbeat ---
// Catches dead WS connections without waiting for visibility/focus events (critical for mobile over Tailscale)
// Only acts on OPEN sockets — never kills CONNECTING ones (that causes an infinite reconnect loop on iOS)
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - _lastWsMessage > 15000) {
    console.log("[ws] Heartbeat: no message in 15s, reconnecting");
    try { ws.close(); } catch {}
    clearTimeout(reconnectTimer);
    connect();
  }
}, 5000);

// Guard: don't reconnect if already connecting
function _reconnectIfStale() {
  if (ws && ws.readyState === WebSocket.CONNECTING) return; // let pending connect finish
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - _lastWsMessage > 20000) {
    console.log("[ws] Stale connection detected, reconnecting");
    try { ws.close(); } catch {}
    clearTimeout(reconnectTimer);
    connect();
  }
}

// --- Pending send queue (survives reconnect) ---
let _pendingSend = null; // { session, text, paths } — only latest message

// --- Mobile detection ---
function isMobile() { return window.innerWidth <= 600; }

// --- Masonry grid layout ---
// Cards have explicit heights; we translate that into grid-row spans
// so tall cards on one side don't push down cards in other columns.
const GRID_ROW_PX = 10; // matches grid-auto-rows in CSS
const GRID_GAP_PX = 20; // visual gap between cards (achieved via margin-bottom + extra span)

function getCardDefaultHeight() {
  return isMobile() ? 350 : 500; // matches .agent-card CSS heights
}

function masonryLayout() {

  const cards = grid.querySelectorAll(".agent-card");
  for (const card of cards) {
    // Desired height: inline style (from drag-resize / saved layout) or CSS default
    const inlineH = card.style.height;
    const cssH = (inlineH && inlineH.endsWith("px"))
      ? parseFloat(inlineH)
      : getCardDefaultHeight();
    // During active resize, respect the user's drag height exactly; otherwise use scrollHeight if content overflows
    const termOpen = card.querySelector(".agent-terminal-section")?.style.display !== "none";
    const h = card.classList.contains("resizing-height") ? cssH : Math.max(cssH, card.scrollHeight);
    const span = Math.ceil((h + GRID_GAP_PX) / GRID_ROW_PX);
    if (termOpen) console.log("[masonry]", card.querySelector(".agent-name")?.textContent, { cssH, scrollH: card.scrollHeight, h, span, inlineH });
    card.style.gridRow = `span ${span}`;
  }
  // Force browser to reflow grid after all spans are set
  void grid.offsetHeight;
  updateCardNumbers();
}

// Debounced version for frequent calls (resize, output updates)
let _masonryTimer = null;
function scheduleMasonry() {
  if (_masonryTimer) return;
  _masonryTimer = requestAnimationFrame(() => {
    _masonryTimer = null;
    masonryLayout();
    // After layout completes, scroll any terminals still in force-scroll mode
    for (const agent of agents.values()) {
      if (agent.terminal && agent.terminal._forceScrollUntil && Date.now() < agent.terminal._forceScrollUntil) {
        scrollTerminalToBottom(agent.terminal);
      }
    }
  });
}

// Recalc on window resize
window.addEventListener("resize", scheduleMasonry);

// Linkify file paths and URLs in terminal HTML output.
// Splits on HTML tags to only process text nodes, avoiding breakage of ANSI spans.
const LINK_RE = /(https?:\/\/[^\s<>"')\]]+)|((?:\/[\w.@:+-]+)+(?:\.[\w]+)?(?::\d+)?)/g;

// Escape HTML special characters in attribute values to prevent XSS
function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Validate and sanitize CSS color hex values to prevent CSS injection
function safeHex(hex) {
  if (typeof hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(hex)) return hex;
  return "#8A9BA8"; // fallback to slate
}

function linkifyTerminal(html) {
  // Split into HTML tags and text segments
  const parts = html.split(/(<[^>]+>)/);
  for (let i = 0; i < parts.length; i++) {
    // Skip HTML tags (odd indices after split)
    if (parts[i].startsWith("<")) continue;
    parts[i] = parts[i].replace(LINK_RE, (match, url, filepath) => {
      if (url) {
        // Only allow http/https URLs — block javascript:, data:, etc.
        if (!/^https?:\/\//i.test(url)) return match;
        const safeUrl = escapeAttr(url);
        return `<a class="terminal-link" href="${safeUrl}" target="_blank" rel="noopener">${match}</a>`;
      }
      if (filepath && filepath.length > 3) {
        // File path — use vscode:// URI for cmd+click to open in editor
        const cleanPath = filepath.replace(/[,;:!?)]+$/, "");
        const trailing = filepath.slice(cleanPath.length);
        const safePath = escapeAttr(cleanPath);
        return `<a class="terminal-link terminal-path" data-path="${safePath}" href="vscode://file${safePath}">${cleanPath}</a>${trailing}`;
      }
      return match;
    });
  }
  return parts.join("");
}

const agents = new Map(); // name -> { card, terminal, status, workdir }
let claudeSessions = []; // cached Claude session data
let selectedSessionId = null; // currently selected resume session
let slashCommands = []; // cached slash commands

// --- Popout coordination ---
const popoutChannel = new BroadcastChannel("ceo-popout");
const poppedOutAgents = new Set();

popoutChannel.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "popped-out") {
    poppedOutAgents.add(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) { agent.card.classList.add("popped-out"); scheduleMasonry(); }
  }
  if (msg.type === "popped-back") {
    poppedOutAgents.delete(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) {
      agent.card.classList.remove("popped-out");
      if (agent.terminal) agent.terminal._forceScrollUntil = Date.now() + 3000;
      scheduleMasonry();
    }
  }
  if (msg.type === "kill-agent") {
    poppedOutAgents.delete(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) {
      agent.card.remove();
      agents.delete(msg.agent);
      removeLayout(msg.agent);
      saveCardOrder();
      updateEmptyState();
      updateDashboardDot();
    }
  }
};

// --- Card Layout Persistence ---
// Mobile and desktop use separate layout keys so resizing on one doesn't affect the other.
// Minimized state is shared (always applies).

const LAYOUT_KEY_DESKTOP = "ceo-card-layouts";
const LAYOUT_KEY_MOBILE = "ceo-card-layouts-mobile";

function getLayoutKey() {
  return isMobile() ? LAYOUT_KEY_MOBILE : LAYOUT_KEY_DESKTOP;
}

function loadLayouts() {
  try { return JSON.parse(localStorage.getItem(getLayoutKey())) || {}; } catch { return {}; }
}

function saveLayout(name, data) {
  const layouts = loadLayouts();
  layouts[name] = { ...layouts[name], ...data };
  localStorage.setItem(getLayoutKey(), JSON.stringify(layouts));
}

// --- Card order persistence ---
const CARD_ORDER_KEY = "ceo-card-order";
function loadCardOrder() {
  try { return JSON.parse(localStorage.getItem(CARD_ORDER_KEY)) || []; } catch { return []; }
}
function saveCardOrder() {
  const grid = document.querySelector(".agents-grid");
  if (!grid) return;
  const order = Array.from(grid.querySelectorAll(".agent-card"))
    .map(c => c.querySelector(".agent-name")?.textContent)
    .filter(Boolean);
  localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order));
}

// --- Dismiss status (persisted in localStorage, shared across devices) ---
const DISMISS_KEY = "ceo-dismissed-status";
function loadDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || {}; } catch { return {}; }
}
function dismissAgent(name, gen) {
  const d = loadDismissed();
  d[name] = gen;
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}
function isDismissed(name, gen) {
  const d = loadDismissed();
  return d[name] === gen;
}
function clearDismiss(name) {
  const d = loadDismissed();
  delete d[name];
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}

function removeLayout(name) {
  // Remove from both keys so kill always cleans up
  for (const key of [LAYOUT_KEY_DESKTOP, LAYOUT_KEY_MOBILE]) {
    try {
      const layouts = JSON.parse(localStorage.getItem(key)) || {};
      delete layouts[name];
      localStorage.setItem(key, JSON.stringify(layouts));
    } catch {}
  }
}

function applyLayout(name, card) {
  const layouts = loadLayouts();
  const layout = layouts[name];
  if (!layout) return;
  // Column span (1x, 2x, 3x) — desktop only
  if (!isMobile()) {
    if (layout.span === 2) card.classList.add("span-2");
    if (layout.span === 3) card.classList.add("span-3");
  }
  // Height
  if (layout.height) {
    card.style.height = layout.height;
  }
  // Header color — sanitize to prevent CSS injection from localStorage
  if (layout.headerColor) {
    const color = safeHex(layout.headerColor);
    const h = card.querySelector(".card-header");
    if (h) {
      h.style.background = `linear-gradient(135deg, ${color}38 0%, ${color}20 100%)`;
      h.style.borderBottom = `1px solid ${color}50`;
    }
  }
  // Note: minimized state is now server-side, applied separately in addAgentCard
  // Terminal restore disabled — terminals are only opened by user interaction
  // (prevents spawning new tmux sessions on every reload)
}

// --- Dashboard Status Dot ---
// Reflects aggregate status of all agents: green=all idle, blue=working, red=needs attention

function updateDashboardDot() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // offline handled by onclose
  let hasWaiting = false;
  let hasAsking = false;
  let hasWorking = false;
  for (const [name, agent] of agents) {
    const dismissed = (agent.status === "waiting" || agent.status === "asking") && isDismissed(name, agent._waitGen);
    if (agent.status === "waiting" && !dismissed) hasWaiting = true;
    if (agent.status === "asking" && !dismissed) hasAsking = true;
    if (agent.status === "working") hasWorking = true;
  }
  if (hasWaiting || hasAsking) {
    connDot.className = "dot needs-attention";
    connDot.title = hasWaiting ? "Agent needs input" : "Agent has a question";
  } else if (hasWorking) {
    connDot.className = "dot some-working";
    connDot.title = "Agents working";
  } else {
    connDot.className = "dot all-idle";
    connDot.title = agents.size ? "All agents idle" : "Connected — no agents";
  }
  updateTabNotifications();
}

// --- Card Reordering (favorites first, FLIP animation) ---

function reorderCards() {
  const cards = Array.from(grid.querySelectorAll(".agent-card"));
  if (cards.length <= 1) { scheduleMasonry(); saveCardOrder(); return; }

  // FIRST: record current positions
  const firstRects = new Map();
  cards.forEach(card => firstRects.set(card, card.getBoundingClientRect()));

  // Sort: use saved order if available, then favorites first, then creation order
  const savedOrder = loadCardOrder();
  cards.sort((a, b) => {
    const aName = a.querySelector(".agent-name")?.textContent || "";
    const bName = b.querySelector(".agent-name")?.textContent || "";
    const aFav = a.classList.contains("favorited") ? 0 : 1;
    const bFav = b.classList.contains("favorited") ? 0 : 1;

    // If both in saved order, use that order
    const aIdx = savedOrder.indexOf(aName);
    const bIdx = savedOrder.indexOf(bName);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;

    // Saved-order cards come before unsaved (new cards go to end)
    if (aIdx !== -1 && bIdx === -1) return -1;
    if (aIdx === -1 && bIdx !== -1) return 1;

    // Neither in saved order: favorites first, then preserve DOM order
    return aFav - bFav;
  });

  // Check if order actually changed — skip DOM moves if already correct
  const currentOrder = Array.from(grid.querySelectorAll(".agent-card"));
  let orderChanged = cards.length !== currentOrder.length;
  if (!orderChanged) {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] !== currentOrder[i]) { orderChanged = true; break; }
    }
  }

  if (orderChanged) {
    // Save focused element + cursor position before DOM moves (appendChild causes blur)
    const focused = document.activeElement;
    const focusedInGrid = focused && grid.contains(focused);
    const cursorStart = focusedInGrid ? focused.selectionStart : null;
    const cursorEnd = focusedInGrid ? focused.selectionEnd : null;

    // Save terminal scroll positions before DOM moves (appendChild can reset scrollTop)
    const scrollPositions = new Map();
    for (const card of cards) {
      const t = card.querySelector(".terminal");
      if (t) scrollPositions.set(t, t.scrollTop);
    }

    // Re-append in sorted order (moves DOM nodes without recreating)
    for (const card of cards) {
      grid.appendChild(card);
    }

    // Restore terminal scroll positions displaced by DOM re-append
    for (const [t, pos] of scrollPositions) {
      if (!t._userScrolledUp) {
        t.scrollTop = t.scrollHeight;
      } else {
        t.scrollTop = pos;
      }
    }

    // Restore focus stolen by DOM re-append
    if (focusedInGrid && focused !== document.activeElement) {
      focused.focus({ preventScroll: true });
      if (cursorStart != null) {
        try { focused.setSelectionRange(cursorStart, cursorEnd); } catch {}
      }
    }
    }
  saveCardOrder();

  // INVERT + PLAY: animate from old position to new
  cards.forEach(card => {
    const first = firstRects.get(card);
    const last = card.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;
    if (deltaX === 0 && deltaY === 0) return;

    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    card.style.transition = "none";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition = "transform 0.3s ease";
        card.style.transform = "";
        card.addEventListener("transitionend", function cleanup() {
          card.style.transition = "";
          card.removeEventListener("transitionend", cleanup);
        });
      });
    });
  });
  scheduleMasonry();
}

// --- WebSocket ---

let ws;
let reconnectTimer;
let _knownVersion = null; // tracks hot-reload version; if it changes on reconnect, reload
let _reloadingPage = false; // set true when reload is triggered — suppresses hotkeys during transition

// Build reload-persist state (used by hot-reload, server-restart, and manual restart)
function buildReloadState() {
  const state = {
    scrollY: window.scrollY,
    drafts: {},
    attachments: {},
    shellOpen: document.getElementById("shell-panel")?.classList.contains("open"),
    currentView: currentView || "agents",
  };
  // Save todo state if on todo view
  if (state.currentView === "todo") {
    state.todo = {
      activeListId: activeListId || null,
      rawMode: todoRawMode || false,
    };
    // Save unsaved raw textarea content
    const rawTextarea = document.querySelector(".todo-editor");
    if (rawTextarea) state.todo.rawContent = rawTextarea.value;
    // Save rich editor content as markdown
    if (!todoRawMode && typeof richEditorToMarkdown === "function") {
      const richMd = richEditorToMarkdown();
      if (richMd != null) state.todo.richContent = richMd;
    }
    // Save title input value
    const titleInput = document.querySelector(".todo-title-input");
    if (titleInput) state.todo.titleValue = titleInput.value;
  }
  // Capture active focus (which input the cursor is in)
  const focused = document.activeElement;
  if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" || focused.isContentEditable)) {
    state.focusCursorStart = focused.selectionStart ?? null;
    state.focusCursorEnd = focused.selectionEnd ?? null;
    state._savedTextLength = focused.value?.length ?? 0;
    // Identify by ID first (most reliable)
    if (focused.id) {
      state.focusedId = focused.id;
    }
    // Agent card input — identify by agent name
    const card = focused.closest(".agent-card");
    if (card) {
      const agentName = card.querySelector(".agent-name")?.textContent;
      if (agentName) state.focusedAgent = agentName;
    }
    // Todo inputs — identify by class
    if (focused.closest(".todo-view")) {
      if (focused.classList.contains("todo-title-input")) state.focusedTodo = "title";
      else if (focused.classList.contains("todo-editor")) state.focusedTodo = "editor";
    }
    if (focused.closest("#todo-rich-editor") || focused.id === "todo-rich-editor") {
      state.focusedTodo = "rich-editor";
    }
    // Agent doc edit area — identify by agent name + doc name
    const docSection = focused.closest(".agent-doc-section");
    if (docSection && focused.classList.contains("agent-doc-edit-area")) {
      const docCard = focused.closest(".agent-card");
      const docAgent = docCard?.querySelector(".agent-name")?.textContent;
      if (docAgent) state.focusedDocAgent = docAgent;
    }
  }
  // Save files panel state
  if (filesPanel.classList.contains("visible")) {
    state.filesOpen = true;
    if (currentFilePath) {
      state.fileEditor = {
        path: currentFilePath,
        name: fileEditorName.textContent,
        content: fileEditorContent.value,
        cursorStart: fileEditorContent.selectionStart,
        cursorEnd: fileEditorContent.selectionEnd,
        rawMode: fileEditorToggle?.classList.contains("active") || false,
      };
    }
  }
  // Save settings panel state
  if (document.getElementById("settings-panel")?.classList.contains("visible")) {
    state.settingsOpen = true;
  }
  // Save bookmarks panel state
  if (_bmPanel && _bmPanel.classList.contains("visible")) {
    state.bookmarksOpen = true;
  }
  for (const [name, agent] of agents) {
    const textarea = agent.card.querySelector(".card-input textarea");
    if (textarea && textarea.value) state.drafts[name] = textarea.value;
    // Persist image attachments (only completed uploads, not processing videos)
    if (agent.pendingAttachments && agent.pendingAttachments.length > 0) {
      const saved = agent.pendingAttachments.filter(a => !a.processing).map(a => {
        if (a.videoGroup) return { videoGroup: a.videoGroup, name: a.name, paths: a.paths, frameCount: a.frameCount, duration: a.duration };
        return { path: a.path, name: a.name };
      });
      if (saved.length > 0) state.attachments[name] = saved;
    }
    // Persist pasted content
    if (agent.pasteState && agent.pasteState.content) {
      if (!state.pastedContent) state.pastedContent = {};
      state.pastedContent[name] = agent.pasteState.content;
    }
  }
  // Persist new-agent modal state if open
  if (!modalOverlay.classList.contains("hidden")) {
    state.modal = {
      name: document.getElementById("agent-name").value,
      prompt: document.getElementById("agent-prompt").value,
      workdir: getSelectedWorkdir(),
      customWorkdir: document.getElementById("agent-workdir-custom").value,
      selectedWorkdirPath: selectedWorkdirPath,
    };
    // Save modal attachments
    if (modalPendingAttachments.length > 0) {
      state.modal.attachments = modalPendingAttachments.filter(a => !a.processing).map(a => {
        if (a.videoGroup) return { videoGroup: a.videoGroup, name: a.name, paths: a.paths, frameCount: a.frameCount, duration: a.duration };
        return { path: a.path, name: a.name };
      });
    }
  }
  return state;
}

function connect() {
  // If already connecting, don't kill-and-restart — let the pending handshake finish
  if (ws && ws.readyState === WebSocket.CONNECTING) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${wsProto}//${location.host}`);
  ws.binaryType = "arraybuffer"; // Binary frames arrive as ArrayBuffer (shell PTY data)

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    _lastWsMessage = Date.now();
    updateDashboardDot();
    // Re-send shell terminal size on reconnect so PTY output is properly formatted
    if (window._shellXterm && window._shellXterm.cols) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: window._shellXterm.cols, rows: window._shellXterm.rows }));
    }
    // Re-subscribe all terminal cards + embedded agent terminals on reconnect
    for (const [tName, agent] of agents) {
      if (agent.type === "terminal" && !agent.card.classList.contains("minimized")) {
        ws.send(JSON.stringify({ type: "terminal-subscribe", session: tName }));
        if (agent.xterm?.cols && agent.xterm?.rows) {
          _sendTerminalResize(tName, agent.xterm.cols, agent.xterm.rows);
        }
      }
      // Embedded agent terminal
      if (agent._termXterm && agent._termName) {
        const section = agent.card.querySelector(".agent-terminal-section");
        if (section && section.style.display !== "none") {
          ws.send(JSON.stringify({ type: "terminal-subscribe", session: agent._termName }));
          if (agent._termXterm.cols && agent._termXterm.rows) {
            _sendTerminalResize(agent._termName, agent._termXterm.cols, agent._termXterm.rows);
          }
        }
      }
    }
    // Check if we missed a hot reload while disconnected (iOS Safari suspends WS in background)
    fetch("/api/version").then(r => r.json()).then(data => {
      if (_knownVersion === null) {
        _knownVersion = data.version;
      } else if (data.version !== _knownVersion && !_updateErrorShowing) {
        location.reload();
      }
    }).catch(() => {});
    // Check for dashboard updates
    fetch("/api/check-update").then(r => r.json()).then(data => {
      if (data.updateAvailable) showUpdateButton(data);
    }).catch(() => {});
    // Drain pending send that was queued while disconnected
    if (_pendingSend) {
      const p = _pendingSend;
      _pendingSend = null;
      if (p.paths && p.paths.length > 0) {
        sendInputWithImages(p.session, p.text, p.paths);
      } else {
        sendInput(p.session, p.text);
      }
      console.log("[ws] Drained pending send for", p.session);
    }
  };

  ws.onclose = () => {
    connDot.className = "dot offline";
    connDot.title = "Disconnected";
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    // Force close on error so onclose fires and triggers reconnect
    try { ws.close(); } catch {}
  };

  ws.onmessage = (event) => {
    _lastWsMessage = Date.now();

    // Binary frame = shell PTY data or terminal card data (hot path — zero JSON overhead)
    if (event.data instanceof ArrayBuffer) {
      const buf = new Uint8Array(event.data);
      // 0x02 prefix = terminal card output: 0x02 + nameLen(1B) + name + data
      if (buf.length > 1 && buf[0] === 0x02) {
        const nameLen = buf[1];
        const tName = new TextDecoder().decode(buf.subarray(2, 2 + nameLen));
        const tData = buf.subarray(2 + nameLen);
        // Standalone terminal card
        const agent = agents.get(tName);
        if (agent?.xterm) {
          agent.xterm.write(tData);
          if (!agent._termReady) {
            agent._termReady = true;
            const loader = agent.card.querySelector(".terminal-loading");
            if (loader) { loader.classList.add("fade-out"); setTimeout(() => loader.remove(), 300); }
          }
        }
        // Embedded agent terminal (name is "<agent>-term")
        if (tName.endsWith("-term")) {
          const baseAgent = agents.get(tName.slice(0, -5));
          if (baseAgent?._termXterm) {
            baseAgent._termXterm.write(tData);
            if (!baseAgent._termReady) {
              baseAgent._termReady = true;
              const loader = baseAgent.card.querySelector(".agent-terminal-section .terminal-loading");
              if (loader) { loader.classList.add("fade-out"); setTimeout(() => loader.remove(), 300); }
            }
          }
        }
        return;
      }
      // Default: footer shell (bare binary, no prefix)
      if (window._shellXterm) window._shellXterm.write(buf);
      return;
    }

    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "native-notification") {
      if (_isNativeApp) {
        _sendNativeBridge({ action: "sendNotification", title: msg.title, body: msg.body, tag: msg.tag });
      } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(msg.title, { body: msg.body, tag: msg.tag });
      }
      return;
    }

    if (msg.type === "reload") {
      if (_updateErrorShowing) return;
      _reloadingPage = true;
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      location.reload();
      return;
    }

    if (msg.type === "server-restarting") {
      if (_updateErrorShowing) return;
      _reloadingPage = true;
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      const pollUntilReady = () => {
        fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
          .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
          .catch(() => setTimeout(pollUntilReady, 500));
      };
      setTimeout(pollUntilReady, 800);
      return;
    }
    if (msg.type === "shell-unavailable") {
      if (window._shellXterm) {
        window._shellXterm.write("\r\n\x1b[1;31m  Terminal unavailable\x1b[0m\r\n\r\n");
        window._shellXterm.write("  node-pty failed to start. Run this to fix:\r\n\r\n");
        window._shellXterm.write("    \x1b[1mnpm rebuild node-pty\x1b[0m\r\n\r\n");
        window._shellXterm.write("  Then restart the dashboard.\r\n");
      }
      return;
    }
    if (msg.type === "update-available") {
      showUpdateButton(msg);
      return;
    }
    if (msg.type === "open-url") {
      if (typeof msg.url === "string" && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, "_blank");
      }
      return;
    }
    if (msg.type === "shell-open-url") {
      if (typeof msg.url === "string" && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, "_blank");
      }
      return;
    }
    if (msg.type === "shell-info") {
      const shellCwd = document.getElementById("shell-cwd");
      const shellBranch = document.getElementById("shell-branch");
      const shellPrLink = document.getElementById("shell-pr-link");
      if (msg.cwd) {
        shellCwd.textContent = shortPath(msg.cwd);
        shellCwd.dataset.fullPath = msg.cwd; // Store full path for Finder
      }
      shellBranch.textContent = msg.branch || "";
      if (msg.prUrl) {
        shellPrLink.href = msg.prUrl;
        shellPrLink.textContent = "View PR";
        shellPrLink.style.display = "";
      } else if (msg.prUrl === null) {
        shellPrLink.style.display = "none";
      }
    }

    if (msg.type === "todo-update") {
      if (typeof handleTodoUpdate === "function") handleTodoUpdate(msg.data);
      // Refresh agent todo refs on all cards
      for (const [agentName, agent] of agents) {
        fetch(`/api/todos/by-agent/${encodeURIComponent(agentName)}`)
          .then((r) => r.json())
          .then((todos) => renderAgentTodoRefs(agent.card, todos))
          .catch(() => {});
      }
      return;
    }


    if (msg.type === "favorites-update") {
      if (typeof renderBookmarks === "function") renderBookmarks(msg.data);
      return;
    }

    if (msg.type === "sessions") {
      const activeNames = new Set(msg.sessions.map(s => s.name));
      for (const s of msg.sessions) {
        if (s.type === "terminal") {
          addTerminalCard(s.name, s.workdir);
        } else {
          addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
        }
      }
      // Clear ALL terminalOpen flags — terminals are only opened by user interaction
      const layouts = loadLayouts();
      for (const layout of Object.values(layouts)) {
        if (layout.terminalOpen) layout.terminalOpen = false;
      }
      localStorage.setItem(getLayoutKey(), JSON.stringify(layouts));
      reorderCards();
      updateEmptyState();
    }

    // Live minimize sync from another client
    if (msg.type === "minimize-sync") {
      const agent = agents.get(msg.session);
      if (agent) {
        const card = agent.card;
        const minBtn = card.querySelector(".minimize-btn");
        if (msg.minimized && !card.classList.contains("minimized")) {
          card.classList.add("minimized");
          minBtn.innerHTML = "+";
          minBtn.title = "Restore";
          minimizedBar.appendChild(card);
          updateEmptyState();
          scheduleMasonry();
        } else if (!msg.minimized && card.classList.contains("minimized")) {
          card.classList.remove("minimized");
          minBtn.innerHTML = "\u2212";
          minBtn.title = "Minimize";
          grid.appendChild(card);
          reorderCards();
          updateEmptyState();
          scheduleMasonry();
        }
      }
    }

    if (msg.type === "output") {
      const existing = agents.get(msg.session);
      if (existing?.type === "terminal") return;
      if (!agents.has(msg.session)) {
        addAgentCard(msg.session, "", null, false, false);
      }
      const agent = agents.get(msg.session);
      const isFirstContent = !agent.terminal._lastContent;
      // Force scroll to bottom on first content received (handles reload/reconnect)
      if (isFirstContent) {
        agent.terminal._forceScrollUntil = Date.now() + 5000;
        agent.terminal._wheelGraceUntil = Date.now() + 1500;
      }
      updateTerminal(agent.terminal, msg.lines);
      // Track that this agent has received its first output (for page loader)
      if (isFirstContent && !_loaderDismissed) {
        _agentsWithContent.add(msg.session);
        checkAllAgentsLoaded();
      }
      agent.promptOptions = msg.promptOptions || null;
      updateStatus(agent, msg.status, msg.promptType);
      // Live workdir + git info updates
      if (msg.workdir && msg.workdir !== agent.workdir) {
        agent.workdir = msg.workdir;
        agent.card.querySelector(".workdir-link").textContent = shortPath(msg.workdir);
        // Also update embedded terminal header if open
        updateTerminalHeader(agent.card, msg.workdir, undefined, undefined, undefined);
      }
      if (msg.branch !== undefined) {
        updateBranchDisplay(agent.card, msg.branch, msg.isWorktree);
        // Also update embedded terminal header if open
        updateTerminalHeader(agent.card, undefined, msg.branch, msg.isWorktree, undefined);
      }
    }

    // Live input sync from another client
    if (msg.type === "input-sync") {
      const agent = agents.get(msg.session);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea && textarea !== document.activeElement) {
          textarea.value = msg.text;
          // Trigger auto-resize (use 1px not "auto" to avoid layout thrash)
          textarea.style.height = "1px";
          textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
          // Auto-scroll terminal so input area stays visible (respect user scroll)
          if (msg.text && !agent.terminal._userScrolledUp) scrollTerminalToBottom(agent.terminal);
        }
      }
    }
  };
}

function sendInput(session, text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", session, text }));
  }
}

function sendKeypress(session, keys) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "keypress", session, keys }));
  }
}

function sendTypeOption(session, keys, text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "type-option", session, keys, text }));
  }
}

function sendInputWithImages(session, text, paths) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input-with-images", session, text, paths }));
  }
}

// Pull-based refresh: client actively requests latest output after interactions.
// Belt-and-suspenders backup for the server's push-based updates.
function requestRefresh(session) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "request-refresh", session }));
  }
}

function scheduleRefresh(session) {
  for (const ms of [500, 1000, 2000, 3000, 5000]) {
    setTimeout(() => requestRefresh(session), ms);
  }
}

// --- Agent Cards ---

function addAgentCard(name_, workdir, branch, isWorktree, favorite, minimized) {
  let name = name_;
  if (agents.has(name)) {
    const agent = agents.get(name);
    if (workdir && workdir !== agent.workdir) {
      agent.workdir = workdir;
      agent.card.querySelector(".workdir-link").textContent = shortPath(workdir);
    }
    // Update branch/worktree info
    updateBranchDisplay(agent.card, branch, isWorktree);
    // Sync minimized state from server
    if (minimized !== undefined) {
      const card = agent.card;
      const minBtn = card.querySelector(".minimize-btn");
      if (minimized && !card.classList.contains("minimized")) {
        card.classList.add("minimized");
        minBtn.innerHTML = "+";
        minBtn.title = "Restore";
        minimizedBar.appendChild(card);
      } else if (!minimized && card.classList.contains("minimized")) {
        card.classList.remove("minimized");
        minBtn.innerHTML = "\u2212";
        minBtn.title = "Minimize";
        grid.appendChild(card);
      }
    }
    // Sync favorite state from server
    if (favorite !== undefined) {
      const card = agent.card;
      const favBtn = card.querySelector(".favorite-btn");
      if (favorite) {
        card.classList.add("favorited");
        favBtn.classList.add("active");
        favBtn.textContent = "\u2605";
      } else {
        card.classList.remove("favorited");
        favBtn.classList.remove("active");
        favBtn.textContent = "\u2606";
      }
    }
    return;
  }

  const card = document.createElement("div");
  card.className = "agent-card";
  card.innerHTML = `
    <div class="card-body-wrapper">
    <div class="card-sticky-top">
      <div class="card-header">
        <div class="card-header-left">
          <button class="fullscreen-back-btn" tabindex="-1" title="Exit fullscreen">&#x2190;</button>
          <span class="alert-icon" title="Needs input"></span>
          <span class="agent-name">${escapeHtml(name)}</span>
          <span class="status-badge working">working</span>
        </div>
        <div class="card-actions">
          <button class="favorite-btn" tabindex="-1" title="Favorite">&#9734;</button>
          <div class="more-menu-wrap">
            <button class="more-btn" tabindex="-1" title="More actions">&hellip;</button>
            <div class="more-menu">
              <button class="more-menu-item" data-action="view-diff">View Diff</button>
              <button class="more-menu-item" data-action="open-terminal">Terminal</button>
              <button class="more-menu-item" data-action="rename">Rename</button>
              <button class="more-menu-item" data-action="header-color">Header Color</button>
              <div class="header-color-picker" style="display:none;">
                <div class="header-color-swatches">
                  <button class="header-color-swatch" data-color="" title="Default"><span class="swatch-x">&times;</span></button>
                  <button class="header-color-swatch" data-color="#c9a84c" title="Gold" style="--swatch:#c9a84c;"></button>
                  <button class="header-color-swatch" data-color="#7eb8da" title="Blue" style="--swatch:#7eb8da;"></button>
                  <button class="header-color-swatch" data-color="#5cb85c" title="Green" style="--swatch:#5cb85c;"></button>
                  <button class="header-color-swatch" data-color="#d9534f" title="Red" style="--swatch:#d9534f;"></button>
                  <button class="header-color-swatch" data-color="#b07cc6" title="Purple" style="--swatch:#b07cc6;"></button>
                  <button class="header-color-swatch" data-color="#d97753" title="Orange" style="--swatch:#d97753;"></button>
                  <button class="header-color-swatch" data-color="#6bb5a0" title="Teal" style="--swatch:#6bb5a0;"></button>
                </div>
              </div>
              <button class="more-menu-item" data-action="save-memory">Save Memory</button>
              <button class="more-menu-item" data-action="update-memory">Update Memory</button>
              <button class="more-menu-item more-menu-danger" data-action="clear-memory">Clear Memory</button>
              <button class="more-menu-item" data-action="dismiss-status" style="display:none;">Dismiss Status</button>
              <button class="more-menu-item" data-action="restart">Restart Claude</button>
            </div>
          </div>
          <button class="restart-btn" tabindex="0" title="Restart Claude">&#8635;</button>
          <button class="expand-btn" tabindex="0" title="Fullscreen">&#x26F6;</button>
          <button class="popout-btn" tabindex="0" title="Pop out">&#8599;</button>
          <button class="minimize-btn" tabindex="0" title="Minimize">&minus;</button>
          <button class="kill-btn" tabindex="0" title="Kill agent">&times;</button>
        </div>
      </div>
      <div class="card-subheader">
        <span class="workdir-link" title="Click to change workspace">${escapeHtml(shortPath(workdir))}</span>
        <span class="branch-info"></span>
      </div>
    </div>
    <div class="terminal">
      <div class="terminal-loading">
        <div class="loading-claude">
          <div class="loading-ring"></div>
          <div class="loading-ring loading-ring-2"></div>
          <div class="loading-ring loading-ring-3"></div>
          <div class="loading-orb loading-orb-1"></div>
          <div class="loading-orb loading-orb-2"></div>
          <div class="loading-orb loading-orb-3"></div>
          <div class="loading-orb loading-orb-4"></div>
          <div class="loading-orb loading-orb-5"></div>
          <div class="loading-orb loading-orb-6"></div>
          <img src="claude-symbol.svg" class="loading-logo" alt="">
        </div>
        <div class="loading-text">
          <span class="loading-label">Initializing Claude</span>
          <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
    </div>
    <div class="popout-placeholder">
      <span>In separate window</span>
      <button class="btn-secondary popout-bring-back-btn">Bring Back</button>
    </div>
    <div class="prompt-actions"></div>
    <div class="attachment-chips"></div>
    <div class="card-input">
      <textarea rows="1" placeholder="Send a message..."></textarea>
      <button class="image-upload-btn" tabindex="-1" title="Add image"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
      <input type="file" class="image-upload-input" accept="image/*,video/*" multiple style="display:none">
      <button class="send-btn" tabindex="-1">Send</button>
    </div>
    <div class="resize-grip"></div>
    <div class="agent-todo-refs"></div>
    <div class="agent-doc-section">
      <div class="agent-doc-header">
        <span>Agent Docs</span>
        <span class="agent-doc-badge empty">0</span>
      </div>
      <div class="agent-doc-body">
        <div class="agent-doc-resize"></div>
        <div class="agent-doc-list"></div>
        <div class="agent-doc-empty">No docs yet. Agents can write to ~/ceo-dashboard/docs/&lt;name&gt;/</div>
        <div class="agent-doc-detail" style="display:none;">
          <div class="agent-doc-detail-header">
            <button class="agent-doc-back-btn">&larr;</button>
            <span class="agent-doc-detail-name"></span>
            <div style="display:flex;gap:6px;margin-left:auto;">
              <button class="btn-secondary agent-doc-move-btn" style="padding:3px 10px;font-size:11px;">Move to Local</button>
              <button class="btn-secondary open-finder-btn agent-doc-finder-btn" style="padding:3px 10px;font-size:11px;">Open Folder</button>
              <button class="btn-secondary agent-doc-delete-btn" style="padding:3px 10px;font-size:11px;">Delete</button>
              <button class="md-toggle-btn agent-doc-toggle">Raw</button>
              <button class="btn-primary agent-doc-save-btn" style="padding:3px 10px;font-size:11px;display:none;">Save</button>
            </div>
          </div>
          <div class="agent-doc-rendered md-rendered markdown-body"></div>
          <textarea class="agent-doc-edit-area" style="display:none;"></textarea>
        </div>
      </div>
    </div>
    </div>
    <div class="agent-terminal-section" style="display:none;">
      <div class="agent-terminal-header">
        <div class="agent-terminal-header-left">
          <svg class="agent-terminal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <span class="agent-term-workdir workdir-link" title="Working directory"></span>
          <span class="agent-term-branch branch-info"></span>
          <a class="agent-term-pr-btn btn-secondary" style="display:none;padding:2px 8px;font-size:10px;text-decoration:none;" target="_blank" rel="noopener">View PR</a>
        </div>
        <div class="agent-terminal-header-right">
          <button class="agent-terminal-expand" title="Expand to card">&#x26F6;</button>
          <button class="agent-terminal-close" title="Close terminal">&times;</button>
        </div>
      </div>
      <div class="agent-terminal-container">
        <div class="terminal-loading">
          <div class="terminal-loading-anim">
            <div class="loading-ring"></div>
            <div class="loading-ring loading-ring-2"></div>
            <div class="loading-ring loading-ring-3"></div>
            <div class="loading-orb loading-orb-1"></div>
            <div class="loading-orb loading-orb-2"></div>
            <div class="loading-orb loading-orb-3"></div>
            <div class="loading-orb loading-orb-4"></div>
            <div class="loading-orb loading-orb-5"></div>
            <div class="loading-orb loading-orb-6"></div>
            <div class="terminal-loading-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            </div>
          </div>
          <span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
        </div>
      </div>
      <div class="agent-terminal-resize"></div>
    </div>
  `;

  const terminal = card.querySelector(".terminal");
  terminal.setAttribute("tabindex", "-1");
  // Force scroll to bottom for new/reloaded cards until content settles
  terminal._forceScrollUntil = Date.now() + 5000;
  // Short grace period: ignore wheel/touch during first 1.5s to prevent
  // trackpad momentum from a previous page view from locking scroll at top
  terminal._wheelGraceUntil = Date.now() + 1500;

  // Scroll trapping: when terminal is at bottom, don't immediately let page scroll
  setupScrollTrapping(terminal);

  // Touch tracking: suppress auto-scroll while user is touching the terminal
  terminal.addEventListener("touchstart", () => {
    // During grace period, don't let stale momentum cancel force-scroll
    if (terminal._wheelGraceUntil && Date.now() < terminal._wheelGraceUntil) return;
    terminal._userTouching = true;
    terminal._forceScrollUntil = 0; // cancel any active force-scroll
  }, { passive: true });
  terminal.addEventListener("touchend", () => {
    // Delay clearing — momentum scroll continues after touchend
    setTimeout(() => { terminal._userTouching = false; }, 1000);
  }, { passive: true });

  // Scroll tracking: detect when user scrolls up (wants to read history)
  // Cleared when they scroll back to bottom
  terminal.addEventListener("wheel", (e) => {
    if (e.deltaY < 0) {
      // During grace period after card creation/reload, ignore upward wheel
      // to prevent macOS trackpad momentum from canceling force-scroll
      if (terminal._wheelGraceUntil && Date.now() < terminal._wheelGraceUntil) return;
      terminal._userScrolledUp = true;
      terminal._forceScrollUntil = 0;
    }
  }, { passive: true });
  terminal.addEventListener("scroll", () => {
    if (terminal._updatingContent) return; // ignore scroll events from innerHTML replacement
    const atBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30;
    if (atBottom) terminal._userScrolledUp = false;
  }, { passive: true });

  // Cmd+A inside terminal selects only terminal content
  terminal.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(terminal);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    // Arrow keys & Enter → send directly to tmux session (for Claude interactive UI)
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const keyMap = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter" };
      if (keyMap[e.key]) {
        e.preventDefault();
        sendKeypress(name, keyMap[e.key]);
        return;
      }
    }
    // Typing printable characters or Escape in terminal → focus input field
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" || (e.key.length === 1 && !e.metaKey)) {
      const inp = card.querySelector(".card-input textarea");
      if (inp) {
        inp.focus();
        // Don't swallow Escape — let it propagate to the global handler
        if (e.key !== "Escape") {
          // For printable chars, append to input value
          // (the focus + default behavior will handle it)
        }
      }
    }
  });

  const input = card.querySelector(".card-input textarea");
  const sendBtn = card.querySelector(".send-btn");
  const killBtn = card.querySelector(".kill-btn");
  const minimizeBtn = card.querySelector(".minimize-btn");
  const restartBtn = card.querySelector(".restart-btn");
  const popoutBtn = card.querySelector(".popout-btn");
  const expandBtn = card.querySelector(".expand-btn");
  const fullscreenBackBtn = card.querySelector(".fullscreen-back-btn");
  const bringBackBtn = card.querySelector(".popout-bring-back-btn");
  const favoriteBtn = card.querySelector(".favorite-btn");
  const moreBtn = card.querySelector(".more-btn");
  const moreMenu = card.querySelector(".more-menu");
  const workdirLink = card.querySelector(".workdir-link");
  // Pending image attachments for this agent
  const pendingAttachments = [];

  // Pasted content collapsed into a chip (like Claude CLI's "N lines pasted")
  // Stored as object property so buildReloadState can access it via the agents map
  const pasteState = { content: null };

  // Send message (includes attached images if any)
  const doSend = () => {
    // Combine pasted content (if any) with typed text
    let text = input.value.trim();
    if (pasteState.content) {
      text = pasteState.content + (text ? "\n" + text : "");
      pasteState.content = null;
      const pasteChip = card.querySelector(".attachment-chip.paste");
      if (pasteChip) pasteChip.remove();
    }
    if (!text && pendingAttachments.length === 0) return;
    // Don't send while video frames are still extracting
    if (pendingAttachments.some((a) => a.processing)) return;

    // Build the message payload
    let sendSession = name, sendText = text, sendPaths = null;
    if (pendingAttachments.length > 0) {
      const paths = [];
      const videoContextParts = [];
      for (const a of pendingAttachments) {
        if (a.videoGroup) {
          paths.push(...a.paths);
          videoContextParts.push(
            `[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`
          );
        } else {
          paths.push(a.path);
        }
      }
      sendText = [...videoContextParts, text].filter(Boolean).join("\n");
      sendPaths = paths;
      pendingAttachments.length = 0;
      const chips = card.querySelector(".attachment-chips");
      if (chips) chips.innerHTML = "";
    }

    // If WS isn't open, queue the message and trigger reconnect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      _pendingSend = { session: sendSession, text: sendText, paths: sendPaths };
      console.log("[ws] Send queued for", sendSession, "— triggering reconnect");
      connDot.className = "dot offline";
      connDot.title = "Reconnecting…";
      clearTimeout(reconnectTimer);
      connect();
    } else if (sendPaths && sendPaths.length > 0) {
      sendInputWithImages(sendSession, sendText, sendPaths);
    } else {
      sendInput(sendSession, sendText);
    }
    input.value = "";
    // User sent input — they want to see the response, reset scroll lock
    terminal._userScrolledUp = false;
    terminal._forceScrollUntil = Date.now() + 3000;
    // Sync cleared input to other clients
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input-sync", session: name, text: "" }));
    }
  };

  // Auto-resize textarea — card has fixed height, terminal flex-shrinks automatically
  // Avoid setting height="auto" first — it collapses the textarea to 0 momentarily,
  // causing the terminal flex sibling to expand then shrink (visible scroll jump).
  const autoResize = () => {
    const terminal = card.querySelector(".terminal");
    const savedScroll = terminal ? terminal.scrollTop : 0;
    // Shrink to 1px to measure natural scrollHeight without the old height constraining it
    input.style.height = "1px";
    const newH = Math.min(input.scrollHeight, 150);
    input.style.height = newH + "px";
    // Restore terminal scroll position displaced by the height change
    if (terminal && !terminal._userScrolledUp) {
      scrollTerminalToBottom(terminal);
    } else if (terminal) {
      terminal.scrollTop = savedScroll;
    }
  };
  input.addEventListener("input", autoResize);

  // Handle pasted images from clipboard (e.g. screenshots)
  input.addEventListener("paste", async (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    // Check for image files in clipboard first
    const imageFiles = Array.from(clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      e.preventDefault();
      for (const file of imageFiles) {
        try {
          const base64 = await fileToBase64(file);
          const filename = file.name === "image.png" ? `clipboard-${Date.now()}.png` : file.name;
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: filename });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Clipboard image upload failed:", err);
        }
      }
      return;
    }

    // Collapse large text pastes into a chip (like Claude CLI's "N lines pasted")
    let text;
    try {
      text = clipboardData.getData("text/plain") || clipboardData.getData("text");
    } catch {}
    if (!text) return;

    const lines = text.split("\n");
    if (lines.length < 3) return; // short pastes stay inline

    e.preventDefault(); // don't insert into textarea
    pasteState.content = text;

    renderPasteChip(card, lines.length, () => {
      pasteState.content = null;
    });
  });

  // Live input sync — broadcast keystrokes to other clients
  input.addEventListener("input", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input-sync", session: name, text: input.value }));
    }
  });

  // Per-agent input history (arrow up/down to recall)
  const inputHistory = [];
  let historyIndex = -1; // -1 = not browsing history
  let historyDraft = "";  // saves in-progress text when entering history

  const origDoSend = doSend;
  // Wrap doSend to also record history
  const doSendWithHistory = () => {
    const text = input.value.trim();
    if (text) {
      // Don't duplicate consecutive entries
      if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text);
      }
    }
    historyIndex = -1;
    historyDraft = "";
    origDoSend();
  };
  // Reassign doSend reference used by the send button and Enter key
  const doSendFinal = doSendWithHistory;

  input.addEventListener("keydown", (e) => {
    // Arrow up/down for input history (only when slash dropdown is not visible)
    const dropdown = card.querySelector(".slash-dropdown");
    const dropdownVisible = dropdown && dropdown.classList.contains("visible");

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !dropdownVisible && !e.shiftKey) {
      // Only activate on ArrowUp if cursor is at the start (or input is single-line)
      const isMultiline = input.value.includes("\n");
      if (e.key === "ArrowUp" && isMultiline && input.selectionStart > input.value.indexOf("\n")) return;
      if (e.key === "ArrowDown" && isMultiline && input.selectionStart < input.value.lastIndexOf("\n")) return;

      if (inputHistory.length === 0) return;

      e.preventDefault();
      if (e.key === "ArrowUp") {
        if (historyIndex === -1) {
          historyDraft = input.value;
          historyIndex = inputHistory.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        input.value = inputHistory[historyIndex];
      } else {
        if (historyIndex === -1) return;
        if (historyIndex < inputHistory.length - 1) {
          historyIndex++;
          input.value = inputHistory[historyIndex];
        } else {
          historyIndex = -1;
          input.value = historyDraft;
        }
      }
      autoResize();
      return;
    }

    if (e.key !== "Enter") return;
    // Shift+Enter → newline (default behavior)
    if (e.shiftKey) return;
    // Enter → send
    e.preventDefault();
    const hasActiveItem = dropdown && dropdown.querySelector(".slash-item.active");
    if (!dropdownVisible || !hasActiveItem) {
      doSendFinal();
      input.style.height = "";
    }
  });
  sendBtn.addEventListener("click", () => {
    doSendFinal();
    input.style.height = "";
  });

  // Slash command autocomplete
  setupAutocomplete(input, card);

  // Image drag-and-drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.add("drag-over");
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("drag-over");
  };
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        // Video: extract frames client-side and upload each as JPEG
        const videoId = `video-${Date.now()}`;
        pendingAttachments.push({
          name: file.name,
          videoGroup: videoId,
          processing: true,
          paths: [],
          frameCount: 0,
          duration: 0,
        });
        renderAttachmentChips(card, pendingAttachments);
        try {
          const entry = pendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips(card, pendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Video frame extraction failed:", err);
          const idx = pendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) pendingAttachments.splice(idx, 1);
          renderAttachmentChips(card, pendingAttachments);
        }
      }
    }
  };
  // Attach drag-drop to entire card so dropping anywhere works
  card.addEventListener("dragover", handleDragOver);
  card.addEventListener("dragleave", handleDragLeave);
  card.addEventListener("drop", handleDrop);

  // Mobile image upload button — triggers file picker for photo library
  const imageUploadBtn = card.querySelector(".image-upload-btn");
  const imageUploadInput = card.querySelector(".image-upload-input");
  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());
  imageUploadInput.addEventListener("change", async () => {
    const files = Array.from(imageUploadInput.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        const videoId = `video-${Date.now()}`;
        pendingAttachments.push({
          name: file.name, videoGroup: videoId, processing: true,
          paths: [], frameCount: 0, duration: 0,
        });
        renderAttachmentChips(card, pendingAttachments);
        try {
          const entry = pendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips(card, pendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Video frame extraction failed:", err);
          const idx = pendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) pendingAttachments.splice(idx, 1);
          renderAttachmentChips(card, pendingAttachments);
        }
      }
    }
    // Reset input so the same file can be selected again
    imageUploadInput.value = "";
  });

  // Favorite toggle
  if (favorite) {
    card.classList.add("favorited");
    favoriteBtn.classList.add("active");
    favoriteBtn.textContent = "\u2605";
  }
  favoriteBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/api/sessions/${name}/favorite`, { method: "PATCH" });
      const data = await res.json();
      if (data.favorite) {
        card.classList.add("favorited");
        favoriteBtn.classList.add("active");
        favoriteBtn.textContent = "\u2605";
      } else {
        card.classList.remove("favorited");
        favoriteBtn.classList.remove("active");
        favoriteBtn.textContent = "\u2606";
      }
      reorderCards();
    } catch {}
  });

  // More menu (... button)
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = moreMenu.classList.toggle("visible");
    if (isOpen) {
      // Focus first item for keyboard nav
      const firstItem = moreMenu.querySelector(".more-menu-item");
      if (firstItem) firstItem.focus();
      // Close on next outside click
      const close = () => { moreMenu.classList.remove("visible"); colorPicker.style.display = "none"; };
      setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    }
  });

  // Header color picker
  const colorPicker = moreMenu.querySelector(".header-color-picker");
  const cardHeader = card.querySelector(".card-header");

  // More menu keyboard nav
  moreMenu.addEventListener("keydown", (e) => {
    const items = [...moreMenu.querySelectorAll(".more-menu-item")];
    const idx = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { e.preventDefault(); moreMenu.classList.remove("visible"); colorPicker.style.display = "none"; moreBtn.focus(); }
  });

  function applyHeaderColor(color) {
    if (color) {
      cardHeader.style.background = `linear-gradient(135deg, ${color}38 0%, ${color}20 100%)`;
      cardHeader.style.borderBottom = `1px solid ${color}50`;
    } else {
      cardHeader.style.background = "";
      cardHeader.style.borderBottom = "";
    }
  }

  // Apply saved color on load
  {
    const layouts = loadLayouts();
    const saved = layouts[name]?.headerColor;
    if (saved) applyHeaderColor(saved);
  }

  colorPicker.addEventListener("click", (e) => {
    const swatch = e.target.closest(".header-color-swatch");
    if (!swatch) return;
    e.stopPropagation();
    const color = swatch.dataset.color;
    applyHeaderColor(color);
    saveLayout(name, { headerColor: color || null });
    // Mark active swatch
    colorPicker.querySelectorAll(".header-color-swatch").forEach(s => s.classList.remove("active"));
    if (color) swatch.classList.add("active");
    colorPicker.style.display = "none";
    moreMenu.classList.remove("visible");
  });

  moreMenu.addEventListener("click", async (e) => {
    // Handle swatch clicks inside the color picker (don't close menu)
    if (e.target.closest(".header-color-picker")) {
      e.stopPropagation();
      return;
    }
    const item = e.target.closest(".more-menu-item");
    if (!item) return;
    e.stopPropagation();
    const action = item.dataset.action;

    if (action === "header-color") {
      const isVisible = colorPicker.style.display !== "none";
      colorPicker.style.display = isVisible ? "none" : "block";
      // Mark current active swatch
      if (!isVisible) {
        const layouts = loadLayouts();
        const current = layouts[name]?.headerColor || "";
        colorPicker.querySelectorAll(".header-color-swatch").forEach(s => {
          s.classList.toggle("active", s.dataset.color === current);
        });
      }
      return; // Don't close menu
    }

    moreMenu.classList.remove("visible");

    if (action === "view-diff") { openDiffModal(name); return; }
    if (action === "open-terminal") { openAgentTerminal(name, card); return; }
    if (action === "rename") {
      const newName = prompt("Rename agent:", name);
      if (!newName || newName === name) return;
      const sanitized = newName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
      if (!sanitized) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: sanitized }),
        });
        if (res.ok) {
          const data = await res.json();
          // Update the agents map
          const agent = agents.get(name);
          agents.delete(name);
          agents.set(data.name, agent);
          // Update displayed name
          card.querySelector(".agent-name").textContent = data.name;
          // Update layout storage (both mobile and desktop keys)
          for (const key of [LAYOUT_KEY_DESKTOP, LAYOUT_KEY_MOBILE]) {
            try {
              const layouts = JSON.parse(localStorage.getItem(key)) || {};
              if (layouts[name]) {
                layouts[data.name] = layouts[name];
                delete layouts[name];
                localStorage.setItem(key, JSON.stringify(layouts));
              }
            } catch {}
          }
          // Update the closure variable via re-binding
          name = data.name;
        } else {
          const err = await res.json();
          alert(err.error || "Rename failed");
        }
      } catch {
        alert("Rename failed");
      }
      return;
    }

    if (action === "save-memory") {
      item.textContent = "Saving...";
      try {
        await fetch(`/api/sessions/${name}/snapshot-memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "save" }),
        });
      } catch {}
      setTimeout(() => { item.textContent = "Save Memory"; }, 2000);
    }

    if (action === "update-memory") {
      item.textContent = "Updating...";
      try {
        await fetch(`/api/sessions/${name}/snapshot-memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "update" }),
        });
      } catch {}
      setTimeout(() => { item.textContent = "Update Memory"; }, 2000);
    }

    if (action === "clear-memory") {
      if (!confirm(`Clear memory for "${name}"?`)) return;
      try {
        await fetch(`/api/sessions/${name}/memory`, { method: "DELETE" });
      } catch {}
    }

    if (action === "dismiss-status") {
      const agent = agents.get(name);
      if (agent) {
        dismissAgent(name, agent._waitGen);
        updateStatus(agent, agent.status, null);
      }
    }

    if (action === "restart") {
      doRestart();
    }
  });

  // Restart Claude — kill tmux session and resume with same session ID
  async function doRestart() {
    const loading = terminal.querySelector(".terminal-loading");
    terminal.innerHTML = "";
    terminal._lastContent = null;
    const spinner = document.createElement("div");
    spinner.className = "terminal-loading";
    spinner.innerHTML = `
      <div class="loading-claude">
        <div class="loading-ring"></div>
        <div class="loading-ring loading-ring-2"></div>
        <div class="loading-ring loading-ring-3"></div>
        <div class="loading-orb loading-orb-1"></div>
        <div class="loading-orb loading-orb-2"></div>
        <div class="loading-orb loading-orb-3"></div>
        <div class="loading-orb loading-orb-4"></div>
        <div class="loading-orb loading-orb-5"></div>
        <div class="loading-orb loading-orb-6"></div>
        <img src="claude-symbol.svg" class="loading-logo" alt="">
      </div>
      <div class="loading-text">
        <span class="loading-label">Restarting Claude</span>
        <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
      </div>`;
    spinner._createdAt = Date.now();
    terminal.appendChild(spinner);

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/restart`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        spinner.querySelector("span").textContent = err.error || "Restart failed";
        return;
      }
      terminal._forceScrollUntil = Date.now() + 2000;
      scheduleRefresh(name);
    } catch {
      spinner.querySelector("span").textContent = "Restart failed";
    }
  }

  restartBtn.addEventListener("click", doRestart);

  // Pop out to separate window
  popoutBtn.addEventListener("click", () => {
    const url = `/popout.html?agent=${encodeURIComponent(name)}`;
    window.open(url, `ceo-popout-${name}`, "width=800,height=600");
    poppedOutAgents.add(name);
    card.classList.add("popped-out");
    scheduleMasonry();
  });

  // Bring back from popout
  bringBackBtn.addEventListener("click", () => {
    popoutChannel.postMessage({ type: "popped-back", agent: name });
    poppedOutAgents.delete(name);
    card.classList.remove("popped-out");
    terminal._forceScrollUntil = Date.now() + 3000;
    scheduleMasonry();
  });

  // Fullscreen expand/collapse
  function exitFullscreen() {
    card.classList.remove("fullscreen");
    expandBtn.innerHTML = "\u26F6"; // ⛶
    expandBtn.title = "Fullscreen";
    document.body.style.overflow = "";
    scheduleMasonry();
  }
  expandBtn.addEventListener("click", () => {
    if (card.classList.contains("fullscreen")) {
      exitFullscreen();
    } else {
      card.classList.add("fullscreen");
      expandBtn.innerHTML = "\u2715"; // ✕
      expandBtn.title = "Exit fullscreen";
      document.body.style.overflow = "hidden";
    }
  });
  fullscreenBackBtn.addEventListener("click", exitFullscreen);

  // Minimize / restore — moves card between grid and minimized bar, syncs via server
  minimizeBtn.addEventListener("click", async () => {
    const isMinimized = card.classList.toggle("minimized");
    minimizeBtn.innerHTML = isMinimized ? "+" : "\u2212";
    minimizeBtn.title = isMinimized ? "Restore" : "Minimize";
    if (isMinimized) {
      // Clear doc body height so it doesn't persist into restored state
      const body = card.querySelector(".agent-doc-body");
      if (body) body.style.height = "";
      minimizedBar.appendChild(card);
    } else {
      grid.appendChild(card);
      reorderCards();
    }
    updateEmptyState();
    // Persist to server (broadcasts to all clients)
    try {
      await fetch(`/api/sessions/${encodeURIComponent(name)}/minimize`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimized: isMinimized }),
      });
    } catch {}
  });

  // Kill agent — favorites require confirm(), non-favorites use double-click arm pattern
  let killArmed = false;
  let killTimer = null;
  const doKill = async () => {
    await fetch(`/api/sessions/${name}`, { method: "DELETE" });
    // Also kill the embedded terminal tmux session if it exists
    const agEntry = agents.get(name);
    if (agEntry?._termName) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: agEntry._termName }));
      }
      if (agEntry._termXterm) { try { agEntry._termXterm.dispose(); } catch {} }
      if (agEntry._termResizeObserver) { try { agEntry._termResizeObserver.disconnect(); } catch {} }
      fetch(`/api/sessions/${encodeURIComponent(agEntry._termName)}`, { method: "DELETE" }).catch(() => {});
      // Also remove standalone terminal card if it exists
      const termCardAgent = agents.get(agEntry._termName);
      if (termCardAgent?.card) {
        if (termCardAgent.xterm) { try { termCardAgent.xterm.dispose(); } catch {} }
        termCardAgent.card.remove();
        agents.delete(agEntry._termName);
      }
    }
    if (poppedOutAgents.has(name)) {
      popoutChannel.postMessage({ type: "kill-agent", agent: name });
      poppedOutAgents.delete(name);
    }
    card.remove();
    agents.delete(name);
    removeLayout(name);
    saveCardOrder();
    updateEmptyState();
    updateDashboardDot();
  };
  killBtn.addEventListener("click", async () => {
    // Favorites: confirm dialog instead of double-click
    if (card.classList.contains("favorited")) {
      if (!confirm(`Kill favorite agent "${name}"? This agent is protected.`)) return;
      await doKill();
      return;
    }
    // Non-favorites: double-click arm pattern
    if (!killArmed) {
      killArmed = true;
      killBtn.classList.add("armed");
      killBtn.textContent = "kill";
      killTimer = setTimeout(() => {
        killArmed = false;
        killBtn.classList.remove("armed");
        killBtn.innerHTML = "\u00d7";
      }, 2000);
      return;
    }
    clearTimeout(killTimer);
    await doKill();
  });

  // Change workspace
  workdirLink.addEventListener("click", () => {
    document.getElementById("workspace-agent-name").value = name;
    document.getElementById("workspace-path").value = workdir;
    wsModalOverlay.classList.remove("hidden");
  });

  // Doc header is mouse-only (not a useful keyboard stop)

  // Agent doc section
  const docSection = card.querySelector(".agent-doc-section");
  const docHeader = card.querySelector(".agent-doc-header");
  const docBadge = card.querySelector(".agent-doc-badge");
  const docList = card.querySelector(".agent-doc-list");
  const docEmpty = card.querySelector(".agent-doc-empty");
  const docDetail = card.querySelector(".agent-doc-detail");
  const docDetailName = card.querySelector(".agent-doc-detail-name");
  const docRendered = card.querySelector(".agent-doc-rendered");
  const docEditArea = card.querySelector(".agent-doc-edit-area");
  const docToggle = card.querySelector(".agent-doc-toggle");
  const docSaveBtn = card.querySelector(".agent-doc-save-btn");
  const docMoveBtn = card.querySelector(".agent-doc-move-btn");
  const docDeleteBtn = card.querySelector(".agent-doc-delete-btn");
  const docFinderBtn = card.querySelector(".agent-doc-finder-btn");
  const docBackBtn = card.querySelector(".agent-doc-back-btn");

  docHeader.addEventListener("click", () => {
    const opening = !docSection.classList.contains("open");
    docSection.classList.toggle("open");
    if (opening) {
      refreshAgentDocs(name, docList, docEmpty, docBadge, card);
    } else {
      // Clear inline heights so closed state returns to minimal size
      const body = card.querySelector(".agent-doc-body");
      if (body) body.style.height = "";
    }
    scheduleMasonry();
  });

  docBackBtn.addEventListener("click", () => {
    docDetail.style.display = "none";
    docToggle.classList.remove("active");
    docToggle.textContent = "Raw";
    docSaveBtn.style.display = "none";
    // Clear body height so list view shrinks to content
    const body = card.querySelector(".agent-doc-body");
    if (body) body.style.height = "";
    refreshAgentDocs(name, docList, docEmpty, docBadge, card);
  });

  docToggle.addEventListener("click", () => {
    const isRaw = docToggle.classList.contains("active");
    const docName = docDetail.dataset.docName;
    if (isRaw) {
      // Switching from raw to rendered — save if changed
      const content = docEditArea.value;
      if (content !== docEditArea.dataset.original) {
        saveAgentDoc(name, docName, content, docRendered, docEditArea);
      } else {
        docRendered.innerHTML = marked.parse(content);
        docRendered.style.display = "";
        docEditArea.style.display = "none";
      }
      docToggle.classList.remove("active");
      docToggle.textContent = "Raw";
      docSaveBtn.style.display = "none";
    } else {
      // Switching to raw edit mode
      docRendered.style.display = "none";
      docEditArea.style.display = "";
      docEditArea.focus();
      docToggle.classList.add("active");
      docToggle.textContent = "Rendered";
      docSaveBtn.style.display = "";
    }
  });

  docSaveBtn.addEventListener("click", () => {
    const docName = docDetail.dataset.docName;
    saveAgentDoc(name, docName, docEditArea.value, docRendered, docEditArea);
    docToggle.classList.remove("active");
    docToggle.textContent = "Raw";
    docSaveBtn.style.display = "none";
  });

  docMoveBtn.addEventListener("click", async () => {
    const docName = docDetail.dataset.docName;
    if (!docName) return;
    try {
      const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}/${encodeURIComponent(docName)}/move-to-local`, { method: "POST" });
      if (res.ok) {
        docMoveBtn.textContent = "Copied!";
        setTimeout(() => { docMoveBtn.textContent = "Move to Local"; }, 2000);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to copy");
      }
    } catch {
      alert("Failed to copy");
    }
  });

  docDeleteBtn.addEventListener("click", async () => {
    const docName = docDetail.dataset.docName;
    if (!docName) return;
    if (!confirm(`Delete "${docName}"?`)) return;
    try {
      const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}/${encodeURIComponent(docName)}`, { method: "DELETE" });
      if (res.ok) {
        // Go back to list and refresh
        docDetail.style.display = "none";
        docToggle.classList.remove("active");
        docToggle.textContent = "Raw";
        docSaveBtn.style.display = "none";
        refreshAgentDocs(name, docList, docEmpty, docBadge, card);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  });

  docFinderBtn.addEventListener("click", () => {
    // Agent docs live at docs/<agent-name>/<doc>.md
    openInFinder(`docs/${name}/${docDetail.dataset.docName}.md`);
  });

  // Drag handle to resize doc body height
  const docResize = card.querySelector(".agent-doc-resize");
  const docBody = card.querySelector(".agent-doc-body");
  docResize.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = docBody.offsetHeight;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      const newHeight = Math.max(80, startHeight + (startY - ev.clientY));
      docBody.style.height = newHeight + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevSelect;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Touch resize for doc section (mobile)
  docResize.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const startY = e.touches[0].clientY;
    const startHeight = docBody.offsetHeight;

    const onTouchMove = (ev) => {
      const newHeight = Math.max(80, startHeight + (startY - ev.touches[0].clientY));
      docBody.style.height = newHeight + "px";
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Double-click resize handle to reset doc body height
  docResize.addEventListener("dblclick", () => {
    docBody.style.height = "";
  });

  // Resize grip: drag to resize width (column snap) + height (free pixels)
  const resizeGrip = card.querySelector(".resize-grip");

  const getSpan = () => {
    if (card.classList.contains("span-3")) return 3;
    if (card.classList.contains("span-2")) return 2;
    return 1;
  };

  const setSpan = (span) => {
    card.classList.remove("span-2", "span-3");
    if (span === 3) card.classList.add("span-3");
    else if (span === 2) card.classList.add("span-2");
  };

  // Compute how many grid columns exist at current viewport width
  const getGridColumnCount = () => {
    const gridStyle = getComputedStyle(grid);
    const cols = gridStyle.gridTemplateColumns.split(" ").length;
    return cols || 1;
  };

  // Get the width of a single grid column (first column)
  const getColWidth = () => {
    const gridStyle = getComputedStyle(grid);
    const cols = gridStyle.gridTemplateColumns.split(" ");
    return parseFloat(cols[0]) || 400;
  };

  resizeGrip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startScrollY = window.scrollY;
    const startHeight = card.offsetHeight;
    const startSpan = getSpan();
    const colWidth = getColWidth();
    const maxCols = getGridColumnCount();
    let scrollRAF = null;
    let lastMouseY = startY;

    // When terminal is open, track wrapper so we resize agent area only (terminal stays fixed)
    const bodyWrapper = card.querySelector(".card-body-wrapper");
    const termSection = card.querySelector(".agent-terminal-section");
    const termIsOpen = termSection && termSection.style.display !== "none";
    const startWrapperH = termIsOpen ? bodyWrapper.offsetHeight : 0;

    const applyHeight = (deltaY) => {
      const newHeight = Math.max(250, startHeight + deltaY);
      card.style.height = newHeight + "px";
      if (termIsOpen && bodyWrapper) {
        bodyWrapper.style.height = Math.max(150, startWrapperH + deltaY) + "px";
      }
    };

    document.body.style.userSelect = "none";
    card.classList.add("resizing-height");

    // Auto-scroll when mouse is near viewport edges during resize
    const autoScroll = () => {
      const edgeZone = 50;
      const maxSpeed = 15;
      const viewH = window.innerHeight;
      if (lastMouseY > viewH - edgeZone) {
        const speed = Math.min(maxSpeed, ((lastMouseY - (viewH - edgeZone)) / edgeZone) * maxSpeed);
        window.scrollBy(0, speed);
        const deltaY = (lastMouseY - startY) + (window.scrollY - startScrollY);
        applyHeight(deltaY);
        scheduleMasonry();
      } else if (lastMouseY < edgeZone) {
        const speed = Math.min(maxSpeed, ((edgeZone - lastMouseY) / edgeZone) * maxSpeed);
        window.scrollBy(0, -speed);
      }
      scrollRAF = requestAnimationFrame(autoScroll);
    };
    scrollRAF = requestAnimationFrame(autoScroll);

    const onMouseMove = (ev) => {
      lastMouseY = ev.clientY;
      const deltaY = (ev.clientY - startY) + (window.scrollY - startScrollY);
      applyHeight(deltaY);

      // Width: snap to column spans based on horizontal drag distance
      const deltaX = ev.clientX - startX;
      let targetSpan = startSpan + Math.round(deltaX / colWidth);
      targetSpan = Math.max(1, Math.min(targetSpan, maxCols, 3));
      if (targetSpan !== getSpan()) {
        setSpan(targetSpan);
      }
      scheduleMasonry();
    };

    const onMouseUp = () => {
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      card.classList.remove("resizing-height");

      // Persist final state
      saveLayout(name, { height: card.style.height, span: getSpan() });
      scheduleMasonry();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Touch resize for card grip (mobile) — height only, no span changes
  resizeGrip.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const startY = touch.clientY;
    const startHeight = card.offsetHeight;

    const bw = card.querySelector(".card-body-wrapper");
    const ts = card.querySelector(".agent-terminal-section");
    const tOpen = ts && ts.style.display !== "none";
    const startBwH = tOpen ? bw.offsetHeight : 0;

    card.classList.add("resizing-height");

    const onTouchMove = (ev) => {
      const t = ev.touches[0];
      const deltaY = t.clientY - startY;
      const newHeight = Math.max(200, startHeight + deltaY);
      card.style.height = newHeight + "px";
      if (tOpen && bw) bw.style.height = Math.max(150, startBwH + deltaY) + "px";
      scheduleMasonry();
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      card.classList.remove("resizing-height");
      saveLayout(name, { height: card.style.height });
      scheduleMasonry();
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Double-click grip to reset height + span to defaults
  resizeGrip.addEventListener("dblclick", (e) => {
    e.preventDefault();
    card.style.height = "";
    card.classList.remove("span-2", "span-3");
    saveLayout(name, { height: null, span: 1 });
    scheduleMasonry();
  });

  // --- Drag-to-reorder (header-only) ---
  const header = card.querySelector(".card-header");

  // Make only the header draggable — card itself stays non-draggable so text selection works
  // Disable on touch devices: HTML drag interferes with touch scrolling; cards are single-column on mobile
  if (!("ontouchstart" in window)) {
    header.setAttribute("draggable", "true");
  }

  header.addEventListener("dragstart", (e) => {
    // Don't drag from buttons inside header
    if (e.target.closest("button")) {
      e.preventDefault();
      return;
    }
    // Don't drag minimized cards or popped-out cards
    if (card.classList.contains("minimized") || card.classList.contains("popped-out")) {
      e.preventDefault();
      return;
    }
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", name);
  });

  header.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    // Clear all drag-over highlights
    for (const c of grid.querySelectorAll(".drag-over-card")) {
      c.classList.remove("drag-over-card");
    }
  });

  card.addEventListener("dragover", (e) => {
    // Don't intercept file drops (images/videos) — only card reorder drags
    if (e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!card.classList.contains("dragging")) {
      card.classList.add("drag-over-card");
    }
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over-card");
  });

  card.addEventListener("drop", (e) => {
    // Don't intercept file drops (images/videos)
    if (e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    card.classList.remove("drag-over-card");
    const draggedName = e.dataTransfer.getData("text/plain");
    if (!draggedName || draggedName === name) return;
    const draggedAgent = agents.get(draggedName);
    if (!draggedAgent) return;
    const draggedCard = draggedAgent.card;

    // Swap positions: insert dragged card before this card
    const allCards = Array.from(grid.querySelectorAll(".agent-card"));
    const draggedIdx = allCards.indexOf(draggedCard);
    const targetIdx = allCards.indexOf(card);
    if (draggedIdx < targetIdx) {
      card.after(draggedCard);
    } else {
      card.before(draggedCard);
    }
    saveCardOrder();
    scheduleMasonry();
  });

  // Force scroll-to-bottom for first 5s after card creation (covers page refresh)
  terminal._forceScrollUntil = Date.now() + 5000;
  terminal._wheelGraceUntil = Date.now() + 1500;

  grid.appendChild(card);
  applyLayout(name, card);
  // Apply server-side minimized state (overrides localStorage)
  if (minimized && !card.classList.contains("minimized")) {
    card.classList.add("minimized");
    const minBtn = card.querySelector(".minimize-btn");
    minBtn.innerHTML = "+";
    minBtn.title = "Restore";
    minimizedBar.appendChild(card);
  }
  updateBranchDisplay(card, branch, isWorktree);
  agents.set(name, { card, terminal, status: "working", workdir, _waitGen: 0, pendingAttachments, pasteState });
  updateEmptyState();
  scheduleMasonry();

  // Immediately check for existing docs (badge shows count on load)
  fetch(`/api/agent-docs/${encodeURIComponent(name)}`)
    .then((r) => r.json())
    .then((docs) => {
      if (docs.length > 0) {
        docBadge.classList.remove("empty");
        docBadge.textContent = docs.length;
      }
    })
    .catch(() => {});
}

// --- Shared xterm.js terminal infrastructure ---
// Build a full xterm theme from a background color (adapts for light/dark)
function buildXtermTheme(bg) {
  const light = _isLight(bg);
  const fg = light ? "#1a1a1a" : "#e6edf3";
  return {
    background: bg, foreground: fg, cursor: fg,
    selectionBackground: light ? "rgba(0,100,200,0.25)" : "rgba(56, 139, 253, 0.4)",
    black:         light ? "#1a1a1a" : "#484f58",
    red:           light ? "#cf222e" : "#ff7b72",
    green:         light ? "#1a7f37" : "#3fb950",
    yellow:        light ? "#7a6a00" : "#d29922",
    blue:          light ? "#0550ae" : "#58a6ff",
    magenta:       light ? "#8250df" : "#bc8cff",
    cyan:          light ? "#0c7d9d" : "#39d353",
    white:         light ? "#555"    : "#b1bac4",
    brightBlack:   light ? "#666"    : "#6e7681",
    brightRed:     light ? "#d1242f" : "#ffa198",
    brightGreen:   light ? "#1a9f37" : "#56d364",
    brightYellow:  light ? "#8a7500" : "#e3b341",
    brightBlue:    light ? "#0969da" : "#79c0ff",
    brightMagenta: light ? "#8250df" : "#d2a8ff",
    brightCyan:    light ? "#0c7d9d" : "#56d364",
    brightWhite:   light ? "#1a1a1a" : "#f0f6fc",
  };
}

const XTERM_THEME = buildXtermTheme("#0d1117");

const XTERM_BASE_CONFIG = {
  cursorBlink: true,
  cursorStyle: "bar",
  fontSize: 13,
  fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
  fastScrollModifier: "alt",
  fastScrollSensitivity: 10,
  smoothScrollDuration: 0,
  allowProposedApi: true,
  theme: XTERM_THEME,
};

function createXtermInstance(scrollback, themeOverride) {
  const config = { ...XTERM_BASE_CONFIG, scrollback };
  if (themeOverride) config.theme = themeOverride;
  const term = new Terminal(config);
  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  return { term, fitAddon };
}

function initXtermWebGL(term) {
  try {
    if (typeof WebglAddon !== "undefined") {
      const wgl = new WebglAddon.WebglAddon();
      wgl.onContextLoss(() => { wgl.dispose(); });
      term.loadAddon(wgl);
    }
  } catch (e) {
    console.warn("[xterm] WebGL addon failed:", e);
  }
}

const _xtermEncoder = new TextEncoder();

// Binary WS: footer shell stdin (0x01 prefix)
function _sendShellStdin(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = _xtermEncoder.encode(data);
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = 0x01;
    frame.set(payload, 1);
    ws.send(frame);
  }
}

// --- Terminal Card (xterm.js + tmux via binary WS) ---

// Binary WS: terminal card stdin (0x03 prefix + name routing)
function _sendTerminalStdin(name, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const nameBuf = _xtermEncoder.encode(name);
    const dataBuf = _xtermEncoder.encode(data);
    const frame = new Uint8Array(2 + nameBuf.length + dataBuf.length);
    frame[0] = 0x03;
    frame[1] = nameBuf.length;
    frame.set(nameBuf, 2);
    frame.set(dataBuf, 2 + nameBuf.length);
    ws.send(frame);
  }
}

// Binary WS: terminal card resize (0x04 prefix + name + cols/rows)
function _updateGripOffset() {
  // No-op: grip is now inside .card-body-wrapper which has position:relative,
  // so it naturally stays at the bottom-right of the agent area.
}

function _sendTerminalResize(name, cols, rows) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const nameBuf = _xtermEncoder.encode(name);
    const frame = new Uint8Array(2 + nameBuf.length + 4);
    frame[0] = 0x04;
    frame[1] = nameBuf.length;
    frame.set(nameBuf, 2);
    const dv = new DataView(frame.buffer);
    dv.setUint16(2 + nameBuf.length, cols);
    dv.setUint16(2 + nameBuf.length + 2, rows);
    ws.send(frame);
  }
}

// --- Embedded Agent Terminal ---
// Opens an xterm.js terminal inside an agent card, anchored below docs.
// Creates a server-side terminal session named "<agent>-term" in the agent's workdir.
const _termLoadingHTML = `<div class="terminal-loading"><div class="terminal-loading-anim"><div class="loading-ring"></div><div class="loading-ring loading-ring-2"></div><div class="loading-ring loading-ring-3"></div><div class="loading-orb loading-orb-1"></div><div class="loading-orb loading-orb-2"></div><div class="loading-orb loading-orb-3"></div><div class="loading-orb loading-orb-4"></div><div class="loading-orb loading-orb-5"></div><div class="loading-orb loading-orb-6"></div><div class="terminal-loading-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></div></div><span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span></div>`;

function updateTerminalHeader(card, workdir, branch, isWorktree, prUrl) {
  const wdEl = card.querySelector(".agent-term-workdir");
  const brEl = card.querySelector(".agent-term-branch");
  const prEl = card.querySelector(".agent-term-pr-btn");
  if (wdEl && workdir !== null && workdir !== undefined) wdEl.textContent = shortPath(workdir);
  if (brEl && branch !== null && branch !== undefined) {
    if (branch) {
      brEl.textContent = isWorktree ? `worktree: ${branch}` : branch;
      brEl.className = isWorktree ? "agent-term-branch branch-info worktree" : "agent-term-branch branch-info";
    } else {
      brEl.textContent = "";
    }
  }
  if (prEl && prUrl !== null && prUrl !== undefined) {
    if (prUrl) {
      prEl.href = prUrl;
      prEl.style.display = "";
    } else {
      prEl.style.display = "none";
    }
  }
}

function openAgentTerminal(agentName, card, restoreHeight) {
  const section = card.querySelector(".agent-terminal-section");
  if (!section) return;

  // If already open, just toggle visibility
  if (section.style.display !== "none") {
    closeAgentTerminal(agentName, card);
    return;
  }

  const container = section.querySelector(".agent-terminal-container");
  const loadingEl = section.querySelector(".terminal-loading");
  const agent = agents.get(agentName);
  const workdir = agent?.workdir || "";
  const termH = restoreHeight || 200;

  // BEFORE showing the terminal section: lock the body wrapper height
  // so the agent area can NEVER shrink when the terminal is added
  const bodyWrapper = card.querySelector(".card-body-wrapper");
  const wrapperH = bodyWrapper.offsetHeight;
  bodyWrapper.style.height = wrapperH + "px";
  bodyWrapper.style.flexGrow = "0";

  // Now show the section and set the terminal container height
  section.style.display = "";
  container.style.height = termH + "px";

  // Grow the card to fit: locked wrapper + terminal section
  const sectionH = section.offsetHeight;
  const newCardH = wrapperH + sectionH;
  card.style.height = newCardH + "px";
  // Directly set grid-row span — don't wait for masonryLayout
  const newSpan = Math.ceil((newCardH + GRID_GAP_PX) / GRID_ROW_PX);
  card.style.gridRow = `span ${newSpan}`;
  console.log("[terminal-open]", agentName, { wrapperH, sectionH, newCardH, newSpan, scrollH: card.scrollHeight });
  requestAnimationFrame(() => _updateGripOffset(card));
  saveLayout(agentName, { terminalOpen: true, terminalHeight: termH });
  if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
  masonryLayout();
  requestAnimationFrame(() => masonryLayout());
  setTimeout(masonryLayout, 150);

  // Populate header with current agent info
  const branchEl = card.querySelector(".branch-info:not(.agent-term-branch)");
  const branch = branchEl?.textContent?.replace(/^worktree:\s*/, "") || "";
  const isWorktree = branchEl?.classList.contains("worktree") || false;
  updateTerminalHeader(card, workdir, branch, isWorktree, null);

  // Fetch PR URL asynchronously
  fetch(`/api/sessions/${encodeURIComponent(agentName)}/pr-url`)
    .then(r => r.json())
    .then(data => { if (data.prUrl) updateTerminalHeader(card, null, null, null, data.prUrl); })
    .catch(() => {});

  // If already initialized (reopening with xterm alive), just re-subscribe
  if (agent?._termXterm) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-subscribe", session: agent._termName }));
    }
    requestAnimationFrame(() => { try { agent._termFitAddon.fit(); } catch {} });
    return;
  }

  // Helper: set up xterm for a given terminal session name
  const initEmbeddedXterm = (sessionName) => {
    const _termBg = getComputedStyle(document.documentElement).getPropertyValue("--shell-bg").trim() || "#0d1117";
    const { term, fitAddon } = createXtermInstance(5000, buildXtermTheme(_termBg));

    if (agent) {
      agent._termXterm = term;
      agent._termFitAddon = fitAddon;
      agent._termName = sessionName;
      agent._termReady = false;
    }

    requestAnimationFrame(() => {
      term.open(container);
      initXtermWebGL(term);
      term.onData((d) => { _sendTerminalStdin(sessionName, d); });
      try { fitAddon.fit(); } catch {}
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-subscribe", session: sessionName }));
        if (term.cols && term.rows) _sendTerminalResize(sessionName, term.cols, term.rows);
      }
      const ro = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (term.cols && term.rows) _sendTerminalResize(sessionName, term.cols, term.rows);
        } catch {}
      });
      ro.observe(container);
      if (agent) agent._termResizeObserver = ro;
      container.addEventListener("click", () => { term.focus(); });
      setTimeout(() => {
        if (loadingEl?.parentNode) { loadingEl.classList.add("fade-out"); setTimeout(() => loadingEl.remove(), 300); }
      }, 5000);
    });
  };

  // If tmux session already exists (e.g. after expand→minimize back, or page reload), reuse it
  if (agent?._termName) {
    initEmbeddedXterm(agent._termName);
    return;
  }

  // Create terminal session on the server (ephemeral — not persisted to sessions.json)
  const termName = agentName + "-term";
  fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: termName, type: "terminal", workdir }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) { console.error("[agent-terminal] Create failed:", data.error); return; }
      initEmbeddedXterm(data.name);
    })
    .catch((err) => console.error("[agent-terminal] Create failed:", err));

  // Wire close button
  const closeBtn = section.querySelector(".agent-terminal-close");
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener("click", () => closeAgentTerminal(agentName, card));
  }

  // Wire expand button → pop out to standalone terminal card
  const expandBtn = section.querySelector(".agent-terminal-expand");
  if (expandBtn && !expandBtn._wired) {
    expandBtn._wired = true;
    expandBtn.addEventListener("click", () => {
      const ag = agents.get(agentName);
      const termName = ag?._termName;
      const wd = ag?.workdir || "";
      if (!termName) return;

      // Create standalone terminal card FIRST (subscribes to same PTY, keeps scrollback alive)
      addTerminalCard(termName, wd);

      // Now clean up embedded terminal (unsubscribe after standalone has subscribed)
      setTimeout(() => {
        if (ag?._termXterm) { try { ag._termXterm.dispose(); } catch {} }
        if (ag?._termResizeObserver) { try { ag._termResizeObserver.disconnect(); } catch {} }
        ag._termXterm = null;
        ag._termFitAddon = null;
        ag._termReady = false;
        // Reset container with loading state for potential re-open
        const cont = section.querySelector(".agent-terminal-container");
        if (cont) cont.innerHTML = _termLoadingHTML;
        // Hide section + shrink card (without unsubscribing — standalone already subscribed)
        const sectionH = section.offsetHeight;
        const cardH = card.offsetHeight;
        if (sectionH > 0 && cardH > sectionH) card.style.height = (cardH - sectionH) + "px";
        section.style.display = "none";
        const bw = card.querySelector(".card-body-wrapper");
        if (bw) { bw.style.height = ""; bw.style.flexGrow = ""; }
        _updateGripOffset(card);
        saveLayout(agentName, { terminalOpen: false, height: card.style.height });
        scheduleMasonry();
        // NOW unsubscribe embedded — standalone client keeps PTY alive
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: termName }));
        }
      }, 200); // Wait for standalone to subscribe first

      // Scroll to the new card
      const termAgent = agents.get(termName);
      if (termAgent?.card) {
        requestAnimationFrame(() => {
          termAgent.card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  }

  // Wire workdir click → open in Finder
  const termWdEl = section.querySelector(".agent-term-workdir");
  if (termWdEl && !termWdEl._wired) {
    termWdEl._wired = true;
    termWdEl.addEventListener("click", () => {
      const ag = agents.get(agentName);
      if (ag?.workdir) {
        fetch("/api/shell/open-finder", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: ag.workdir }),
        });
      }
    });
  }

  // Wire resize handle
  const resizeHandle = section.querySelector(".agent-terminal-resize");
  if (resizeHandle && !resizeHandle._wired) {
    resizeHandle._wired = true;
    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startTermH = container.offsetHeight;
      const startCardH = card.offsetHeight;
      const onMove = (ev) => {
        const delta = ev.clientY - startY;
        const newTermH = Math.max(80, startTermH + delta);
        container.style.height = newTermH + "px";
        // Grow/shrink card by the same delta
        card.style.height = (startCardH + (newTermH - startTermH)) + "px";
        _updateGripOffset(card);
        scheduleMasonry();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (agent?._termFitAddon) try { agent._termFitAddon.fit(); } catch {}
        _updateGripOffset(card);
        saveLayout(agentName, { terminalHeight: container.offsetHeight, height: card.style.height });
        if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
        masonryLayout();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}

function closeAgentTerminal(agentName, card) {
  const section = card.querySelector(".agent-terminal-section");
  if (section) {
    // Shrink card by the terminal section height before hiding
    const sectionH = section.offsetHeight;
    const cardH = card.offsetHeight;
    if (sectionH > 0 && cardH > sectionH) {
      card.style.height = (cardH - sectionH) + "px";
    }
    section.style.display = "none";
    // Unlock body wrapper so it can flex normally again
    const bodyWrapper = card.querySelector(".card-body-wrapper");
    if (bodyWrapper) { bodyWrapper.style.height = ""; bodyWrapper.style.flexGrow = ""; }
  }
  _updateGripOffset(card);
  saveLayout(agentName, { terminalOpen: false, height: card.style.height });
  if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
  masonryLayout();
  requestAnimationFrame(() => { masonryLayout(); });
  setTimeout(masonryLayout, 100);
  // Clamp scroll so we don't overshoot past the now-shorter page
  requestAnimationFrame(() => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY > maxScroll && maxScroll >= 0) {
      window.scrollTo({ top: maxScroll, behavior: "auto" });
    }
  });
  // Unsubscribe to save bandwidth
  const agent = agents.get(agentName);
  if (agent?._termName && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: agent._termName }));
  }
}

function addTerminalCard(name, workdir) {
  if (agents.has(name)) {
    // Already exists — just update workdir if changed
    const agent = agents.get(name);
    if (workdir && workdir !== agent.workdir) {
      agent.workdir = workdir;
      const wdEl = agent.card.querySelector(".workdir-link");
      if (wdEl) wdEl.textContent = shortPath(workdir);
    }
    return;
  }

  const card = document.createElement("div");
  card.className = "agent-card terminal-card";
  card.innerHTML = `
    <div class="card-sticky-top">
      <div class="card-header">
        <div class="card-header-left">
          <span class="terminal-icon">&gt;_</span>
          <span class="agent-name">${escapeHtml(name)}</span>
        </div>
        <div class="card-actions">
          <button class="minimize-btn" tabindex="0" title="Minimize">&minus;</button>
          <button class="kill-btn" tabindex="0" title="Close terminal">&times;</button>
        </div>
      </div>
      <div class="card-subheader">
        <span class="workdir-link">${escapeHtml(shortPath(workdir))}</span>
        <span class="branch-info"></span>
      </div>
    </div>
    <div class="terminal-xterm-container">
      <div class="terminal-loading">
        <div class="terminal-loading-anim">
          <div class="loading-ring"></div>
          <div class="loading-ring loading-ring-2"></div>
          <div class="loading-ring loading-ring-3"></div>
          <div class="loading-orb loading-orb-1"></div>
          <div class="loading-orb loading-orb-2"></div>
          <div class="loading-orb loading-orb-3"></div>
          <div class="loading-orb loading-orb-4"></div>
          <div class="loading-orb loading-orb-5"></div>
          <div class="loading-orb loading-orb-6"></div>
          <div class="terminal-loading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
        </div>
        <span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
      </div>
    </div>
    <div class="resize-grip"></div>
  `;

  const xtermContainer = card.querySelector(".terminal-xterm-container");
  const loadingEl = card.querySelector(".terminal-loading");

  // Create xterm.js terminal instance — use shell/terminal bg color from theme
  const _termBg = getComputedStyle(document.documentElement).getPropertyValue("--shell-bg").trim() || "#0d1117";
  const { term, fitAddon } = createXtermInstance(5000, buildXtermTheme(_termBg));

  // Store in agents map
  agents.set(name, { card, xterm: term, fitAddon, type: "terminal", workdir, status: "terminal" });

  // Derive parent agent name from terminal name (e.g. "my-agent-term" → "my-agent")
  const parentAgentName = name.endsWith("-term") ? name.slice(0, -5) : null;

  // Close button — close standalone card, keep tmux session alive for later re-embed
  const killBtn = card.querySelector(".kill-btn");
  killBtn.addEventListener("click", () => {
    // Unsubscribe + dispose xterm but keep tmux session alive
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
    }
    const agentEntry = agents.get(name);
    if (agentEntry?.resizeObserver) agentEntry.resizeObserver.disconnect();
    term.dispose();
    card.remove();
    agents.delete(name);
    // Clear terminalOpen on parent agent so it doesn't re-open on reload
    if (parentAgentName) saveLayout(parentAgentName, { terminalOpen: false });
    updateEmptyState();
    scheduleMasonry();
  });

  // Minimize button — collapse back into parent agent card as embedded terminal
  const minBtn = card.querySelector(".minimize-btn");
  minBtn.addEventListener("click", () => {
    const parentAgent = parentAgentName ? agents.get(parentAgentName) : null;
    if (parentAgent?.card) {
      // Unsubscribe + dispose standalone
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
      }
      const agentEntry = agents.get(name);
      if (agentEntry?.resizeObserver) agentEntry.resizeObserver.disconnect();
      term.dispose();
      card.remove();
      agents.delete(name);
      updateEmptyState();
      scheduleMasonry();
      // Re-open as embedded terminal in the parent agent card
      openAgentTerminal(parentAgentName, parentAgent.card);
    } else {
      // No parent agent — fall back to standard minimize
      if (card.classList.contains("minimized")) {
        card.classList.remove("minimized");
        minBtn.innerHTML = "\u2212";
        minBtn.title = "Minimize";
        grid.appendChild(card);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-subscribe", session: name }));
        }
        reorderCards();
        updateEmptyState();
        scheduleMasonry();
        requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
      } else {
        card.classList.add("minimized");
        minBtn.innerHTML = "+";
        minBtn.title = "Restore";
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
        }
        minimizedBar.appendChild(card);
        updateEmptyState();
        scheduleMasonry();
      }
    }
  });

  // Resize grip
  const grip = card.querySelector(".resize-grip");
  let resizing = false;
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startH = card.offsetHeight;
    const onMove = (ev) => {
      const h = startH + (ev.clientY - startY);
      card.style.height = Math.max(150, h) + "px";
    };
    const onUp = () => {
      resizing = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try { fitAddon.fit(); } catch {}
      scheduleMasonry();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Populate branch from parent agent if this is a "-term" card
  if (parentAgentName) {
    const parentAgent = agents.get(parentAgentName);
    if (parentAgent?.card) {
      const srcBranch = parentAgent.card.querySelector(".branch-info:not(.agent-term-branch)");
      if (srcBranch) {
        updateBranchDisplay(card, srcBranch.textContent.replace(/^worktree:\s*/, ""), srcBranch.classList.contains("worktree"));
      }
    }
  }

  // Add card to grid
  grid.appendChild(card);
  updateEmptyState();
  scheduleMasonry();

  // Open xterm after card is in DOM
  requestAnimationFrame(() => {
    term.open(xtermContainer);

    initXtermWebGL(term);

    // Wire input to binary WS
    term.onData((data) => {
      _sendTerminalStdin(name, data);
    });

    // Fit and subscribe
    try { fitAddon.fit(); } catch {}
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-subscribe", session: name }));
      // Send initial resize
      if (term.cols && term.rows) {
        _sendTerminalResize(name, term.cols, term.rows);
      }
    }

    // ResizeObserver for auto-fit — store reference for cleanup on kill
    const ro = new ResizeObserver(() => {
      if (card.classList.contains("minimized")) return;
      try {
        fitAddon.fit();
        if (term.cols && term.rows) {
          _sendTerminalResize(name, term.cols, term.rows);
        }
      } catch {}
    });
    ro.observe(xtermContainer);
    const agentEntry = agents.get(name);
    if (agentEntry) agentEntry.resizeObserver = ro;

    // Focus xterm on click
    xtermContainer.addEventListener("click", () => { term.focus(); });

    // Safety: dismiss loading after 5s even if no data arrives
    setTimeout(() => {
      if (loadingEl?.parentNode) { loadingEl.classList.add("fade-out"); setTimeout(() => loadingEl.remove(), 300); }
    }, 5000);

    // Mark as loaded for page loader
    if (!_loaderDismissed) {
      _agentsWithContent.add(name);
      checkAllAgentsLoaded();
    }

    // Second fit after layout settles (masonry may shift the card)
    setTimeout(() => { try { fitAddon.fit(); } catch {} }, 100);
  });
}

// Scroll trapping: brief pause when scrolling down hits terminal bottom
function setupScrollTrapping(el) {
  let _trappedUntil = 0;
  el.addEventListener("wheel", (e) => {
    // Only trap downward scrolls that hit the bottom
    if (e.deltaY <= 0) return; // scrolling up — always allow (passes to page if at top)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    if (!atBottom) return; // still has content to scroll — let it scroll normally
    // At bottom scrolling down — trap briefly
    if (Date.now() < _trappedUntil) {
      e.preventDefault();
    } else {
      _trappedUntil = Date.now() + 500;
      e.preventDefault();
    }
  }, { passive: false });
}

function scrollTerminalToBottom(terminal) {
  // Save and restore focus — setting scrollTop on a tabindex'd scrollable div
  // can steal focus in some browsers (WebKit).
  const active = document.activeElement;
  terminal.scrollTop = terminal.scrollHeight;
  if (active && active !== document.activeElement && active.isConnected) {
    active.focus({ preventScroll: true });
  }
}

function updateTerminal(terminal, lines) {
  // Keep loading spinner until Claude Code banner appears (hides raw shell commands)
  const loading = terminal.querySelector(".terminal-loading");
  if (loading) {
    const claudeStarted = lines.some((l) => l.replace(/\x1b\[[0-9;]*m/g, "").includes("Claude Code"));
    // Safety: if spinner has been showing for 8+ seconds, clear it regardless
    // (prevents permanent "stuck" state if Claude fails to start or banner is missed)
    if (!loading._createdAt) loading._createdAt = Date.now();
    const spinnerAge = Date.now() - loading._createdAt;
    if (!claudeStarted && spinnerAge < 8000) return; // still booting — keep showing spinner
    loading.remove();
  }

  const content = lines.join("\n");

  // Skip update if content hasn't changed
  if (terminal._lastContent === content) {
    // Still ensure scroll is at bottom if user hasn't scrolled up.
    // Layout changes (masonry, resize) can displace scrollTop even without new content.
    if (!terminal._userTouching && !terminal._userScrolledUp) {
      scrollTerminalToBottom(terminal);
    }
    return;
  }

  // Skip update if user has active text selection in this terminal
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && terminal.contains(sel.anchorNode)) {
    return;
  }

  const userInteracting = terminal._userTouching || terminal._userScrolledUp;
  const forceScroll = !userInteracting && terminal._forceScrollUntil && Date.now() < terminal._forceScrollUntil;

  // Preserve scroll position when user is reading history (scrolled up)
  const savedScrollTop = userInteracting ? terminal.scrollTop : null;

  terminal._lastContent = content;
  let html = linkifyTerminal(ansiUp.ansi_to_html(content));
  // Strip dark gray background blocks (user-typed messages in Claude Code)
  // These are ANSI 256-color backgrounds in the #2a2a2a–#4a4a4a range
  html = html.replace(/background-color:rgb\((\d+),(\d+),(\d+)\)/g, (m, r, g, b) => {
    r = +r; g = +g; b = +b;
    if (r === g && g === b && r >= 30 && r <= 80) return "background-color:transparent";
    return m;
  });

  // Suppress scroll-event side effects during innerHTML replacement
  terminal._updatingContent = true;
  // Save focused element before innerHTML — DOM reconstruction can steal focus
  // to the terminal (scrollable containers are implicitly focusable in some browsers).
  const _preInnerFocused = document.activeElement;
  const _preInnerCursorStart = _preInnerFocused?.selectionStart;
  const _preInnerCursorEnd = _preInnerFocused?.selectionEnd;
  terminal.innerHTML = `<pre>${html}</pre>`;
  // Restore focus if innerHTML stole it
  if (_preInnerFocused && _preInnerFocused !== document.activeElement && _preInnerFocused.isConnected) {
    _preInnerFocused.focus({ preventScroll: true });
    try { if (_preInnerCursorStart != null) _preInnerFocused.setSelectionRange(_preInnerCursorStart, _preInnerCursorEnd); } catch {}
  }

  // Restore scroll position if user was reading history
  if (savedScrollTop !== null) {
    terminal.scrollTop = savedScrollTop;
  }
  requestAnimationFrame(() => { terminal._updatingContent = false; });

  if (forceScroll) {
    // Force scroll (initial load / page refresh): multiple retries for layout settling
    // Each checks if user has since interacted to avoid fighting with them
    scrollTerminalToBottom(terminal);
    requestAnimationFrame(() => scrollTerminalToBottom(terminal));
    for (const ms of [50, 150, 500]) {
      setTimeout(() => {
        if (!terminal._userScrolledUp && !terminal._userTouching) {
          scrollTerminalToBottom(terminal);
        }
      }, ms);
    }
  } else if (!userInteracting) {
    // User hasn't scrolled up — always keep at bottom.
    // (Previously checked wasScrolledToBottom, but layout changes like masonry reflow
    // can displace scrollTop without user intent, leaving terminals stuck at top.)
    scrollTerminalToBottom(terminal);
    requestAnimationFrame(() => scrollTerminalToBottom(terminal));
  }
}

function updateStatus(agent, status, promptType) {
  const name = agent.card.querySelector(".agent-name").textContent;
  const wasNeedy = agent.status === "waiting" || agent.status === "asking";
  const isNeedy = status === "waiting" || status === "asking";

  // Bump generation when entering a new needy cycle (was not needy -> now needy)
  if (isNeedy && !wasNeedy) {
    agent._waitGen = (agent._waitGen || 0) + 1;
  }

  agent.status = status;
  const badge = agent.card.querySelector(".status-badge");
  const labels = { working: "working", waiting: "needs input", asking: "has question", idle: "" };

  // Check if this needy state has been dismissed
  const dismissed = isNeedy && isDismissed(name, agent._waitGen);

  badge.textContent = dismissed ? "dismissed" : (labels[status] || "");
  badge.className = `status-badge ${dismissed ? "dismissed" : status}`;
  agent.card.classList.toggle("needs-input", isNeedy && !dismissed);
  agent.card.classList.toggle("status-dismissed", dismissed);

  // Show/hide dismiss option in more menu
  const dismissItem = agent.card.querySelector('[data-action="dismiss-status"]');
  if (dismissItem) dismissItem.style.display = (isNeedy && !dismissed) ? "" : "none";

  updateDashboardDot();

  // Show/hide prompt action buttons (only for "waiting" status with tool prompts)
  const actionsBar = agent.card.querySelector(".prompt-actions");
  if (status !== "waiting" || !promptType) {
    if (actionsBar.innerHTML !== "") actionsBar.innerHTML = "";
    actionsBar.style.display = "none";
      return;
  }
  // "asking" status doesn't need action buttons — user types in the regular input

  actionsBar.style.display = "";

  // After any prompt button click: scroll terminal + request fresh output from server
  function afterPromptAction() {
    const t = agent.card.querySelector(".terminal");
    if (t) {
      t._userScrolledUp = false;
      t._forceScrollUntil = Date.now() + 3000;
      for (const ms of [500, 1000, 2000, 3000]) {
        setTimeout(() => { t.scrollTop = t.scrollHeight; }, ms);
      }
    }
    // Also clear _lastContent so the next server push always renders
    if (t) t._lastContent = null;
    // Pull fresh output from server (backup for push-based updates)
    scheduleRefresh(name);
  }

  if (promptType === "permission") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="allow-once">Allow Once</button>
      <button class="prompt-btn prompt-btn-always" data-action="allow-always">Allow Always</button>
      <button class="prompt-btn prompt-btn-deny" data-action="deny">Deny</button>
    `;
    actionsBar.querySelector('[data-action="allow-once"]').addEventListener("click", () => {
      sendKeypress(name, "Enter");
      afterPromptAction();
    });
    actionsBar.querySelector('[data-action="allow-always"]').addEventListener("click", () => {
      sendKeypress(name, "Down");
      setTimeout(() => { sendKeypress(name, "Enter"); afterPromptAction(); }, 150);
    });
    actionsBar.querySelector('[data-action="deny"]').addEventListener("click", () => {
      sendKeypress(name, ["Down", "Down"]);
      setTimeout(() => { sendKeypress(name, "Enter"); afterPromptAction(); }, 150);
    });
  } else if (promptType === "yesno") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="yes">Yes</button>
      <button class="prompt-btn prompt-btn-deny" data-action="no">No</button>
    `;
    actionsBar.querySelector('[data-action="yes"]').addEventListener("click", () => {
      sendInput(name, "y");
      afterPromptAction();
    });
    actionsBar.querySelector('[data-action="no"]').addEventListener("click", () => {
      sendInput(name, "n");
      afterPromptAction();
    });
  } else if (promptType === "question" && agent.promptOptions) {
    // AskUserQuestion: number keys INSTANTLY select options (no arrow keys or Enter needed).
    // Pressing "1" selects option 1, "2" selects option 2, etc.
    // This avoids all arrow key escape sequence race conditions.
    const isTypeOption = (label) => /type\s*something|^other$/i.test(label);

    let html = '<div class="prompt-options">';
    for (const opt of agent.promptOptions) {
      if (isTypeOption(opt.label)) {
        // Inline text input for free-text "Type something" / "Other" options
        html += `<div class="prompt-type-input-wrap">
          <input type="text" class="prompt-type-input" data-num="${opt.index + 1}" placeholder="Type your answer...">
          <button class="prompt-btn prompt-btn-allow prompt-type-send" data-num="${opt.index + 1}">\u21B5</button>
        </div>`;
      } else {
        const title = opt.description ? escapeHtml(opt.description) : "";
        html += `<button class="prompt-btn prompt-btn-option" data-num="${opt.index + 1}" title="${title}">${escapeHtml(opt.label)}</button>`;
      }
    }
    html += '</div>';
    actionsBar.innerHTML = html;

    // Option buttons: just send the digit — Claude instantly selects it
    for (const btn of actionsBar.querySelectorAll(".prompt-btn-option[data-num]")) {
      btn.addEventListener("click", () => {
        sendKeypress(name, btn.dataset.num);
        afterPromptAction();
      });
    }

    // "Type something" inputs: press digit to select the option, wait for text input, then type
    for (const inp of actionsBar.querySelectorAll(".prompt-type-input")) {
      const num = inp.dataset.num;
      const doTypeSubmit = () => {
        const text = inp.value.trim();
        if (!text) return;
        // Server: sends digit key, waits 400ms, then types the literal text + Enter
        sendTypeOption(name, [num], text);
        inp.value = "";
        afterPromptAction();
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doTypeSubmit();
      });
      const sendBtn = actionsBar.querySelector(`.prompt-type-send[data-num="${num}"]`);
      if (sendBtn) sendBtn.addEventListener("click", doTypeSubmit);
    }
  } else if (promptType === "enter") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="enter">Press Enter</button>
    `;
    actionsBar.querySelector('[data-action="enter"]').addEventListener("click", () => {
      sendKeypress(name, "Enter");
      afterPromptAction();
    });
  }
}

function updateEmptyState() {
  if (agents.size > 0) {
    emptyState.style.display = "none";
    return;
  }
  emptyState.style.display = "block";
  if (_needsSetup) {
    emptyState.innerHTML =
      '<div class="setup-banner">' +
        '<p><strong>Welcome to CEO Dashboard!</strong></p>' +
        '<p>You\'re running with defaults. To configure workspaces, shell alias, and auto-start:</p>' +
        '<pre>npm run setup</pre>' +
        '<p style="margin-top:8px;opacity:0.7">Everything works without setup — create an agent or use the terminal below to get started.</p>' +
      '</div>';
  } else {
    emptyState.innerHTML = '<p>No agents running. Click <strong>+ New Agent</strong> to start one.</p>';
  }
}

function shortPath(p) {
  if (!p) return "";
  if (!_homedir) return p;
  return p.replace(new RegExp("^" + _homedir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "~");
}

function updateBranchDisplay(card, branch, isWorktree) {
  const el = card.querySelector(".branch-info");
  if (!el) return;
  if (!branch) { el.textContent = ""; el.className = "branch-info"; return; }
  el.textContent = isWorktree ? `worktree: ${branch}` : branch;
  el.className = isWorktree ? "branch-info worktree" : "branch-info";
}

// --- Agent Doc Helpers (multi-doc per agent) ---

async function refreshAgentDocs(name, listEl, emptyEl, badgeEl, card) {
  try {
    const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}`);
    const docs = await res.json();
    if (docs.length > 0) {
      badgeEl.classList.remove("empty");
      badgeEl.textContent = docs.length;
      emptyEl.style.display = "none";
      listEl.innerHTML = "";
      listEl.style.display = "";
      for (const doc of docs) {
        const item = document.createElement("div");
        item.className = "agent-doc-list-item";
        item.innerHTML = `
          <span class="agent-doc-list-name">${escapeHtml(doc.name)}</span>
          <span class="agent-doc-list-meta">${formatSize(doc.size)}</span>
        `;
        item.addEventListener("click", () => openAgentDoc(name, doc.name, card));
        makeKeyboardActivatable(item);
        listEl.appendChild(item);
      }
    } else {
      badgeEl.classList.add("empty");
      badgeEl.textContent = "0";
      listEl.innerHTML = "";
      listEl.style.display = "none";
      emptyEl.style.display = "";
    }
  } catch {}
}

async function openAgentDoc(agentName, docName, card) {
  const detail = card.querySelector(".agent-doc-detail");
  const list = card.querySelector(".agent-doc-list");
  const empty = card.querySelector(".agent-doc-empty");
  const rendered = card.querySelector(".agent-doc-rendered");
  const editArea = card.querySelector(".agent-doc-edit-area");
  const detailNameEl = card.querySelector(".agent-doc-detail-name");
  const toggle = card.querySelector(".agent-doc-toggle");
  const saveBtn = card.querySelector(".agent-doc-save-btn");
  const docBody = card.querySelector(".agent-doc-body");

  list.style.display = "none";
  empty.style.display = "none";
  detail.style.display = "";
  detail.dataset.docName = docName;
  // Set a readable default height for doc detail view
  if (docBody) docBody.style.height = "200px";
  detailNameEl.textContent = docName;

  try {
    const res = await fetch(`/api/agent-docs/${encodeURIComponent(agentName)}/${encodeURIComponent(docName)}`);
    const data = await res.json();
    const content = data.content || "";
    editArea.value = content;
    editArea.dataset.original = content;
    rendered.innerHTML = marked.parse(content);
    rendered.style.display = "";
    editArea.style.display = "none";
    toggle.classList.remove("active");
    toggle.textContent = "Raw";
    saveBtn.style.display = "none";
  } catch {}
}

async function saveAgentDoc(agentName, docName, content, renderedEl, editArea) {
  try {
    await fetch(`/api/agent-docs/${encodeURIComponent(agentName)}/${encodeURIComponent(docName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    editArea.dataset.original = content;
    renderedEl.innerHTML = marked.parse(content);
    renderedEl.style.display = "";
    editArea.style.display = "none";
  } catch {
    alert("Failed to save doc");
  }
}

function startDocPolling() {
  setInterval(async () => {
    for (const [name, agent] of agents) {
      const section = agent.card.querySelector(".agent-doc-section");
      if (!section) continue;
      const badgeEl = section.querySelector(".agent-doc-badge");

      // Always poll badge count (even when section is collapsed)
      try {
        const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}`);
        const docs = await res.json();
        if (docs.length > 0) {
          badgeEl.classList.remove("empty");
          badgeEl.textContent = docs.length;
        } else {
          badgeEl.classList.add("empty");
          badgeEl.textContent = "0";
        }

        // If section is open and not viewing a specific doc, refresh the list too
        if (section.classList.contains("open")) {
          const detail = section.querySelector(".agent-doc-detail");
          if (!detail || detail.style.display === "none") {
            const listEl = section.querySelector(".agent-doc-list");
            const emptyEl = section.querySelector(".agent-doc-empty");
            refreshAgentDocs(name, listEl, emptyEl, badgeEl, agent.card);
          }
        }
      } catch {}
    }
    }, 8000);
}

// --- Agent Todo Refs ---

function renderAgentTodoRefs(card, todos) {
  const container = card.querySelector(".agent-todo-refs");
  if (!container) return;
  if (!todos || todos.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = todos.map((t) => `
    <span class="agent-todo-pill" title="${escapeHtml(t.title)}" data-todo-id="${t.id}">
      <span class="agent-todo-pill-dot" style="background:${safeHex(t.hex)}"></span>
      <span class="agent-todo-pill-label">${escapeHtml(t.title)}</span>
    </span>
  `).join("");
  // Click a pill → switch to todo view and select that list
  const cardName = card.querySelector(".agent-name")?.textContent || "";
  container.querySelectorAll(".agent-todo-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const todoId = pill.dataset.todoId;
      showTodoView(cardName);
      if (todoData && todoData.lists) {
        activeListId = todoId;
        saveTodoLastList();
        renderTodoDots();
        renderActiveList();
      }
    });
  });
}

function startTodoRefsPolling() {
  async function poll() {
    for (const [name, agent] of agents) {
      try {
        const res = await fetch(`/api/todos/by-agent/${encodeURIComponent(name)}`);
        const todos = await res.json();
        renderAgentTodoRefs(agent.card, todos);
      } catch {}
    }
  }
  poll();
  setInterval(poll, 10000);
}

// --- Slash Command Autocomplete ---

async function loadSlashCommands() {
  try {
    const res = await fetch("/api/slash-commands");
    slashCommands = await res.json();
  } catch {
    slashCommands = [];
  }
}

function setupAutocomplete(input, card) {
  const dropdown = document.createElement("div");
  dropdown.className = "slash-dropdown";
  card.querySelector(".card-input").appendChild(dropdown);

  let activeIndex = -1;

  function showDropdown(matches) {
    dropdown.innerHTML = "";
    activeIndex = -1;
    if (matches.length === 0) {
      dropdown.classList.remove("visible");
      return;
    }
    for (const cmd of matches) {
      const item = document.createElement("div");
      item.className = "slash-item";
      item.innerHTML = `
        <span class="slash-item-name">${escapeHtml(cmd.name)}</span>
        <span class="slash-item-desc">${escapeHtml(cmd.description)}</span>
        ${cmd.custom ? '<span class="slash-item-badge">custom</span>' : ""}
      `;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent input blur
        input.value = cmd.name + " ";
        hideDropdown();
        input.focus();
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.add("visible");
  }

  function hideDropdown() {
    dropdown.classList.remove("visible");
    activeIndex = -1;
  }

  function setActive(index) {
    const items = dropdown.querySelectorAll(".slash-item");
    items.forEach((el) => el.classList.remove("active"));
    if (index >= 0 && index < items.length) {
      activeIndex = index;
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const val = input.value;
    if (val.startsWith("/") && !val.includes(" ")) {
      const q = val.toLowerCase();
      const matches = slashCommands.filter((c) => c.name.startsWith(q));
      showDropdown(matches);
    } else {
      hideDropdown();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (!dropdown.classList.contains("visible")) return;

    const items = dropdown.querySelectorAll(".slash-item");
    if (items.length === 0) return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex >= items.length - 1 ? 0 : activeIndex + 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const selected = items[activeIndex >= 0 ? activeIndex : 0];
      const name = selected.querySelector(".slash-item-name").textContent;
      input.value = name + " ";
      hideDropdown();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const selected = items[activeIndex];
      const name = selected.querySelector(".slash-item-name").textContent;
      input.value = name + " ";
      hideDropdown();
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  });

  input.addEventListener("blur", () => {
    // Small delay so mousedown on dropdown items fires first
    setTimeout(hideDropdown, 150);
  });
}

// --- Session Picker ---

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function renderSessionList(sessions) {
  sessionList.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (selectedSessionId === s.sessionId ? " selected" : "");
    item.dataset.sessionId = s.sessionId;
    item.dataset.projectPath = s.projectPath || "";

    const title = s.lastPrompt?.slice(0, 120) || s.firstPrompt?.slice(0, 120) || s.summary?.slice(0, 120) || "Untitled session";
    const subtitle = s.lastPrompt && s.firstPrompt && s.lastPrompt !== s.firstPrompt
      ? s.firstPrompt.slice(0, 80) : "";
    const branch = s.gitBranch || "";
    const time = relativeTime(s.modified);
    const size = formatSize(s.fileSize);

    item.innerHTML = `
      <div class="session-item-summary">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="session-item-first-prompt">${escapeHtml(subtitle)}</div>` : ""}
      <div class="session-item-meta">
        <span>${time}</span>
        ${branch ? `<span class="session-branch">${escapeHtml(branch)}</span>` : ""}
        ${size ? `<span>${size}</span>` : ""}
      </div>
    `;

    item.addEventListener("click", () => selectSession(s));
    item.setAttribute("tabindex", "-1");
    sessionList.appendChild(item);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractVideoFrames(file, onProgress) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const duration = video.duration;
  const frameCount = Math.min(20, Math.max(5, Math.floor(duration / 2)));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const frames = [];
  const baseName = file.name.replace(/\.[^.]+$/, "");

  for (let i = 0; i < frameCount; i++) {
    const time = (duration * i) / frameCount;
    video.currentTime = time;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    const base64 = await blobToBase64(blob);
    const frameName = `${baseName}-frame-${i + 1}.jpg`;
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: frameName, data: base64 }),
    });
    const result = await res.json();
    if (result.path) {
      frames.push({ path: result.path, name: frameName });
    }
    if (onProgress) onProgress(i + 1, frameCount);
  }

  URL.revokeObjectURL(url);
  return { frames, duration, frameCount };
}

function renderAttachmentChips(card, attachments) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Preserve paste chip across re-renders
  const pasteChip = container.querySelector(".attachment-chip.paste");
  if (attachments.length === 0) {
    container.innerHTML = "";
    if (pasteChip) container.appendChild(pasteChip);
    return;
  }
  container.innerHTML = attachments
    .map((a, i) => {
      if (a.videoGroup) {
        const label = a.processing
          ? escapeHtml(a.progressText || `Processing ${a.name}...`)
          : `${escapeHtml(a.name)} (${a.frameCount} frames)`;
        return `<span class="attachment-chip video${a.processing ? " processing" : ""}">
          <span class="attachment-chip-name">${label}</span>
          ${a.processing ? "" : `<button class="attachment-chip-remove" data-idx="${i}">&times;</button>`}
        </span>`;
      }
      return `<span class="attachment-chip">
          <span class="attachment-chip-name">${escapeHtml(a.name)}</span>
          <button class="attachment-chip-remove" data-idx="${i}">&times;</button>
        </span>`;
    })
    .join("");
  for (const btn of container.querySelectorAll(".attachment-chip-remove")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attachments.splice(idx, 1);
      renderAttachmentChips(card, attachments);
    });
  }
  // Re-append preserved paste chip
  if (pasteChip) container.appendChild(pasteChip);
}

function renderPasteChip(card, lineCount, onRemove) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Remove any existing paste chip first
  const existing = container.querySelector(".attachment-chip.paste");
  if (existing) existing.remove();

  const chip = document.createElement("span");
  chip.className = "attachment-chip paste";
  chip.innerHTML = `
    <span class="attachment-chip-name">\u{1F4CB} ${lineCount} lines pasted</span>
    <button class="attachment-chip-remove">&times;</button>
  `;
  chip.querySelector(".attachment-chip-remove").addEventListener("click", () => {
    chip.remove();
    onRemove();
  });
  container.appendChild(chip);
}

function selectSession(session) {
  // Toggle: clicking selected session deselects
  if (selectedSessionId === session.sessionId) {
    deselectSession();
    return;
  }

  selectedSessionId = session.sessionId;

  // Highlight selected item
  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.sessionId === session.sessionId);
  });

  // Show selected info
  const label = session.lastPrompt?.slice(0, 60) || session.firstPrompt?.slice(0, 60) || "Untitled";
  sessionSelectedLabel.textContent = `Resuming: ${label}`;
  sessionSelectedInfo.classList.remove("hidden");

  // Hide prompt textarea (not needed when resuming)
  promptLabel.style.display = "none";

  // Auto-fill workdir from session's projectPath
  if (session.projectPath) {
    setWorkdir(session.projectPath);
  }
}

function deselectSession() {
  selectedSessionId = null;
  sessionList.querySelectorAll(".session-item").forEach((el) => el.classList.remove("selected"));
  sessionSelectedInfo.classList.add("hidden");
  promptLabel.style.display = "";
  resetWorkdir();
}

async function fetchClaudeSessions() {
  try {
    const res = await fetch("/api/claude-sessions");
    claudeSessions = await res.json();
    renderSessionList(claudeSessions);
  } catch {
    claudeSessions = [];
  }
}

function filterSessions(query) {
  if (!query) {
    renderSessionList(claudeSessions);
    return;
  }
  const q = query.toLowerCase();
  const filtered = claudeSessions.filter((s) => {
    return (s.summary || "").toLowerCase().includes(q)
      || (s.lastPrompt || "").toLowerCase().includes(q)
      || (s.firstPrompt || "").toLowerCase().includes(q)
      || (s.gitBranch || "").toLowerCase().includes(q);
  });
  renderSessionList(filtered);
}

let searchDebounce;
sessionSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => filterSessions(sessionSearch.value.trim()), 200);
});

sessionDeselect.addEventListener("click", (e) => {
  e.preventDefault();
  deselectSession();
});

let DEFAULT_WORKDIR = "";
let _homedir = ""; // set by /api/config — shortPath() is a no-op until then
let _defaultAgentName = "agent";
let _needsSetup = false;

// --- Config loading ---

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    DEFAULT_WORKDIR = cfg.defaultWorkspace || "";
    _homedir = cfg.homedir || _homedir;
    _defaultAgentName = cfg.defaultAgentName || "agent";
    selectedWorkdirPath = DEFAULT_WORKDIR;
    _needsSetup = cfg.needsSetup || false;
    if (cfg.title) {
      TAB_TITLE_DEFAULT = cfg.title;
      document.title = cfg.title;
      const headerTitle = document.getElementById("header-title");
      if (headerTitle) headerTitle.textContent = cfg.title;
    }
    // Populate the contribute tooltip with the dashboard directory + spawn button
    if (cfg.dashboardDir) {
      const dir = shortPath(cfg.dashboardDir);
      const tip = document.querySelector(".contribute-tooltip");
      if (tip) tip.querySelector(".dashboard-dir").textContent = dir;
      const spawnBtn = document.getElementById("contribute-spawn-btn");
      if (spawnBtn) {
        spawnBtn.addEventListener("click", async () => {
          spawnBtn.disabled = true;
          spawnBtn.textContent = "Creating…";
          try {
            const res = await fetch("/api/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "contributor", workdir: cfg.dashboardDir }),
            });
            if (res.ok) {
              const data = await res.json();
              addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
              spawnBtn.textContent = "Created!";
              setTimeout(() => {
                const agent = agents.get(data.name);
                if (agent) agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 300);
            } else {
              spawnBtn.textContent = "Create Agent";
              spawnBtn.disabled = false;
            }
          } catch {
            spawnBtn.textContent = "Create Agent";
            spawnBtn.disabled = false;
          }
        });
      }
    }
    _renderWorkdirPills(cfg.workspaces || []);
    updateEmptyState();
  })
  .catch(() => {});

function _renderWorkdirPills(workspaces) {
  const customBtn = workdirOptions.querySelector('[data-path="__custom__"]');
  // Remove any previously rendered workspace pills
  workdirOptions.querySelectorAll(".workdir-pill:not([data-path='__custom__'])").forEach((p) => p.remove());
  // Insert workspace pills before the Custom button
  for (const ws of workspaces) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "workdir-pill";
    btn.dataset.path = ws.path;
    btn.textContent = ws.label;
    workdirOptions.insertBefore(btn, customBtn);
  }
  // Activate the default workspace pill
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
}

// --- Workdir picker ---

const workdirOptions = document.getElementById("workdir-options");
const workdirCustom = document.getElementById("agent-workdir-custom");
let selectedWorkdirPath = DEFAULT_WORKDIR;

workdirOptions.addEventListener("click", (e) => {
  const pill = e.target.closest(".workdir-pill");
  if (!pill) return;
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  const path = pill.dataset.path;
  if (path === "__custom__") {
    workdirCustom.classList.remove("hidden");
    workdirCustom.focus();
    selectedWorkdirPath = "__custom__";
  } else {
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  }
});

function getSelectedWorkdir() {
  if (selectedWorkdirPath === "__custom__") return workdirCustom.value.trim();
  return selectedWorkdirPath;
}

function setWorkdir(path) {
  const pill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(path)}"]`);
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  if (pill) {
    pill.classList.add("active");
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  } else {
    workdirOptions.querySelector('.workdir-pill[data-path="__custom__"]').classList.add("active");
    workdirCustom.classList.remove("hidden");
    workdirCustom.value = path;
    selectedWorkdirPath = "__custom__";
  }
}

function resetWorkdir() {
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
  workdirCustom.classList.add("hidden");
  workdirCustom.value = "";
  selectedWorkdirPath = DEFAULT_WORKDIR;
}

// --- Keyboard Accessibility Helpers ---

function makeKeyboardActivatable(el) {
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.click();
    }
  });
}

// Track keyboard vs mouse navigation — scoped styles only show during keyboard use
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.body.classList.add("keyboard-nav");
});
document.addEventListener("mousedown", () => {
  document.body.classList.remove("keyboard-nav");
});

function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const focusable = [...container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null); // only visible elements
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Scroll focused element into view — generous positioning so the user always has context
document.addEventListener("focusin", (e) => {
  if (!_loaderDismissed) return; // don't scroll during page load
  const el = e.target;
  // Skip elements inside fixed/overlay panels that manage their own scroll
  if (el.closest("#shell-terminal") || el.closest(".modal") || el.closest("#files-panel") || el.closest("#settings-panel")) return;
  const card = el.closest(".agent-card");
  const headerH = 60; // sticky dashboard header height
  const margin = 80;  // generous breathing room above the element

  // When focusing the card's textarea input, scroll so the input sits just
  // above the shell panel (or viewport bottom), with the agent terminal visible above
  const isCardInput = card && el.closest(".card-input");
  if (isCardInput) {
    const inputArea = el.closest(".card-input");
    const inputRect = inputArea.getBoundingClientRect();
    const shellPanel = document.getElementById("shell-panel");
    const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
    const viewBottom = window.innerHeight - bottomCutoff;
    const isHidden = inputRect.bottom > viewBottom - 10 || inputRect.top < headerH;
    const isTooLow = inputRect.bottom > viewBottom - 60; // too close to shell panel edge
    if (isHidden || isTooLow) {
      // Place input bottom just above the shell panel with breathing room
      const targetBottom = viewBottom - 20;
      window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
    }
    return;
  }

  // Only scroll if the card's input area is not visible
  if (!card) return;
  const inputArea = card.querySelector(".card-input");
  if (!inputArea) return;
  const inputRect = inputArea.getBoundingClientRect();
  const shellPanel = document.getElementById("shell-panel");
  const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
  const viewTop = headerH;
  const viewBottom = window.innerHeight - bottomCutoff;
  // If any part of the input is visible, don't scroll
  if (inputRect.bottom > viewTop && inputRect.top < viewBottom) return;
  // Input completely above viewport
  if (inputRect.bottom <= viewTop) {
    window.scrollBy({ top: inputRect.top - viewTop - margin, behavior: "smooth" });
  }
  // Input completely below viewport
  if (inputRect.top >= viewBottom) {
    const targetBottom = viewBottom - 20;
    window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
  }
});

function updateCardNumbers() {
  const cards = [...grid.querySelectorAll(".agent-card:not(.minimized)")];
  cards.forEach((card, i) => {
    let badge = card.querySelector(".card-number-badge");
    if (cards.length >= 2 && i < 9) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "card-number-badge";
        card.querySelector(".card-header-left").prepend(badge);
      }
      badge.textContent = i + 1;
    } else if (badge) {
      badge.remove();
    }
  });
}

// --- Modals ---

newAgentBtn.addEventListener("click", () => {
  modalOverlay.classList.remove("hidden");
  fetchClaudeSessions();
  const nameInput = document.getElementById("agent-name");
  if (!nameInput.value) nameInput.value = _defaultAgentName;
  nameInput.focus();
  nameInput.select();
});

// + Terminal button — instant create, no modal
const newTerminalBtn = document.getElementById("new-terminal-btn");
if (newTerminalBtn) {
  newTerminalBtn.addEventListener("click", () => {
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "terminal", type: "terminal" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { console.error("[terminal] Create failed:", data.error); return; }
        addTerminalCard(data.name, data.workdir);
        reorderCards();
        updateEmptyState();
        scheduleMasonry();
      })
      .catch((err) => console.error("[terminal] Create failed:", err));
  });
}

function closeNewAgentModal() {
  modalOverlay.classList.add("hidden");
  deselectSession();
  sessionSearch.value = "";
  sessionList.innerHTML = "";
  document.getElementById("agent-name").value = "";
  // Clear modal attachments
  modalPendingAttachments.length = 0;
  const chips = document.getElementById("modal-attachment-chips");
  if (chips) chips.innerHTML = "";
}

modalCancel.addEventListener("click", closeNewAgentModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeNewAgentModal();
});

modalOverlay.addEventListener("keydown", (e) => {
  if (!modalOverlay.classList.contains("hidden")) trapFocus(modalOverlay.querySelector(".modal"), e);
});

// --- Modal drag-and-drop for images/videos ---
const modalPendingAttachments = [];
const promptDropZone = document.getElementById("prompt-drop-zone");

if (promptDropZone) {
  promptDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.add("drag-over");
  });
  promptDropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
  });
  promptDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    const chipsContainer = document.getElementById("modal-attachment-chips");
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            modalPendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        const videoId = `video-${Date.now()}`;
        modalPendingAttachments.push({
          name: file.name,
          videoGroup: videoId,
          processing: true,
          paths: [],
          frameCount: 0,
          duration: 0,
        });
        renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        try {
          const entry = modalPendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal video extraction failed:", err);
          const idx = modalPendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) modalPendingAttachments.splice(idx, 1);
          renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        }
      }
    }
  });
}

// --- Modal paste for images ---
const agentPromptTextarea = document.getElementById("agent-prompt");
if (agentPromptTextarea) {
  agentPromptTextarea.addEventListener("paste", async (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const imageFiles = Array.from(clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const chipsContainer = document.getElementById("modal-attachment-chips");
    for (const file of imageFiles) {
      try {
        const base64 = await fileToBase64(file);
        const filename = file.name === "image.png" ? `clipboard-${Date.now()}.png` : file.name;
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, data: base64 }),
        });
        const result = await res.json();
        if (result.path) {
          modalPendingAttachments.push({ path: result.path, name: filename });
          renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        }
      } catch (err) {
        console.error("Modal clipboard upload failed:", err);
      }
    }
  });
}

let creatingAgent = false;

newAgentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (creatingAgent) return; // prevent double submit
  // Don't submit while video frames are still extracting
  if (modalPendingAttachments.some((a) => a.processing)) return;

  // Sanitize name: spaces → dashes, strip invalid chars, lowercase
  let name = document.getElementById("agent-name").value.trim();
  name = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  if (!name) {
    alert("Please enter a name");
    return;
  }
  // Update the input to show the sanitized name
  document.getElementById("agent-name").value = name;

  const workdir = getSelectedWorkdir();
  const prompt = document.getElementById("agent-prompt").value.trim();

  // Collect attachment paths for initial prompt
  const hasAttachments = modalPendingAttachments.length > 0;
  let initialImages = [];
  let imageContextText = "";
  if (hasAttachments) {
    const videoContextParts = [];
    for (const a of modalPendingAttachments) {
      if (a.videoGroup) {
        initialImages.push(...a.paths);
        videoContextParts.push(
          `[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`
        );
      } else {
        initialImages.push(a.path);
      }
    }
    imageContextText = videoContextParts.join("\n");
  }

  const body = { name, workdir: workdir || undefined };
  if (selectedSessionId) {
    body.resumeSessionId = selectedSessionId;
  } else if (hasAttachments) {
    // Send prompt text separately via paste-buffer after creation so images are included
    body.initialImages = initialImages;
    body.initialImageText = [imageContextText, prompt].filter(Boolean).join("\n");
  } else if (prompt) {
    body.prompt = prompt;
  }

  // Disable button while creating
  const submitBtn = newAgentForm.querySelector('button[type="submit"]');
  creatingAgent = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      closeNewAgentModal();
      newAgentForm.reset();
      resetWorkdir();
      // Scroll the new card into view
      const agent = agents.get(data.name);
      if (agent) {
        setTimeout(() => agent.card.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create agent");
    }
  } catch {
    alert("Failed to create agent");
  } finally {
    creatingAgent = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Create";
  }
});

wsCancel.addEventListener("click", () => {
  wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("click", (e) => {
  if (e.target === wsModalOverlay) wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("keydown", (e) => {
  if (!wsModalOverlay.classList.contains("hidden")) trapFocus(wsModalOverlay.querySelector(".modal"), e);
});

wsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("workspace-agent-name").value;
  const workdir = document.getElementById("workspace-path").value.trim();

  const res = await fetch(`/api/sessions/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workdir }),
  });

  if (res.ok) {
    const agent = agents.get(name);
    if (agent) {
      agent.workdir = workdir;
      agent.card.querySelector(".workdir-link").textContent = shortPath(workdir);
      if (agent.terminal) agent.terminal.innerHTML = "";
    }
    wsModalOverlay.classList.add("hidden");
  } else {
    const err = await res.json();
    alert(err.error || "Failed to update workspace");
  }
});

// --- Todo view: capture-phase shortcut overrides ---
// Cmd+8/B/I must be caught in capture phase to prevent browser tab-switching (Cmd+8)
// and ensure they work even when the editor textarea isn't focused.
document.addEventListener("keydown", (e) => {
  if (typeof currentView === "undefined" || currentView !== "todo") return;
  if (!e.metaKey && !e.ctrlKey) return;

  const key = e.key;
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const isRich = !!richEditor;

  if (key === "z" && isRich) {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) richRedo();
    else richUndo();
    return;
  }

  if (key === "8") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      toggleCurrentItemCheckbox();
    } else if (rawEditor) {
      rawEditor.focus();
      insertCheckbox(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "b") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("bold");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "**");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "i") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("italic");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "*");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "=" || key === "+") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(true);
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      toggleHeading(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "-" || key === "_") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(false);
      scheduleRichSave();
    }
    return;
  }

  // Cmd+[ / Cmd+] — switch to prev/next list
  if (key === "[" || key === "]") {
    e.preventDefault();
    e.stopPropagation();
    const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
    if (sorted.length < 2) return;
    const idx = sorted.findIndex((l) => l.id === activeListId);
    const next = key === "]"
      ? sorted[(idx + 1) % sorted.length]
      : sorted[(idx - 1 + sorted.length) % sorted.length];
    activeListId = next.id;
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
    return;
  }
}, true); // capture phase — fires before browser default behavior

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  let inInput = e.target.matches("input, textarea, [contenteditable]");
  // Suppress hotkeys while page loader is showing or reload is in flight
  // BUT allow typing in inputs (user may have focus restored before loader finishes)
  if (!_loaderDismissed || _reloadingPage) { if (!inInput) return; }

  // If focus is on body but we had an active textarea recently, redirect to it
  // instead of letting the keypress trigger a hotkey. This catches the cascading
  // bug where programmatic focus loss → body → next keystroke triggers hotkey.
  if (!inInput && (e.target === document.body || e.target === document.documentElement)) {
    if (_lastActiveTextarea && _lastActiveTextarea.isConnected && (Date.now() - _lastActiveTextareaAt) < 5000 && (Date.now() - _userClickedAt) > 300) {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const ta = _lastActiveTextarea;
        ta.focus({ preventScroll: true });
        // Insert the printable character that was meant for the textarea
        if (e.key.length === 1) {
          const start = ta.selectionStart || 0;
          const end = ta.selectionEnd || 0;
          ta.value = ta.value.slice(0, start) + e.key + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + 1;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          e.preventDefault();
        }
        // For non-printable keys (Backspace, arrows, etc.), focus is restored
        // and the next keypress will work normally. One keystroke may be lost
        // but that's acceptable — the focus is back where it belongs.
        return;
      }
    }
  }

  const inShell = !!e.target.closest("#shell-panel");
  const inFilesPanel = !!e.target.closest("#files-panel");
  const todoSettingsOverlay = document.getElementById("todo-settings-overlay");
  const bugReportOverlay = document.getElementById("bug-report-overlay");
  const bugSuccessOverlay = document.getElementById("bug-success-overlay");
  const modalOpen = !modalOverlay.classList.contains("hidden") || !wsModalOverlay.classList.contains("hidden") || (todoSettingsOverlay && !todoSettingsOverlay.classList.contains("hidden")) || (_diffOverlay && !_diffOverlay.classList.contains("hidden")) || (bugReportOverlay && !bugReportOverlay.classList.contains("hidden")) || (bugSuccessOverlay && !bugSuccessOverlay.classList.contains("hidden"));

  // Escape: layered dismiss (fullscreen → modals → file editor → files panel → shell → agent tmux)
  if (e.key === "Escape") {
    const fullscreenCard = document.querySelector(".agent-card.fullscreen");
    if (fullscreenCard) {
      e.preventDefault();
      fullscreenCard.classList.remove("fullscreen");
      const btn = fullscreenCard.querySelector(".expand-btn");
      if (btn) { btn.innerHTML = "\u26F6"; btn.title = "Fullscreen"; }
      document.body.style.overflow = "";
      scheduleMasonry();
      return;
    }
    if (_diffOverlay && !_diffOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeDiffModal();
      return;
    }
    if (!modalOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeNewAgentModal();
      newAgentBtn.focus();
      return;
    }
    if (!wsModalOverlay.classList.contains("hidden")) {
      e.preventDefault();
      wsModalOverlay.classList.add("hidden");
      return;
    }
    if (_ueOverlay && !_ueOverlay.classList.contains("hidden")) {
      e.preventDefault();
      _ueOverlay.classList.add("hidden");
      _updateErrorShowing = false;
      return;
    }
    if (_diffOverlay && !_diffOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeDiffModal();
      return;
    }
    if (bugReportOverlay && !bugReportOverlay.classList.contains("hidden")) {
      e.preventDefault();
      if (window.closeBugReportModal) window.closeBugReportModal();
      else bugReportOverlay.classList.add("hidden");
      return;
    }
    if (bugSuccessOverlay && !bugSuccessOverlay.classList.contains("hidden")) {
      e.preventDefault();
      bugSuccessOverlay.classList.add("hidden");
      return;
    }
    // Todo settings modal
    if (todoSettingsOverlay && !todoSettingsOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeTodoSettings();
      return;
    }
    // Todo view — back to agents
    if (typeof currentView !== "undefined" && currentView === "todo") {
      e.preventDefault();
      showAgentsView();
      return;
    }
    // Bookmarks panel
    if (_bmPanel && _bmPanel.classList.contains("visible")) {
      e.preventDefault();
      closeBookmarksPanel();
      if (_bmBtn) _bmBtn.focus();
      return;
    }
    // Settings panel
    if (settingsPanel && settingsPanel.classList.contains("visible")) {
      e.preventDefault();
      closeSettingsPanel();
      settingsBtn.focus();
      return;
    }
    // Files panel: close editor first, then panel
    if (filesPanel && filesPanel.classList.contains("visible")) {
      e.preventDefault();
      if (!fileEditor.classList.contains("hidden")) {
        closeFileEditor();
      } else {
        closeFilesPanel();
        filesBtn.focus();
      }
      return;
    }
    // Shell terminal: close panel, return focus to body
    if (inShell && document.getElementById("shell-panel").classList.contains("open")) {
      e.preventDefault();
      document.getElementById("shell-header").click();
      document.getElementById("shell-header").focus();
      return;
    }
    // If typing in a card input, just blur
    if (inInput && !inShell && !inFilesPanel) return;
    // Agent card: send Escape to tmux
    const card = e.target.closest(".agent-card");
    if (card) {
      const agentName = card.querySelector(".agent-name")?.textContent;
      if (agentName) {
        e.preventDefault();
        sendKeypress(agentName, "Escape");
      }
    }
    return;
  }

  // Modifier keys — never hijack browser shortcuts
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Skip hotkeys when modals are open
  if (modalOpen) return;

  const key = e.key.toLowerCase();

  // Panel toggle hotkeys — work even from inside their own panel (to close)
  // T toggles terminal (Escape closes it when focused inside xterm)
  if (key === "t" && !inInput) {
    e.preventDefault();
    document.getElementById("shell-header").click();
    return;
  }
  if (key === "f" && !inInput) {
    e.preventDefault();
    filesBtn.click();
    if (!filesPanel.classList.contains("visible")) filesBtn.focus();
    return;
  }
  if (key === "b" && !inInput) {
    e.preventDefault();
    toggleBookmarksPanel();
    return;
  }
  if (key === "s" && !inInput) {
    e.preventDefault();
    settingsBtn.click();
    if (!settingsPanel.classList.contains("visible")) settingsBtn.focus();
    return;
  }

  // Remaining hotkeys — skip if typing in any input
  if (inInput) return;

  if (key === "d") {
    e.preventDefault();
    toggleTodoView();
    return;
  }
  if (key === "r") {
    e.preventDefault();
    restartServer();
    return;
  }
  if (key === "!") {
    e.preventDefault();
    document.getElementById("bug-report-btn").click();
    return;
  }
  if (key === "n") {
    e.preventDefault();
    newAgentBtn.click();
    return;
  }
  if (key === "c") {
    e.preventDefault();
    if (filesPanel.classList.contains("visible") && currentFilePath === "__ceo_md__") {
      closeFilesPanel();
      ceoMdBtn.focus();
    } else {
      ceoMdBtn.click();
    }
    return;
  }
  if (key === "/") {
    e.preventDefault();
    const firstCard = grid.querySelector(".agent-card:not(.minimized)");
    if (firstCard) {
      const inp = firstCard.querySelector(".card-input textarea");
      if (inp) inp.focus();
    }
    return;
  }
  // 1-9: focus card N's input
  const num = parseInt(key);
  if (num >= 1 && num <= 9) {
    const cards = [...grid.querySelectorAll(".agent-card:not(.minimized)")];
    if (cards[num - 1]) {
      e.preventDefault();
      const inp = cards[num - 1].querySelector(".card-input textarea");
      if (inp) inp.focus();
    }
    return;
  }
});

// --- Bug Report ---

{
  const bugReportBtn = document.getElementById("bug-report-btn");
  const bugOverlay = document.getElementById("bug-report-overlay");
  const bugForm = document.getElementById("bug-report-form");
  const bugTitle = document.getElementById("bug-title");
  const bugDesc = document.getElementById("bug-description");
  const bugSteps = document.getElementById("bug-steps");
  const bugSubmit = document.getElementById("bug-submit");
  const bugCancel = document.getElementById("bug-cancel");
  const bugTargetRepo = document.getElementById("bug-target-repo");
  const bugSysinfoLoading = document.getElementById("bug-sysinfo-loading");
  const bugSysinfoContent = document.getElementById("bug-sysinfo-content");
  const bugSysinfoError = document.getElementById("bug-sysinfo-error");
  const bugSysinfoRetry = document.getElementById("bug-sysinfo-retry");
  const bugScreenshotZone = document.getElementById("bug-screenshot-zone");
  const bugScreenshotInput = document.getElementById("bug-screenshot-input");
  const bugScreenshotPlaceholder = document.getElementById("bug-screenshot-placeholder");
  const bugScreenshotPreview = document.getElementById("bug-screenshot-preview");
  const bugScreenshotImg = document.getElementById("bug-screenshot-img");
  const bugScreenshotRemove = document.getElementById("bug-screenshot-remove");
  const bugSuccessOverlay = document.getElementById("bug-success-overlay");
  const bugSuccessMsg = document.getElementById("bug-success-msg");
  const bugSuccessClose = document.getElementById("bug-success-close");
  const bugSuccessSpawn = document.getElementById("bug-success-spawn");

  let bugSelectedSeverity = "medium";
  let bugScreenshotFile = null;
  let bugSystemInfo = null;
  let _lastIssueUrl = "";
  let _lastBugTitle = "";
  let _lastBugDesc = "";

  function setSysinfoState(state) {
    bugSysinfoLoading.classList.toggle("hidden", state !== "loading");
    bugSysinfoContent.classList.toggle("hidden", state !== "content");
    bugSysinfoError.classList.toggle("hidden", state !== "error");
  }

  function openBugReportModal() {
    bugOverlay.classList.remove("hidden");
    bugTargetRepo.textContent = _bugReportRepo;
    bugTitle.focus();
    fetchSystemInfo();
  }

  // Expose globally for Escape handler
  window.closeBugReportModal = closeBugReportModal;
  function closeBugReportModal() {
    bugOverlay.classList.add("hidden");
    bugForm.reset();
    bugSelectedSeverity = "medium";
    bugScreenshotFile = null;
    bugScreenshotPreview.classList.add("hidden");
    bugScreenshotPlaceholder.style.display = "";
    bugSystemInfo = null;
    setSysinfoState("loading");
    // Reset severity pills
    bugOverlay.querySelectorAll(".severity-pill").forEach(p => {
      p.classList.toggle("active", p.dataset.severity === "medium");
    });
  }

  let _bugReportRepo = "john-farina/claude-cli-dashboard";

  async function fetchSystemInfo() {
    setSysinfoState("loading");
    try {
      const res = await fetch("/api/system-info");
      bugSystemInfo = await res.json();
      bugSystemInfo.browser = navigator.userAgent.replace(/^Mozilla\/5\.0 /, "");
      if (bugSystemInfo.bugReportRepo) _bugReportRepo = bugSystemInfo.bugReportRepo;
      bugTargetRepo.textContent = _bugReportRepo;
      bugSysinfoContent.textContent =
        `Dashboard: ${bugSystemInfo.dashboardVersion} (${bugSystemInfo.dashboardBranch})\n` +
        `Node: ${bugSystemInfo.nodeVersion}\n` +
        `OS: ${bugSystemInfo.platform} ${bugSystemInfo.osVersion}\n` +
        `Agents: ${bugSystemInfo.activeAgents}\n` +
        `Browser: ${bugSystemInfo.browser}`;
      setSysinfoState("content");
    } catch {
      setSysinfoState("error");
    }
  }

  bugSysinfoRetry.addEventListener("click", fetchSystemInfo);

  // Open modal
  bugReportBtn.addEventListener("click", openBugReportModal);

  // Close modal
  bugCancel.addEventListener("click", closeBugReportModal);
  bugOverlay.addEventListener("click", (e) => {
    if (e.target === bugOverlay) closeBugReportModal();
  });

  // Severity pills
  bugOverlay.querySelectorAll(".severity-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      bugOverlay.querySelectorAll(".severity-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      bugSelectedSeverity = pill.dataset.severity;
    });
  });

  // Screenshot upload
  bugScreenshotZone.addEventListener("click", () => bugScreenshotInput.click());
  bugScreenshotZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    bugScreenshotZone.classList.add("dragover");
  });
  bugScreenshotZone.addEventListener("dragleave", () => {
    bugScreenshotZone.classList.remove("dragover");
  });
  bugScreenshotZone.addEventListener("drop", (e) => {
    e.preventDefault();
    bugScreenshotZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleScreenshot(file);
  });
  bugScreenshotInput.addEventListener("change", () => {
    if (bugScreenshotInput.files[0]) handleScreenshot(bugScreenshotInput.files[0]);
  });
  bugScreenshotRemove.addEventListener("click", (e) => {
    e.stopPropagation();
    bugScreenshotFile = null;
    bugScreenshotPreview.classList.add("hidden");
    bugScreenshotPlaceholder.style.display = "";
    bugScreenshotInput.value = "";
  });

  function handleScreenshot(file) {
    bugScreenshotFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      bugScreenshotImg.src = reader.result;
      bugScreenshotPreview.classList.remove("hidden");
      bugScreenshotPlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);
  }

  // Submit bug report
  bugForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = bugTitle.value.trim();
    if (!title) return;

    bugSubmit.disabled = true;
    bugSubmit.textContent = "Submitting...";

    try {
      // Upload screenshot first if present
      let screenshotPath = null;
      if (bugScreenshotFile) {
        const formData = new FormData();
        formData.append("file", bugScreenshotFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (upRes.ok) {
          const upData = await upRes.json();
          screenshotPath = upData.path;
        }
      }

      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: bugDesc.value.trim(),
          steps: bugSteps.value.trim(),
          severity: bugSelectedSeverity,
          systemInfo: bugSystemInfo,
          screenshotPath,
        }),
      });

      const data = await res.json();
      if (res.ok && data.issueUrl) {
        _lastIssueUrl = data.issueUrl;
        _lastBugTitle = title;
        _lastBugDesc = bugDesc.value.trim();
        closeBugReportModal();
        // Show success modal with spawn option
        bugSuccessMsg.innerHTML = `Issue created: <a href="${escapeAttr(data.issueUrl)}" target="_blank">${escapeHtml(data.issueUrl)}</a>`;
        bugSuccessOverlay.classList.remove("hidden");
      } else {
        alert(data.error || "Failed to create issue. Make sure `gh` CLI is authenticated.");
      }
    } catch {
      alert("Failed to submit bug report. Check your network connection and gh CLI auth.");
    } finally {
      bugSubmit.disabled = false;
      bugSubmit.textContent = "Submit Bug Report";
    }
  });

  // Success modal actions
  bugSuccessClose.addEventListener("click", () => {
    bugSuccessOverlay.classList.add("hidden");
  });
  bugSuccessOverlay.addEventListener("click", (e) => {
    if (e.target === bugSuccessOverlay) bugSuccessOverlay.classList.add("hidden");
  });

  bugSuccessSpawn.addEventListener("click", async () => {
    bugSuccessOverlay.classList.add("hidden");
    // Create a new agent with the bug details as its prompt
    const prompt = `Fix this bug and create a PR:\n\nTitle: ${_lastBugTitle}\n${_lastBugDesc ? `Description: ${_lastBugDesc}\n` : ""}Issue: ${_lastIssueUrl}\n\nPlease investigate, fix the bug, and create a PR that references the issue.`;
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "bugfix-" + _lastBugTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30).replace(/-$/, ""),
          prompt,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      } else {
        alert("Failed to spawn fix agent");
      }
    } catch {
      alert("Failed to spawn fix agent");
    }
  });
}

// --- .claude File Browser ---

const filesBtn = document.getElementById("files-btn");
const filesPanel = document.getElementById("files-panel");
const filesBackdrop = document.getElementById("files-backdrop");
const filesClose = document.getElementById("files-close");
const filesCategories = document.getElementById("files-categories");
const fileEditor = document.getElementById("file-editor");
const fileEditorName = document.getElementById("file-editor-name");
const fileEditorContent = document.getElementById("file-editor-content");
const fileEditorBack = document.getElementById("file-editor-back");
const fileEditorSave = document.getElementById("file-editor-save");
const fileEditorToggle = document.getElementById("file-editor-toggle");
const fileEditorRendered = document.getElementById("file-editor-rendered");
const fileEditorFinder = document.getElementById("file-editor-finder");
const fileEditorHint = document.getElementById("file-editor-hint");
const ceoMdBtn = document.getElementById("ceo-md-btn");

let currentFilePath = null;

function toggleFilesPanel() {
  const isOpen = filesPanel.classList.contains("visible");
  if (isOpen) {
    closeFilesPanel();
  } else {
    // Close other panels if open
    const sp = document.getElementById("settings-panel");
    if (sp && sp.classList.contains("visible")) closeSettingsPanel();
    if (_bmPanel && _bmPanel.classList.contains("visible")) closeBookmarksPanel();
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
    filesBtn.classList.add("panel-active");
    loadClaudeFiles();
    // Focus the close button so Tab navigation starts inside the panel
    setTimeout(() => filesClose.focus(), 100);
  }
}

function closeFilesPanel() {
  filesPanel.classList.remove("visible");
  filesBackdrop.classList.remove("visible");
  filesBtn.classList.remove("panel-active");
  closeFileEditor();
}

filesBtn.addEventListener("click", toggleFilesPanel);
filesClose.addEventListener("click", closeFilesPanel);
filesBackdrop.addEventListener("click", closeFilesPanel);
filesPanel.addEventListener("keydown", (e) => {
  if (filesPanel.classList.contains("visible")) trapFocus(filesPanel, e);
});

async function loadClaudeFiles() {
  try {
    const res = await fetch("/api/claude-files");
    const data = await res.json();
    renderFileCategories(data);
  } catch {
    filesCategories.innerHTML = '<div style="padding:20px;color:var(--text-dim)">Failed to load files</div>';
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

function renderFileCategories(data) {
  filesCategories.innerHTML = "";

  const categories = [
    { key: "ceoDocs", label: "CEO Docs", files: data.ceoDocs || [] },
    { key: "docs", label: "Docs", files: data.docs || [] },
    { key: "commands", label: "Commands", files: data.commands || [] },
    { key: "skills", label: "Skills", files: data.skills || [] },
    { key: "agents", label: "Agents", files: data.agents || [] },
    { key: "memory", label: "Memory", files: data.memory || [] },
  ];

  // Settings as a special single-file category
  if (data.settings) {
    categories.push({
      key: "settings",
      label: "Settings",
      files: [{ name: "settings.json", path: data.settings.path, size: data.settings.size || 0 }],
    });
  }

  for (const cat of categories) {
    // Always show Docs category (even when empty) so users discover it
    if (cat.files.length === 0 && cat.key !== "docs") continue;

    const section = document.createElement("div");
    section.className = "files-category";

    const header = document.createElement("div");
    header.className = "files-category-header";
    header.innerHTML = `${escapeHtml(cat.label)} <span class="files-category-count">${cat.files.length}</span>`;
    header.addEventListener("click", () => section.classList.toggle("open"));
    makeKeyboardActivatable(header);

    const list = document.createElement("div");
    list.className = "files-category-list";

    if (cat.key === "docs" && cat.files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "files-docs-empty";
      empty.innerHTML = `
        <p>Save docs here for all future Claude sessions — coding guidelines, architecture notes, API references.</p>
        <button class="btn-secondary files-create-docs-btn">Create Docs Folder</button>
      `;
      empty.querySelector("button").addEventListener("click", async () => {
        try {
          await fetch("/api/claude-files/ensure-docs", { method: "POST" });
          loadClaudeFiles();
        } catch {}
      });
      list.appendChild(empty);
    }

    for (const file of cat.files) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.innerHTML = `
        <span>${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatSize(file.size)}</span>
      `;
      item.addEventListener("click", () => openFile(file.path, file.name));
      makeKeyboardActivatable(item);
      list.appendChild(item);
    }

    section.appendChild(header);
    section.appendChild(list);
    filesCategories.appendChild(section);
  }
}

async function openFile(filePath, fileName) {
  try {
    const res = await fetch(`/api/claude-files/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to read file");
      return;
    }
    const data = await res.json();
    currentFilePath = filePath;
    fileEditorHint.style.display = "none";
    fileEditorName.textContent = fileName;
    fileEditorContent.value = data.content;
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Markdown files: show rendered by default
    const isMd = fileName.endsWith(".md");
    if (isMd) {
      fileEditorRendered.innerHTML = marked.parse(data.content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
      fileEditorToggle.style.display = "";
      fileEditorToggle.textContent = "Raw";
      fileEditorToggle.classList.remove("active");
    } else {
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
      fileEditorToggle.style.display = "none";
    }
  } catch {
    alert("Failed to read file");
  }
}

function closeFileEditor() {
  fileEditor.classList.add("hidden");
  filesCategories.style.display = "";
  currentFilePath = null;
  // Reset toggle state
  fileEditorRendered.style.display = "none";
  fileEditorContent.style.display = "";
  fileEditorToggle.style.display = "none";
  fileEditorToggle.classList.remove("active");
}

async function saveFile() {
  if (!currentFilePath) return;

  // CEO.md uses its own endpoint
  if (currentFilePath === "__ceo_md__") {
    try {
      const res = await fetch("/api/ceo-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileEditorContent.value }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save CEO.md");
        return;
      }
      closeFileEditor();
    } catch {
      alert("Failed to save CEO.md");
    }
    return;
  }

  try {
    const res = await fetch("/api/claude-files/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFilePath, content: fileEditorContent.value }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to save file");
      return;
    }
    closeFileEditor();
    loadClaudeFiles(); // refresh list (sizes may have changed)
  } catch {
    alert("Failed to save file");
  }
}

fileEditorBack.addEventListener("click", () => {
  closeFileEditor();
  loadClaudeFiles();
});
fileEditorSave.addEventListener("click", saveFile);

// Open containing folder in Finder
async function openInFinder(filePath) {
  try {
    const res = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to open folder");
    }
  } catch { alert("Failed to open folder"); }
}

fileEditorFinder.addEventListener("click", () => {
  if (currentFilePath) openInFinder(currentFilePath);
});

// Toggle between raw and rendered in file editor
fileEditorToggle.addEventListener("click", () => {
  const isRaw = fileEditorToggle.classList.contains("active");
  if (isRaw) {
    // Switch to rendered
    fileEditorRendered.innerHTML = marked.parse(fileEditorContent.value);
    fileEditorRendered.style.display = "";
    fileEditorContent.style.display = "none";
    fileEditorToggle.textContent = "Raw";
    fileEditorToggle.classList.remove("active");
  } else {
    // Switch to raw
    fileEditorRendered.style.display = "none";
    fileEditorContent.style.display = "";
    fileEditorContent.focus();
    fileEditorToggle.textContent = "Rendered";
    fileEditorToggle.classList.add("active");
  }
});

// CEO.md button — open in files panel with its own endpoint
ceoMdBtn.addEventListener("click", async () => {
  // Open files panel if not already open
  if (!filesPanel.classList.contains("visible")) {
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
  }
  try {
    const res = await fetch("/api/ceo-md");
    const data = await res.json();
    currentFilePath = "__ceo_md__";
    fileEditorHint.style.display = "";
    fileEditorName.textContent = "claude-ceo.md";
    fileEditorContent.value = data.content || "";
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Show rendered by default
    const content = data.content || "";
    if (content.trim()) {
      fileEditorRendered.innerHTML = marked.parse(content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
    } else {
      // Empty — go straight to raw editing
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
    }
    fileEditorToggle.style.display = "";
    fileEditorToggle.textContent = content.trim() ? "Raw" : "Rendered";
    fileEditorToggle.classList.toggle("active", !content.trim());
  } catch {
    alert("Failed to load CEO.md");
  }
});

// Files panel Escape is handled by the main keyboard shortcuts handler

// --- Restart Server ---

const restartServerBtn = document.getElementById("restart-server-btn");

async function restartServer() {
  restartServerBtn.disabled = true;
  const restartLabel = restartServerBtn.querySelector(".dock-label");
  if (restartLabel) restartLabel.textContent = "Restarting...";
  else restartServerBtn.textContent = "Restarting...";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));

  try {
    await fetch("/api/restart-server", { method: "POST" });
  } catch {}

  // Poll until server is back, then reload
  const pollUntilReady = () => {
    fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  // Wait a beat for the old server to die
  setTimeout(pollUntilReady, 800);
}

restartServerBtn.addEventListener("click", restartServer);

// --- Auto-Update ---

const updateBtn = document.getElementById("update-btn");
const updateWrapper = document.getElementById("update-wrapper");
const updateTooltip = document.getElementById("update-tooltip");

function showUpdateButton(data) {
  if (!updateBtn || !updateWrapper) return;
  updateWrapper.style.display = "";
  const n = data.behind || 0;
  updateBtn.textContent = n > 1 ? `Update (${n} new commits)` : "Update Available";
  // Build tooltip content: release notes + commit summary
  let tooltipHtml = "";
  if (data.releaseNotes && typeof marked !== "undefined") {
    tooltipHtml += marked.parse(data.releaseNotes);
  }
  if (data.summary) {
    const commits = data.summary.split("\n").filter(Boolean);
    if (commits.length) {
      if (tooltipHtml) tooltipHtml += "<hr style='border-color:var(--border);margin:10px 0'>";
      tooltipHtml += "<strong>Recent changes:</strong><ul>" +
        commits.slice(0, 15).map(c => `<li>${escapeHtml(c)}</li>`).join("") +
        "</ul>";
    }
  }
  if (tooltipHtml && updateTooltip) updateTooltip.innerHTML = tooltipHtml;
}

updateBtn.addEventListener("click", async () => {
  updateBtn.disabled = true;
  updateBtn.textContent = "Updating\u2026";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
  try {
    const res = await fetch("/api/update", { method: "POST" });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      sessionStorage.removeItem("ceo-reload-state");
      showUpdateError(data);
      updateBtn.disabled = false;
      updateBtn.textContent = "Update Available";
      return; // Don't poll-and-reload — error modal needs to stay visible
    }
  } catch {
    // Server likely died during restart — that's expected, fall through to poll
  }
  const pollUntilReady = () => {
    fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  setTimeout(pollUntilReady, 800);
});

let _updateErrorShowing = false; // suppress auto-reload while error modal is visible

// Update error modal — handles all error types from /api/update and /api/install-version
const _ueOverlay = document.getElementById("update-error-overlay");
const _ueTitle = document.getElementById("update-error-title");
const _ueDesc = document.getElementById("update-error-desc");
const _ueFiles = document.getElementById("update-error-files");
const _uePromptWrap = document.getElementById("update-error-prompt-wrap");
const _uePrompt = document.getElementById("update-error-prompt");
const _ueCopy = document.getElementById("update-error-copy");
const _ueAgentBtn = document.getElementById("update-error-agent-btn");
const _ueAgentDesc = document.getElementById("update-error-agent-desc");
const _ueManual = document.getElementById("update-error-manual");
const _uePromptLegacy = document.getElementById("update-error-prompt-legacy");
const _ueCopyLegacy = document.getElementById("update-error-copy-legacy");
const _ueRetry = document.getElementById("update-error-retry");
const _ueClose = document.getElementById("update-error-close");

function _buildConflictAgentPrompt(files, cwd, localDiff, diffTruncated, remote) {
  remote = remote || "origin";
  const fileList = files.map(f => `- ${f}`).join("\n");
  const parts = [
    `You are in the CEO Dashboard repository at ${cwd}. An update from ${remote}/main caused merge conflicts.`,
    ``,
    `## The user's local customizations`,
    `Below is the diff of local changes this user has made. Study it carefully — these are their personal customizations (hotkeys, styles, layout tweaks, etc.) and you MUST preserve them.`,
  ];
  if (localDiff) {
    parts.push(``, `\`\`\`diff`, localDiff.trimEnd(), `\`\`\``);
    if (diffTruncated) {
      parts.push(``, `**NOTE: The diff above was truncated because it's very large. The conflicting files are fully shown, but some non-conflicting files may be summarized. Run \`git diff HEAD\` on any file you need to see in full, and read the actual file contents before resolving conflicts.**`);
    }
  } else {
    parts.push(``, `(Diff was not captured — run \`git diff HEAD\` to see local changes before proceeding.)`);
  }
  parts.push(
    ``,
    `## Step 0: Save a backup of local changes to memory`,
    `Before touching ANYTHING, save the above diff to your memory file. Include:`,
    `- Every file and what was modified`,
    `- Full code snippets for every change`,
    `- Your interpretation of each change's purpose (e.g. "changed accent color to blue", "added custom Ctrl+K hotkey for X", "restyled header to be more compact")`,
    `This is the safety net — if the merge goes wrong, these exact snippets let us restore everything.`,
    ``,
    `## Conflicting files:`,
    fileList,
    ``,
    `## Step 1: Start the merge`,
    `\`git fetch ${remote} main && git merge ${remote}/main --no-edit\``,
    ``,
    `## Step 2: Resolve each conflict INTELLIGENTLY`,
    `You already know exactly what the user changed (from the diff above). Use that knowledge to make smart decisions.`,
    ``,
    `For each \`<<<<<<<\` / \`>>>>>>>\` block:`,
    ``,
    `**If both sides added different things** (e.g. both added a new function, CSS rule, or feature):`,
    `→ KEEP BOTH. Include the upstream addition AND the local addition.`,
    ``,
    `**If upstream changed something the user also customized:**`,
    `→ ASK THE USER with full context. You know what their change does — explain it back to them. Examples:`,
    `  - "You changed the accent color to #3B82F6 (blue). Upstream changed it to #10B981 (green). Want to keep your blue, take the new green, or pick a different color?"`,
    `  - "You added a Ctrl+K hotkey for killing agents. Upstream also added Ctrl+K but for search. Want to keep yours and I'll rebind the upstream one to a different key? Or take theirs and I'll move yours?"`,
    `  - "You made the header more compact (removed padding, smaller font). Upstream redesigned the header with a new layout. Want me to apply your compact style to the new layout, keep yours as-is, or take theirs?"`,
    ``,
    `**If upstream changed something the user didn't touch:**`,
    `→ Take the upstream version (it's a required update).`,
    ``,
    `**If the user changed something upstream didn't touch:**`,
    `→ Keep the user's version (it's their customization).`,
    ``,
    `## Step 3: Show me the result BEFORE committing`,
    `Do NOT commit yet. Instead:`,
    `1. Show a summary of every conflict and how you resolved it`,
    `2. For each file, show the key changes you made`,
    `3. Ask: "Does this look good? I can commit this, or if something looks wrong I can undo the entire merge with \`git merge --abort\` and we start fresh."`,
    ``,
    `## Step 4: Commit only after approval`,
    `Only after I confirm:`,
    `\`git add ${files.join(" ")} && git commit -m "Merge ${remote}/main — resolve conflicts"\``,
    ``,
    `If I say something looks wrong:`,
    `- Run \`git merge --abort\` to undo everything`,
    `- Tell me what happened and ask how I want to proceed`,
    `- My local changes from the memory backup can be restored if needed`,
    ``,
    `## Step 5: Restart the server`,
    `Once committed, the code on disk is updated but the running server is still using the old code. Restart it:`,
    `1. If \`package.json\` changed upstream, run: \`cd ${cwd} && npm install\``,
    `2. Run: \`curl -s -X POST http://localhost:9145/api/restart-server\``,
    `3. Tell me: "Merge complete and server is restarting! The page will reload automatically in a few seconds. After it reloads, verify your customizations are intact. If anything looks off, let me know — I have the full backup of your changes in memory."`,
  );
  return parts.join("\n");
}

function _buildConflictManualSteps(files, cwd, remote) {
  remote = remote || "origin";
  return [
    `cd ${cwd}`,
    `git fetch ${remote} main`,
    `git merge ${remote}/main --no-edit`,
    `# Resolve conflicts in each file`,
    `git add ${files.join(" ")}`,
    `git commit -m "Merge ${remote}/main — resolve conflicts"`,
  ].join("\n");
}

function _buildDirtyWorkdirAgentPrompt(cwd, localDiff, diffTruncated, remote) {
  remote = remote || "origin";
  const parts = [
    `You are in the CEO Dashboard repository at ${cwd}. There are uncommitted local changes blocking an auto-update from ${remote}/main.`,
    ``,
    `## The user's local customizations`,
    `Below is the diff of local changes this user has made. Study it carefully — these are their personal customizations and you MUST preserve them.`,
  ];
  if (localDiff) {
    parts.push(``, `\`\`\`diff`, localDiff.trimEnd(), `\`\`\``);
    if (diffTruncated) {
      parts.push(``, `**NOTE: The diff above was truncated because it's very large. Run \`git diff\` to see the full changes for any file you need, and read the actual file contents before resolving conflicts.**`);
    }
  } else {
    parts.push(``, `(Diff was not captured — run \`git diff\` to see local changes before proceeding.)`);
  }
  parts.push(
    ``,
    `## Step 0: Save a backup of local changes to memory`,
    `Before touching ANYTHING, save the above diff to your memory file. Include:`,
    `- Every file and what was modified`,
    `- Full code snippets for every change`,
    `- Your interpretation of each change's purpose (e.g. "changed accent color to blue", "added custom Ctrl+K hotkey for X", "restyled header to be more compact")`,
    `This is the safety net — if the merge goes wrong, these exact snippets let us restore everything.`,
    ``,
    `## Step 1: Stash and update`,
    `\`\`\``,
    `git stash`,
    `git fetch ${remote} main && git merge ${remote}/main --no-edit`,
    `git stash pop`,
    `\`\`\``,
    ``,
    `## Step 2: If conflicts after stash pop — resolve INTELLIGENTLY`,
    `You already know exactly what the user changed (from the diff above). Use that knowledge to make smart decisions.`,
    ``,
    `For each conflict:`,
    ``,
    `**If both sides added different things:**`,
    `→ KEEP BOTH.`,
    ``,
    `**If upstream changed something the user also customized:**`,
    `→ ASK THE USER with full context. You know what their change does — explain it back to them:`,
    `  - "You changed X to Y for [reason]. Upstream changed it to Z. Want to keep yours, take theirs, or combine them?"`,
    ``,
    `**If only one side changed a given line:**`,
    `→ Keep that side's version.`,
    ``,
    `## Step 3: Show me the result BEFORE finalizing`,
    `Do NOT just say "done". Instead:`,
    `1. Show a summary of what changed and any conflicts you resolved`,
    `2. Ask: "Does this look good? Or should I undo everything with \`git checkout -- . && git stash pop\` to restore your original state?"`,
    ``,
    `## Step 4: Only finalize after approval`,
    `If I say something looks wrong:`,
    `- Undo: \`git reset --hard HEAD\` then \`git stash pop\` to restore the original local state`,
    `- My local changes from the memory backup can be restored manually if the stash is lost`,
    ``,
    `## Step 5: Restart the server`,
    `Once I confirm, the code on disk is updated but the running server is still using the old code. Restart it:`,
    `1. If \`package.json\` changed upstream, run: \`cd ${cwd} && npm install\``,
    `2. Run: \`curl -s -X POST http://localhost:9145/api/restart-server\``,
    `3. Tell me: "Update complete and server is restarting! The page will reload automatically in a few seconds. After it reloads, verify your customizations are intact. If anything looks off, let me know — I have the full backup of your changes in memory."`,
  );
  return parts.join("\n");
}

function _buildDirtyWorkdirManualSteps(cwd, remote) {
  remote = remote || "origin";
  return [
    `cd ${cwd}`,
    `git stash`,
    `git fetch ${remote} main`,
    `git merge ${remote}/main --no-edit`,
    `git stash pop`,
    `# Resolve any conflicts if needed`,
  ].join("\n");
}

function _buildUnknownPrompt(message, cwd, remote) {
  remote = remote || "origin";
  return `The CEO Dashboard update at ${cwd || "."} failed with this error:\n\n${message}\n\nDiagnose and fix this so the dashboard can update. Check git status, resolve any issues, then run: git fetch ${remote} main && git -c merge.ff=false merge ${remote}/main --no-edit`;
}

function showUpdateError(data) {
  _updateErrorShowing = true;
  const errorType = data.error || "unknown";
  const cwd = data.cwd || ".";
  const message = data.message || "";
  const files = data.conflicts || [];
  const localDiff = data.localDiff || "";
  const diffTruncated = data.diffTruncated || false;
  const remote = data.remote || "origin";

  // Reset all sections
  _ueFiles.classList.add("hidden");
  _ueFiles.innerHTML = "";
  _uePromptWrap.classList.add("hidden");
  _uePromptLegacy.textContent = "";
  _ueRetry.classList.add("hidden");
  _ueCopy.textContent = "Copy";
  _ueCopyLegacy.textContent = "Copy";
  _ueAgentBtn.classList.add("hidden");
  _ueAgentDesc.classList.add("hidden");
  _ueManual.classList.add("hidden");
  _ueManual.removeAttribute("open");
  _uePrompt.textContent = "";
  _ueAgentBtn.disabled = false;
  _ueAgentBtn.textContent = "Launch Resolver Agent";
  _ueAgentBtn._agentPrompt = null;
  _ueAgentBtn._agentCwd = null;

  switch (errorType) {
    case "merge-conflict":
      _ueTitle.textContent = "Merge Conflict";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = "Your local changes conflict with the latest update. Nothing is broken \u2014 the dashboard is still running.";
      _ueAgentBtn.classList.remove("hidden");
      _ueAgentDesc.classList.remove("hidden");
      _ueAgentBtn._agentPrompt = _buildConflictAgentPrompt(files, cwd, localDiff, diffTruncated, remote);
      _ueAgentBtn._agentCwd = cwd;
      _ueFiles.innerHTML = files.map(f => `<li>${escapeHtml(f)}</li>`).join("");
      _ueFiles.classList.remove("hidden");
      _uePrompt.textContent = _buildConflictManualSteps(files, cwd, remote);
      _ueManual.classList.remove("hidden");
      break;

    case "dirty-workdir":
      _ueTitle.textContent = "Uncommitted Changes";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = "Your local changes prevent the update. Nothing is broken \u2014 the dashboard is still running.";
      _ueAgentBtn.classList.remove("hidden");
      _ueAgentDesc.classList.remove("hidden");
      _ueAgentBtn._agentPrompt = _buildDirtyWorkdirAgentPrompt(cwd, localDiff, diffTruncated, remote);
      _ueAgentBtn._agentCwd = cwd;
      _uePrompt.textContent = _buildDirtyWorkdirManualSteps(cwd, remote);
      _ueManual.classList.remove("hidden");
      break;

    case "network":
      _ueTitle.textContent = "Network Error";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "Could not reach the remote repository. Check your internet connection and try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "timeout":
      _ueTitle.textContent = "Timed Out";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "The update timed out. This is usually temporary — try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "not-on-main": {
      const branch = data.branch || "unknown";
      _ueTitle.textContent = "Wrong Branch";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.innerHTML = `You're on <code>${escapeHtml(branch)}</code>. Updates apply to the <code>main</code> branch. Switch first, then retry:`;
      _uePromptLegacy.textContent = `cd ${cwd} && git checkout main`;
      _uePromptWrap.classList.remove("hidden");
      _ueRetry.classList.remove("hidden");
      break;
    }

    case "npm-failed":
      _ueTitle.textContent = "Install Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = "The code was updated, but npm install failed. Run this manually:";
      _uePromptLegacy.textContent = `cd ${cwd} && npm install`;
      _uePromptWrap.classList.remove("hidden");
      break;

    default: // "unknown" or unrecognized
      _ueTitle.textContent = "Update Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = message || "An unexpected error occurred during the update.";
      if (cwd) {
        _uePromptLegacy.textContent = _buildUnknownPrompt(message, cwd, remote);
        _uePromptWrap.classList.remove("hidden");
      }
      break;
  }

  updateBtn.textContent = "Update Available";
  _ueOverlay.classList.remove("hidden");
}

_ueCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(_uePrompt.textContent).then(() => {
    _ueCopy.textContent = "Copied!";
    setTimeout(() => { _ueCopy.textContent = "Copy"; }, 2000);
  });
});

_ueCopyLegacy.addEventListener("click", () => {
  navigator.clipboard.writeText(_uePromptLegacy.textContent).then(() => {
    _ueCopyLegacy.textContent = "Copied!";
    setTimeout(() => { _ueCopyLegacy.textContent = "Copy"; }, 2000);
  });
});

_ueAgentBtn.addEventListener("click", async () => {
  const prompt = _ueAgentBtn._agentPrompt;
  const workdir = _ueAgentBtn._agentCwd;
  if (!prompt || !workdir) return;

  _ueAgentBtn.disabled = true;
  _ueAgentBtn.textContent = "Creating\u2026";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "update-fix", workdir, prompt }),
    });
    if (res.ok) {
      const data = await res.json();
      addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      _ueOverlay.classList.add("hidden");
      _updateErrorShowing = false;
      setTimeout(() => {
        const agent = agents.get(data.name);
        if (agent) agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    } else {
      _ueAgentBtn.textContent = "Launch Resolver Agent";
      _ueAgentBtn.disabled = false;
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create resolver agent");
    }
  } catch {
    _ueAgentBtn.textContent = "Launch Resolver Agent";
    _ueAgentBtn.disabled = false;
    alert("Failed to create resolver agent");
  }
});

_ueRetry.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
  _updateErrorShowing = false;
  updateBtn.click();
});

_ueClose.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
  _updateErrorShowing = false;
});

// Click backdrop (overlay) to close update error modal
_ueOverlay.addEventListener("click", (e) => {
  if (e.target === _ueOverlay) {
    _ueOverlay.classList.add("hidden");
    _updateErrorShowing = false;
  }
});

// --- Code Diff Viewer ---

const _diffOverlay = document.getElementById("diff-overlay");
const _diffAgentName = document.getElementById("diff-agent-name");
const _diffWorkdir = document.getElementById("diff-workdir");
const _diffContent = document.getElementById("diff-content");
const _diffEmpty = document.getElementById("diff-empty");
const _diffLoading = document.getElementById("diff-loading");
const _diffError = document.getElementById("diff-error");
const _diffErrorMsg = document.getElementById("diff-error-msg");
const _diffClose = document.getElementById("diff-close");
const _diffRefresh = document.getElementById("diff-refresh");
const _diffRetry = document.getElementById("diff-retry");
const _diffTabGroup = document.getElementById("diff-tab-group");

let _diffCurrentAgent = null;
let _diffSideBySide = false;
let _diffCachedStaged = "";
let _diffCachedUnstaged = "";

function _diffSetState(state) {
  _diffContent.innerHTML = "";
  _diffEmpty.classList.add("hidden");
  _diffLoading.classList.add("hidden");
  _diffError.classList.add("hidden");
  if (state === "loading") _diffLoading.classList.remove("hidden");
  else if (state === "empty") _diffEmpty.classList.remove("hidden");
  else if (state === "error") _diffError.classList.remove("hidden");
}

async function openDiffModal(agentName) {
  _diffCurrentAgent = agentName;
  _diffOverlay.classList.remove("hidden");
  _diffAgentName.textContent = agentName;
  _diffWorkdir.textContent = "";
  _diffSetState("loading");

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(agentName)}/diff`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch diff");

    _diffWorkdir.textContent = shortPath(data.workdir);

    if (!data.hasDiff) {
      _diffCachedStaged = "";
      _diffCachedUnstaged = "";
      _diffSetState("empty");
      return;
    }

    _diffCachedStaged = data.staged || "";
    _diffCachedUnstaged = data.unstaged || "";
    _diffSetState("content");
    renderDiff(_diffCachedStaged, _diffCachedUnstaged);
  } catch (e) {
    _diffErrorMsg.textContent = e.message;
    _diffSetState("error");
  }
}

function renderDiff(staged, unstaged) {
  let combined = "";
  if (unstaged) combined += unstaged;
  if (staged) combined += (combined ? "\n" : "") + staged;
  if (!combined) { _diffSetState("empty"); return; }

  const outputFormat = _diffSideBySide ? "side-by-side" : "line-by-line";
  const html = Diff2Html.html(combined, {
    drawFileList: true,
    matching: "lines",
    outputFormat,
    colorScheme: "dark",
  });
  _diffContent.innerHTML = html;
}

function closeDiffModal() {
  _diffOverlay.classList.add("hidden");
  _diffContent.innerHTML = "";
  _diffCachedStaged = "";
  _diffCachedUnstaged = "";
  _diffCurrentAgent = null;
}

_diffClose.addEventListener("click", closeDiffModal);

_diffOverlay.addEventListener("click", (e) => {
  if (e.target === _diffOverlay) closeDiffModal();
});

_diffRefresh.addEventListener("click", () => {
  if (_diffCurrentAgent) openDiffModal(_diffCurrentAgent);
});

_diffRetry.addEventListener("click", () => {
  if (_diffCurrentAgent) openDiffModal(_diffCurrentAgent);
});

_diffTabGroup.addEventListener("click", (e) => {
  const tab = e.target.closest(".diff-tab");
  if (!tab || tab.classList.contains("active")) return;
  _diffTabGroup.querySelectorAll(".diff-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  _diffSideBySide = tab.dataset.view === "side-by-side";
  if (_diffCachedStaged || _diffCachedUnstaged) {
    renderDiff(_diffCachedStaged, _diffCachedUnstaged);
  }
});

// --- Settings Panel ---

const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const settingAutostart = document.getElementById("setting-autostart");
const settingAddToDock = document.getElementById("setting-add-to-dock");
const dockDesc = document.getElementById("dock-desc");
const tailscaleDesc = document.getElementById("tailscale-desc");
const tailscaleBadge = document.getElementById("tailscale-badge");
const tailscaleDetails = document.getElementById("tailscale-details");
const tailscaleIp = document.getElementById("tailscale-ip");
const tailscaleUrl = document.getElementById("tailscale-url");

function toggleSettingsPanel() {
  const isOpen = settingsPanel.classList.contains("visible");
  if (isOpen) {
    closeSettingsPanel();
  } else {
    // Close other panels if open
    if (filesPanel.classList.contains("visible")) closeFilesPanel();
    if (_bmPanel && _bmPanel.classList.contains("visible")) closeBookmarksPanel();
    settingsPanel.classList.add("visible");
    settingsBackdrop.classList.add("visible");
    settingsBtn.classList.add("panel-active");
    loadSettings();
    setTimeout(() => settingsClose.focus(), 100);
  }
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("visible");
  settingsBackdrop.classList.remove("visible");
  settingsBtn.classList.remove("panel-active");
}

settingsBtn.addEventListener("click", toggleSettingsPanel);
settingsClose.addEventListener("click", closeSettingsPanel);
settingsBackdrop.addEventListener("click", closeSettingsPanel);
settingsPanel.addEventListener("keydown", (e) => {
  if (settingsPanel.classList.contains("visible")) trapFocus(settingsPanel, e);
});

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();

    // Auto-Start
    settingAutostart.checked = data.autoStart;

    // Dock App
    const rebuildHint = document.getElementById("customize-rebuild-hint");
    if (data.dockAppInstalled) {
      settingAddToDock.textContent = "Rebuild";
      settingAddToDock.classList.add("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Rebuild to apply title and accent color changes to the Dock app";
      if (rebuildHint) rebuildHint.classList.remove("hidden");
    } else {
      settingAddToDock.textContent = "Install";
      settingAddToDock.classList.remove("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Install as a standalone app in your Dock";
      if (rebuildHint) rebuildHint.classList.add("hidden");
    }

    // Tailscale
    const ts = data.tailscale;
    if (ts.running) {
      tailscaleBadge.textContent = "Connected";
      tailscaleBadge.className = "settings-badge running";
      tailscaleDesc.textContent = "Mesh VPN for secure remote access";
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = ts.ip || "—";
      const port = location.port || (location.protocol === "https:" ? "443" : "80");
      const url = `http://${ts.ip}:${port}`;
      tailscaleUrl.textContent = url;
      tailscaleUrl.href = url;
    } else if (ts.installed) {
      tailscaleBadge.textContent = "Installed";
      tailscaleBadge.className = "settings-badge installed";
      tailscaleDesc.textContent = "Tailscale installed but not running. Open Tailscale.app to connect.";
      tailscaleDetails.classList.add("hidden");
    } else {
      tailscaleBadge.textContent = "Not Installed";
      tailscaleBadge.className = "settings-badge offline";
      tailscaleDesc.innerHTML = 'Access your dashboard from your phone or any device on your network.';
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = "—";
      tailscaleUrl.textContent = "";
      tailscaleUrl.href = "#";
      tailscaleDetails.innerHTML = `<div class="tailscale-setup-guide">
        <p><strong>Setup:</strong></p>
        <ol>
          <li>Install from <a href="https://tailscale.com/download/mac" target="_blank">tailscale.com/download/mac</a></li>
          <li>Open Tailscale.app and sign in (Google, Microsoft, or GitHub)</li>
          <li>Install Tailscale on your phone too — same account</li>
          <li>Both devices join the same private network automatically</li>
          <li>Reopen Settings here — your dashboard URL will appear</li>
        </ol>
        <p style="margin-top:8px;color:var(--text-dim);font-size:11px;">Free for personal use. No port forwarding, no firewall changes needed.</p>
      </div>`;
    }
  } catch {
    tailscaleDesc.textContent = "Failed to load settings";
  }

  // Accent Color swatches
  const accentGrid = document.getElementById("accent-color-grid");
  if (accentGrid) renderAccentGrid(accentGrid);

  // Background color swatches
  const bgGrid = document.getElementById("bg-color-grid");
  if (bgGrid) renderBgGrid(bgGrid);

  // Terminal color swatches
  const termGrid = document.getElementById("terminal-color-grid");
  if (termGrid) renderTerminalGrid(termGrid);

  // Shell color swatches
  const shellGrid = document.getElementById("shell-color-grid");
  if (shellGrid) renderShellGrid(shellGrid);
}

function _removeBgOverrides() {
  const s = document.documentElement.style;
  const props = ["--bg","--bg-gradient","--input-bg","--header-bg","--surface","--modal-bg",
   "--surface-raised","--border","--scrollbar-thumb","--scrollbar-hover","--gray","--text-dim",
   "--text","--header-border","--modal-backdrop","--card-shadow"];
  // Only reset terminal-bg if user hasn't set a custom terminal color
  if (!localStorage.getItem("terminalColor")) {
    props.push("--terminal-bg");
    s.removeProperty("--terminal-text");
    s.removeProperty("--terminal-text-dim");
    s.removeProperty("--terminal-link-color");
  }
  props.forEach(v => s.removeProperty(v));
}

settingAutostart.addEventListener("change", async () => {
  const enabled = settingAutostart.checked;
  try {
    const res = await fetch("/api/settings/auto-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const err = await res.json();
      settingAutostart.checked = !enabled;
      alert(err.error || "Failed to toggle auto-start");
    }
  } catch {
    settingAutostart.checked = !enabled;
  }
});

settingAddToDock.addEventListener("click", async () => {
  if (settingAddToDock.disabled) return;
  const wasInstalled = settingAddToDock.classList.contains("installed");
  settingAddToDock.textContent = wasInstalled ? "Rebuilding..." : "Installing...";
  settingAddToDock.disabled = true;
  try {
    const res = await fetch("/api/settings/add-to-dock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      settingAddToDock.textContent = "Rebuild";
      settingAddToDock.classList.add("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Rebuild to apply title and accent color changes to the Dock app";
    } else {
      const err = await res.json();
      settingAddToDock.textContent = wasInstalled ? "Rebuild" : "Install";
      settingAddToDock.disabled = false;
      alert(err.error || "Failed to install");
    }
  } catch {
    settingAddToDock.textContent = wasInstalled ? "Rebuild" : "Install";
    settingAddToDock.disabled = false;
  }
});

// --- In-App Browser settings ---

document.getElementById("setting-clear-browser").addEventListener("click", () => {
  if (!confirm("Clear all in-app browser cookies, cache, and logins?")) return;
  // Post to native bridge to clear WKWebsiteDataStore
  if (window.webkit?.messageHandlers?.ceoBridge) {
    window.webkit.messageHandlers.ceoBridge.postMessage({ action: "clearBrowserData" });
  }
  const btn = document.getElementById("setting-clear-browser");
  btn.textContent = "Cleared";
  btn.disabled = true;
  setTimeout(() => { btn.textContent = "Clear"; btn.disabled = false; }, 2000);
});

// --- Delete All Worktrees (double-click confirm) ---
{
  const btn = document.getElementById("setting-delete-worktrees");
  let armed = false;
  let timer = null;
  btn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      btn.classList.add("armed");
      btn.textContent = "Confirm Delete";
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove("armed");
        btn.textContent = "Delete All";
      }, 2000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    btn.classList.remove("armed");
    btn.disabled = true;
    btn.textContent = "Deleting...";
    try {
      const resp = await fetch("/api/worktrees/delete-all", { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        btn.textContent = data.removed > 0 ? `Removed ${data.removed}` : "None found";
      } else {
        btn.textContent = "Error";
      }
    } catch {
      btn.textContent = "Error";
    }
    setTimeout(() => { btn.textContent = "Delete All"; btn.disabled = false; }, 2000);
  });
}

// --- Agent Defaults config ---

// Collapsible toggle
document.getElementById("customize-toggle").addEventListener("click", () => {
  const section = document.getElementById("customize-toggle").closest(".settings-collapse");
  const body = document.getElementById("customize-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

document.getElementById("agent-defaults-toggle").addEventListener("click", () => {
  const section = document.getElementById("agent-defaults-toggle").closest(".settings-collapse");
  const body = document.getElementById("agent-defaults-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _settingTitle = document.getElementById("setting-title");
const _settingDefaultName = document.getElementById("setting-default-agent-name");
const _settingPrefix = document.getElementById("setting-agent-prefix");
const _settingPort = document.getElementById("setting-port");
const _settingShellCmd = document.getElementById("setting-shell-command");
const _settingInstallAlias = document.getElementById("setting-install-alias");

function _loadAgentDefaults() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _settingTitle.value = cfg.title || "CEO Dashboard";
    _defaultAgentName = cfg.defaultAgentName || "agent";
    _settingDefaultName.value = cfg.defaultAgentName || "agent";
    _settingPrefix.value = cfg.agentPrefix || "ceo-";
    _settingPort.value = cfg.port || 9145;
    _settingShellCmd.value = cfg.shellCommand || "ceo";
    // Sync accent color from server config (for cross-device consistency)
    if (cfg.accentColor && ACCENT_PRESETS[cfg.accentColor] && !localStorage.getItem("accentColor")) {
      localStorage.setItem("accentColor", cfg.accentColor);
      applyAccentColor(cfg.accentColor);
    }
    if (cfg.bgColor && !localStorage.getItem("bgColor")) {
      localStorage.setItem("bgColor", cfg.bgColor);
      applyBgColor(cfg.bgColor);
    }
  }).catch(() => {});
}

let _agentDefaultsSaveTimer = null;
function _saveAgentDefault(key, value) {
  clearTimeout(_agentDefaultsSaveTimer);
  _agentDefaultsSaveTimer = setTimeout(async () => {
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {}
  }, 400);
}

_settingTitle.addEventListener("input", () => {
  const v = _settingTitle.value.trim() || "CEO Dashboard";
  TAB_TITLE_DEFAULT = v;
  document.title = v;
  const headerTitle = document.getElementById("header-title");
  if (headerTitle) headerTitle.textContent = v;
  _saveAgentDefault("title", v);
});
_settingDefaultName.addEventListener("input", () => {
  const v = _settingDefaultName.value.trim();
  _defaultAgentName = v || "agent";
  _saveAgentDefault("defaultAgentName", v || "agent");
});
_settingPrefix.addEventListener("input", () => {
  _saveAgentDefault("agentPrefix", _settingPrefix.value.trim() || "ceo-");
});
_settingPort.addEventListener("input", () => {
  const v = parseInt(_settingPort.value);
  if (v > 0) _saveAgentDefault("port", v);
});
_settingShellCmd.addEventListener("input", () => {
  const v = _settingShellCmd.value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (v) _saveAgentDefault("shellCommand", v);
});
_settingInstallAlias.addEventListener("click", async () => {
  _settingInstallAlias.disabled = true;
  _settingInstallAlias.textContent = "Installing...";
  try {
    const res = await fetch("/api/settings/install-alias", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      _settingInstallAlias.textContent = "Installed";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    } else {
      _settingInstallAlias.textContent = "Error";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    }
  } catch {
    _settingInstallAlias.textContent = "Error";
    setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
  }
});

// --- Workspace config editor ---

// Collapsible toggle
document.getElementById("workspace-toggle").addEventListener("click", () => {
  const section = document.getElementById("workspace-toggle").closest(".settings-collapse");
  const body = document.getElementById("workspace-collapse-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _wsListEl = document.getElementById("workspace-list");
const _wsAddPath = document.getElementById("workspace-add-path");
const _wsAddLabel = document.getElementById("workspace-add-label");
const _wsAddBtn = document.getElementById("workspace-add-btn");
const _wsDefaultSelectEl = document.getElementById("workspace-default-select");
let _wsConfig = { workspaces: [], defaultWorkspace: "" };

let _wsDragIdx = -1;
let _wsDragOverIdx = -1;

function _renderWorkspaceEditor() {
  // Render workspace rows
  _wsListEl.innerHTML = "";
  for (let i = 0; i < _wsConfig.workspaces.length; i++) {
    const ws = _wsConfig.workspaces[i];
    const row = document.createElement("div");
    row.className = "workspace-row" + (ws.builtIn ? " workspace-row-builtin" : "");
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `
      <span class="workspace-drag-handle" title="Drag to reorder">&#x2630;</span>
      <span class="workspace-row-path" title="${escapeAttr(ws.path)}">${escapeHtml(shortPath(ws.path))}</span>
      <span class="workspace-row-label">${escapeHtml(ws.label || "")}${ws.builtIn ? ' <span class="workspace-builtin-badge">built-in</span>' : ""}</span>
      ${ws.builtIn ? "" : '<button class="workspace-row-remove" title="Remove">&times;</button>'}
    `;
    if (!ws.builtIn) {
      row.querySelector(".workspace-row-remove").addEventListener("click", () => {
        _wsConfig.workspaces.splice(i, 1);
        if (_wsConfig.defaultWorkspace === ws.path && _wsConfig.workspaces.length > 0) {
          _wsConfig.defaultWorkspace = _wsConfig.workspaces[0].path;
        }
        _saveWorkspaceConfig();
      });
    }
    // Drag events
    row.addEventListener("dragstart", (e) => {
      _wsDragIdx = i;
      row.classList.add("workspace-row-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("workspace-row-dragging");
      _wsListEl.querySelectorAll(".workspace-row").forEach(r => r.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below"));
      if (_wsDragIdx !== -1 && _wsDragOverIdx !== -1 && _wsDragIdx !== _wsDragOverIdx) {
        const [moved] = _wsConfig.workspaces.splice(_wsDragIdx, 1);
        _wsConfig.workspaces.splice(_wsDragOverIdx, 0, moved);
        _saveWorkspaceConfig();
      }
      _wsDragIdx = -1;
      _wsDragOverIdx = -1;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const targetIdx = parseInt(row.dataset.idx);
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
      if (e.clientY < mid) {
        row.classList.add("workspace-row-dragover-above");
        _wsDragOverIdx = targetIdx > _wsDragIdx ? targetIdx - 1 : targetIdx;
      } else {
        row.classList.add("workspace-row-dragover-below");
        _wsDragOverIdx = targetIdx < _wsDragIdx ? targetIdx + 1 : targetIdx;
      }
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
    });
    _wsListEl.appendChild(row);
  }
  // Render default custom select
  const trigger = _wsDefaultSelectEl.querySelector(".custom-select-label");
  const optionsContainer = _wsDefaultSelectEl.querySelector(".custom-select-options");
  optionsContainer.innerHTML = "";
  const current = _wsConfig.workspaces.find(w => w.path === _wsConfig.defaultWorkspace);
  trigger.textContent = current ? current.label : "—";
  for (const ws of _wsConfig.workspaces) {
    const opt = document.createElement("div");
    opt.className = "custom-select-option" + (ws.path === _wsConfig.defaultWorkspace ? " selected" : "");
    opt.textContent = ws.label;
    opt.addEventListener("click", () => {
      _wsConfig.defaultWorkspace = ws.path;
      _wsDefaultSelectEl.classList.remove("open");
      _saveWorkspaceConfig();
    });
    optionsContainer.appendChild(opt);
  }
}

function _loadWorkspaceConfig() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _wsConfig.workspaces = cfg.workspaces || [];
    _wsConfig.defaultWorkspace = cfg.defaultWorkspace || "";
    _renderWorkspaceEditor();
  }).catch(() => {});
}

async function _saveWorkspaceConfig() {
  _renderWorkspaceEditor();
  _renderWorkdirPills(_wsConfig.workspaces);
  DEFAULT_WORKDIR = _wsConfig.defaultWorkspace;
  selectedWorkdirPath = DEFAULT_WORKDIR;
  // Find built-in position, filter it out before saving
  const builtInIdx = _wsConfig.workspaces.findIndex(w => w.builtIn);
  const userWorkspaces = _wsConfig.workspaces.filter(w => !w.builtIn);
  const payload = { workspaces: userWorkspaces, defaultWorkspace: _wsConfig.defaultWorkspace };
  if (builtInIdx !== -1) payload.builtInPosition = builtInIdx;
  try {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {}
}

_wsAddBtn.addEventListener("click", () => {
  const pathVal = _wsAddPath.value.trim();
  if (!pathVal) return;
  const label = _wsAddLabel.value.trim() || pathVal.split("/").filter(Boolean).pop() || pathVal;
  if (_wsConfig.workspaces.some(w => w.path === pathVal)) return; // no dupes
  _wsConfig.workspaces.push({ path: pathVal, label });
  if (!_wsConfig.defaultWorkspace) _wsConfig.defaultWorkspace = pathVal;
  _wsAddPath.value = "";
  _wsAddLabel.value = "";
  _saveWorkspaceConfig();
  // Auto-select the newly added workspace in the new agent modal
  setWorkdir(pathVal);
});

_wsAddPath.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});
_wsAddLabel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});

// Custom select toggle
_wsDefaultSelectEl.querySelector(".custom-select-trigger").addEventListener("click", () => {
  _wsDefaultSelectEl.classList.toggle("open");
});
// Close custom select when clicking outside
document.addEventListener("click", (e) => {
  if (!_wsDefaultSelectEl.contains(e.target)) {
    _wsDefaultSelectEl.classList.remove("open");
  }
});

// --- Bookmarks Panel (slide-out) ---

const _bmPanel = document.getElementById("bookmarks-panel");
const _bmBackdrop = document.getElementById("bookmarks-backdrop");
const _bmClose = document.getElementById("bookmarks-close");
const _bmList = document.getElementById("bookmarks-list");
const _bmAddToggle = document.getElementById("bookmarks-add-toggle");
const _bmAddForm = document.getElementById("bookmarks-add-form");
const _bmAddUrl = document.getElementById("bookmark-add-url");
const _bmAddTitle = document.getElementById("bookmark-add-title");
const _bmAddSave = document.getElementById("bookmark-add-save");
const _bmAddCancel = document.getElementById("bookmark-add-cancel");
const _bmBtn = document.getElementById("bookmarks-btn");

function toggleBookmarksPanel() {
  if (_bmPanel.classList.contains("visible")) {
    closeBookmarksPanel();
  } else {
    // Close other panels
    const sp = document.getElementById("settings-panel");
    if (sp && sp.classList.contains("visible")) closeSettingsPanel();
    if (filesPanel && filesPanel.classList.contains("visible")) closeFilesPanel();
    _bmPanel.classList.add("visible");
    _bmBackdrop.classList.add("visible");
    if (_bmBtn) _bmBtn.classList.add("panel-active");
    _bmAddForm.classList.add("hidden");
    _bmAddUrl.value = "";
    _bmAddTitle.value = "";
    loadBookmarks();
    setTimeout(() => _bmClose.focus(), 100);
  }
}

function closeBookmarksPanel() {
  _bmPanel.classList.remove("visible");
  _bmBackdrop.classList.remove("visible");
  if (_bmBtn) _bmBtn.classList.remove("panel-active");
  _bmAddForm.classList.add("hidden");
}

async function loadBookmarks() {
  try {
    const res = await fetch("/api/favorites");
    const favs = await res.json();
    renderBookmarks(favs);
  } catch {}
}

function renderBookmarks(favs) {
  if (!favs.length) {
    _bmList.innerHTML = '<div class="bookmarks-empty">No bookmarks yet. Click <strong>+</strong> to add one.</div>';
    return;
  }
  _bmList.innerHTML = favs.map(f => `
    <div class="bookmark-item" data-id="${escapeAttr(f.id)}">
      <img class="bookmark-favicon" src="${escapeAttr(f.favicon || "")}" alt="" onerror="this.style.display='none'">
      <div class="bookmark-info">
        <span class="bookmark-title" data-url="${escapeAttr(f.url)}" title="${escapeAttr(f.url)}">${escapeHtml(f.title || f.url)}</span>
        <span class="bookmark-url">${escapeHtml(f.url)}</span>
      </div>
      <button class="bookmark-remove" title="Remove">&times;</button>
    </div>
  `).join("");

  // Click anywhere on bookmark row → open in browser
  _bmList.querySelectorAll(".bookmark-item").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const url = el.querySelector(".bookmark-title").dataset.url;
      if (url) window.open(url, "_blank");
    });
  });

  // Click remove → delete
  _bmList.querySelectorAll(".bookmark-remove").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.closest(".bookmark-item").dataset.id;
      try {
        await fetch(`/api/favorites/${id}`, { method: "DELETE" });
        loadBookmarks();
      } catch {}
    });
  });
}

// Add form toggle
_bmAddToggle.addEventListener("click", () => {
  _bmAddForm.classList.toggle("hidden");
  if (!_bmAddForm.classList.contains("hidden")) _bmAddUrl.focus();
});
_bmAddCancel.addEventListener("click", () => {
  _bmAddForm.classList.add("hidden");
  _bmAddUrl.value = "";
  _bmAddTitle.value = "";
});

// Save new bookmark
_bmAddSave.addEventListener("click", async () => {
  const url = _bmAddUrl.value.trim();
  if (!url) return;
  const title = _bmAddTitle.value.trim();
  try {
    await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title }),
    });
    _bmAddUrl.value = "";
    _bmAddTitle.value = "";
    _bmAddForm.classList.add("hidden");
    loadBookmarks();
  } catch {}
});
_bmAddUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _bmAddSave.click(); }
});
_bmAddTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _bmAddSave.click(); }
});

if (_bmBtn) _bmBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmarksPanel(); });
_bmClose.addEventListener("click", closeBookmarksPanel);
_bmBackdrop.addEventListener("click", closeBookmarksPanel);
_bmPanel.addEventListener("keydown", (e) => {
  if (_bmPanel.classList.contains("visible")) trapFocus(_bmPanel, e);
});

// --- Version Manager ---

const _versionSection = document.getElementById("version-toggle").closest(".settings-collapse");

document.getElementById("version-toggle").addEventListener("click", () => {
  const body = document.getElementById("version-collapse-body");
  _versionSection.classList.toggle("open");
  body.classList.toggle("hidden");
});

let _versionsLoaded = false;

async function _loadVersions() {
  const listEl = document.getElementById("version-list");
  // Hide section until we know there's something to show
  _versionSection.style.display = "none";
  listEl.innerHTML = '<span class="settings-hint">Loading versions...</span>';
  try {
    const res = await fetch("/api/versions");
    const data = await res.json();
    _versionsLoaded = true;
    const versions = data.versions || [];
    const hasInstallable = versions.some(v => !v.isCurrent);
    if (!hasInstallable) return; // nothing to downgrade to — keep hidden
    _versionSection.style.display = "";
    _renderVersionList(versions, listEl);
  } catch {
    // On error, keep hidden
  }
}

function _renderVersionList(versions, listEl) {
  listEl.innerHTML = "";
  if (!versions.length) {
    listEl.innerHTML = '<span class="settings-hint">No tagged versions found.</span>';
    return;
  }
  for (const v of versions) {
    const row = document.createElement("div");
    row.className = "version-row" + (v.isCurrent ? " version-row-current" : "");
    const tag = document.createElement("span");
    tag.className = "version-tag";
    tag.textContent = v.tag;
    const date = document.createElement("span");
    date.className = "version-date";
    date.textContent = v.date ? new Date(v.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    row.appendChild(tag);
    row.appendChild(date);
    if (v.isCurrent) {
      const badge = document.createElement("span");
      badge.className = "version-current-badge";
      badge.textContent = "Current";
      row.appendChild(badge);
    } else {
      const btn = document.createElement("button");
      btn.className = "version-install-btn";
      btn.textContent = "Install";
      btn.addEventListener("click", () => _installVersion(v.tag, btn));
      row.appendChild(btn);
    }
    listEl.appendChild(row);
  }
}

async function _installVersion(tag, btn) {
  if (!confirm(`Switch to ${tag}? The server will restart.`)) return;
  btn.disabled = true;
  btn.textContent = "Installing...";
  try {
    const res = await fetch("/api/install-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    const data = await res.json();
    if (!res.ok) {
      showUpdateError(data);
      btn.textContent = "Install";
      btn.disabled = false;
      return;
    }
    // Server is restarting — poll until it's back
    btn.textContent = "Restarting...";
    const start = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - start > 30000) { clearInterval(poll); btn.textContent = "Timeout"; return; }
      try {
        const r = await fetch("/api/sessions", { signal: AbortSignal.timeout(2000) });
        if (r.ok) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 1500);
  } catch {
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Install"; btn.disabled = false; }, 2000);
  }
}

// Load config sections when settings panel opens
const _origLoadSettings = loadSettings;
loadSettings = async function() {
  _versionsLoaded = false;
  _versionSection.style.display = "none";
  _versionSection.classList.remove("open");
  document.getElementById("version-collapse-body").classList.add("hidden");
  _loadVersions();
  _loadAgentDefaults();
  _loadWorkspaceConfig();
  return _origLoadSettings();
};

// --- Init ---

loadSlashCommands();
startDocPolling();
startTodoRefsPolling();

// --- Page loader: wait for ALL agents to have terminal content before revealing ---
let _expectedAgentCount = 0;
let _agentsWithContent = new Set();
let _loaderDismissed = false;
let _sessionsReceived = false; // true after /api/sessions fetch resolves
let _savedReloadState = null; // set during restore to apply after loader

function dismissPageLoader() {
  if (_loaderDismissed) return;
  _loaderDismissed = true;
  const loader = document.getElementById("page-loader");
  if (loader) {
    // Try graceful fade first
    loader.classList.add("fade-out");
    loader.addEventListener("transitionend", () => loader.remove(), { once: true });
    // 400ms: force hide (covers transition not firing)
    setTimeout(() => { if (loader.parentNode) { loader.style.display = "none"; } }, 400);
    // 800ms: force remove from DOM
    setTimeout(() => { if (loader.parentNode) loader.remove(); }, 800);
  }
  // Restore remaining state (panels, scroll, modals) after a frame so layout settles
  requestAnimationFrame(() => {
    try {
      if (_savedReloadState) {
        _applyRestoredState(_savedReloadState);
        _savedReloadState = null;
      } else {
        // First load (no reload state) — auto-open shell if not explicitly closed before
        const shellPref = localStorage.getItem("ceo-shell-open");
        if (shellPref !== "0") {
          const header = document.getElementById("shell-header");
          const panel = document.getElementById("shell-panel");
          if (header && panel && !panel.classList.contains("open")) {
            header.click();
          }
        }
      }
    } catch (e) {
      console.error("[loader] Error restoring state:", e);
    }
  });
}

function checkAllAgentsLoaded() {
  if (_loaderDismissed) return;
  // Don't dismiss for count===0 until we've actually received the session list
  // (WS output can arrive before the fetch resolves, leaving _expectedAgentCount at 0)
  if (!_sessionsReceived) return;
  if (_expectedAgentCount === 0) { dismissPageLoader(); return; }
  if (_agentsWithContent.size >= _expectedAgentCount) {
    // All agents have content — run masonry then dismiss after layout settles.
    scheduleMasonry();
    // Wait two rAFs (layout + paint) then dismiss so cards don't jump
    requestAnimationFrame(() => {
      requestAnimationFrame(() => dismissPageLoader());
    });
  }
}

// Safety: dismiss loader after 3s no matter what (server lag, dead agents, etc.)
setTimeout(() => { if (!_loaderDismissed) dismissPageLoader(); }, 3000);
// Hard safety: force-remove loader DOM at 4s and 6s — two chances, no transitions, just remove
for (const ms of [4000, 6000]) {
  setTimeout(() => {
    const loader = document.getElementById("page-loader");
    if (loader) {
      loader.style.display = "none";
      loader.remove();
      _loaderDismissed = true;
    }
  }, ms);
}

// Load existing sessions first, then connect WebSocket
function _loadSessions(retries) {
  fetch("/api/sessions")
    .then((r) => r.json())
    .then((sessions) => {
      _expectedAgentCount = sessions.length;
      _sessionsReceived = true;
      for (const s of sessions) {
        try {
          if (s.type === "terminal") {
            addTerminalCard(s.name, s.workdir);
          } else {
            addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
          }
        } catch (e) {
          console.error("[init] Failed to add card for", s.name, e);
        }
      }
      reorderCards();
      updateEmptyState();
      // Restore drafts + focus EARLY (before loader dismisses) so user can type immediately
      try {
        if (_savedReloadState) _applyEarlyState(_savedReloadState);
      } catch (e) {
        console.error("[loader] Error in early state restore:", e);
      }
      // If no agents, dismiss immediately
      checkAllAgentsLoaded();
    })
    .catch(() => {
      if (retries > 0) {
        setTimeout(() => _loadSessions(retries - 1), 1000);
      } else {
        _sessionsReceived = true;
        dismissPageLoader();
      }
    });
}
_loadSessions(3);

connect();

// --- Restore state after hot-reload or app restart ---
// Check sessionStorage first (hot-reload), then localStorage (app kill/restart).
try {
  const saved = sessionStorage.getItem("ceo-reload-state") || localStorage.getItem("ceo-reload-state");
  if (saved) {
    sessionStorage.removeItem("ceo-reload-state");
    localStorage.removeItem("ceo-reload-state");
    _savedReloadState = JSON.parse(saved);
  }
} catch {}

// Save state on page hide (app kill, tab close, navigation away).
// pagehide fires reliably in WKWebView and mobile Safari; beforeunload does not.
window.addEventListener("pagehide", () => {
  try {
    localStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
  } catch {}
});

// Auto-save drafts every 5s so force-kills don't lose input
setInterval(() => {
  try {
    // Only save if there are actual drafts or pasted content worth preserving
    let hasDrafts = false;
    for (const [, agent] of agents) {
      const textarea = agent.card?.querySelector(".card-input textarea");
      if ((textarea && textarea.value) || (agent.pasteState && agent.pasteState.content)) {
        hasDrafts = true;
        break;
      }
    }
    if (hasDrafts) {
      localStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
    }
  } catch {}
}, 5000);

// Early restore: drafts + focus applied as soon as cards exist (before loader dismisses).
// This lets the user start typing immediately during load.
let _earlyStateApplied = false;
function _applyEarlyState(state) {
  if (_earlyStateApplied) return;
  _earlyStateApplied = true;
  // 1. Restore input drafts
  if (state.drafts) {
    for (const [name, text] of Object.entries(state.drafts)) {
      const agent = agents.get(name);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea) {
          textarea.value = text;
          textarea.style.height = "1px";
          textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
        }
      }
    }
  }
  // 2. Restore attachments
  if (state.attachments) {
    for (const [name, items] of Object.entries(state.attachments)) {
      const agent = agents.get(name);
      if (agent && agent.pendingAttachments) {
        agent.pendingAttachments.length = 0;
        for (const item of items) agent.pendingAttachments.push(item);
        renderAttachmentChips(agent.card, agent.pendingAttachments);
      }
    }
  }
  // 2b. Restore pasted content
  if (state.pastedContent) {
    for (const [name, text] of Object.entries(state.pastedContent)) {
      const agent = agents.get(name);
      if (agent && agent.pasteState) {
        agent.pasteState.content = text;
        const lines = text.split("\n");
        renderPasteChip(agent.card, lines.length, () => {
          agent.pasteState.content = null;
        });
      }
    }
  }
  // 3. Restore focus immediately so user can keep typing
  _restoreFocusFromState(state);
}

// Apply remaining state after loader dismisses (panels, scroll, modals)
function _applyRestoredState(state) {
  // Drafts/attachments/focus already applied in _applyEarlyState — skip if done
  if (!_earlyStateApplied) _applyEarlyState(state);
  // 3. Force all terminals to scroll to bottom on reload.
  // Saved scroll positions are unreliable after innerHTML rebuild — the offsets
  // become stale and leave terminals stuck at the top.
  for (const [, agent] of agents) {
    if (agent.terminal) {
      agent.terminal._userScrolledUp = false;
      agent.terminal._forceScrollUntil = Date.now() + 5000;
      agent.terminal._wheelGraceUntil = Date.now() + 1500;
      scrollTerminalToBottom(agent.terminal);
    }
  }
  // 4. Restore page scroll position
  window.scrollTo(0, state.scrollY || 0);
  // 5. Restore current view (todo vs agents)
  if (state.currentView === "todo") {
    // Set todo state before showing the view so it renders the right list
    if (state.todo) {
      activeListId = state.todo.activeListId;
      todoRawMode = state.todo.rawMode || false;
    }
    showTodoView();
    // After todo view renders, restore unsaved edits
    if (state.todo) {
      requestAnimationFrame(() => {
        if (state.todo.titleValue != null) {
          const titleInput = document.querySelector(".todo-title-input");
          if (titleInput) titleInput.value = state.todo.titleValue;
        }
        if (state.todo.rawContent != null) {
          const rawTextarea = document.querySelector(".todo-editor");
          if (rawTextarea) rawTextarea.value = state.todo.rawContent;
        }
        // Restore rich editor content (re-render with saved markdown)
        if (state.todo.richContent != null && !todoRawMode) {
          const richEditor = document.getElementById("todo-rich-editor");
          if (richEditor) {
            renderRichEditorContent({ content: state.todo.richContent });
          }
        }
      });
    }
  }
  // 6. Restore new-agent modal state if it was open
  if (state.modal) {
    modalOverlay.classList.remove("hidden");
    document.getElementById("agent-name").value = state.modal.name || "";
    document.getElementById("agent-prompt").value = state.modal.prompt || "";
    if (state.modal.selectedWorkdirPath) {
      setWorkdir(state.modal.selectedWorkdirPath === "__custom__"
        ? (state.modal.customWorkdir || state.modal.workdir)
        : state.modal.selectedWorkdirPath);
    }
    if (state.modal.attachments && state.modal.attachments.length > 0) {
      modalPendingAttachments.length = 0;
      for (const item of state.modal.attachments) modalPendingAttachments.push(item);
      const chipsContainer = document.getElementById("modal-attachment-chips");
      renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
    }
  }
  // 7. Restore shell panel state
  if (state.shellOpen) {
    const header = document.getElementById("shell-header");
    if (header && !document.getElementById("shell-panel")?.classList.contains("open")) {
      header.click();
    }
  }
  // 8. Restore side panels (files, settings, bookmarks)
  if (state.filesOpen) {
    if (!filesPanel.classList.contains("visible")) {
      filesPanel.classList.add("visible");
      filesBackdrop.classList.add("visible");
      filesBtn.classList.add("panel-active");
      loadClaudeFiles();
    }
    // Restore file editor with content + cursor
    if (state.fileEditor) {
      const fe = state.fileEditor;
      currentFilePath = fe.path;
      fileEditorName.textContent = fe.name || "";
      fileEditorHint.style.display = fe.path === "__ceo_md__" ? "" : "none";
      fileEditorContent.value = fe.content;
      filesCategories.style.display = "none";
      fileEditor.classList.remove("hidden");
      // Restore raw/rendered mode
      const isMd = fe.path.endsWith(".md") || fe.path === "__ceo_md__";
      if (isMd && !fe.rawMode) {
        fileEditorRendered.innerHTML = marked.parse(fe.content);
        fileEditorRendered.style.display = "";
        fileEditorContent.style.display = "none";
        fileEditorToggle.style.display = "";
        fileEditorToggle.textContent = "Raw";
        fileEditorToggle.classList.remove("active");
      } else {
        fileEditorRendered.style.display = "none";
        fileEditorContent.style.display = "";
        if (isMd) {
          fileEditorToggle.style.display = "";
          fileEditorToggle.textContent = "Rendered";
          fileEditorToggle.classList.add("active");
        } else {
          fileEditorToggle.style.display = "none";
        }
      }
    }
  }
  if (state.settingsOpen) {
    const sp = document.getElementById("settings-panel");
    const sb = document.getElementById("settings-backdrop");
    if (sp && !sp.classList.contains("visible")) {
      sp.classList.add("visible");
      if (sb) sb.classList.add("visible");
      settingsBtn.classList.add("panel-active");
      loadSettings();
    }
  }
  if (state.bookmarksOpen && _bmPanel) {
    if (!_bmPanel.classList.contains("visible")) {
      _bmPanel.classList.add("visible");
      _bmBackdrop.classList.add("visible");
      if (_bmBtn) _bmBtn.classList.add("panel-active");
      loadBookmarks();
    }
  }
  // 9. Re-apply scroll after layout settles (panels/modals may have shifted it)
  requestAnimationFrame(() => {
    window.scrollTo(0, state.scrollY || 0);
    // Re-focus in case panels stole it
    _restoreFocusFromState(state);
  });
}

// Shared focus restoration — used by both early and late restore phases
function _restoreFocusFromState(state) {
  function restoreFocus(el) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (state.focusCursorStart != null && el.setSelectionRange) {
      try {
        const len = el.value?.length ?? 0;
        // If cursor was at or near end of text, snap to actual end
        // (text length may differ slightly after restore)
        const wasNearEnd = state.focusCursorStart >= (state._savedTextLength || len) - 2;
        if (wasNearEnd) {
          el.setSelectionRange(len, len);
        } else {
          const start = Math.min(state.focusCursorStart, len);
          const end = Math.min(state.focusCursorEnd ?? start, len);
          el.setSelectionRange(start, end);
        }
      } catch {}
    }
    return true;
  }
  if (state.focusedId) {
    const el = document.getElementById(state.focusedId);
    if (el && restoreFocus(el)) return;
  }
  if (state.focusedTodo) {
    let el = null;
    if (state.focusedTodo === "title") el = document.querySelector(".todo-title-input");
    else if (state.focusedTodo === "editor") el = document.querySelector(".todo-editor");
    else if (state.focusedTodo === "rich-editor") el = document.getElementById("todo-rich-editor");
    if (el && restoreFocus(el)) return;
  }
  if (state.focusedAgent) {
    const agent = agents.get(state.focusedAgent);
    if (agent) {
      const textarea = agent.card.querySelector(".card-input textarea");
      if (textarea && restoreFocus(textarea)) return;
    }
  }
  if (state.focusedDocAgent) {
    const agent = agents.get(state.focusedDocAgent);
    if (agent) {
      const editArea = agent.card.querySelector(".agent-doc-edit-area");
      if (editArea && editArea.style.display !== "none" && restoreFocus(editArea)) return;
    }
  }
}

// --- Embedded Shell Terminal (xterm.js) ---
{
  const shellPanel = document.getElementById("shell-panel");
  const shellHeader = document.getElementById("shell-header");
  const shellContainer = document.getElementById("shell-terminal");
  const shellResize = shellPanel.querySelector(".shell-panel-resize");
  // Set initial shell height CSS var for todo view sizing
  document.documentElement.style.setProperty("--shell-panel-h", (shellPanel.offsetHeight || 42) + 8 + "px");

  // Create xterm.js terminal — respect saved shell color (uses shared infra with theme override)
  const _shellBg = localStorage.getItem("shellColor") || "#0d1117";
  const _shellTheme = buildXtermTheme(_shellBg);
  const { term, fitAddon } = createXtermInstance(2000, _shellTheme);

  // --- URL Opener wrapper detection + install ---
  const urlOpenerWrap = document.getElementById("url-opener-wrap");
  const urlOpenerBtn = document.getElementById("url-opener-btn");
  const urlOpenerTooltip = document.getElementById("url-opener-tooltip");
  const urlOpenerDeleteBtn = document.getElementById("url-opener-delete-btn");
  urlOpenerWrap.addEventListener("click", (e) => e.stopPropagation());
  async function checkUrlOpener() {
    try {
      const res = await fetch("/api/url-opener");
      const data = await res.json();
      if (data.installed) {
        urlOpenerBtn.textContent = "URL Opener Active";
        urlOpenerBtn.classList.add("installed");
        urlOpenerWrap.style.display = "";
        urlOpenerBtn.onclick = null;
        urlOpenerTooltip.querySelector(".url-opener-tooltip-title").textContent = "URL Opener — Active";
        urlOpenerDeleteBtn.style.display = "";
        urlOpenerDeleteBtn.onclick = async () => {
          urlOpenerDeleteBtn.textContent = "Removing...";
          urlOpenerDeleteBtn.disabled = true;
          try {
            await fetch("/api/url-opener", { method: "DELETE" });
            checkUrlOpener();
          } catch {
            urlOpenerDeleteBtn.textContent = "Failed";
            setTimeout(checkUrlOpener, 2000);
          }
          urlOpenerDeleteBtn.disabled = false;
        };
      } else {
        urlOpenerBtn.textContent = "Enable URL Opener";
        urlOpenerBtn.classList.remove("installed");
        urlOpenerWrap.style.display = "";
        urlOpenerTooltip.querySelector(".url-opener-tooltip-title").textContent = "URL Opener — Not Installed";
        urlOpenerDeleteBtn.style.display = "none";
        urlOpenerBtn.onclick = async () => {
          urlOpenerBtn.textContent = "Installing...";
          urlOpenerBtn.disabled = true;
          try {
            await fetch("/api/url-opener/install", { method: "POST" });
            checkUrlOpener();
          } catch {
            urlOpenerBtn.textContent = "Install Failed";
            setTimeout(checkUrlOpener, 2000);
          }
          urlOpenerBtn.disabled = false;
        };
      }
    } catch {}
  }
  checkUrlOpener();

  let shellInitialized = false;

  function initShellTerminal() {
    if (shellInitialized) return;
    shellInitialized = true;
    term.open(shellContainer);

    initXtermWebGL(term);

    // Send input from xterm to server PTY
    // Handles selection-based editing for paste (keyboard is handled by attachCustomKeyEventHandler)
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Intercept Enter: if the current line is a `claude` command, open new agent modal instead
        if (data === "\r" || data === "\n") {
          const buf = term.buffer.active;
          const line = buf.getLine(buf.baseY + buf.cursorY);
          if (line) {
            const lineText = line.translateToString(true);
            // Match "claude" or "claude <prompt>" (strip shell prompt prefix)
            const cmd = lineText.replace(/^.*?[%$#>]\s*/, "").trim();
            if (cmd === "claude" || cmd.startsWith("claude ")) {
              // Clear the typed command from the terminal (Ctrl+U clears line, then Enter to get fresh prompt)
              _sendShellStdin("\x15\r");
              // Extract prompt if any (e.g., "claude fix the bug" → "fix the bug")
              const prompt = cmd.startsWith("claude ") ? cmd.slice(7).trim() : "";
              // Open the new agent modal with the prompt pre-filled
              modalOverlay.classList.remove("hidden");
              fetchClaudeSessions();
              if (prompt) {
                setTimeout(() => {
                  const promptEl = document.getElementById("agent-prompt");
                  if (promptEl) { promptEl.value = prompt; promptEl.focus(); }
                }, 50);
              } else {
                document.getElementById("agent-name").focus();
              }
              return;
            }
          }
        }

        let sendData = data;
        // If pasting while text is selected, replace the selection with pasted content
        if (term.hasSelection() && data.length > 0 && data.charCodeAt(0) >= 32) {
          const prefix = _shellSelectionEditPrefix();
          if (prefix !== null) {
            sendData = prefix + data;
          }
          term.clearSelection();
        }
        _sendShellStdin(sendData);
      }
    });

    // Don't fit here — the caller does it after DOM layout
  }

  // Helper: generate move-to-selection-start + delete sequence for selection editing
  function _shellSelectionEditPrefix() {
    const sel = typeof term.getSelectionPosition === "function" ? term.getSelectionPosition() : null;
    const selectedText = term.getSelection();
    if (!sel || !selectedText) return null;
    if (sel.start.y !== sel.end.y) return null;
    const buf = term.buffer.active;
    const cursorAbsRow = buf.baseY + buf.cursorY;
    if (sel.start.y !== cursorAbsRow) return null;
    const delta = sel.start.x - buf.cursorX;
    let prefix = "";
    if (delta > 0) prefix += "\x1b[C".repeat(delta);
    else if (delta < 0) prefix += "\x1b[D".repeat(-delta);
    prefix += "\x1b[3~".repeat(selectedText.length);
    return prefix;
  }

  // --- Autocomplete Dropdown ---
  let _acDropdown = null;   // DOM element
  let _acDomItems = [];     // cached DOM item elements
  let _acItems = [];        // completion objects
  let _acIndex = 0;         // selected index
  let _acWord = "";         // original word being completed
  let _acFetching = false;  // prevent double-fetch

  function _getCursorScreenPos() {
    const screen = shellContainer.querySelector(".xterm-screen");
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    const buf = term.buffer.active;
    return {
      x: rect.left + buf.cursorX * cellW,
      y: rect.top + (buf.cursorY + 1) * cellH,
      cellH,
    };
  }

  function _acRender() {
    if (!_acDomItems.length) return;
    for (let i = 0; i < _acDomItems.length; i++) {
      _acDomItems[i].classList.toggle("selected", i === _acIndex);
    }
    _acDomItems[_acIndex]?.scrollIntoView({ block: "nearest" });
  }

  function _acShow(completions, currentWord) {
    _acDismiss();
    _acItems = completions;
    _acWord = currentWord;
    _acIndex = 0;

    const dropdown = document.createElement("div");
    dropdown.className = "shell-autocomplete";

    completions.forEach((item, i) => {
      const row = document.createElement("div");
      const typeClass = item.type === "dir" ? "dir-item" : item.type === "link" ? "link-item" : "";
      row.className = "shell-autocomplete-item" + (typeClass ? " " + typeClass : "") + (i === 0 ? " selected" : "");
      row.dataset.index = i;

      const icon = document.createElement("span");
      icon.className = "shell-autocomplete-icon";
      icon.textContent = item.type === "dir" ? "\uD83D\uDCC1" : item.type === "link" ? "\uD83D\uDD17" : "\uD83D\uDCC4";

      const name = document.createElement("span");
      name.className = "shell-autocomplete-name";
      name.textContent = item.name + (item.type === "dir" ? "/" : "");

      row.appendChild(icon);
      row.appendChild(name);

      if (item.type === "dir") {
        const hint = document.createElement("span");
        hint.className = "shell-autocomplete-hint";
        hint.textContent = "dir";
        row.appendChild(hint);
      }

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        _acIndex = i;
        _acAccept();
      });

      dropdown.appendChild(row);
    });

    // Position at cursor
    const pos = _getCursorScreenPos();
    if (pos) {
      dropdown.style.left = Math.min(pos.x, window.innerWidth - 440) + "px";
      const estH = Math.min(completions.length * 28 + 8, 268);
      if (pos.y + estH > window.innerHeight - 10) {
        dropdown.style.bottom = (window.innerHeight - pos.y + pos.cellH + 2) + "px";
      } else {
        dropdown.style.top = pos.y + "px";
      }
    }

    document.body.appendChild(dropdown);
    _acDropdown = dropdown;
    _acDomItems = Array.from(dropdown.querySelectorAll(".shell-autocomplete-item"));
    setTimeout(() => document.addEventListener("mousedown", _acClickOutside), 0);
  }

  function _acClickOutside(e) {
    if (_acDropdown && !_acDropdown.contains(e.target)) _acDismiss();
  }

  function _acDismiss() {
    if (_acDropdown) {
      _acDropdown.remove();
      _acDropdown = null;
      _acDomItems = [];
      _acItems = [];
      _acIndex = 0;
      document.removeEventListener("mousedown", _acClickOutside);
    }
  }

  function _acMove(delta) {
    if (!_acDropdown || _acItems.length === 0) return;
    _acIndex = (_acIndex + delta + _acItems.length) % _acItems.length;
    _acRender();
  }

  function _acAccept() {
    const item = _acItems[_acIndex];
    if (!item) return;
    // Figure out what prefix is already typed for this filename
    const wordBase = _acWord.includes("/") ? _acWord.split("/").pop() : _acWord;
    let remaining = item.name.slice(wordBase.length);
    if (item.type === "dir") remaining += "/";
    // Escape spaces and special chars for shell
    remaining = remaining.replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
    _sendShellStdin(remaining);
    _acDismiss();
  }

  function _acTrigger() {
    if (_acFetching) return;
    const buf = term.buffer.active;
    const line = buf.getLine(buf.baseY + buf.cursorY);
    if (!line) return;
    const lineText = line.translateToString(false, 0, buf.cursorX);
    // Extract current word (everything after last unescaped space)
    const match = lineText.match(/(\S+)$/);
    const currentWord = match ? match[1] : "";
    // Get shell cwd
    const cwdEl = document.getElementById("shell-cwd");
    const cwd = cwdEl?.dataset.fullPath;
    if (!cwd) { _sendShellStdin("\t"); return; }
    // Detect directory-only commands
    const firstWord = lineText.replace(/^.*?%\s*/, "").trim().split(/\s+/)[0] || "";
    const dirsOnly = ["cd", "pushd"].includes(firstWord) && currentWord !== firstWord;
    _acFetching = true;
    fetch("/api/shell/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: currentWord, cwd, dirsOnly }),
    })
    .then(r => r.json())
    .then(({ completions }) => {
      _acFetching = false;
      if (!completions || completions.length === 0) {
        // No matches — fall back to shell native Tab
        _sendShellStdin("\t");
      } else if (completions.length === 1) {
        // Single match — auto-insert
        _acWord = currentWord;
        _acItems = completions;
        _acIndex = 0;
        _acAccept();
      } else {
        // Insert common prefix if any, then show dropdown
        const wordBase = currentWord.includes("/") ? currentWord.split("/").pop() : currentWord;
        const common = _commonPrefix(completions);
        if (common.length > wordBase.length) {
          const insert = common.slice(wordBase.length).replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
          _sendShellStdin(insert);
          const newWord = currentWord.slice(0, currentWord.length - wordBase.length) + common;
          _acShow(completions, newWord);
        } else {
          _acShow(completions, currentWord);
        }
      }
    })
    .catch(() => { _acFetching = false; _sendShellStdin("\t"); });
  }

  function _commonPrefix(items) {
    if (items.length === 0) return "";
    let pfx = items[0].name;
    for (let i = 1; i < items.length; i++) {
      const n = items[i].name;
      let j = 0;
      while (j < pfx.length && j < n.length && pfx[j] === n[j]) j++;
      pfx = pfx.slice(0, j);
      if (!pfx) return "";
    }
    return pfx;
  }

  // Custom key handler: autocomplete, Tab, selection editing, Escape
  // Cached selection state to avoid calling term.hasSelection() on every keypress
  let _shellHasSelection = false;
  term.onSelectionChange(() => { _shellHasSelection = term.hasSelection(); });

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;

    // Fast path: no dropdown, no selection — only check Tab and Escape
    if (!_acDropdown && !_shellHasSelection) {
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        _acTrigger();
        return false;
      }
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;
      return true;
    }

    // --- Autocomplete dropdown is open: handle navigation ---
    if (_acDropdown) {
      if (e.key === "ArrowDown") { e.preventDefault(); _acMove(1); return false; }
      if (e.key === "ArrowUp") { e.preventDefault(); _acMove(-1); return false; }
      if (e.key === "Tab") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Enter") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); _acDismiss(); return false; }
      // Any other key: dismiss dropdown and let the key pass through
      _acDismiss();
      // Fall through to normal handling below
    }

    // Escape: bubble out to close the panel
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;

    // Tab: trigger autocomplete dropdown
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _acTrigger();
      return false;
    }

    // Selection-based editing
    if (_shellHasSelection) {
      if (e.key === "Backspace" || e.key === "Delete") {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix);
          term.clearSelection();
          return false;
        }
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix + e.key);
          term.clearSelection();
          return false;
        }
      }
    }

    return true;
  });

  // Expose globally for WS handler
  window._shellXterm = term;

  // --- Click-to-position: move cursor to clicked cell on the active input line ---
  // Translates mouse clicks into arrow key sequences (like iTerm2 / Warp).
  // Handles wrapped commands spanning multiple terminal rows.
  {
    let _shellScreen = null;
    shellContainer.addEventListener("mouseup", (e) => {
      // Only left-click, no modifiers
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!shellInitialized) return;
      // Defer to let xterm.js finish processing selection state
      setTimeout(() => {
        // Skip if text was selected (drag, not click)
        if (term.hasSelection()) return;
        const buf = term.buffer.active;
        // Only when scrolled to bottom (current prompt is visible)
        if (buf.viewportY < buf.baseY) return;
        // Calculate clicked cell position
        if (!_shellScreen) _shellScreen = shellContainer.querySelector(".xterm-screen");
        if (!_shellScreen) return;
        const rect = _shellScreen.getBoundingClientRect();
        const cellWidth = rect.width / term.cols;
        const cellHeight = rect.height / term.rows;
        const clickCol = Math.min(Math.max(0, Math.floor((e.clientX - rect.left) / cellWidth)), term.cols - 1);
        const clickRow = Math.min(Math.max(0, Math.floor((e.clientY - rect.top) / cellHeight)), term.rows - 1);
        const curRow = buf.cursorY;
        const curCol = buf.cursorX;
        // For multi-row clicks, verify all rows between are part of the same wrapped line
        if (clickRow !== curRow) {
          const minRow = Math.min(clickRow, curRow);
          const maxRow = Math.max(clickRow, curRow);
          for (let r = minRow + 1; r <= maxRow; r++) {
            const rowLine = buf.getLine(buf.viewportY + r);
            if (!rowLine || !rowLine.isWrapped) return; // Different lines — don't move
          }
        }
        // Clamp click column to actual content length on the clicked row
        const clickLine = buf.getLine(buf.viewportY + clickRow);
        if (!clickLine) return;
        const lineText = clickLine.translateToString(true);
        const targetCol = Math.min(clickCol, lineText.length);
        // Calculate total character delta (handles wrapped lines naturally)
        const delta = (clickRow - curRow) * term.cols + (targetCol - curCol);
        if (delta === 0) return;
        // Send arrow key sequences to move the shell cursor
        const arrowKey = delta > 0 ? "\x1b[C" : "\x1b[D";
        const keys = arrowKey.repeat(Math.abs(delta));
        _sendShellStdin(keys);
      }, 10);
    });
  }

  // Fit terminal when panel resizes — always sends resize to PTY
  function fitShell() {
    if (!shellInitialized || !shellPanel.classList.contains("open")) return;
    try {
      fitAddon.fit();
    } catch {}
    if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: term.cols, rows: term.rows }));
    }
  }

  // Dynamic grid padding — keeps cards above the terminal panel
  function updateShellPadding() {
    const h = shellPanel.offsetHeight || 42;
    document.documentElement.style.setProperty("--shell-panel-h", h + 8 + "px");
    if (shellPanel.classList.contains("open")) {
      grid.style.paddingBottom = (h + 40) + "px";
    } else {
      grid.style.paddingBottom = "";
    }
  }

  // Click CWD pill → open folder in Finder
  document.getElementById("shell-cwd").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const fullPath = e.currentTarget.dataset.fullPath;
    if (fullPath) {
      fetch("/api/shell/open-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      });
    }
  });

  // Click branch pill → copy branch name to clipboard
  document.getElementById("shell-branch").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const branch = e.currentTarget.textContent.trim();
    if (!branch) return;
    navigator.clipboard.writeText(branch).then(() => {
      const el = e.currentTarget;
      const original = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => { el.textContent = original; }, 1200);
    });
  });

  // Toggle panel by clicking header bar (not a tab stop — use T/Escape hotkeys)
  shellHeader.addEventListener("click", (e) => {
    // Don't toggle if clicking a link or info pill
    if (e.target.closest("a") || e.target.closest(".shell-info-pill")) return;
    // Save height before toggling (while still open)
    if (shellPanel.classList.contains("open")) {
      shellPanel._savedHeight = shellPanel.offsetHeight;
    }
    const isOpen = shellPanel.classList.toggle("open");
    try { localStorage.setItem("ceo-shell-open", isOpen ? "1" : "0"); } catch {}
    if (isOpen) {
      initShellTerminal();
      // Restore user-resized height, or clear to let CSS default (280px)
      if (shellPanel._savedHeight && shellPanel._savedHeight > 80) {
        shellPanel.style.height = shellPanel._savedHeight + "px";
      } else {
        shellPanel.style.height = "";
      }
      // Hide xterm viewport scrollbar during expand to prevent glitch
      const viewport = shellContainer.querySelector(".xterm-viewport");
      if (viewport) viewport.style.overflow = "hidden";
      requestAnimationFrame(() => {
        fitShell();
        term.focus();
        updateShellPadding();
        if (viewport) setTimeout(() => { viewport.style.overflow = ""; }, 50);
      });
    } else {
      // Clear inline style so CSS auto-height collapses it
      shellPanel.style.height = "";
      updateShellPadding();
      _acDismiss();
    }
  });

  // Block ALL wheel scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("wheel", (e) => {
    e.preventDefault();
  }, { passive: false });

  // Block touch scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("touchmove", (e) => {
    e.stopPropagation();
  }, { passive: true });

  // Resize handle — debounce fitShell during drag (expensive DOM reflow)
  let _dragFitTimer = null;
  function fitShellDebounced() {
    clearTimeout(_dragFitTimer);
    _dragFitTimer = setTimeout(fitShell, 50);
  }

  shellResize.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shellPanel.offsetHeight;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      fitShell(); // final precise fit
      updateShellPadding();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Touch resize for shell panel (mobile)
  shellResize.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const startY = e.touches[0].clientY;
    const startH = shellPanel.offsetHeight;

    const onTouchMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.touches[0].clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      fitShell(); // final precise fit
      updateShellPadding();
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Re-fit on window resize
  // Debounce window resize — fitAddon.fit() triggers expensive DOM reflow
  let _fitResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_fitResizeTimer);
    _fitResizeTimer = setTimeout(fitShell, 100);
  });
}

// --- Todo View ---

let currentView = "agents"; // "agents" | "todo"
let todoData = { lists: [], colors: [] };
let activeListId = null;
function _todoStorageKey() {
  return window.innerWidth <= 600 ? "todo-last-mobile" : "todo-last-desktop";
}
function saveTodoLastList() {
  if (activeListId) localStorage.setItem(_todoStorageKey(), activeListId);
}
function restoreTodoLastList() {
  if (!activeListId) {
    activeListId = localStorage.getItem(_todoStorageKey()) || null;
  }
}
let todoSaveTimer = null;
let todoRawMode = false; // false = rich editor (default), true = raw textarea

const todoView = document.getElementById("todo-view");
const todoDotsEl = document.getElementById("todo-dots");
const todoContentEl = document.getElementById("todo-content");
const todoBtn = document.getElementById("todo-btn");
const todoBackBtn = document.getElementById("todo-back");
const todoNewBtn = document.getElementById("todo-new");
const todoSettingsOverlayEl = document.getElementById("todo-settings-overlay");
const todoSettingsClose = document.getElementById("todo-settings-close");
const todoAddColor = document.getElementById("todo-add-color");
const todoColorRows = document.getElementById("todo-color-rows");

let _savedScrollY = 0;
let _returnToCard = null;

function showTodoView(fromCardName) {
  _savedScrollY = window.scrollY;
  _returnToCard = fromCardName || null;
  currentView = "todo";
  grid.style.display = "none";
  minimizedBar.style.display = "none";
  todoView.classList.remove("hidden");
  todoBtn.classList.add("active");
  document.querySelector(".header-right").classList.add("todo-mode");
  loadTodoData();
}

function showAgentsView() {
  currentView = "agents";
  // Clear pending save timers
  if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
  if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
  if (_todoSaveMaxWait) { clearTimeout(_todoSaveMaxWait); _todoSaveMaxWait = null; }
  if (_richSaveMaxWait) { clearTimeout(_richSaveMaxWait); _richSaveMaxWait = null; }
  // Flush any unsaved content before leaving
  saveTodoContent();
  todoView.classList.add("hidden");
  grid.style.display = "";
  minimizedBar.style.display = "";
  todoBtn.classList.remove("active");
  const headerRight = document.querySelector(".header-right");
  if (headerRight) headerRight.classList.remove("todo-mode");
  scheduleMasonry();
  // Restore scroll: if came from a card pill, scroll to that card; otherwise restore position
  requestAnimationFrame(() => {
    if (_returnToCard && agents.has(_returnToCard)) {
      const card = agents.get(_returnToCard).card;
      card.scrollIntoView({ behavior: "instant", block: "center" });
      _returnToCard = null;
    } else {
      window.scrollTo(0, _savedScrollY);
    }
  });
}

function toggleTodoView() {
  if (currentView === "todo") showAgentsView();
  else showTodoView();
}

todoBtn.addEventListener("click", toggleTodoView);
todoBackBtn.addEventListener("click", showAgentsView);


todoNewBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New List" }),
    });
    const list = await res.json();
    activeListId = list.id;
    saveTodoLastList();
  } catch (err) {
    console.error("Failed to create todo list:", err);
  }
});

async function loadTodoData() {
  try {
    const res = await fetch("/api/todos");
    todoData = await res.json();
    restoreTodoLastList();
    // Validate restored ID still exists
    if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
      activeListId = null;
    }
    if (!activeListId && todoData.lists.length > 0) {
      activeListId = todoData.lists[0].id;
    }
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
  } catch (err) {
    console.error("Failed to load todos:", err);
  }
}

function handleTodoUpdate(data) {
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const titleInput = document.querySelector(".todo-title-input");
  const active = document.activeElement;
  const editorFocused = (rawEditor && active === rawEditor) || (richEditor && (active === richEditor || richEditor.contains(active)));
  const titleFocused = titleInput && active === titleInput;

  todoData = data;

  // If active list was deleted, clear selection
  if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
    activeListId = todoData.lists.length > 0 ? todoData.lists[0].id : null;
  }

  renderTodoDots();

  // Skip re-rendering content area if user is actively editing (avoids cursor jumps)
  if (editorFocused || titleFocused) return;
  renderActiveList();
}

function getColorHex(colorId) {
  const color = todoData.colors.find((c) => c.id === colorId);
  return color ? color.hex : "#8A9BA8";
}

function renderTodoDots() {
  todoDotsEl.innerHTML = "";
  const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
  for (const list of sorted) {
    const tab = document.createElement("div");
    tab.className = "todo-dot" + (list.id === activeListId ? " active" : "");
    tab.tabIndex = 0;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", list.id === activeListId ? "true" : "false");

    const circle = document.createElement("span");
    circle.className = "todo-dot-circle";
    circle.style.background = getColorHex(list.colorId);
    tab.appendChild(circle);

    const label = document.createElement("span");
    label.className = "todo-dot-label";
    label.textContent = list.title || "Untitled";
    tab.appendChild(label);

    tab.addEventListener("click", () => {
      activeListId = list.id;
      saveTodoLastList();
      renderTodoDots();
      renderActiveList();
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tab.click();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const tabs = [...todoDotsEl.querySelectorAll(".todo-dot")];
        const i = tabs.indexOf(tab);
        const next = e.key === "ArrowRight"
          ? tabs[(i + 1) % tabs.length]
          : tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) { next.focus(); next.click(); }
      }
    });
    todoDotsEl.appendChild(tab);
  }
  // Settings gear
  const gear = document.createElement("div");
  gear.className = "todo-dot-settings";
  gear.innerHTML = "\u2699";
  gear.title = "Color settings";
  gear.addEventListener("click", openTodoSettings);
  todoDotsEl.appendChild(gear);
}

function renderActiveList() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) {
    todoContentEl.innerHTML = '<div class="todo-empty-state"><p>No lists yet. Click <strong>+ New List</strong> to create one.</p></div>';
    return;
  }

  const hex = safeHex(getColorHex(list.colorId));
  const tintBg = hex + "0a";

  todoContentEl.innerHTML = `
    <div class="todo-list-active" style="background:${tintBg};--list-accent:${hex}">
      <div class="todo-title-bar">
        <div class="todo-color-trigger" style="background:${hex}" title="Change color"></div>
        <div class="todo-color-dropdown" id="todo-color-dropdown"></div>
        <input class="todo-title-input" value="${escapeHtml(list.title)}" placeholder="List title" style="color:${hex}">
        <button class="todo-delete-btn" title="Delete list">&times;</button>
      </div>
      <div class="todo-editor-area">
        ${todoRawMode
          ? `<textarea class="todo-editor" placeholder="- [ ] Your first task...">${escapeHtml(list.content)}</textarea>`
          : '<div class="todo-rich-editor" id="todo-rich-editor"></div>'
        }
      </div>
      <div class="todo-status-bar">
        <div class="todo-status-counts" id="todo-status-counts"></div>
        <div class="todo-status-right">
          <button class="todo-hotkey-btn" title="Keyboard shortcuts">?</button>
          <button class="todo-preview-toggle${todoRawMode ? " active" : ""}">${todoRawMode ? "Rich" : "Raw"}</button>
        </div>
      </div>
      <div class="todo-hotkey-panel hidden">
        <div class="todo-hotkey-grid">
          <kbd>\u2318B</kbd><span>Bold</span>
          <kbd>\u2318I</kbd><span>Italic</span>
          <kbd>\u2318Z</kbd><span>Undo</span>
          <kbd>\u21e7\u2318Z</kbd><span>Redo</span>
          <kbd>\u23188</kbd><span>Checkbox</span>
          <kbd>\u2318=</kbd><span>Heading \u2191</span>
          <kbd>\u2318\u2013</kbd><span>Heading \u2193</span>
          <kbd>\u2318[</kbd><span>Prev list</span>
          <kbd>\u2318]</kbd><span>Next list</span>
          <kbd>Esc</kbd><span>Back to agents</span>
        </div>
      </div>
    </div>
  `;

  // Wire up title input
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  titleInput.addEventListener("input", () => scheduleTodoSave());

  // Wire up raw textarea (only in raw mode)
  const textarea = todoContentEl.querySelector(".todo-editor");
  if (textarea) {
    textarea.addEventListener("input", () => scheduleTodoSave());
    setupRawEditorKeys(textarea);
  }

  // Populate rich editor (only in rich mode)
  if (!todoRawMode) renderRichEditorContent(list);

  // Delete — double-click arm pattern
  const deleteBtn = todoContentEl.querySelector(".todo-delete-btn");
  let deleteArmed = false;
  let deleteTimer = null;
  deleteBtn.addEventListener("click", async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.classList.add("armed");
      deleteBtn.textContent = "delete";
      deleteTimer = setTimeout(() => {
        deleteArmed = false;
        deleteBtn.classList.remove("armed");
        deleteBtn.innerHTML = "\u00d7";
      }, 2000);
      return;
    }
    clearTimeout(deleteTimer);
    await fetch(`/api/todos/${list.id}`, { method: "DELETE" });
  });

  // Color trigger
  const trigger = todoContentEl.querySelector(".todo-color-trigger");
  const dropdown = todoContentEl.querySelector(".todo-color-dropdown");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("visible");
    if (dropdown.classList.contains("visible")) renderColorDropdown(list);
  });
  document.addEventListener("click", function closeDropdown(e) {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      dropdown.classList.remove("visible");
      document.removeEventListener("click", closeDropdown);
    }
  });

  // Hotkey panel toggle
  const hotkeyBtn = todoContentEl.querySelector(".todo-hotkey-btn");
  const hotkeyPanel = todoContentEl.querySelector(".todo-hotkey-panel");
  if (hotkeyBtn && hotkeyPanel) {
    hotkeyBtn.addEventListener("click", () => hotkeyPanel.classList.toggle("hidden"));
  }

  // Mode toggle (Rich ↔ Raw)
  todoContentEl.querySelector(".todo-preview-toggle").addEventListener("click", () => {
    if (todoRawMode) {
      const ta = todoContentEl.querySelector(".todo-editor");
      if (ta) { list.content = ta.value; saveTodoNow(list); }
    } else {
      const md = richEditorToMarkdown();
      if (md !== null) { list.content = md; saveTodoNow(list); }
    }
    todoRawMode = !todoRawMode;
    renderActiveList();
  });

  updateTodoStatusBar(list);
}

function saveTodoNow(list) {
  fetch(`/api/todos/${list.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: list.content }),
  });
}

// ═══════════════════════════════════════════════════
// RICH EDITOR — contenteditable structured items
// ═══════════════════════════════════════════════════

function parseMarkdownToItems(markdown) {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split("\n");
  const items = [];
  for (const line of lines) {
    const cbU = line.match(/^(\s*)- \[ \] (.*)/);
    const cbC = line.match(/^(\s*)- \[x\] (.*)/i);
    const bullet = line.match(/^(\s*)[-*] (.*)/);
    const numbered = line.match(/^(\s*)(\d+)\. (.*)/);
    const heading = line.match(/^(#{1,6}) (.*)/);
    if (cbU) items.push({ type: "checkbox", checked: false, text: cbU[2] });
    else if (cbC) items.push({ type: "checkbox", checked: true, text: cbC[2] });
    else if (bullet) items.push({ type: "bullet", text: bullet[2] });
    else if (numbered) items.push({ type: "numbered", text: numbered[3] });
    else if (heading) items.push({ type: "heading", level: heading[1].length, text: heading[2] });
    else if (line.trim() === "") {
      if (items.length === 0 || items[items.length - 1].type !== "separator") items.push({ type: "separator" });
    } else items.push({ type: "text", text: line });
  }
  if (items.length > 0 && items[items.length - 1].type === "separator") items.pop();
  return items;
}

function inlineMarkdownToHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function htmlToInlineMarkdown(el) {
  let md = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { md += node.textContent; }
    else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") md += "**" + htmlToInlineMarkdown(node) + "**";
      else if (tag === "em" || tag === "i") md += "*" + htmlToInlineMarkdown(node) + "*";
      else if (tag === "code") md += "`" + node.textContent + "`";
      else if (tag !== "br") md += htmlToInlineMarkdown(node);
    }
  }
  return md;
}

function richEditorToMarkdown() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return null;
  const items = editor.querySelectorAll(".todo-rich-item");
  const lines = [];
  let numCount = 0;
  for (const item of items) {
    const type = item.dataset.type;
    if (type === "separator") { lines.push(""); numCount = 0; continue; }
    const textEl = item.querySelector(".todo-rich-text");
    const text = textEl ? htmlToInlineMarkdown(textEl) : "";
    if (type === "checkbox") { lines.push(`- [${item.dataset.checked === "true" ? "x" : " "}] ${text}`); numCount = 0; }
    else if (type === "bullet") { lines.push(`- ${text}`); numCount = 0; }
    else if (type === "numbered") { numCount++; lines.push(`${numCount}. ${text}`); }
    else if (type === "heading") { lines.push(`${"#".repeat(parseInt(item.dataset.level) || 1)} ${text}`); numCount = 0; }
    else { lines.push(text); numCount = 0; }
  }
  return lines.join("\n");
}

function createRichItem(itemData, isInitialEmpty) {
  const div = document.createElement("div");
  div.className = "todo-rich-item";
  div.dataset.type = itemData.type;
  if (itemData.type === "separator") { div.contentEditable = "false"; return div; }

  if (itemData.type === "checkbox") {
    div.dataset.checked = itemData.checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (itemData.checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = div.dataset.checked === "true";
      div.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      const t = div.querySelector(".todo-rich-text");
      if (t) t.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    div.appendChild(cb);
  } else if (itemData.type === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    div.appendChild(b);
  } else if (itemData.type === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = (itemData.num || 1) + ".";
    div.appendChild(n);
  }

  const textEl = document.createElement("span");
  textEl.className = "todo-rich-text";
  if (itemData.type === "checkbox" && itemData.checked) textEl.classList.add("checked-text");
  textEl.innerHTML = inlineMarkdownToHtml(itemData.text || "");

  if (itemData.type === "heading") {
    div.dataset.level = itemData.level || 1;
    const lvl = itemData.level || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Only show placeholder on the initial empty item when a list is brand new
  if (isInitialEmpty && !itemData.text) {
    textEl.dataset.placeholder = "New item...";
  }

  div.appendChild(textEl);
  return div;
}

function autoConvertMarkdownPrefix(itemEl, textEl) {
  // Only auto-convert plain text or bullet items — don't re-convert existing checkboxes/headings
  const type = itemEl.dataset.type;
  const raw = textEl.textContent;

  // Checkbox: "- [ ] " or "- [x] "
  const cbU = raw.match(/^- \[ \] (.*)/);
  const cbC = raw.match(/^- \[x\] (.*)/i);
  if (cbU || cbC) {
    const checked = !!cbC;
    const rest = checked ? cbC[1] : cbU[1];
    replaceItemAs(itemEl, textEl, "checkbox", rest, checked);
    return;
  }

  // Bullet: "- " or "* " at start (only if item is currently text)
  if (type === "text" || type === "bullet") {
    const bm = raw.match(/^[-*] (.+)/);
    if (bm && type === "text") {
      replaceItemAs(itemEl, textEl, "bullet", bm[1], false);
      return;
    }
  }

  // Heading: "# " through "###### "
  if (type === "text") {
    const hm = raw.match(/^(#{1,6}) (.+)/);
    if (hm) {
      replaceItemAs(itemEl, textEl, "heading", hm[2], false, hm[1].length);
      return;
    }
  }

  // Numbered: "1. " etc.
  if (type === "text") {
    const nm = raw.match(/^(\d+)\. (.+)/);
    if (nm) {
      replaceItemAs(itemEl, textEl, "numbered", nm[2], false);
      return;
    }
  }
}

function replaceItemAs(itemEl, textEl, newType, newText, checked, headingLevel) {
  pushRichUndo();
  // Remove old prefix element
  const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (oldPrefix) oldPrefix.remove();

  itemEl.dataset.type = newType;
  delete itemEl.dataset.checked;
  textEl.classList.remove("checked-text");
  textEl.style.fontSize = "";
  textEl.style.fontWeight = "";
  delete itemEl.dataset.level;

  if (newType === "checkbox") {
    itemEl.dataset.checked = checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    itemEl.insertBefore(cb, textEl);
    if (checked) textEl.classList.add("checked-text");
  } else if (newType === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    itemEl.insertBefore(b, textEl);
  } else if (newType === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = "1.";
    itemEl.insertBefore(n, textEl);
  } else if (newType === "heading") {
    itemEl.dataset.level = headingLevel || 1;
    const lvl = headingLevel || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Set the remaining text and place cursor at end
  textEl.innerHTML = inlineMarkdownToHtml(newText);
  delete textEl.dataset.placeholder;
  focusAtEnd(textEl);
}

function handleRichItemKey(e, itemEl, textEl) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;

  // Cmd+B: bold
  if ((e.metaKey || e.ctrlKey) && e.key === "b") {
    e.preventDefault(); document.execCommand("bold"); scheduleRichSave(); return;
  }
  // Cmd+I: italic
  if ((e.metaKey || e.ctrlKey) && e.key === "i") {
    e.preventDefault(); document.execCommand("italic"); scheduleRichSave(); return;
  }

  // Enter: new item below
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    pushRichUndo();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    if (textEl.lastChild) afterRange.setEndAfter(textEl.lastChild);
    else afterRange.setEnd(textEl, textEl.childNodes.length);
    const frag = afterRange.extractContents();
    const tmp = document.createElement("div");
    tmp.appendChild(frag);
    const afterText = htmlToInlineMarkdown(tmp);

    if (!textEl.textContent.trim() && !afterText.trim() && itemEl.dataset.type !== "text") {
      convertItemToText(itemEl); scheduleRichSave(); return;
    }

    const newItem = createRichItem({
      type: itemEl.dataset.type, checked: false,
      level: parseInt(itemEl.dataset.level) || 1, text: afterText,
    });
    itemEl.after(newItem);
    const newText = newItem.querySelector(".todo-rich-text");
    if (newText) focusAtStart(newText);
    scheduleRichSave();
    return;
  }

  // Backspace at start
  if (e.key === "Backspace") {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (!isCaretAtStart(textEl)) return;
    pushRichUndo();
    const items = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
    const idx = items.indexOf(itemEl);

    if (!textEl.textContent.trim()) {
      if (items.length <= 1) return;
      e.preventDefault();
      if (itemEl.dataset.type !== "text") {
        convertItemToText(itemEl);
      } else {
        const focusIdx = Math.max(0, idx - 1);
        itemEl.remove();
        const rest = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
        if (rest[focusIdx]) { const t = rest[focusIdx].querySelector(".todo-rich-text"); if (t) focusAtEnd(t); }
      }
      scheduleRichSave(); return;
    }
    if (idx > 0) {
      e.preventDefault();
      const prevText = items[idx - 1].querySelector(".todo-rich-text");
      if (!prevText) return;
      const prevLen = prevText.textContent.length;
      while (textEl.firstChild) prevText.appendChild(textEl.firstChild);
      itemEl.remove();
      setCursorAtOffset(prevText, prevLen);
      scheduleRichSave();
    }
  }
}

function convertItemToText(itemEl) {
  itemEl.dataset.type = "text";
  delete itemEl.dataset.checked;
  const prefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (prefix) prefix.remove();
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (textEl) { textEl.classList.remove("checked-text"); delete textEl.dataset.placeholder; }
}

function richToggleHeading(increase) {
  pushRichUndo();
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const sel = window.getSelection();
  let itemEl = null;
  if (sel.anchorNode) {
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (node && editor.contains(node)) itemEl = node.closest(".todo-rich-item");
  }
  // Fallback: use the first item if cursor isn't in one
  if (!itemEl) itemEl = editor.querySelector(".todo-rich-item:not([data-type='separator'])");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (!textEl) return;

  const currentLevel = parseInt(itemEl.dataset.level) || 0;
  const isHeading = itemEl.dataset.type === "heading";

  if (increase) {
    if (!isHeading) {
      // Convert to heading level 1
      const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
      if (oldPrefix) oldPrefix.remove();
      itemEl.dataset.type = "heading";
      itemEl.dataset.level = "1";
      delete itemEl.dataset.checked;
      textEl.classList.remove("checked-text");
      textEl.style.fontSize = "20px";
      textEl.style.fontWeight = "700";
    } else if (currentLevel < 6) {
      const newLvl = currentLevel + 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    }
  } else {
    // Decrease
    if (isHeading && currentLevel > 1) {
      const newLvl = currentLevel - 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    } else if (isHeading && currentLevel <= 1) {
      // Remove heading — convert back to text
      itemEl.dataset.type = "text";
      delete itemEl.dataset.level;
      textEl.style.fontSize = "";
      textEl.style.fontWeight = "";
    }
  }
}

function toggleCurrentItemCheckbox() {
  pushRichUndo();
  const sel = window.getSelection();
  if (!sel.anchorNode) return;
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const itemEl = node?.closest(".todo-rich-item");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");

  if (itemEl.dataset.type === "checkbox") {
    convertItemToText(itemEl);
  } else {
    itemEl.dataset.type = "checkbox";
    itemEl.dataset.checked = "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox";
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    const bullet = itemEl.querySelector(".todo-rich-bullet");
    if (bullet) bullet.remove();
    itemEl.insertBefore(cb, textEl);
    if (textEl) textEl.classList.remove("checked-text");
  }
  scheduleRichSave();
  if (textEl) focusAtEnd(textEl);
}

function isCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}

function focusAtStart(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.setStart(el, 0); r.collapse(true);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function focusAtEnd(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function setCursorAtOffset(el, charOffset) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  let count = 0;
  const walk = (node) => {
    if (node.nodeType === 3) {
      const len = node.textContent.length;
      if (count + len >= charOffset) {
        const r = document.createRange(); r.setStart(node, charOffset - count); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
      count += len;
    } else { for (const c of node.childNodes) { if (walk(c)) return true; } }
    return false;
  };
  if (!walk(el)) focusAtEnd(el);
}

// ═══════════════════════════════════════════════════
// UNDO / REDO — markdown-level snapshots
// ═══════════════════════════════════════════════════
const _richUndoStack = [];
const _richRedoStack = [];
let _richUndoBatchTimer = null;

function pushRichUndo() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  if (_richUndoStack.length > 0 && _richUndoStack[_richUndoStack.length - 1] === md) return;
  _richUndoStack.push(md);
  if (_richUndoStack.length > 200) _richUndoStack.shift();
  _richRedoStack.length = 0;
}

function batchPushRichUndo() {
  if (_richUndoBatchTimer) clearTimeout(_richUndoBatchTimer);
  _richUndoBatchTimer = setTimeout(pushRichUndo, 800);
}

function richUndo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richUndoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  let prevMd = _richUndoStack.pop();
  if (prevMd === currentMd && _richUndoStack.length > 0) {
    _richRedoStack.push(prevMd);
    prevMd = _richUndoStack.pop();
  }
  if (currentMd !== null && currentMd !== prevMd) _richRedoStack.push(currentMd);
  restoreRichEditor(prevMd);
}

function richRedo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richRedoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  if (currentMd !== null) _richUndoStack.push(currentMd);
  const nextMd = _richRedoStack.pop();
  restoreRichEditor(nextMd);
}

function restoreRichEditor(md) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const items = parseMarkdownToItems(md);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }
  const texts = editor.querySelectorAll(".todo-rich-text");
  if (texts.length) focusAtEnd(texts[texts.length - 1]);
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (list) {
    list.content = md;
    fetch(`/api/todos/${activeListId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: md }),
    });
    updateTodoStatusBar(list);
    renderTodoDots();
  }
}

let _richSaveTimer = null;
let _richSaveMaxWait = null;
function _doRichSave() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;
  list.content = md;
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const updates = { content: md };
  if (titleInput) { updates.title = titleInput.value; list.title = updates.title; }
  fetch(`/api/todos/${activeListId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  updateTodoStatusBar(list);
  renderTodoDots();
}
function scheduleRichSave() {
  if (_richSaveTimer) clearTimeout(_richSaveTimer);
  _richSaveTimer = setTimeout(_doRichSave, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_richSaveMaxWait) {
    _richSaveMaxWait = setTimeout(() => {
      _richSaveMaxWait = null;
      if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
      _doRichSave();
    }, 800);
  }
}

function renderRichEditorContent(list) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  editor.contentEditable = "true";
  // Initialize undo stack with current content
  _richUndoStack.length = 0;
  _richRedoStack.length = 0;
  _richUndoStack.push(list.content || "");
  const items = parseMarkdownToItems(list.content);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }

  // Only attach handlers once — undo/redo repopulates items but keeps the same editor element
  if (!editor._handlersAttached) {
    editor._handlersAttached = true;

    // Editor-level keydown — detect active item and delegate
    editor.addEventListener("keydown", (e) => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl && itemEl) {
        handleRichItemKey(e, itemEl, textEl);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pushRichUndo();
        const newItem = createRichItem({ type: "text", text: "" });
        editor.appendChild(newItem);
        const t = newItem.querySelector(".todo-rich-text");
        if (t) focusAtStart(t);
        scheduleRichSave();
      }
    });

    // Editor-level input — detect active item, run auto-convert + save
    editor.addEventListener("input", () => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl) {
        if (textEl.textContent) delete textEl.dataset.placeholder;
        else if (editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])").length <= 1) {
          textEl.dataset.placeholder = "New item...";
        }
        if (itemEl) autoConvertMarkdownPrefix(itemEl, textEl);
      }
      batchPushRichUndo();
      scheduleRichSave();
    });
  }

  // Only auto-focus if editor doesn't already have focus (first open, not WebSocket re-render)
  if (document.activeElement !== editor && !editor.contains(document.activeElement)) {
    const first = editor.querySelector(".todo-rich-text");
    if (first) setTimeout(() => focusAtEnd(first), 50);
  }
}

function getActiveRichItem(editor) {
  const sel = window.getSelection();
  if (!sel.anchorNode) return {};
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  if (!node || !editor.contains(node)) return {};
  const textEl = node.closest ? node.closest(".todo-rich-text") : null;
  const itemEl = textEl ? textEl.closest(".todo-rich-item") : (node.closest ? node.closest(".todo-rich-item") : null);
  return { itemEl, textEl };
}

// ═══════════════════════════════════════════════════
// RAW TEXTAREA EDITOR (fallback mode)
// ═══════════════════════════════════════════════════

function setupRawEditorKeys(editor) {
  editor.addEventListener("keydown", (e) => {
    const { selectionStart: start, selectionEnd: end, value } = editor;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const line = value.slice(lineStart, start);
      const cbMatch = line.match(/^(\s*- \[[ x]\] )(.*)/i);
      const bMatch = line.match(/^(\s*- )(.*)/);
      const nMatch = line.match(/^(\s*)(\d+)\. (.*)/);
      const match = cbMatch || bMatch;
      if (match) {
        const content = cbMatch ? cbMatch[2] : bMatch[2];
        if (!content.trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const prefix = cbMatch ? cbMatch[1].replace(/\[x\]/i, "[ ]") : bMatch[1];
        const ins = "\n" + prefix;
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
      if (nMatch) {
        if (!nMatch[3].trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const ins = "\n" + nMatch[1] + (parseInt(nMatch[2]) + 1) + ". ";
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      if (e.shiftKey && value[lineStart] === " ") {
        const n = Math.min(2, value.slice(lineStart).search(/\S/));
        editor.value = value.slice(0, lineStart) + value.slice(lineStart + n);
        editor.selectionStart = editor.selectionEnd = start - n;
      } else if (!e.shiftKey) {
        editor.value = value.slice(0, lineStart) + "  " + value.slice(lineStart);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
      editor.dispatchEvent(new Event("input"));
    }
  });
}

function insertCheckbox(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  let newLine;
  if (line.match(/^\s*- \[[ x]\] /i)) newLine = line.replace(/^(\s*)- \[[ x]\] /i, "$1");
  else if (line.match(/^\s*- /)) newLine = line.replace(/^(\s*)- /, "$1- [ ] ");
  else newLine = line.match(/^(\s*)/)[1] + "- [ ] " + line.trimStart();
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function wrapSelection(editor, marker) {
  const { selectionStart: start, selectionEnd: end, value } = editor;
  const selected = value.slice(start, end);
  if (selected) {
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);
    if (before === marker && after === marker) {
      editor.value = value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
      editor.selectionStart = start - marker.length; editor.selectionEnd = end - marker.length;
    } else {
      editor.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
      editor.selectionStart = start + marker.length; editor.selectionEnd = end + marker.length;
    }
  } else {
    editor.value = value.slice(0, start) + marker + marker + value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + marker.length;
  }
  editor.dispatchEvent(new Event("input"));
}

function toggleHeading(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const hm = line.match(/^(#{1,6})\s/);
  let newLine;
  if (hm && hm[1].length >= 6) newLine = line.replace(/^#{1,6}\s/, "");
  else if (hm) newLine = "#" + line;
  else newLine = "# " + line;
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function renderColorDropdown(list) {
  const dropdown = document.getElementById("todo-color-dropdown");
  dropdown.innerHTML = "";
  for (const color of todoData.colors) {
    const swatch = document.createElement("div");
    swatch.className = "todo-color-swatch" + (color.id === list.colorId ? " selected" : "");
    swatch.style.background = color.hex;
    swatch.title = color.name;
    swatch.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/todos/${list.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorId: color.id }),
      });
      dropdown.classList.remove("visible");
    });
    dropdown.appendChild(swatch);
  }
}


let _todoSaveMaxWait = null;
function scheduleTodoSave() {
  if (todoSaveTimer) clearTimeout(todoSaveTimer);
  todoSaveTimer = setTimeout(saveTodoContent, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_todoSaveMaxWait) {
    _todoSaveMaxWait = setTimeout(() => {
      _todoSaveMaxWait = null;
      if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
      saveTodoContent();
    }, 800);
  }
}

async function saveTodoContent() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;

  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const rawEditor = todoContentEl.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");

  const updates = {};
  if (titleInput) updates.title = titleInput.value;

  // Read content from whichever editor is active
  if (!todoRawMode && richEditor) {
    const md = richEditorToMarkdown();
    if (md !== null) updates.content = md;
  } else if (rawEditor) {
    updates.content = rawEditor.value;
  }

  // Update local state immediately for snappy feel
  if (updates.title !== undefined) list.title = updates.title;
  if (updates.content !== undefined) list.content = updates.content;

  try {
    await fetch(`/api/todos/${activeListId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  } catch (err) {
    console.error("Failed to save todo:", err);
  }

  updateTodoStatusBar(list);
  renderTodoDots(); // update dot title
}

function updateTodoStatusBar(list) {
  const countsEl = document.getElementById("todo-status-counts");
  if (!countsEl) return;

  const content = list.content || "";
  const lines = content.split("\n").length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const chars = content.length;

  const checked = (content.match(/- \[x\]/gi) || []).length;
  const total = (content.match(/- \[[ x]\]/gi) || []).length;

  let text = `${lines} lines \u00b7 ${words} words \u00b7 ${chars} chars`;
  if (total > 0) text += ` \u00b7 ${checked}/${total} done`;

  countsEl.textContent = text;
}

// --- Color Settings Modal ---

function openTodoSettings() {
  todoSettingsOverlayEl.classList.remove("hidden");
  renderTodoColorSettings();
}

function closeTodoSettings() {
  // Save colors on close
  const rows = todoColorRows.querySelectorAll(".todo-color-row");
  const colors = [];
  rows.forEach((row) => {
    const name = row.querySelector('input[type="text"]').value.trim();
    const hex = row.querySelector('input[type="color"]').value;
    const id = row.dataset.colorId;
    if (name && hex) colors.push({ id, name, hex });
  });
  fetch("/api/todo-colors", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colors }),
  });
  todoSettingsOverlayEl.classList.add("hidden");
}

todoSettingsClose.addEventListener("click", closeTodoSettings);
todoSettingsOverlayEl.addEventListener("click", (e) => {
  if (e.target === todoSettingsOverlayEl) closeTodoSettings();
});

function renderTodoColorSettings() {
  todoColorRows.innerHTML = "";
  for (const color of todoData.colors) {
    const row = document.createElement("div");
    row.className = "todo-color-row";
    row.dataset.colorId = color.id;
    row.innerHTML = `
      <input type="color" value="${safeHex(color.hex)}">
      <input type="text" value="${escapeHtml(color.name)}" placeholder="Color name">
      <button class="todo-color-remove" title="Remove">&times;</button>
    `;
    row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
    todoColorRows.appendChild(row);
  }
}

todoAddColor.addEventListener("click", () => {
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const row = document.createElement("div");
  row.className = "todo-color-row";
  row.dataset.colorId = id;
  row.innerHTML = `
    <input type="color" value="#8A9BA8">
    <input type="text" value="" placeholder="Color name">
    <button class="todo-color-remove" title="Remove">&times;</button>
  `;
  row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
  todoColorRows.appendChild(row);
});


// --- iOS Keyboard Handling ---
// When the virtual keyboard opens on iOS, scroll the focused input into view.
// Uses the visualViewport API which fires resize events as the keyboard opens/closes.
if (window.visualViewport && isMobile()) {
  let _lastVVHeight = window.visualViewport.height;

  window.visualViewport.addEventListener("resize", () => {
    const vv = window.visualViewport;
    const heightDiff = _lastVVHeight - vv.height;
    _lastVVHeight = vv.height;

    // Keyboard opened (viewport shrank significantly)
    if (heightDiff > 100) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")) {
        // Scroll the focused element into the visible area
        setTimeout(() => {
          focused.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
      // Also handle the shell panel — push it above the keyboard
      const shellPanel = document.getElementById("shell-panel");
      if (shellPanel && shellPanel.classList.contains("open")) {
        shellPanel.style.bottom = (window.innerHeight - vv.height - vv.offsetTop) + "px";
      }
    }
    // Keyboard closed (viewport grew back)
    if (heightDiff < -100) {
      const shellPanel = document.getElementById("shell-panel");
      if (shellPanel) {
        shellPanel.style.bottom = "";
      }
    }
  });

  // Mobile focusin scroll is handled by the global focusin handler (line ~3093)
  // which accounts for shell panel height and card context — no duplicate needed here.
}
