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

// --- Shared xterm.js infrastructure (used by shell.js and app.js) ---

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
