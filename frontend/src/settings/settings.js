// ==========================================================================
// Nexterm — Settings & Theme Management
// Manages application preferences, theme definitions, theme gallery, and settings modal.
// ==========================================================================

import { getTabs } from "../state/tabState.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { showModal, hideModal } from "../ui/modal.js";
import { updatePlanetHero } from "../ui/planetHeroAnimation.js";
import { isAppLockEnabled, setAppLockEnabled, getIdleMinutes, setIdleMinutes, isLockOnStartup, setLockOnStartup } from "../ui/appLock.js";
import {
  getKnowledgeFiles,
  getKnowledgeFolders,
  getKnowledgeSummary,
  addFolder,
  deleteFolder,
  addKnowledgeFile,
  updateKnowledgeFile,
  deleteKnowledgeFile,
  formatFileSize,
  MAX_KNOWLEDGE_FILES
} from "../brm/aiKnowledgeStore.js";

// Default user settings
export let userSettings = {
  theme: "dark-modern",
  uiTheme: "dark-modern",
  fontFamily: "Cascadia Mono, Consolas, Fira Code, monospace",
  fontSize: 13,
  cursorBlink: true,
  cursorStyle: "block",
  scrollback: 10000,
  rightClickPaste: true,
  autoCopySelection: true,
  autoReconnect: false,
  reconnectAttempts: 5,
  reconnectDelay: 2,
  notificationLevel: "minimal"
};

export function loadSettings() {
  const savedSettings = localStorage.getItem("nexterm_settings");
  if (savedSettings) {
    try {
      const parsed = JSON.parse(savedSettings);
      Object.assign(userSettings, parsed);
    } catch (e) {
      console.warn("Failed to parse saved nexterm_settings:", e);
    }
  }
  return userSettings;
}

export function saveSettings() {
  localStorage.setItem("nexterm_settings", JSON.stringify(userSettings));
}

export const THEMES = {
  "dark-modern": {
    background: "#090c11",
    foreground: "#d9e0ea",
    cursor: "#60a5fa",
    cursorAccent: "#090c11",
    selectionBackground: "rgba(59, 130, 246, 0.4)",
    black: "#1e2233",
    red: "#f43f5e",
    green: "#10b981",
    yellow: "#f59e0b",
    blue: "#3b82f6",
    magenta: "#8b5cf6",
    cyan: "#06b6d4",
    white: "#f8fafc",
    brightBlack: "#475569",
    brightRed: "#fb7185",
    brightGreen: "#34d399",
    brightYellow: "#fbbf24",
    brightBlue: "#60a5fa",
    brightMagenta: "#a78bfa",
    brightCyan: "#22d3ee",
    brightWhite: "#ffffff"
  },
  "solarized-dark": {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "rgba(7, 54, 66, 0.8)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  },
  "monokai": {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "rgba(73, 72, 62, 0.8)",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#f4bf75",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5"
  },
  "nord": {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#88c0d0",
    cursorAccent: "#2e3440",
    selectionBackground: "rgba(67, 76, 94, 0.8)",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4"
  },
  "dracula": {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "rgba(68, 71, 90, 0.8)",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff"
  },
  "crimson-sunset": {
    background: "#150608",
    foreground: "#fff1f2",
    cursor: "#f43f5e",
    cursorAccent: "#150608",
    selectionBackground: "rgba(244, 63, 94, 0.35)",
    black: "#240a0f",
    red: "#f43f5e",
    green: "#34d399",
    yellow: "#fb923c",
    blue: "#fb7185",
    magenta: "#e11d48",
    cyan: "#fda4af",
    white: "#fff1f2",
    brightBlack: "#4c141d",
    brightRed: "#ff4d6d",
    brightGreen: "#4ade80",
    brightYellow: "#fba655",
    brightBlue: "#fda4af",
    brightMagenta: "#f43f5e",
    brightCyan: "#ffe4e6",
    brightWhite: "#ffffff"
  },
  "matrix": {
    background: "#031105",
    foreground: "#22eb4f",
    cursor: "#22eb4f",
    cursorAccent: "#031105",
    selectionBackground: "rgba(10, 60, 20, 0.8)",
    black: "#002008",
    red: "#00ff41",
    green: "#00ff41",
    yellow: "#5cff77",
    blue: "#00cc33",
    magenta: "#00aa2a",
    cyan: "#00ff55",
    white: "#d0ffd7",
    brightBlack: "#005515",
    brightRed: "#33ff66",
    brightGreen: "#00ff41",
    brightYellow: "#88ffa0",
    brightBlue: "#00dd38",
    brightMagenta: "#00bb2f",
    brightCyan: "#44ff77",
    brightWhite: "#ffffff"
  },
  "cyberpunk": {
    background: "#0f051d",
    foreground: "#00f0ff",
    cursor: "#ff007f",
    cursorAccent: "#0f051d",
    selectionBackground: "rgba(255, 0, 127, 0.35)",
    black: "#1a0b2e",
    red: "#ff0055",
    green: "#00ff9f",
    yellow: "#ffe600",
    blue: "#00f0ff",
    magenta: "#ff007f",
    cyan: "#7928ca",
    white: "#ffffff",
    brightBlack: "#2d1254",
    brightRed: "#ff3377",
    brightGreen: "#33ffb2",
    brightYellow: "#ffeb33",
    brightBlue: "#33f3ff",
    brightMagenta: "#ff3399",
    brightCyan: "#9b4dca",
    brightWhite: "#ffffff"
  },
  "light-modern": {
    background: "#f8fafc",
    foreground: "#0f172a",
    cursor: "#0284c7",
    cursorAccent: "#f8fafc",
    selectionBackground: "rgba(2, 132, 199, 0.2)",
    black: "#0f172a",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#d97706",
    blue: "#0284c7",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#ffffff",
    brightBlack: "#64748b",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#38bdf8",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff"
  },
  "linux-black": {
    background: "#000000",
    foreground: "#f2f2f2",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "rgba(255, 255, 255, 0.25)",
    black: "#000000",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    brightBlack: "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#ffffff"
  },
  "tokyo-night": {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    cursor: "#7aa2f7",
    cursorAccent: "#1a1b26",
    selectionBackground: "rgba(122, 162, 247, 0.3)",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#c0caf5",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5"
  },
  "gruvbox-dark": {
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#fe8019",
    cursorAccent: "#282828",
    selectionBackground: "rgba(254, 128, 25, 0.3)",
    black: "#1d2021",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2"
  },
  "rose-pine": {
    background: "#191724",
    foreground: "#e0def4",
    cursor: "#ebbcba",
    cursorAccent: "#191724",
    selectionBackground: "rgba(235, 188, 186, 0.25)",
    black: "#26233a",
    red: "#eb6f92",
    green: "#31748f",
    yellow: "#f6c177",
    blue: "#9ccfd8",
    magenta: "#c4a7e7",
    cyan: "#ebbcba",
    white: "#e0def4",
    brightBlack: "#6e6a86",
    brightRed: "#eb6f92",
    brightGreen: "#31748f",
    brightYellow: "#f6c177",
    brightBlue: "#9ccfd8",
    brightMagenta: "#c4a7e7",
    brightCyan: "#ebbcba",
    brightWhite: "#e0def4"
  },
  // ======================== PLANET THEMES ========================
  "planet-mercury": {
    background: "#0a0908",
    foreground: "#d4c8b8",
    cursor: "#c9a96e",
    cursorAccent: "#0a0908",
    selectionBackground: "rgba(201, 169, 110, 0.35)",
    black: "#1a1714",
    red: "#c87941",
    green: "#a89878",
    yellow: "#c9a96e",
    blue: "#8a7d6b",
    magenta: "#b08d6a",
    cyan: "#9e9585",
    white: "#d4c8b8",
    brightBlack: "#5c5347",
    brightRed: "#d89060",
    brightGreen: "#bfaf96",
    brightYellow: "#dbbf85",
    brightBlue: "#a09382",
    brightMagenta: "#c4a480",
    brightCyan: "#b5ab9a",
    brightWhite: "#ede5d8"
  },
  "planet-venus": {
    background: "#0d0a04",
    foreground: "#e8d8b4",
    cursor: "#e8c170",
    cursorAccent: "#0d0a04",
    selectionBackground: "rgba(232, 193, 112, 0.3)",
    black: "#1c1608",
    red: "#d4944a",
    green: "#c4a860",
    yellow: "#e8c170",
    blue: "#b89850",
    magenta: "#d4a850",
    cyan: "#c4b07a",
    white: "#e8d8b4",
    brightBlack: "#6b5c3a",
    brightRed: "#e0a860",
    brightGreen: "#d4b878",
    brightYellow: "#f0d088",
    brightBlue: "#c8a868",
    brightMagenta: "#e0b868",
    brightCyan: "#d4c090",
    brightWhite: "#f5ead0"
  },
  "planet-earth": {
    background: "#040a12",
    foreground: "#c8dce8",
    cursor: "#2e90d0",
    cursorAccent: "#040a12",
    selectionBackground: "rgba(46, 144, 208, 0.3)",
    black: "#0c1820",
    red: "#d06040",
    green: "#48a060",
    yellow: "#c8a848",
    blue: "#2e90d0",
    magenta: "#8068b0",
    cyan: "#38a8b8",
    white: "#c8dce8",
    brightBlack: "#3a5060",
    brightRed: "#e07858",
    brightGreen: "#60b878",
    brightYellow: "#d8b860",
    brightBlue: "#50a8e0",
    brightMagenta: "#9880c8",
    brightCyan: "#50c0d0",
    brightWhite: "#e8f0f8"
  },
  "planet-mars": {
    background: "#0c0604",
    foreground: "#e0c4a8",
    cursor: "#d05830",
    cursorAccent: "#0c0604",
    selectionBackground: "rgba(208, 88, 48, 0.35)",
    black: "#1c1008",
    red: "#d05830",
    green: "#b88048",
    yellow: "#d09848",
    blue: "#a07050",
    magenta: "#c07040",
    cyan: "#b89068",
    white: "#e0c4a8",
    brightBlack: "#6b4830",
    brightRed: "#e07048",
    brightGreen: "#c89860",
    brightYellow: "#e0b060",
    brightBlue: "#b88868",
    brightMagenta: "#d08858",
    brightCyan: "#c8a080",
    brightWhite: "#f0dac0"
  },
  "planet-jupiter": {
    background: "#070514",
    foreground: "#e8def8",
    cursor: "#c084fc",
    cursorAccent: "#070514",
    selectionBackground: "rgba(168, 85, 247, 0.35)",
    black: "#130f24",
    red: "#e879f9",
    green: "#a855f7",
    yellow: "#fbbf24",
    blue: "#818cf8",
    magenta: "#c084fc",
    cyan: "#fed7aa",
    white: "#f5f3ff",
    brightBlack: "#433560",
    brightRed: "#f472b6",
    brightGreen: "#c084fc",
    brightYellow: "#fde68a",
    brightBlue: "#a5b4fc",
    brightMagenta: "#e879f9",
    brightCyan: "#ffedd5",
    brightWhite: "#ffffff"
  },
  "planet-saturn": {
    background: "#0a0808",
    foreground: "#e8dcc8",
    cursor: "#d4b878",
    cursorAccent: "#0a0808",
    selectionBackground: "rgba(212, 184, 120, 0.3)",
    black: "#1a1610",
    red: "#c89458",
    green: "#b8a878",
    yellow: "#d4b878",
    blue: "#a09478",
    magenta: "#c0a468",
    cyan: "#b0a490",
    white: "#e8dcc8",
    brightBlack: "#605848",
    brightRed: "#d8a870",
    brightGreen: "#c8b890",
    brightYellow: "#e4c890",
    brightBlue: "#b0a490",
    brightMagenta: "#d0b480",
    brightCyan: "#c0b4a0",
    brightWhite: "#f4ece0"
  },
  "planet-uranus": {
    background: "#040a0e",
    foreground: "#c0dce8",
    cursor: "#60c0c8",
    cursorAccent: "#040a0e",
    selectionBackground: "rgba(96, 192, 200, 0.3)",
    black: "#0c181e",
    red: "#5898a0",
    green: "#68b0a8",
    yellow: "#88c0b0",
    blue: "#60c0c8",
    magenta: "#70a0b0",
    cyan: "#78d0d0",
    white: "#c0dce8",
    brightBlack: "#385860",
    brightRed: "#70b0b8",
    brightGreen: "#80c8c0",
    brightYellow: "#a0d0c8",
    brightBlue: "#78d0d8",
    brightMagenta: "#88b8c8",
    brightCyan: "#90e0e0",
    brightWhite: "#e0f0f4"
  },
  "planet-neptune": {
    background: "#04060e",
    foreground: "#b8c8e0",
    cursor: "#3070d0",
    cursorAccent: "#04060e",
    selectionBackground: "rgba(48, 112, 208, 0.35)",
    black: "#0c1020",
    red: "#4878c0",
    green: "#4090a0",
    yellow: "#6898b0",
    blue: "#3070d0",
    magenta: "#5068c0",
    cyan: "#3898d0",
    white: "#b8c8e0",
    brightBlack: "#304060",
    brightRed: "#6090d0",
    brightGreen: "#58a8b8",
    brightYellow: "#80b0c8",
    brightBlue: "#4888e0",
    brightMagenta: "#6880d0",
    brightCyan: "#50b0e0",
    brightWhite: "#d8e4f0"
  },
  "planet-pluto": {
    background: "#080612",
    foreground: "#e2dcf2",
    cursor: "#c084fc",
    cursorAccent: "#080612",
    selectionBackground: "rgba(192, 132, 252, 0.3)",
    black: "#141024",
    red: "#c084fc",
    green: "#a78bfa",
    yellow: "#f472b6",
    blue: "#818cf8",
    magenta: "#e879f9",
    cyan: "#c4b5fd",
    white: "#e2dcf2",
    brightBlack: "#4c3d69",
    brightRed: "#d8b4fe",
    brightGreen: "#c4b5fd",
    brightYellow: "#fbcfe8",
    brightBlue: "#a5b4fc",
    brightMagenta: "#f0abfc",
    brightCyan: "#ddd6fe",
    brightWhite: "#f5f3ff"
  }
};

export const THEME_METADATA = {
  "dark-modern": {
    name: "Dark Modern",
    desc: "Nexterm signature professional dark theme with electric cyan and deep slate accents",
    icon: "🌌",
    swatches: ["#0d0f17", "#131722", "#38bdf8", "#3b82f6", "#10b981"]
  },
  "tokyo-night": {
    name: "Tokyo Night",
    desc: "Iconic Japanese cyberpunk dark theme with deep twilight indigo, electric neon blue, and vivid purple",
    icon: "🌸",
    swatches: ["#1a1b26", "#16161e", "#7aa2f7", "#bb9af7", "#7dcfff"]
  },
  "nord": {
    name: "Nordic Frost",
    desc: "Arctic ice palette with calm polar slates, frosty cyan and soft snow",
    icon: "❄️",
    swatches: ["#2e3440", "#3b4252", "#88c0d0", "#81a1c1", "#a3be8c"]
  },
  "dracula": {
    name: "Dracula",
    desc: "Vampiric dark theme with midnight purple, electric pink and neon cyan",
    icon: "🧛",
    swatches: ["#282a36", "#21222c", "#bd93f9", "#ff79c6", "#50fa7b"]
  },
  "gruvbox-dark": {
    name: "Gruvbox Dark",
    desc: "Retro warm espresso palette with rich terracotta, warm amber, and golden olive accents",
    icon: "🪵",
    swatches: ["#282828", "#1d2021", "#fe8019", "#fabd2f", "#b8bb26"]
  },
  "rose-pine": {
    name: "Rosé Pine",
    desc: "Ethereal twilight atmosphere with soothing warm rose, dusky pine, and soft gold",
    icon: "🌹",
    swatches: ["#191724", "#1f1d2e", "#ebbcba", "#f6c177", "#9ccfd8"]
  },
  "monokai": {
    name: "Monokai Pro",
    desc: "Legendary warm charcoal code palette with vibrant lime and ruby tones",
    icon: "🍃",
    swatches: ["#272822", "#1e1f1c", "#a6e22e", "#f92672", "#66d9ef"]
  },
  "solarized-dark": {
    name: "Solarized Dark",
    desc: "Scientifically tailored low-contrast oceanic teal and warm amber",
    icon: "🌊",
    swatches: ["#002b36", "#073642", "#268bd2", "#2aa198", "#b58900"]
  },
  "matrix": {
    name: "Matrix Green CRT",
    desc: "Retro terminal phosphor green with pure pitch dark backgrounds",
    icon: "🟩",
    swatches: ["#031105", "#051c09", "#00ff41", "#00cc33", "#22eb4f"]
  },
  "cyberpunk": {
    name: "Cyberpunk Neon",
    desc: "High-contrast synthwave neon palette with hot magenta, yellow and cyan",
    icon: "🌆",
    swatches: ["#0f051d", "#1a0b2e", "#ff007f", "#00f0ff", "#00ff9f"]
  },
  "crimson-sunset": {
    name: "Sunset Crimson",
    desc: "Fiery dark palette with molten crimson, blood orange, and burning ember highlights",
    icon: "🔥",
    swatches: ["#150608", "#280e12", "#f43f5e", "#fb923c", "#fff1f2"]
  },
  "linux-black": {
    name: "Linux Console (Pure Black)",
    desc: "Classic Linux TTY terminal with pitch black background, crisp white console text, and VGA ANSI colors",
    icon: "🐧",
    swatches: ["#000000", "#111111", "#4e9a06", "#3465a4", "#ffffff"]
  },
  "light-modern": {
    name: "Modern Light",
    desc: "Clean porcelain white with high-contrast text and crisp cyan highlights",
    icon: "☀️",
    swatches: ["#f1f5f9", "#ffffff", "#0284c7", "#16a34a", "#0f172a"]
  },
  // ======================== PLANET THEMES ========================
  "planet-mercury": {
    name: "Mercury",
    desc: "Cratered silver-grey with warm amber & copper — the scorched messenger planet closest to the Sun",
    icon: "☿️",
    image: "assets/planet-mercury.jpg",
    swatches: ["#0a0908", "#1a1714", "#c9a96e", "#c87941", "#9e9585"]
  },
  "planet-venus": {
    name: "Venus",
    desc: "Golden sulfuric clouds and warm amber hazes — Earth's blazing twin shrouded in mystery",
    icon: "♀️",
    image: "assets/planet-venus.jpg",
    swatches: ["#0d0a04", "#1c1608", "#e8c170", "#d4944a", "#c4b07a"]
  },
  "planet-earth": {
    name: "Earth",
    desc: "Deep ocean blue, lush green continents & white clouds — our pale blue dot in the cosmos",
    icon: "🌍",
    image: "assets/planet-earth.jpg",
    swatches: ["#040a12", "#0c1820", "#2e90d0", "#48a060", "#38a8b8"]
  },
  "planet-mars": {
    name: "Mars",
    desc: "Rusty iron-oxide red, deep canyon ochre & dusty sienna — the Red Planet frontier",
    icon: "♂️",
    image: "assets/planet-mars.jpg",
    swatches: ["#0c0604", "#1c1008", "#d05830", "#b88048", "#d09848"]
  },
  "planet-jupiter": {
    name: "Jupiter",
    desc: "Cosmic royal violet nebula, swirling gas giant cloud bands & glowing rings — The Guardian of the inner worlds",
    icon: "♃",
    image: "assets/planet-jupiter.jpg",
    swatches: ["#070514", "#150e30", "#a855f7", "#ec4899", "#fed7aa"]
  },
  "planet-saturn": {
    name: "Saturn",
    desc: "Pale champagne-gold atmosphere with majestic icy rings — the jewel of the solar system",
    icon: "♄",
    image: "assets/planet-saturn.jpg",
    swatches: ["#0a0808", "#1a1610", "#d4b878", "#c89458", "#b8a878"]
  },
  "planet-uranus": {
    name: "Uranus",
    desc: "Cool cyan-teal methane atmosphere with icy aquamarine glow — the tilted ice giant",
    icon: "⛢",
    image: "assets/planet-uranus.jpg",
    swatches: ["#040a0e", "#0c181e", "#60c0c8", "#68b0a8", "#78d0d0"]
  },
  "planet-neptune": {
    name: "Neptune",
    desc: "Deep vivid cobalt blue with electric storms & icy winds — the farthest wanderer",
    icon: "♆",
    image: "assets/planet-neptune.jpg",
    swatches: ["#04060e", "#0c1020", "#3070d0", "#4090a0", "#3898d0"]
  },
  "planet-pluto": {
    name: "Pluto",
    desc: "Frosty nitrogen heart glaciers, icy violet haze & deep Kuiper Belt amethyst — the distant pioneer",
    icon: "♇",
    image: "assets/planet-pluto.jpg",
    swatches: ["#080612", "#150f2c", "#c084fc", "#a78bfa", "#f472b6"]
  }
};

export function applyUITheme(themeKey, persist = true) {
  const LEGACY_ALIASES = {
    "one-dark": "dark-modern",
    "github-dark": "dark-modern",
    "avisys-navy": "dark-modern",
    "slack-dark": "dark-modern",
    "catppuccin-mocha": "tokyo-night"
  };
  if (LEGACY_ALIASES[themeKey]) themeKey = LEGACY_ALIASES[themeKey];
  if (!THEMES[themeKey]) themeKey = "dark-modern";
  userSettings.uiTheme = themeKey;
  userSettings.theme = themeKey;

  document.documentElement.setAttribute("data-theme", themeKey);
  document.body.setAttribute("data-theme", themeKey);

  // Sync toolbar sun/moon toggle icon immediately
  const icon = document.getElementById("tbThemeToggleIcon");
  const btn = document.getElementById("tbThemeToggleBtn");
  if (icon) {
    if (themeKey === "light-modern") {
      icon.innerHTML = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
      if (btn) btn.title = "Light mode — click for Dark";
    } else {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
      if (btn) btn.title = "Dark mode — click for Light";
    }
  }

  if (persist) {
    saveSettings();
  }

  // Synchronize all open terminals immediately
  const activeTheme = THEMES[themeKey];
  const tabs = getTabs();
  Object.values(tabs).forEach(t => {
    if (t.term) {
      t.term.options.theme = activeTheme;
      if (t.fitAddon) {
        try { t.fitAddon.fit(); } catch (_) {}
      }
    }
  });

  // Update dynamic moving planetary hero viewport
  try {
    updatePlanetHero(themeKey);
  } catch (err) {
    console.warn("[applyUITheme] Failed to update planet hero viewport:", err);
  }
}
window.__applyUITheme = applyUITheme;

export function showThemePickerDialog() {
  const current = userSettings.uiTheme || userSettings.theme || "dark-modern";

  const cardsHtml = Object.entries(THEME_METADATA).map(([key, meta], idx, arr) => {
    const isActive = key === current;
    const swatchesHtml = meta.swatches.map(c => `<span class="theme-swatch" style="background: ${c};" title="${c}"></span>`).join("");
    const isPlanet = key.startsWith("planet-");

    // Insert section dividers before the first item of each category
    let divider = "";
    if (isPlanet) {
      const prevKey = idx > 0 ? arr[idx - 1][0] : "";
      if (!prevKey.startsWith("planet-")) {
        divider = `<div class="theme-section-divider" data-section="planets">
          <div class="theme-section-left">
            <span class="theme-section-title">🪐 Solar System Collection</span>
            <span class="theme-section-tag">9 Worlds</span>
          </div>
          <span class="theme-section-sub">Planetary contrast aesthetics with orbital telemetry</span>
        </div>`;
      }
    } else if (idx === 0) {
      const allThemeEntries = Object.keys(THEME_METADATA);
      const stdCount = allThemeEntries.filter(k => !k.startsWith("planet-")).length;
      divider = `<div class="theme-section-divider" data-section="standard">
        <div class="theme-section-left">
          <span class="theme-section-title">🎨 Standard Themes</span>
          <span class="theme-section-tag">${stdCount} Themes</span>
        </div>
        <span class="theme-section-sub">Popular developer dark themes and clean light modes</span>
      </div>`;
    }

    const imageHtml = meta.image
      ? `<div class="theme-card-image" style="background-image: url('${meta.image}');">
          ${isPlanet ? `<span class="planet-badge-orbit">ORBITAL VIEW</span>` : ''}
        </div>`
      : "";

    return `${divider}
      <div class="theme-card ${isActive ? 'active' : ''} ${isPlanet ? 'planet-theme' : 'standard-theme'}" data-theme="${key}" data-category="${isPlanet ? 'planets' : 'standard'}">
        ${imageHtml}
        <div class="theme-card-header">
          <span class="theme-card-title">${meta.icon} ${meta.name}</span>
          ${isActive ? `<span class="theme-card-badge">Active</span>` : ''}
        </div>
        <div class="theme-card-desc">${meta.desc}</div>
        <div class="theme-preview-palette">
          ${swatchesHtml}
        </div>
      </div>
    `;
  }).join("");

  const allThemesTotal = Object.keys(THEME_METADATA).length;
  const planetThemesTotal = Object.keys(THEME_METADATA).filter(k => k.startsWith("planet-")).length;
  const standardThemesTotal = allThemesTotal - planetThemesTotal;

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">🎨 Application UI Theme Gallery</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="theme-gallery-toolbar">
        <div class="theme-filter-tabs" id="themeFilterTabs">
          <button class="theme-filter-btn active" data-filter="all">All (${allThemesTotal})</button>
          <button class="theme-filter-btn" data-filter="planets">🪐 Solar System (${planetThemesTotal})</button>
          <button class="theme-filter-btn" data-filter="standard">🎨 Standard (${standardThemesTotal})</button>
        </div>
        <input type="text" id="themeSearchInput" class="theme-search-input" placeholder="🔍 Search themes..." autocomplete="off" />
      </div>
      <div class="theme-picker-grid" id="themePickerGrid">
        ${cardsHtml}
      </div>
    </div>
    <div class="modal-footer">
      <div class="theme-gallery-hint">
        💡 Click any theme to apply immediately across all workspaces, sidebars & terminals.
      </div>
      <button class="btn-primary" id="modalCloseBtn">Done</button>
    </div>
  `, "modal-theme-gallery");

  // Real-time theme selection
  box.querySelectorAll(".theme-card").forEach(card => {
    card.onclick = () => {
      const themeKey = card.dataset.theme;
      applyUITheme(themeKey, true);
      box.querySelectorAll(".theme-card").forEach(c => {
        c.classList.remove("active");
        const b = c.querySelector(".theme-card-badge");
        if (b) b.remove();
      });
      card.classList.add("active");
      const hdr = card.querySelector(".theme-card-header");
      if (hdr && !hdr.querySelector(".theme-card-badge")) {
        const badge = document.createElement("span");
        badge.className = "theme-card-badge";
        badge.textContent = "Active";
        hdr.appendChild(badge);
      }
      showToast(`Switched theme to ${THEME_METADATA[themeKey].name}`, "success");
    };
  });

  // Filter & Search Functionality
  let currentFilter = "all";
  const searchInput = box.querySelector("#themeSearchInput");
  const filterBtns = box.querySelectorAll(".theme-filter-btn");
  const grid = box.querySelector("#themePickerGrid");

  const filterCards = () => {
    const q = (searchInput?.value || "").toLowerCase().trim();
    const cards = box.querySelectorAll(".theme-card");
    const dividers = box.querySelectorAll(".theme-section-divider");

    let visiblePlanets = 0;
    let visibleStandard = 0;

    cards.forEach(card => {
      const cat = card.dataset.category;
      const themeKey = card.dataset.theme;
      const meta = THEME_METADATA[themeKey];
      const name = (meta?.name || "").toLowerCase();
      const desc = (meta?.desc || "").toLowerCase();

      const matchesCat = currentFilter === "all" || currentFilter === cat;
      const matchesSearch = !q || name.includes(q) || desc.includes(q);

      const isVisible = matchesCat && matchesSearch;
      card.classList.toggle("theme-card-hidden", !isVisible);
      card.style.setProperty("display", isVisible ? "flex" : "none", "important");

      if (isVisible) {
        if (cat === "planets") visiblePlanets++;
        else visibleStandard++;
      }
    });

    dividers.forEach(div => {
      const sec = div.dataset.section;
      const shouldShow = (sec === "planets")
        ? (visiblePlanets > 0 && (currentFilter === "all" || currentFilter === "planets"))
        : (visibleStandard > 0 && (currentFilter === "all" || currentFilter === "standard"));

      div.classList.toggle("theme-divider-hidden", !shouldShow);
      div.style.setProperty("display", shouldShow ? "flex" : "none", "important");
    });
  };

  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter || "all";
      filterCards();
      if (grid) grid.scrollTop = 0;
    };
  });

  if (searchInput) {
    searchInput.oninput = filterCards;
  }

  // Initial pass to guarantee exact filter state on open
  filterCards();

  const closeBtn = box.querySelector("#modalCloseBtn");
  if (closeBtn) closeBtn.onclick = hideModal;
  const closeX = box.querySelector("#modalClose");
  if (closeX) closeX.onclick = hideModal;
}

export async function showSettingsDialog(initialTab = "tab-settings-term") {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">⚙️ NexTerm Professional Settings & Preferences</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-tabs">
      <button class="modal-tab-btn active" data-tab="tab-settings-term">🖥️ Terminal & UI</button>
      <button class="modal-tab-btn" data-tab="tab-settings-pwd">🔑 Passwords & Vault</button>
      <button class="modal-tab-btn" data-tab="tab-settings-sec">🛡️ Security Policies</button>
      <button class="modal-tab-btn" data-tab="tab-settings-custom">🏢 Customizer</button>
      <button class="modal-tab-btn" data-tab="tab-settings-knownhosts">🛡️ Known Hosts</button>
      <button class="modal-tab-btn" data-tab="tab-settings-audit">📜 Audit Log</button>
      <button class="modal-tab-btn" data-tab="tab-settings-ai">🤖 AI Assistant</button>
      <button class="modal-tab-btn" data-tab="tab-settings-privacy">🔒 Privacy & Compliance</button>
    </div>
    <div class="modal-body" style="max-height: 480px; overflow-y: auto;">
      <!-- 1. Terminal & UI Settings Tab -->
      <div id="tab-settings-term" class="tab-content">
        <div class="form-group">
          <label>Application & Workspace UI Theme</label>
          <select id="cfgTheme">
            <optgroup label="Standard Themes">
              <option value="dark-modern" ${userSettings.theme === 'dark-modern' ? 'selected' : ''}>🌌 Dark Modern (Nexterm Default)</option>
              <option value="tokyo-night" ${userSettings.theme === 'tokyo-night' ? 'selected' : ''}>🌸 Tokyo Night (Cyberpunk Twilight)</option>
              <option value="catppuccin-mocha" ${userSettings.theme === 'catppuccin-mocha' ? 'selected' : ''}>☕ Catppuccin Mocha (Pastel Warm Dark)</option>
              <option value="gruvbox-dark" ${userSettings.theme === 'gruvbox-dark' ? 'selected' : ''}>🪵 Gruvbox Dark (Warm Retro Espresso)</option>
              <option value="rose-pine" ${userSettings.theme === 'rose-pine' ? 'selected' : ''}>🌹 Rosé Pine (Ethereal Dusky Rose)</option>
              <option value="github-dark" ${userSettings.theme === 'github-dark' ? 'selected' : ''}>🐙 GitHub Dark (Executive Charcoal)</option>
              <option value="nord" ${userSettings.theme === 'nord' ? 'selected' : ''}>❄️ Nordic Frost (Arctic Polar Ice)</option>
              <option value="dracula" ${userSettings.theme === 'dracula' ? 'selected' : ''}>🧛 Dracula (Midnight Purple & Neon Pink)</option>
              <option value="cyberpunk" ${userSettings.theme === 'cyberpunk' ? 'selected' : ''}>🌆 Cyberpunk Neon (Synthwave Cyan & Magenta)</option>
              <option value="monokai" ${userSettings.theme === 'monokai' ? 'selected' : ''}>🍃 Monokai Pro (Warm Charcoal & Lime)</option>
              <option value="solarized-dark" ${userSettings.theme === 'solarized-dark' ? 'selected' : ''}>🌊 Solarized Dark (Oceanic Teal & Amber)</option>
              <option value="matrix" ${userSettings.theme === 'matrix' ? 'selected' : ''}>🟩 Matrix Green CRT (Hacker Phosphor)</option>
              <option value="one-dark" ${userSettings.theme === 'one-dark' ? 'selected' : ''}>⚛️ Atom One Dark (Refined Slate & Cornflower)</option>
              <option value="avisys-navy" ${userSettings.theme === 'avisys-navy' ? 'selected' : ''}>⚓ Avisys Corporate Navy (Midnight Enterprise)</option>
              <option value="slack-dark" ${userSettings.theme === 'slack-dark' ? 'selected' : ''}>💬 Slack Theme Dark Mode (Classic Aubergine & Cyan)</option>
              <option value="linux-black" ${userSettings.theme === 'linux-black' ? 'selected' : ''}>🐧 Linux Console (Pure Black)</option>
              <option value="light-modern" ${userSettings.theme === 'light-modern' ? 'selected' : ''}>☀️ Modern Light (Clean Porcelain White)</option>
            </optgroup>
            <optgroup label="🪐 Solar System Collection (Planetary Contrast)">
              <option value="planet-mercury" ${userSettings.theme === 'planet-mercury' ? 'selected' : ''}>☿️ Mercury (Scorched Basalt & Molten Amber)</option>
              <option value="planet-venus" ${userSettings.theme === 'planet-venus' ? 'selected' : ''}>♀️ Venus (Golden Sulfuric Atmosphere)</option>
              <option value="planet-earth" ${userSettings.theme === 'planet-earth' ? 'selected' : ''}>🌍 Earth (Pale Blue Dot & Ocean Sapphire)</option>
              <option value="planet-mars" ${userSettings.theme === 'planet-mars' ? 'selected' : ''}>♂️ Mars (Red Planet Rust & Cinnabar)</option>
              <option value="planet-jupiter" ${userSettings.theme === 'planet-jupiter' ? 'selected' : ''}>♃ Jupiter (The Guardian · Cosmic Violet & Gas Giant)</option>
              <option value="planet-saturn" ${userSettings.theme === 'planet-saturn' ? 'selected' : ''}>♄ Saturn (Ringed Majesty & Champagne Gold)</option>
              <option value="planet-uranus" ${userSettings.theme === 'planet-uranus' ? 'selected' : ''}>⛢ Uranus (Aquamarine Ice & Methane Cyan)</option>
              <option value="planet-neptune" ${userSettings.theme === 'planet-neptune' ? 'selected' : ''}>♆ Neptune (Voyager Cobalt & Deep Abyss Azure)</option>
              <option value="planet-pluto" ${userSettings.theme === 'planet-pluto' ? 'selected' : ''}>♇ Pluto (Distant Pioneer · Kuiper Belt Amethyst)</option>
            </optgroup>
          </select>
        </div>
        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Font Size (px)</label>
            <input type="number" id="cfgFontSize" value="${userSettings.fontSize || 13}" min="9" max="28" />
          </div>
          <div class="form-group">
            <label>Cursor Style</label>
            <select id="cfgCursor">
              <option value="block" ${userSettings.cursorStyle === 'block' ? 'selected' : ''}>Block (█)</option>
              <option value="underline" ${userSettings.cursorStyle === 'underline' ? 'selected' : ''}>Underline (_)</option>
              <option value="bar" ${userSettings.cursorStyle === 'bar' ? 'selected' : ''}>Vertical Bar (|)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Font Family</label>
          <input type="text" id="cfgFont" value="${escapeHtml(userSettings.fontFamily || 'Cascadia Mono, Consolas, Fira Code, monospace')}" />
        </div>
        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Scrollback History (Lines)</label>
            <input type="number" id="cfgScrollback" value="${userSettings.scrollback || 10000}" min="1000" max="100000" step="1000" />
          </div>
          <div class="form-group" style="justify-content: flex-end; padding-bottom: 6px;">
            <label class="checkbox-label">
              <input type="checkbox" id="cfgCursorBlink" ${userSettings.cursorBlink !== false ? 'checked' : ''} />
              <span>Cursor Blinking</span>
            </label>
          </div>
        </div>
        <div class="form-group" style="margin-top: 4px;">
          <label class="checkbox-label">
            <input type="checkbox" id="cfgRightClickPaste" ${userSettings.rightClickPaste !== false ? 'checked' : ''} />
            <span>Right-Click Quick Paste</span>
          </label>
        </div>
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="cfgAutoCopy" ${userSettings.autoCopySelection !== false ? 'checked' : ''} />
            <span>Auto-Copy Highlighted Selection to Clipboard</span>
          </label>
        </div>
        <div class="form-group" style="margin-top: 10px;">
          <label>Notification Level</label>
          <select id="cfgNotifLevel">
            <option value="minimal" ${userSettings.notificationLevel !== 'all' ? 'selected' : ''}>Minimal (Connect/Disconnect & Background Tasks only)</option>
            <option value="all" ${userSettings.notificationLevel === 'all' ? 'selected' : ''}>All Events (Verbose alerts)</option>
          </select>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
            Minimal mode keeps notifications clean: only alerting on connect, disconnect, and background command completion.
          </div>
        </div>
        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: var(--accent-cyan);">🔄 Reconnection Preferences</div>
          <div class="form-group">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="cfgAutoReconnect" ${userSettings.autoReconnect ? 'checked' : ''} />
              <span>Auto-reconnect on connection lost (Exponential Backoff: 1s, 2s, 4s...)</span>
            </label>
          </div>
          <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px;">
            <div class="form-group">
              <label>Default Retry attempts</label>
              <input type="number" id="cfgReconnectAttempts" value="${userSettings.reconnectAttempts || 5}" min="1" max="50" />
            </div>
            <div class="form-group">
              <label>Default Retry initial delay (seconds)</label>
              <input type="number" id="cfgReconnectDelay" value="${userSettings.reconnectDelay || 2}" min="1" max="60" />
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Passwords & Vault Tab -->
      <!-- 2. Passwords & Vault Tab -->
      <div id="tab-settings-pwd" class="tab-content hidden">
        <!-- Vault Header & Protection Status Hero Card -->
        <div class="vault-hero-card" id="vaultHeroCard">
          <div class="vault-hero-left">
            <div class="vault-shield-avatar" id="vaultShieldAvatar">🛡️</div>
            <div class="vault-hero-text">
              <div class="vault-hero-heading">
                <span class="vault-hero-title" id="vaultStatusTitle">Vault Security & Key Management</span>
                <span id="vaultStatusBadge" class="vault-pulse-dot">● Checking...</span>
              </div>
              <div class="vault-hero-subtitle" id="vaultStatusText">
                Hardware DPAPI encryption active. Loading vault protection...
              </div>
            </div>
          </div>
          <div class="vault-header-actions" id="vaultHeaderActions"></div>
        </div>

        <!-- Master Password Lock Gate (shown if protected & locked) -->
        <div id="vaultLockGate" class="vault-lock-gate hidden">
          <div class="vault-lock-card">
            <div class="vault-lock-halo">
              <div class="vault-lock-icon">🔒</div>
            </div>
            <h3 class="vault-lock-title">Vault is Protected & Locked</h3>
            <p class="vault-lock-desc">
              Your credentials are hardware-encrypted with Windows DPAPI and locked with your Master Password. Enter your password to unlock.
            </p>
            <div class="vault-lock-form">
              <div class="pwd-input-wrap">
                <input type="password" id="vaultUnlockPwd" class="form-input vault-input-lg" placeholder="Enter master password..." autocomplete="off" />
                <button type="button" class="pwd-eye-btn" id="btnToggleUnlockPwd" title="Show/Hide Password">👁️</button>
              </div>
              <button type="button" class="btn btn-primary btn-lock-vault" id="btnVaultUnlock">🔓 Unlock Vault</button>
            </div>
            <div class="vault-lock-footer">
              <button type="button" class="vault-forgot-btn" id="btnLockShowHint" title="Show master password hint or recovery options">
                <span class="vault-forgot-icon">💡</span>
                <span>Forgot password? Show Hint</span>
              </button>
              <div id="vaultLockHintBox" class="vault-recovery-panel hidden">
                <div class="vault-recovery-header">
                  <div class="recovery-title-row">
                    <span class="recovery-icon">💡</span>
                    <span class="recovery-title">Password Memory Hint</span>
                  </div>
                  <button type="button" class="vault-recovery-close" id="btnCloseRecoveryPanel" title="Close hint panel">&times;</button>
                </div>
                <div class="vault-recovery-body" id="vaultHintContent">
                  <!-- Injected dynamically -->
                </div>
                <div class="vault-recovery-footer">
                  <span class="recovery-footer-text">Still can't remember?</span>
                  <button type="button" class="btn-reset-vault" id="btnResetMasterLock" title="Reset Master Password Lock">
                    ⚠️ Reset Vault Lock
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Master Password Setup Card (shown if master password is NOT set) -->
        <div id="vaultSetupCard" class="vault-setup-card hidden">
          <div class="vault-banner">
            <div class="vault-banner-icon">🛡️</div>
            <div class="vault-banner-body">
              <h4 class="vault-banner-title">Protect Your Passwords with Your Own Master Password</h4>
              <p class="vault-banner-text">
                Stored session credentials are hardware-encrypted with Windows DPAPI, but anyone with access to your workstation can view them. Set your own Master Password to lock down your credential vault with dual-layer bcrypt security. You can also generate a strong password and save a memory hint.
              </p>
            </div>
          </div>

          <!-- Password Generator Section in Setup -->
          <div class="vault-gen-section">
            <div class="vault-gen-header">
              <span class="vault-gen-title">🎲 Secure Password Generator</span>
              <span class="vault-gen-sub">Generate a cryptographically secure, high-entropy password</span>
            </div>
            <div class="vault-gen-controls">
              <div class="vault-gen-options">
                <div class="vault-gen-lens">
                  <span class="gen-lens-lbl">Length:</span>
                  <button type="button" class="btn-gen-len" data-len="12">12</button>
                  <button type="button" class="btn-gen-len active" data-len="16">16</button>
                  <button type="button" class="btn-gen-len" data-len="20">20</button>
                  <button type="button" class="btn-gen-len" data-len="24">24</button>
                  <button type="button" class="btn-gen-len" data-len="32">32</button>
                </div>
                <label class="checkbox-label" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="genSymbols" checked />
                  <span>Include Symbols (!@#$%...)</span>
                </label>
              </div>
              <div class="vault-gen-output-row">
                <input type="text" id="genOutput" class="vault-gen-input" readonly placeholder="Generating password..." />
                <button type="button" class="btn btn-secondary btn-sm" id="btnRunGen" title="Generate New Password">🎲 Generate</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btnCopyGen" title="Copy Password">📋 Copy</button>
                <button type="button" class="btn btn-accent btn-sm" id="btnUseGen" title="Use as Master Password">⚡ Use as Master Password</button>
              </div>
            </div>
          </div>

          <!-- Master Password Form -->
          <div class="vault-form-box">
            <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label for="newMasterPwd">Create Master Password <span class="required-star" style="color: #ef4444;">*</span></label>
                <div class="pwd-input-wrap">
                  <input type="password" id="newMasterPwd" class="form-input" placeholder="Enter master password (min 4 chars)" autocomplete="new-password" />
                  <button type="button" class="pwd-eye-btn" id="btnToggleNewMasterPwd" title="Show/Hide">👁️</button>
                </div>
                <div class="pwd-strength-container">
                  <div class="pwd-strength-meter">
                    <div id="pwdStrengthBar" class="pwd-strength-fill" style="width: 0%;"></div>
                  </div>
                  <span id="pwdStrengthText" class="pwd-strength-text">Password strength</span>
                </div>
              </div>
              <div class="form-group">
                <label for="confirmMasterPwd">Confirm Master Password <span class="required-star" style="color: #ef4444;">*</span></label>
                <div class="pwd-input-wrap">
                  <input type="password" id="confirmMasterPwd" class="form-input" placeholder="Re-type master password" autocomplete="new-password" />
                  <button type="button" class="pwd-eye-btn" id="btnToggleConfirmMasterPwd" title="Show/Hide">👁️</button>
                </div>
                <span id="pwdMatchNotice" class="pwd-match-text"></span>
              </div>
            </div>

            <!-- Password Hint -->
            <div class="form-group" style="margin-top: 8px;">
              <label for="newMasterHint" style="display: flex; align-items: center; justify-content: space-between;">
                <span>💡 Password Hint <span style="font-weight: normal; color: var(--text-dim);">(Helps you remember)</span></span>
              </label>
              <input type="text" id="newMasterHint" class="form-input" placeholder="e.g. Favorite childhood pet + first car model" autocomplete="off" />
              <div style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">
                Only you will see this hint. Never enter your actual password here.
              </div>
            </div>

            <div class="vault-form-actions" style="margin-top: 14px; display: flex; justify-content: flex-end;">
              <button type="button" class="btn btn-primary btn-lock-vault" id="btnSaveMasterPwd">
                🔒 Set Master Password & Protect Vault
              </button>
            </div>
          </div>
        </div>

        <!-- Master Password Change Panel (Collapsible) -->
        <div id="vaultChangeCard" class="vault-change-card hidden">
          <div class="vault-change-header">
            <h4>🔑 Change Master Password</h4>
            <button type="button" class="btn-link" id="btnCancelChangeMaster">Cancel</button>
          </div>
          <div class="form-group" style="margin-bottom: 8px;">
            <label for="chgCurrPwd">Current Master Password</label>
            <input type="password" id="chgCurrPwd" class="form-input" placeholder="Current master password..." />
          </div>
          <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
            <div class="form-group">
              <label for="chgNewPwd">New Master Password</label>
              <input type="password" id="chgNewPwd" class="form-input" placeholder="New master password (min 4 chars)..." />
            </div>
            <div class="form-group">
              <label for="chgConfirmPwd">Confirm New Password</label>
              <input type="password" id="chgConfirmPwd" class="form-input" placeholder="Confirm new password..." />
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 8px;">
            <label for="chgNewHint">New Password Hint</label>
            <input type="text" id="chgNewHint" class="form-input" placeholder="New hint to remember..." />
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnChangeGenHelp">🎲 Quick Generate</button>
            <button type="button" class="btn btn-primary btn-sm btn-lock-vault" id="btnSubmitChangeMaster">Save New Password</button>
          </div>
        </div>

        <!-- Stored Passwords Section (visible when unlocked or unprotected) -->
        <div id="vaultContentSection" class="vault-content-section">
          <!-- Standalone Generator Drawer (Collapsible) -->
          <div id="vaultGenDrawer" class="vault-gen-section hidden" style="margin-bottom: 12px;">
            <div class="vault-gen-header" style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="vault-gen-title">🎲 Instant Password Generator</span>
                <span class="vault-gen-sub" style="display: block;">Generate cryptographically secure passwords for sessions or accounts</span>
              </div>
              <button type="button" class="btn-link" id="btnCloseGenDrawer" style="font-size: 11.5px;">&times; Close</button>
            </div>
            <div class="vault-gen-controls">
              <div class="vault-gen-options">
                <div class="vault-gen-lens">
                  <span class="gen-lens-lbl">Length:</span>
                  <button type="button" class="btn-gen-len-drawer" data-len="12">12</button>
                  <button type="button" class="btn-gen-len-drawer active" data-len="16">16</button>
                  <button type="button" class="btn-gen-len-drawer" data-len="20">20</button>
                  <button type="button" class="btn-gen-len-drawer" data-len="24">24</button>
                  <button type="button" class="btn-gen-len-drawer" data-len="32">32</button>
                </div>
                <label class="checkbox-label" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                  <input type="checkbox" id="genSymbolsDrawer" checked />
                  <span>Include Symbols (!@#$%...)</span>
                </label>
              </div>
              <div class="vault-gen-output-row">
                <input type="text" id="genOutputDrawer" class="vault-gen-input" readonly placeholder="Generating password..." />
                <button type="button" class="btn btn-secondary btn-sm" id="btnRunGenDrawer" title="Generate New Password">🎲 Generate</button>
                <button type="button" class="btn btn-primary btn-sm" id="btnCopyGenDrawer" title="Copy Password">📋 Copy</button>
              </div>
            </div>
          </div>

          <div class="vault-list-header">
            <div class="vault-list-title">
              <span class="vault-section-title">Saved Session Credentials</span>
              <span id="vaultCredCount" class="vault-counter-badge">0</span>
            </div>
            <div class="vault-list-actions">
              <div class="vault-search-box">
                <input type="text" id="vaultSearchInput" class="vault-search-input" placeholder="🔍 Filter sessions or hosts..." />
              </div>
              <button type="button" class="btn btn-secondary btn-xs" id="btnToggleGenDrawer" title="Toggle Password Generator">🎲 Generator</button>
              <button type="button" class="btn btn-secondary btn-xs" id="btnRefreshVaultList" title="Refresh Vault Credentials">🔄 Refresh</button>
            </div>
          </div>
          <div id="pwdVaultList" class="pwd-vault-list">
            <div style="text-align: center; padding: 20px; color: var(--text-dim);">Loading vault credentials...</div>
          </div>
        </div>
      </div>

      <!-- 3. Security Policies Tab -->
      <div id="tab-settings-sec" class="tab-content hidden">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Enterprise protocol restrictions and credential management controls:
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <label class="checkbox-label"><input type="checkbox" id="secSSH" checked /> <span>Allow SSH Sessions</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secSFTP" checked /> <span>Allow SFTP Browser</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secRDP" checked /> <span>Allow Remote Desktop (RDP)</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secSerial" checked /> <span>Allow Serial / COM Ports</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secVNC" checked /> <span>Allow VNC Sessions</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secTelnet" /> <span>Allow Telnet Sessions</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secPwdSave" checked /> <span>Allow Password Saving in DPAPI</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secClipboard" checked /> <span>Allow Clipboard Sharing</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secTransfers" checked /> <span>Allow File Transfers</span></label>
          <label class="checkbox-label"><input type="checkbox" id="secAudit" /> <span>Require Audit Logging</span></label>
        </div>

        <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-subtle);">
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 10px; color: var(--accent-cyan);">🔒 App Lock & Idle Auto-Lock</div>
          <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px;">
            When enabled, NexTerm locks behind your master password on startup and/or after idle time. Turn it <strong>off</strong> if you don't need it.
          </div>
          <label class="checkbox-label" style="margin-bottom: 8px;">
            <input type="checkbox" id="secAppLockEnabled" ${isAppLockEnabled() ? 'checked' : ''} />
            <span>Enable App Lock (master toggle)</span>
          </label>
          <div id="secAppLockSub" style="margin-left: 22px; opacity: ${isAppLockEnabled() ? '1' : '0.45'}; pointer-events: ${isAppLockEnabled() ? 'auto' : 'none'}; transition: opacity .2s;">
            <label class="checkbox-label" style="margin-bottom: 6px;">
              <input type="checkbox" id="secLockOnStart" ${isLockOnStartup() ? 'checked' : ''} />
              <span>Lock on app startup</span>
            </label>
            <div class="form-row" style="display: flex; align-items: center; gap: 10px; margin-top: 6px;">
              <label style="font-size: 12px; color: var(--text-secondary); white-space: nowrap;">Idle auto-lock after</label>
              <input type="number" id="secIdleMin" min="0" max="240" value="${getIdleMinutes()}" style="width: 70px;" />
              <span style="font-size: 12px; color: var(--text-dim);">minutes (0 = off)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. Enterprise Customizer Tab -->
      <div id="tab-settings-custom" class="tab-content hidden">
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
          Customize enterprise application identity, branding, and corporate defaults:
        </div>
        <div class="form-group">
          <label>Application Name</label>
          <input type="text" id="custAppTitle" value="NexTerm Professional" placeholder="e.g. Avisys NexTerm Pro" />
        </div>
        <div class="form-group">
          <label>Company / Organization Name</label>
          <input type="text" id="custCompany" value="Avisys Services" placeholder="e.g. Avisys Services" />
        </div>
        <div class="form-group">
          <label>Welcome Splash Message</label>
          <input type="text" id="custSplash" value="Enterprise Infrastructure & Systems Engineering Workspace" />
        </div>
        <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Default SSH Port</label>
            <input type="number" id="custDefaultPort" value="22" min="1" max="65535" />
          </div>
          <div class="form-group">
            <label>Default Theme</label>
            <select id="custDefaultTheme">
              <option value="dark-modern">🌌 Dark Modern (Nexterm Default)</option>
              <option value="tokyo-night">🌸 Tokyo Night (Cyberpunk Twilight)</option>
              <option value="catppuccin-mocha">☕ Catppuccin Mocha (Pastel Warm Dark)</option>
              <option value="gruvbox-dark">🪵 Gruvbox Dark (Warm Retro Espresso)</option>
              <option value="rose-pine">🌹 Rosé Pine (Ethereal Dusky Rose)</option>
              <option value="github-dark">🐙 GitHub Dark (Executive Charcoal)</option>
              <option value="nord">❄️ Nordic Frost (Arctic Polar Ice)</option>
              <option value="dracula">🧛 Dracula (Midnight Purple & Neon Pink)</option>
              <option value="cyberpunk">🌆 Cyberpunk Neon (Synthwave Cyan & Magenta)</option>
              <option value="monokai">🍃 Monokai Pro (Warm Charcoal & Lime)</option>
              <option value="solarized-dark">🌊 Solarized Dark (Oceanic Teal & Amber)</option>
              <option value="matrix">🟩 Matrix Green CRT (Hacker Phosphor)</option>
              <option value="one-dark">⚛️ Atom One Dark (Refined Slate & Cornflower)</option>
              <option value="avisys-navy">⚓ Avisys Corporate Navy (Midnight Enterprise)</option>
              <option value="slack-dark">💬 Slack Theme Dark Mode (Classic Aubergine & Cyan)</option>
              <option value="linux-black">🐧 Linux Console (Pure Black)</option>
              <option value="light-modern">☀️ Modern Light (Clean Porcelain White)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 5. Known Hosts Tab -->
      <div id="tab-settings-knownhosts" class="tab-content hidden">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <h4 style="margin: 0; color: #fff; font-size: 13px;">Cached SSH Known Hosts</h4>
            <p style="margin: 3px 0 0; color: #94a3b8; font-size: 11.5px;">Trusted host keys cached in <code>%APPDATA%\\Nexterm\\known_hosts</code></p>
          </div>
          <button class="btn btn-secondary btn-sm" id="btnRefreshKnownHosts" type="button">↻ Refresh</button>
        </div>
        <div id="knownHostsListContainer" style="max-height: 280px; overflow-y: auto; background: #13161f; border: 1px solid #232733; border-radius: 4px; padding: 6px;">
          <div style="color: #94a3b8; padding: 12px; text-align: center;">Loading known hosts...</div>
        </div>
      </div>

      <!-- 6. Audit Log Tab -->
      <div id="tab-settings-audit" class="tab-content hidden">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap;">
          <div>
            <h4 style="margin: 0; color: #fff; font-size: 13px;">Enterprise Audit Trail</h4>
            <p style="margin: 3px 0 0; color: #94a3b8; font-size: 11.5px;">Append-only security log stored in <code>%APPDATA%\\Nexterm\\audit_log.jsonl</code> (0600)</p>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" id="btnExportAuditCSV" type="button" title="Export audit events as CSV">📥 Export CSV</button>
            <button class="btn btn-secondary btn-sm" id="btnExportAuditJSON" type="button" title="Export audit events as JSON">📥 Export JSON</button>
            <button class="btn btn-secondary btn-sm" id="btnRefreshAudit" type="button" title="Reload recent audit events">↻ Refresh</button>
            <button class="btn btn-danger btn-sm" id="btnClearAudit" type="button" title="Purge audit logs">🗑️ Clear</button>
          </div>
        </div>
        <div id="auditLogListContainer" style="max-height: 280px; overflow-y: auto; background: #13161f; border: 1px solid #232733; border-radius: 4px; padding: 6px;">
          <div style="color: #94a3b8; padding: 12px; text-align: center;">Loading audit logs...</div>
        </div>
      </div>

      <!-- 7. AI Assistant & Knowledge Base Tab -->
      <div id="tab-settings-ai" class="tab-content hidden">
        <div class="ai-kb-header-card">
          <div class="ai-kb-header-info">
            <h4 style="margin: 0; color: #fff; font-size: 13px; display: flex; align-items: center; gap: 8px;">
              <span>🤖 AI Assistant Knowledge Base</span>
              <span class="ai-grounded-pill">Strict Grounding</span>
            </h4>
            <p style="margin: 3px 0 0; color: #94a3b8; font-size: 11.5px; line-height: 1.4;">
              All answers in the AI Assistant chat are strictly based on your uploaded files. Upload presentations (.pptx), PDFs, JSON schemas, configs, and guides.
            </p>
          </div>
          <div class="ai-quota-card">
            <div class="ai-quota-meta">
              <span class="ai-quota-lbl">Knowledge Limit</span>
              <strong id="aiQuotaText">0 / 20 files</strong>
            </div>
            <div class="ai-quota-bar-track">
              <div id="aiQuotaBarFill" class="ai-quota-bar-fill" style="width: 0%;"></div>
            </div>
          </div>
        </div>

        <!-- Toolbar: Folders filter & actions -->
        <div class="ai-kb-toolbar">
          <div id="aiFolderFilterChips" class="ai-folder-chips-container"></div>
          <div class="ai-kb-toolbar-actions">
            <button class="btn btn-secondary btn-sm" id="btnAiAddFolder" type="button" title="Create a new folder to organize files">
              📁 + New Folder
            </button>
            <button class="btn btn-primary btn-sm" id="btnAiUploadFile" type="button" title="Upload files (.pptx, .pdf, .json, .txt, .log)">
              📤 Upload Files
            </button>
            <input type="file" id="aiFileInput" multiple accept=".pptx,.pdf,.txt,.json,.log,.md,.csv,.doc,.docx" style="display:none;" />
            <input type="file" id="aiReplaceFileInput" accept=".pptx,.pdf,.txt,.json,.log,.md,.csv,.doc,.docx" style="display:none;" />
          </div>
        </div>

        <!-- Files list container -->
        <div id="aiFilesListContainer" class="ai-files-list-container">
          <div style="color: #94a3b8; padding: 20px; text-align: center;">Loading uploaded files...</div>
        </div>
      </div>

      <!-- 8. Privacy & Compliance Tab -->
      <div id="tab-settings-privacy" class="tab-content hidden">
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🛡️</span>
            <strong style="color: #34d399; font-size: 13px;">100% Local-First & Zero External Telemetry</strong>
          </div>
          <p style="margin: 6px 0 0; color: #cbd5e1; font-size: 12px; line-height: 1.5;">
            NexTerm is designed as a private, local-first desktop application. It does not collect, track, or transmit any user telemetry, crash metrics, or server destinations. All configurations, keys, and session logs reside solely on your local workstation.
          </p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <div style="background: #11141e; border: 1px solid #1e2433; border-radius: 6px; padding: 12px;">
            <div style="font-weight: 600; font-size: 12.5px; color: #f8fafc; margin-bottom: 4px;">🔑 Credential Protection</div>
            <div style="font-size: 11.5px; color: #94a3b8; line-height: 1.4;">
              Passwords and passphrases are encrypted using native OS hardware-bound vaults (Windows DPAPI, macOS Keychain, Linux Secret Service).
            </div>
          </div>
          <div style="background: #11141e; border: 1px solid #1e2433; border-radius: 6px; padding: 12px;">
            <div style="font-weight: 600; font-size: 12.5px; color: #f8fafc; margin-bottom: 4px;">🍪 Cookie & Storage Policy</div>
            <div style="font-size: 11.5px; color: #94a3b8; line-height: 1.4;">
              Zero HTTP or tracking cookies. Browser localStorage is used strictly for storing your local UI themes and layout preferences.
            </div>
          </div>
        </div>

        <div style="background: #11141e; border: 1px solid #1e2433; border-radius: 6px; padding: 12px; margin-bottom: 14px;">
          <div style="font-weight: 600; font-size: 12.5px; color: #f8fafc; margin-bottom: 6px;">📂 Local Data Storage Locations</div>
          <div style="font-family: monospace; font-size: 11px; color: #38bdf8; background: #080a10; padding: 8px 10px; border-radius: 4px; border: 1px solid #1a2030; line-height: 1.6;">
            <div>• Sessions: %APPDATA%\Nexterm\sessions.json</div>
            <div>• Tunnels: %APPDATA%\Nexterm\tunnels.json</div>
            <div>• Known Hosts: %APPDATA%\Nexterm\known_hosts</div>
            <div>• Local Logs: %APPDATA%\Nexterm\logs\</div>
          </div>
        </div>

        <div style="font-size: 11.5px; color: #94a3b8; line-height: 1.5; padding: 4px 2px;">
          Complete open-source legal documentation available in repository root:
          <div style="margin-top: 6px; font-weight: 500; color: #38bdf8;">
            📄 <b>PRIVACY.md</b> &nbsp;|&nbsp; 📋 <b>TERMS.md</b> &nbsp;|&nbsp; 🍪 <b>COOKIE_POLICY.md</b>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="cfgSave">💾 Save All Settings</button>
    </div>
  `, "modal-lg modal-settings-pro");

  async function loadKnownHostsList() {
    const container = box.querySelector("#knownHostsListContainer");
    if (!container) return;
    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetKnownHosts) {
        const entries = await window.go.main.App.GetKnownHosts();
        if (!entries || entries.length === 0) {
          container.innerHTML = `<div style="color: #94a3b8; padding: 16px; text-align: center; font-size: 12px;">No trusted hosts cached yet. Host keys are saved when you connect to SSH servers.</div>`;
          return;
        }
        let html = `
          <table class="knownhosts-table">
            <thead>
              <tr>
                <th>Host / Address</th>
                <th>Key Type</th>
                <th>Fingerprint (SHA256)</th>
                <th style="width: 60px;">Action</th>
              </tr>
            </thead>
            <tbody>
        `;
        entries.forEach((e) => {
          html += `
            <tr>
              <td><strong>${escapeHtml(e.host)}</strong></td>
              <td><span class="hostkey-badge">${escapeHtml(e.keyType || '')}</span></td>
              <td><code style="color: #38bdf8; font-size: 11px;">${escapeHtml(e.fingerprint || '')}</code></td>
              <td><button class="btn btn-danger btn-xs btn-del-knownhost" data-host="${escapeHtml(e.host)}" type="button">Delete</button></td>
            </tr>
          `;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;

        container.querySelectorAll(".btn-del-knownhost").forEach(b => {
          b.onclick = async () => {
            const h = b.dataset.host;
            if (confirm(`Remove trusted host key for "${h}"? You will be prompted with the fingerprint next time you connect.`)) {
              if (window.go && window.go.main && window.go.main.App && window.go.main.App.DeleteKnownHost) {
                await window.go.main.App.DeleteKnownHost(h, 22);
                showToast(`Removed ${h} from known_hosts`, "info");
                loadKnownHostsList();
              }
            }
          };
        });
      }
    } catch (err) {
      container.innerHTML = `<div style="color: #ef4444; padding: 12px;">Failed to load known hosts: ${escapeHtml(err)}</div>`;
    }
  }

  const btnRefKh = box.querySelector("#btnRefreshKnownHosts");
  if (btnRefKh) btnRefKh.onclick = loadKnownHostsList;

  async function loadAuditLogsList() {
    const container = box.querySelector("#auditLogListContainer");
    if (!container) return;
    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetAuditLogs) {
        const logs = await window.go.main.App.GetAuditLogs(100);
        if (!logs || logs.length === 0) {
          container.innerHTML = `<div style="color: #94a3b8; padding: 16px; text-align: center; font-size: 12px;">No audit events recorded yet. Session connections, file transfers, and policy denials will be logged here.</div>`;
          return;
        }
        let html = `
          <table class="knownhosts-table" style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
            <thead>
              <tr style="border-bottom: 1px solid #232733; color: #94a3b8; text-align: left;">
                <th style="padding: 6px 8px;">Time</th>
                <th style="padding: 6px 8px;">Action</th>
                <th style="padding: 6px 8px;">Proto</th>
                <th style="padding: 6px 8px;">Target</th>
                <th style="padding: 6px 8px;">User</th>
                <th style="padding: 6px 8px;">Result</th>
                <th style="padding: 6px 8px;">Details</th>
              </tr>
            </thead>
            <tbody>
        `;
        logs.forEach((log) => {
          let resultBadgeColor = "#10b981"; // success
          if (log.result === "DENIED") resultBadgeColor = "#f59e0b"; // denied
          else if (log.result === "FAILURE") resultBadgeColor = "#ef4444"; // failure

          const ts = log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "";

          html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
              <td style="padding: 5px 8px; color: #94a3b8; white-space: nowrap;">${escapeHtml(ts)}</td>
              <td style="padding: 5px 8px; font-weight: 600; color: #e2e8f0;">${escapeHtml(log.action || '')}</td>
              <td style="padding: 5px 8px;"><span class="hostkey-badge" style="text-transform: uppercase;">${escapeHtml(log.protocol || '-')}</span></td>
              <td style="padding: 5px 8px; color: #38bdf8; font-family: monospace;">${escapeHtml(log.host || '-')}</td>
              <td style="padding: 5px 8px; color: #cbd5e1;">${escapeHtml(log.username || '-')}</td>
              <td style="padding: 5px 8px;"><span style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; background: ${resultBadgeColor}20; color: ${resultBadgeColor}; border: 1px solid ${resultBadgeColor}40;">${escapeHtml(log.result || 'OK')}</span></td>
              <td style="padding: 5px 8px; color: #94a3b8; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(log.details || '')}">${escapeHtml(log.details || '')}</td>
            </tr>
          `;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
      }
    } catch (err) {
      container.innerHTML = `<div style="color: #ef4444; padding: 12px;">Failed to load audit logs: ${escapeHtml(err)}</div>`;
    }
  }

  const btnExpCsv = box.querySelector("#btnExportAuditCSV");
  if (btnExpCsv) {
    btnExpCsv.onclick = async () => {
      try {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.ExportAuditLogsCSV) {
          const path = await window.go.main.App.ExportAuditLogsCSV();
          if (path) {
            showToast(`Audit log exported to: ${path}`, "success");
          }
        }
      } catch (err) {
        showToast("Export failed: " + err, "error");
      }
    };
  }

  const btnExpJson = box.querySelector("#btnExportAuditJSON");
  if (btnExpJson) {
    btnExpJson.onclick = async () => {
      try {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.ExportAuditLogsJSON) {
          const path = await window.go.main.App.ExportAuditLogsJSON();
          if (path) {
            showToast(`Audit log exported to: ${path}`, "success");
          }
        }
      } catch (err) {
        showToast("Export failed: " + err, "error");
      }
    };
  }

  const btnRefAudit = box.querySelector("#btnRefreshAudit");
  if (btnRefAudit) btnRefAudit.onclick = loadAuditLogsList;

  const btnClrAudit = box.querySelector("#btnClearAudit");
  if (btnClrAudit) {
    btnClrAudit.onclick = async () => {
      if (confirm("Are you sure you want to clear the audit log? This cannot be undone.")) {
        try {
          if (window.go && window.go.main && window.go.main.App && window.go.main.App.ClearAuditLogs) {
            await window.go.main.App.ClearAuditLogs();
            showToast("Audit logs cleared", "info");
            loadAuditLogsList();
          }
        } catch (err) {
          showToast("Failed to clear audit logs: " + err, "error");
        }
      }
    };
  }

  // --- AI Knowledge Base Management ---
  let activeFolderFilter = "all";
  let pendingReplaceFileId = null;

  function renderAiKnowledgeUI() {
    const summary = getKnowledgeSummary();
    const files = getKnowledgeFiles();
    const folders = getKnowledgeFolders();

    // 1. Quota meta & progress bar
    const quotaText = box.querySelector("#aiQuotaText");
    const quotaFill = box.querySelector("#aiQuotaBarFill");
    if (quotaText) {
      quotaText.textContent = `${summary.total} / ${summary.max} files`;
      if (summary.isFull) {
        quotaText.style.color = "#ef4444";
      } else if (summary.total >= summary.max - 3) {
        quotaText.style.color = "#f59e0b";
      } else {
        quotaText.style.color = "#38bdf8";
      }
    }
    if (quotaFill) {
      const pct = Math.min(100, Math.round((summary.total / summary.max) * 100));
      quotaFill.style.width = `${pct}%`;
      if (summary.isFull) {
        quotaFill.style.background = "#ef4444";
      } else if (pct >= 80) {
        quotaFill.style.background = "#f59e0b";
      } else {
        quotaFill.style.background = "linear-gradient(90deg, #0284c7, #38bdf8)";
      }
    }

    // 2. Render folder filter chips
    const folderChipsContainer = box.querySelector("#aiFolderFilterChips");
    if (folderChipsContainer) {
      let chipsHtml = `
        <button class="ai-folder-chip ${activeFolderFilter === 'all' ? 'active' : ''}" data-folder="all" type="button">
          <span>All Files</span>
          <span class="ai-chip-count">${files.length}</span>
        </button>
      `;

      folders.forEach(f => {
        const count = files.filter(item => item.folder === f).length;
        const isSelected = activeFolderFilter === f;
        const canDelete = f !== "General";
        chipsHtml += `
          <div class="ai-folder-chip-wrap">
            <button class="ai-folder-chip ${isSelected ? 'active' : ''}" data-folder="${escapeHtml(f)}" type="button">
              <span>📁 ${escapeHtml(f)}</span>
              <span class="ai-chip-count">${count}</span>
            </button>
            ${canDelete ? `<button class="ai-del-folder-btn" data-folder="${escapeHtml(f)}" type="button" title="Delete folder (files will move to General)">&times;</button>` : ""}
          </div>
        `;
      });

      folderChipsContainer.innerHTML = chipsHtml;

      folderChipsContainer.querySelectorAll(".ai-folder-chip").forEach(btn => {
        btn.onclick = () => {
          activeFolderFilter = btn.dataset.folder;
          renderAiKnowledgeUI();
        };
      });

      folderChipsContainer.querySelectorAll(".ai-del-folder-btn").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const targetFolder = btn.dataset.folder;
          if (confirm(`Delete folder "${targetFolder}"? Any files inside will be moved to "General".`)) {
            try {
              deleteFolder(targetFolder);
              if (activeFolderFilter === targetFolder) activeFolderFilter = "all";
              showToast(`Folder "${targetFolder}" removed`, "info");
              renderAiKnowledgeUI();
            } catch (err) {
              showToast(err.message, "error");
            }
          }
        };
      });
    }

    // 3. Render files list
    const listContainer = box.querySelector("#aiFilesListContainer");
    if (listContainer) {
      const filteredFiles = activeFolderFilter === "all"
        ? files
        : files.filter(f => f.folder === activeFolderFilter);

      if (filteredFiles.length === 0) {
        listContainer.innerHTML = `
          <div class="ai-kb-empty-state">
            <div style="font-size: 26px; margin-bottom: 6px;">📂</div>
            <div style="font-weight: 600; color: #e2e8f0; margin-bottom: 4px;">No files found ${activeFolderFilter !== 'all' ? `in "${escapeHtml(activeFolderFilter)}"` : ''}</div>
            <div style="font-size: 11.5px; color: #94a3b8;">Upload presentations (.pptx), PDFs, JSON, or configs. Maximum 20 files.</div>
          </div>
        `;
        return;
      }

      listContainer.innerHTML = filteredFiles.map(file => {
        const fileExt = (file.type || "file").toLowerCase();
        let badgeColor = "#64748b";
        if (fileExt === "pptx") badgeColor = "#ea580c";
        else if (fileExt === "pdf") badgeColor = "#dc2626";
        else if (fileExt === "json") badgeColor = "#0284c7";
        else if (fileExt === "txt" || fileExt === "log") badgeColor = "#059669";
        else if (fileExt === "doc" || fileExt === "docx") badgeColor = "#4f46e5";

        return `
          <div class="ai-file-card" data-fid="${file.id}">
            <div class="ai-file-card-main">
              <div class="ai-file-icon-col">
                <span class="ai-type-badge" style="background: ${badgeColor}25; color: ${badgeColor}; border: 1px solid ${badgeColor}50;">
                  ${escapeHtml(fileExt.toUpperCase())}
                </span>
              </div>
              <div class="ai-file-info-col">
                <div class="ai-file-title-row">
                  <span class="ai-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                  <select class="ai-file-folder-select" data-fid="${file.id}" title="Change folder">
                    ${folders.map(f => `<option value="${escapeHtml(f)}" ${file.folder === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join("")}
                  </select>
                </div>
                <div class="ai-file-meta-row">
                  <span class="ai-file-size">${escapeHtml(file.size)}</span>
                  <span class="ai-meta-dot">•</span>
                  <span class="ai-file-time">${escapeHtml(file.uploadedAt)}</span>
                  ${file.isDefault ? `<span class="ai-default-pill">Pre-loaded</span>` : ""}
                </div>
                <div class="ai-file-summary-row">${escapeHtml(file.summary || "")}</div>
              </div>
            </div>
            <div class="ai-file-card-actions">
              <button class="btn btn-secondary btn-xs btn-update-file" data-fid="${file.id}" type="button" title="Replace file content or metadata">
                🔄 Update
              </button>
              <button class="btn btn-danger btn-xs btn-del-file" data-fid="${file.id}" data-name="${escapeHtml(file.name)}" type="button" title="Delete file">
                🗑️ Delete
              </button>
            </div>
          </div>
        `;
      }).join("");

      // Bind folder selection dropdowns
      listContainer.querySelectorAll(".ai-file-folder-select").forEach(sel => {
        sel.onchange = () => {
          const fid = sel.dataset.fid;
          const newFolder = sel.value;
          updateKnowledgeFile(fid, { folder: newFolder });
          showToast(`Moved file to "${newFolder}"`, "info");
          renderAiKnowledgeUI();
        };
      });

      // Bind update/replace file button
      listContainer.querySelectorAll(".btn-update-file").forEach(btn => {
        btn.onclick = () => {
          pendingReplaceFileId = btn.dataset.fid;
          const replaceInput = box.querySelector("#aiReplaceFileInput");
          if (replaceInput) {
            replaceInput.value = "";
            replaceInput.click();
          }
        };
      });

      // Bind delete file button
      listContainer.querySelectorAll(".btn-del-file").forEach(btn => {
        btn.onclick = () => {
          const fid = btn.dataset.fid;
          const fname = btn.dataset.name;
          if (confirm(`Remove "${fname}" from AI Knowledge Base? The AI Assistant will no longer use it for grounding.`)) {
            deleteKnowledgeFile(fid);
            showToast(`Deleted ${fname}`, "info");
            renderAiKnowledgeUI();
          }
        };
      });
    }
  }

  // Bind AI Toolbar actions (Upload, Replace, New Folder)
  const btnAiUpload = box.querySelector("#btnAiUploadFile");
  const aiFileInput = box.querySelector("#aiFileInput");
  const aiReplaceFileInput = box.querySelector("#aiReplaceFileInput");
  const btnAiAddFolder = box.querySelector("#btnAiAddFolder");

  if (btnAiUpload && aiFileInput) {
    btnAiUpload.onclick = () => {
      const summary = getKnowledgeSummary();
      if (summary.isFull) {
        showToast("Storage quota reached: Maximum 20 knowledge files allowed. Delete existing files first.", "warning");
        return;
      }
      aiFileInput.value = "";
      aiFileInput.click();
    };

    aiFileInput.onchange = async () => {
      const selected = Array.from(aiFileInput.files || []);
      if (selected.length === 0) return;

      const summary = getKnowledgeSummary();
      const remainingQuota = summary.remaining;
      if (remainingQuota <= 0) {
        showToast("Knowledge storage limit reached: Maximum 20 files allowed.", "warning");
        return;
      }

      const filesToProcess = selected.slice(0, remainingQuota);
      if (selected.length > remainingQuota) {
        showToast(`Only ${remainingQuota} file(s) uploaded to keep within the 20-file limit.`, "warning");
      }

      for (const file of filesToProcess) {
        try {
          const ext = (file.name.split('.').pop() || "txt").toLowerCase();
          const isTextLike = ["txt", "json", "log", "md", "csv", "xml", "conf", "yaml", "yml"].includes(ext);
          let content = "";
          if (isTextLike) {
            content = await file.text();
          } else {
            content = `[${ext.toUpperCase()} File: ${file.name}, Size: ${formatFileSize(file.size)}]`;
          }

          addKnowledgeFile({
            name: file.name,
            folder: activeFolderFilter !== "all" ? activeFolderFilter : "General",
            type: ext,
            size: formatFileSize(file.size),
            sizeBytes: file.size,
            content: content
          });
        } catch (err) {
          console.error("Failed to read file:", file.name, err);
        }
      }

      showToast(`Uploaded ${filesToProcess.length} file(s) to AI Knowledge Base`, "success");
      renderAiKnowledgeUI();
    };
  }

  if (aiReplaceFileInput) {
    aiReplaceFileInput.onchange = async () => {
      const file = aiReplaceFileInput.files?.[0];
      if (!file || !pendingReplaceFileId) return;

      try {
        const ext = (file.name.split('.').pop() || "txt").toLowerCase();
        const isTextLike = ["txt", "json", "log", "md", "csv", "xml", "conf", "yaml", "yml"].includes(ext);
        let content = "";
        if (isTextLike) {
          content = await file.text();
        } else {
          content = `[${ext.toUpperCase()} File: ${file.name}, Size: ${formatFileSize(file.size)}]`;
        }

        updateKnowledgeFile(pendingReplaceFileId, {
          name: file.name,
          type: ext,
          size: formatFileSize(file.size),
          sizeBytes: file.size,
          content: content
        });
        showToast(`Updated file with "${file.name}"`, "success");
        pendingReplaceFileId = null;
        renderAiKnowledgeUI();
      } catch (err) {
        showToast("Failed to update file: " + err.message, "error");
      }
    };
  }

  if (btnAiAddFolder) {
    btnAiAddFolder.onclick = () => {
      const name = prompt("Enter new folder name (e.g. Architecture, Presentations, Specs):");
      if (name && name.trim()) {
        try {
          addFolder(name.trim());
          activeFolderFilter = name.trim();
          showToast(`Created folder "${name.trim()}"`, "success");
          renderAiKnowledgeUI();
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    };
  }

  // Tab switching inside modal
  box.querySelectorAll(".modal-tab-btn").forEach(btn => {
    btn.onclick = () => {
      box.querySelectorAll(".modal-tab-btn").forEach(b => b.classList.remove("active"));
      box.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      btn.classList.add("active");
      const target = box.querySelector(`#${btn.dataset.tab}`);
      if (target) target.classList.remove("hidden");
      if (btn.dataset.tab === "tab-settings-knownhosts") {
        loadKnownHostsList();
      } else if (btn.dataset.tab === "tab-settings-audit") {
        loadAuditLogsList();
      } else if (btn.dataset.tab === "tab-settings-ai") {
        renderAiKnowledgeUI();
      } else if (btn.dataset.tab === "tab-settings-pwd") {
        refreshVaultView();
      }
    };
  });

  // Activate requested initialTab if provided
  if (initialTab && initialTab !== "tab-settings-term") {
    const targetBtn = box.querySelector(`.modal-tab-btn[data-tab="${initialTab}"]`);
    if (targetBtn) {
      targetBtn.click();
    }
  }

  // Load Security Policy from Go backend
  if (window.go && window.go.main && window.go.main.App) {
    try {
      const pol = await window.go.main.App.GetSecurityPolicy();
      if (pol) {
        if (box.querySelector("#secSSH")) box.querySelector("#secSSH").checked = pol.allowSSH !== false;
        if (box.querySelector("#secSFTP")) box.querySelector("#secSFTP").checked = pol.allowSFTP !== false;
        if (box.querySelector("#secRDP")) box.querySelector("#secRDP").checked = pol.allowRDP !== false;
        if (box.querySelector("#secSerial")) box.querySelector("#secSerial").checked = pol.allowSerial !== false;
        if (box.querySelector("#secVNC")) box.querySelector("#secVNC").checked = pol.allowVNC !== false;
        if (box.querySelector("#secTelnet")) box.querySelector("#secTelnet").checked = !!pol.allowTelnet;
        if (box.querySelector("#secPwdSave")) box.querySelector("#secPwdSave").checked = pol.allowPasswordSaving !== false;
        if (box.querySelector("#secClipboard")) box.querySelector("#secClipboard").checked = pol.allowClipboardSharing !== false;
        if (box.querySelector("#secTransfers")) box.querySelector("#secTransfers").checked = pol.allowFileTransfers !== false;
        if (box.querySelector("#secAudit")) box.querySelector("#secAudit").checked = !!pol.requireAuditLog;
      }
    } catch (_) {}

    try {
      const cust = await window.go.main.App.GetCustomizerConfig();
      if (cust) {
        if (box.querySelector("#custAppTitle") && cust.appName) box.querySelector("#custAppTitle").value = cust.appName;
        if (box.querySelector("#custCompany") && cust.companyName) box.querySelector("#custCompany").value = cust.companyName;
        if (box.querySelector("#custSplash") && cust.splashMessage) box.querySelector("#custSplash").value = cust.splashMessage;
        if (box.querySelector("#custDefaultPort") && cust.defaultSSHPort) box.querySelector("#custDefaultPort").value = cust.defaultSSHPort;
        if (box.querySelector("#custDefaultTheme") && cust.defaultTheme) box.querySelector("#custDefaultTheme").value = cust.defaultTheme;
      }
    } catch (_) {}
  }

  // =========================================================================
  // Passwords & Vault Protection Management
  // =========================================================================
  let isVaultUnlocked = false; // session unlock state
  let selectedGenLength = 16;

  // Standalone Generator Fallback
  const generatePasswordFallback = (length = 16, includeSymbols = true) => {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*()-_=+[]{}<>";
    let chars = letters + numbers;
    if (includeSymbols) chars += symbols;
    const array = new Uint32Array(length);
    window.crypto.getRandomValues(array);
    let res = "";
    for (let i = 0; i < length; i++) {
      res += chars[array[i] % chars.length];
    }
    return res;
  };

  const calculatePasswordStrength = (pwd) => {
    if (!pwd || pwd.length === 0) return { score: 0, text: "Enter a password", width: "0%", color: "#64748b" };
    if (pwd.length < 4) return { score: 1, text: "Too short (min 4 chars)", width: "15%", color: "#ef4444" };
    let points = 0;
    if (pwd.length >= 8) points++;
    if (pwd.length >= 12) points++;
    if (pwd.length >= 16) points++;
    if (/[a-z]/.test(pwd)) points++;
    if (/[A-Z]/.test(pwd)) points++;
    if (/[0-9]/.test(pwd)) points++;
    if (/[^a-zA-Z0-9]/.test(pwd)) points++;

    if (points <= 3) {
      return { score: 2, text: "Weak password", width: "35%", color: "#f87171" };
    } else if (points <= 5) {
      return { score: 3, text: "Moderate strength", width: "65%", color: "#fbbf24" };
    } else if (points === 6) {
      return { score: 4, text: "Strong password", width: "85%", color: "#38bdf8" };
    } else {
      return { score: 5, text: "Very Strong (Maximum entropy)", width: "100%", color: "#34d399" };
    }
  };

  const triggerGeneratePassword = async () => {
    const incSymbols = box.querySelector("#genSymbols") ? box.querySelector("#genSymbols").checked : true;
    let pwd = "";
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.GenerateSecurePassword) {
      try {
        pwd = await window.go.main.App.GenerateSecurePassword(selectedGenLength, incSymbols);
      } catch (_) {}
    }
    if (!pwd) {
      pwd = generatePasswordFallback(selectedGenLength, incSymbols);
    }
    const out = box.querySelector("#genOutput");
    if (out) out.value = pwd;
    return pwd;
  };

  const handleShowHint = async () => {
    const hintBox = box.querySelector("#vaultLockHintBox");
    const hintContent = box.querySelector("#vaultHintContent");
    if (!hintBox) return;

    // Toggle off if already open
    if (!hintBox.classList.contains("hidden")) {
      hintBox.classList.add("hidden");
      return;
    }

    let hint = "";
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetMasterPasswordHint) {
      try {
        hint = await window.go.main.App.GetMasterPasswordHint();
      } catch (err) {
        showToast("Failed to fetch password hint: " + err, "error");
        return;
      }
    }

    if (hint && hint.trim()) {
      if (hintContent) {
        hintContent.innerHTML = `
          <div class="recovery-hint-quote">
            <span class="quote-symbol">“</span>
            <span class="quote-text">${escapeHtml(hint.trim())}</span>
            <span class="quote-symbol">”</span>
          </div>
          <div class="recovery-hint-subtext">This memory hint was configured when the master password was set.</div>
        `;
      }
    } else {
      if (hintContent) {
        hintContent.innerHTML = `
          <div class="recovery-no-hint">
            <span class="no-hint-icon">ℹ️</span>
            <span>No password memory hint was configured during setup.</span>
          </div>
        `;
      }
    }
    hintBox.classList.remove("hidden");
  };

  const handleRemoveProtection = async () => {
    const pwd = prompt("Enter your current Master Password to remove protection:");
    if (pwd === null) return;
    if (!pwd.trim()) {
      showToast("Current password is required to remove protection", "warning");
      return;
    }
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.RemoveMasterPassword) {
      try {
        await window.go.main.App.RemoveMasterPassword(pwd.trim());
        isVaultUnlocked = true;
        showToast("Master password protection removed. Vault is now unprotected.", "info");
        await refreshVaultView();
      } catch (err) {
        showToast("Failed to remove master password: " + err, "error");
      }
    }
  };

  let cachedVaultCreds = [];
  let vaultFilterQuery = "";
  let selectedDrawerGenLength = 16;

  // Render vault cards from cached credentials
  const renderVaultList = () => {
    const listContainer = box.querySelector("#pwdVaultList");
    if (!listContainer) return;

    let creds = cachedVaultCreds || [];
    if (vaultFilterQuery) {
      creds = creds.filter(c =>
        (c.sessionName && c.sessionName.toLowerCase().includes(vaultFilterQuery)) ||
        (c.host && c.host.toLowerCase().includes(vaultFilterQuery)) ||
        (c.username && c.username.toLowerCase().includes(vaultFilterQuery))
      );
    }

    const countEl = box.querySelector("#vaultCredCount");
    if (countEl) {
      countEl.textContent = vaultFilterQuery
        ? `${creds.length}/${cachedVaultCreds.length}`
        : `${creds.length}`;
    }

    if (creds.length === 0) {
      if (cachedVaultCreds.length > 0 && vaultFilterQuery) {
        listContainer.innerHTML = `
          <div class="pwd-empty-state">
            🔍 No saved credentials match "<b>${escapeHtml(vaultFilterQuery)}</b>".
          </div>
        `;
      } else {
        listContainer.innerHTML = `
          <div class="pwd-empty-state">
            🔒 No saved credentials in Windows DPAPI vault.<br/>
            Connect to any SSH server and check <b>"Remember password"</b> to securely save credentials here.
          </div>
        `;
      }
      return;
    }

    listContainer.innerHTML = creds.map((c, idx) => `
      <div class="pwd-card" data-vaultkey="${escapeHtml(c.vaultKey)}">
        <div class="pwd-card-header">
          <div class="pwd-card-left">
            <div class="pwd-key-avatar">🔑</div>
            <div class="pwd-name-wrap">
              <span class="pwd-card-title">${escapeHtml(c.sessionName || c.host)}</span>
              <span class="pwd-session-type">SSH Session</span>
            </div>
          </div>
          <div class="pwd-card-badges">
            <span class="pwd-badge user-badge" title="Username">👤 ${escapeHtml(c.username || "root")}</span>
            <span class="pwd-badge host-badge" title="Host & Port">🖥️ ${escapeHtml(c.host)}:${c.port || 22}</span>
          </div>
        </div>
        <div class="pwd-card-body">
          <div class="pwd-value-wrap">
            <span class="pwd-lock-ico">🔒</span>
            <span class="pwd-masked" id="pwdMask_${idx}">••••••••••••••••</span>
            <span class="pwd-plain hidden" id="pwdPlain_${idx}">${escapeHtml(c.password)}</span>
          </div>
          <div class="pwd-actions">
            <button type="button" class="pwd-action-btn toggle-pwd-btn" data-idx="${idx}" title="Reveal or Hide Password">
              👁️ Show
            </button>
            <button type="button" class="pwd-action-btn copy-pwd-btn" data-pwd="${escapeHtml(c.password)}" title="Copy Password">
              📋 Copy
            </button>
            <button type="button" class="pwd-action-btn danger delete-pwd-btn" data-vaultkey="${escapeHtml(c.vaultKey)}" data-name="${escapeHtml(c.sessionName || c.host)}" title="Delete from Vault">
              🗑️ Delete
            </button>
          </div>
        </div>
      </div>
    `).join("");

    listContainer.querySelectorAll(".toggle-pwd-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = btn.dataset.idx;
        const maskEl = box.querySelector(`#pwdMask_${idx}`);
        const plainEl = box.querySelector(`#pwdPlain_${idx}`);
        if (!maskEl || !plainEl) return;
        const isHidden = plainEl.classList.contains("hidden");
        if (isHidden) {
          maskEl.classList.add("hidden");
          plainEl.classList.remove("hidden");
          btn.innerHTML = "🔒 Hide";
        } else {
          maskEl.classList.remove("hidden");
          plainEl.classList.add("hidden");
          btn.innerHTML = "👁️ Show";
        }
      };
    });

    listContainer.querySelectorAll(".copy-pwd-btn").forEach(btn => {
      btn.onclick = () => {
        navigator.clipboard.writeText(btn.dataset.pwd);
        showToast("Password copied to clipboard", "success");
      };
    });

    listContainer.querySelectorAll(".delete-pwd-btn").forEach(btn => {
      btn.onclick = async () => {
        if (window.go && window.go.main && window.go.main.App) {
          try {
            await window.go.main.App.DeleteSavedPassword(btn.dataset.vaultkey);
            showToast(`Removed password for "${btn.dataset.name}"`, "info");
            await loadVaultPasswords();
          } catch (err) {
            showToast("Failed to delete password: " + err, "error");
          }
        }
      };
    });
  };

  // Load vault passwords into the list
  const loadVaultPasswords = async () => {
    try {
      let creds = [];
      if (window.go && window.go.main && window.go.main.App) {
        creds = await window.go.main.App.GetSavedPasswords() || [];
      }
      cachedVaultCreds = creds;
      renderVaultList();
    } catch (_) {}
  };

  const refreshVaultView = async () => {
    const tabEl = box.querySelector("#tab-settings-pwd");
    if (!tabEl) return;

    let hasMaster = false;
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.HasMasterPassword) {
      try {
        hasMaster = await window.go.main.App.HasMasterPassword();
      } catch (err) {
        console.warn("Failed to check master password status:", err);
      }
    }

    const heroCardEl = box.querySelector("#vaultHeroCard");
    const shieldAvatarEl = box.querySelector("#vaultShieldAvatar");
    const statusTitleEl = box.querySelector("#vaultStatusTitle");
    const badgeEl = box.querySelector("#vaultStatusBadge");
    const statusTextEl = box.querySelector("#vaultStatusText");
    const actionsEl = box.querySelector("#vaultHeaderActions");
    const lockGateEl = box.querySelector("#vaultLockGate");
    const setupCardEl = box.querySelector("#vaultSetupCard");
    const changeCardEl = box.querySelector("#vaultChangeCard");
    const contentSecEl = box.querySelector("#vaultContentSection");

    if (hasMaster) {
      if (!isVaultUnlocked) {
        // Protected & Locked
        if (heroCardEl) heroCardEl.className = "vault-hero-card";
        if (shieldAvatarEl) {
          shieldAvatarEl.className = "vault-shield-avatar";
          shieldAvatarEl.innerHTML = "🔒";
        }
        if (statusTitleEl) statusTitleEl.textContent = "Vault is Protected & Locked";
        if (badgeEl) {
          badgeEl.className = "vault-pulse-dot dot-warning";
          badgeEl.innerHTML = "● Locked";
        }
        if (statusTextEl) {
          statusTextEl.textContent = "Vault is encrypted with Master Password. Unlock to manage credentials.";
        }
        if (actionsEl) {
          actionsEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-xs" id="btnHeaderShowHint" title="Show password hint">💡 Show Hint</button>
          `;
          const hBtn = actionsEl.querySelector("#btnHeaderShowHint");
          if (hBtn) hBtn.onclick = handleShowHint;
        }
        if (lockGateEl) lockGateEl.classList.remove("hidden");
        if (setupCardEl) setupCardEl.classList.add("hidden");
        if (changeCardEl) changeCardEl.classList.add("hidden");
        if (contentSecEl) contentSecEl.classList.add("hidden");
      } else {
        // Protected & Unlocked
        if (heroCardEl) heroCardEl.className = "vault-hero-card";
        if (shieldAvatarEl) {
          shieldAvatarEl.className = "vault-shield-avatar";
          shieldAvatarEl.innerHTML = "🛡️";
        }
        if (statusTitleEl) statusTitleEl.textContent = "Dual-Layer Hardware Vault Active";
        if (badgeEl) {
          badgeEl.className = "vault-pulse-dot";
          badgeEl.innerHTML = "● Protected";
        }
        if (statusTextEl) {
          statusTextEl.textContent = "Hardware DPAPI (CryptProtectData) + Bcrypt Master Key Gate";
        }
        if (actionsEl) {
          actionsEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-xs" id="btnHeaderShowHint" title="Show password hint">💡 Hint</button>
            <button type="button" class="btn btn-secondary btn-xs" id="btnHeaderChangePwd" title="Change master password">🔑 Change</button>
            <button type="button" class="btn btn-secondary btn-xs btn-ghost-danger" id="btnHeaderRemovePwd" title="Remove master password protection">🔓 Remove</button>
            <button type="button" class="btn btn-primary btn-xs btn-lock-vault" id="btnHeaderLockVault" title="Lock vault now">🔒 Lock Vault</button>
          `;
          const hBtn = actionsEl.querySelector("#btnHeaderShowHint");
          if (hBtn) hBtn.onclick = handleShowHint;
          const cBtn = actionsEl.querySelector("#btnHeaderChangePwd");
          if (cBtn) cBtn.onclick = () => {
            if (changeCardEl) changeCardEl.classList.toggle("hidden");
          };
          const rBtn = actionsEl.querySelector("#btnHeaderRemovePwd");
          if (rBtn) rBtn.onclick = handleRemoveProtection;
          const lBtn = actionsEl.querySelector("#btnHeaderLockVault");
          if (lBtn) lBtn.onclick = () => {
            isVaultUnlocked = false;
            showToast("Vault locked", "info");
            refreshVaultView();
          };
        }
        if (lockGateEl) lockGateEl.classList.add("hidden");
        if (setupCardEl) setupCardEl.classList.add("hidden");
        if (contentSecEl) contentSecEl.classList.remove("hidden");
        loadVaultPasswords();
      }
    } else {
      // Unprotected: prompt user to set up master password
      isVaultUnlocked = true;
      if (heroCardEl) heroCardEl.className = "vault-hero-card unprotected";
      if (shieldAvatarEl) {
        shieldAvatarEl.className = "vault-shield-avatar warning-shield";
        shieldAvatarEl.innerHTML = "⚠️";
      }
      if (statusTitleEl) statusTitleEl.textContent = "Basic Protection Only (DPAPI Hardware)";
      if (badgeEl) {
        badgeEl.className = "vault-pulse-dot dot-warning";
        badgeEl.innerHTML = "● Master Password Recommended";
      }
      if (statusTextEl) {
        statusTextEl.textContent = "Protect your stored passwords with your own Master Password.";
      }
      if (actionsEl) {
        actionsEl.innerHTML = `
          <button type="button" class="btn btn-primary btn-xs btn-lock-vault" id="btnHeaderSetupJump" title="Configure Master Password">🔒 Set Master Password</button>
        `;
        const sBtn = actionsEl.querySelector("#btnHeaderSetupJump");
        if (sBtn) sBtn.onclick = () => {
          const setupCard = box.querySelector("#vaultSetupCard");
          if (setupCard) {
            setupCard.scrollIntoView({ behavior: 'smooth' });
            box.querySelector("#newMasterPwd")?.focus();
          }
        };
      }
      if (lockGateEl) lockGateEl.classList.add("hidden");
      if (setupCardEl) setupCardEl.classList.remove("hidden");
      if (changeCardEl) changeCardEl.classList.add("hidden");
      if (contentSecEl) contentSecEl.classList.remove("hidden");
      loadVaultPasswords();
    }
  };

  // Wire up Vault Event Listeners
  const setupVaultUI = () => {
    // 1. Lock Gate Unlock
    const unlockBtn = box.querySelector("#btnVaultUnlock");
    const unlockInput = box.querySelector("#vaultUnlockPwd");
    const handleUnlockAction = async () => {
      if (!unlockInput) return;
      const pwd = unlockInput.value.trim();
      if (!pwd) {
        showToast("Please enter your master password", "warning");
        unlockInput.focus();
        return;
      }
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.VerifyMasterPassword) {
        try {
          const ok = await window.go.main.App.VerifyMasterPassword(pwd);
          if (ok) {
            isVaultUnlocked = true;
            unlockInput.value = "";
            showToast("Vault unlocked successfully!", "success");
            await refreshVaultView();
          } else {
            showToast("Incorrect master password. Please try again.", "error");
            unlockInput.classList.add("shake-error");
            setTimeout(() => unlockInput.classList.remove("shake-error"), 500);
            unlockInput.select();
          }
        } catch (err) {
          showToast("Error verifying password: " + err, "error");
        }
      }
    };
    if (unlockBtn) unlockBtn.onclick = handleUnlockAction;
    if (unlockInput) {
      unlockInput.onkeydown = (e) => {
        if (e.key === "Enter") handleUnlockAction();
      };
    }

    const lockHintBtn = box.querySelector("#btnLockShowHint");
    if (lockHintBtn) lockHintBtn.onclick = handleShowHint;

    const btnCloseRec = box.querySelector("#btnCloseRecoveryPanel");
    if (btnCloseRec) {
      btnCloseRec.onclick = () => {
        const hintBox = box.querySelector("#vaultLockHintBox");
        if (hintBox) hintBox.classList.add("hidden");
      };
    }

    const btnResetLock = box.querySelector("#btnResetMasterLock");
    if (btnResetLock) {
      btnResetLock.onclick = async () => {
        if (!confirm("⚠️ Reset Master Password Lock?\n\nThis will remove the master password lock so you can regain access and configure a new password.\n\nAll stored session credentials protected by Windows DPAPI will remain safely intact in your vault.\n\nAre you sure you want to proceed?")) {
          return;
        }
        try {
          if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResetMasterPassword) {
            await window.go.main.App.ResetMasterPassword();
          }
          isVaultUnlocked = true;
          showToast("Master password lock reset successfully! You can now access your vault.", "success");
          await refreshVaultView();
        } catch (err) {
          showToast("Failed to reset master password lock: " + err, "error");
        }
      };
    }

    // 2. Setup Password Generator Controls
    box.querySelectorAll(".btn-gen-len").forEach(b => {
      b.onclick = () => {
        box.querySelectorAll(".btn-gen-len").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        selectedGenLength = parseInt(b.dataset.len, 10) || 16;
        triggerGeneratePassword();
      };
    });

    const btnRunGen = box.querySelector("#btnRunGen");
    if (btnRunGen) btnRunGen.onclick = () => triggerGeneratePassword();

    const genSymbolsCb = box.querySelector("#genSymbols");
    if (genSymbolsCb) genSymbolsCb.onchange = () => triggerGeneratePassword();

    const btnCopyGen = box.querySelector("#btnCopyGen");
    if (btnCopyGen) {
      btnCopyGen.onclick = () => {
        const out = box.querySelector("#genOutput");
        if (out && out.value) {
          navigator.clipboard.writeText(out.value);
          showToast("Generated password copied to clipboard!", "success");
        }
      };
    }

    const btnUseGen = box.querySelector("#btnUseGen");
    if (btnUseGen) {
      btnUseGen.onclick = () => {
        const out = box.querySelector("#genOutput");
        if (!out || !out.value) return;
        const pwd = out.value;
        const newPwdInput = box.querySelector("#newMasterPwd");
        const confirmPwdInput = box.querySelector("#confirmMasterPwd");
        if (newPwdInput) {
          newPwdInput.value = pwd;
          newPwdInput.type = "text";
        }
        if (confirmPwdInput) {
          confirmPwdInput.value = pwd;
          confirmPwdInput.type = "text";
        }
        updateStrengthMeter();
        showToast("Password populated! Enter an optional hint below and click Save.", "info");
      };
    }

    // 2b. Standalone Generator Drawer in Credentials Section
    const btnToggleDrawer = box.querySelector("#btnToggleGenDrawer");
    const drawerEl = box.querySelector("#vaultGenDrawer");
    const btnCloseDrawer = box.querySelector("#btnCloseGenDrawer");

    const triggerDrawerGen = async () => {
      const incSymbols = box.querySelector("#genSymbolsDrawer") ? box.querySelector("#genSymbolsDrawer").checked : true;
      let pwd = "";
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.GenerateSecurePassword) {
        try {
          pwd = await window.go.main.App.GenerateSecurePassword(selectedDrawerGenLength, incSymbols);
        } catch (_) {}
      }
      if (!pwd) {
        pwd = generatePasswordFallback(selectedDrawerGenLength, incSymbols);
      }
      const out = box.querySelector("#genOutputDrawer");
      if (out) out.value = pwd;
      return pwd;
    };

    if (btnToggleDrawer && drawerEl) {
      btnToggleDrawer.onclick = () => {
        const isHidden = drawerEl.classList.contains("hidden");
        if (isHidden) {
          drawerEl.classList.remove("hidden");
          triggerDrawerGen();
        } else {
          drawerEl.classList.add("hidden");
        }
      };
    }
    if (btnCloseDrawer && drawerEl) {
      btnCloseDrawer.onclick = () => drawerEl.classList.add("hidden");
    }

    box.querySelectorAll(".btn-gen-len-drawer").forEach(b => {
      b.onclick = () => {
        box.querySelectorAll(".btn-gen-len-drawer").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        selectedDrawerGenLength = parseInt(b.dataset.len, 10) || 16;
        triggerDrawerGen();
      };
    });

    const btnRunGenDrawer = box.querySelector("#btnRunGenDrawer");
    if (btnRunGenDrawer) btnRunGenDrawer.onclick = () => triggerDrawerGen();

    const genSymbolsDrawerCb = box.querySelector("#genSymbolsDrawer");
    if (genSymbolsDrawerCb) genSymbolsDrawerCb.onchange = () => triggerDrawerGen();

    const btnCopyGenDrawer = box.querySelector("#btnCopyGenDrawer");
    if (btnCopyGenDrawer) {
      btnCopyGenDrawer.onclick = () => {
        const out = box.querySelector("#genOutputDrawer");
        if (out && out.value) {
          navigator.clipboard.writeText(out.value);
          showToast("Generated password copied to clipboard!", "success");
        }
      };
    }

    // 2c. Real-time Search Filter for Credentials
    const searchInput = box.querySelector("#vaultSearchInput");
    if (searchInput) {
      searchInput.oninput = (e) => {
        vaultFilterQuery = e.target.value.toLowerCase().trim();
        renderVaultList();
      };
    }

    // 3. Strength Meter & Match Validation
    const updateStrengthMeter = () => {
      const newPwdInput = box.querySelector("#newMasterPwd");
      const confirmPwdInput = box.querySelector("#confirmMasterPwd");
      const fillEl = box.querySelector("#pwdStrengthBar");
      const textEl = box.querySelector("#pwdStrengthText");
      const matchEl = box.querySelector("#pwdMatchNotice");

      const pwd = newPwdInput ? newPwdInput.value : "";
      const conf = confirmPwdInput ? confirmPwdInput.value : "";

      const st = calculatePasswordStrength(pwd);
      if (fillEl) {
        fillEl.style.width = st.width;
        fillEl.style.backgroundColor = st.color;
      }
      if (textEl) {
        textEl.textContent = st.text;
        textEl.style.color = st.color;
      }

      if (matchEl) {
        if (!conf) {
          matchEl.textContent = "";
        } else if (pwd === conf) {
          matchEl.textContent = "✓ Passwords match";
          matchEl.style.color = "#34d399";
        } else {
          matchEl.textContent = "✕ Passwords do not match";
          matchEl.style.color = "#f87171";
        }
      }
    };

    const newMasterInput = box.querySelector("#newMasterPwd");
    if (newMasterInput) newMasterInput.oninput = updateStrengthMeter;

    const confMasterInput = box.querySelector("#confirmMasterPwd");
    if (confMasterInput) confMasterInput.oninput = updateStrengthMeter;

    // 4. Set Master Password Save Button
    const btnSaveMaster = box.querySelector("#btnSaveMasterPwd");
    if (btnSaveMaster) {
      btnSaveMaster.onclick = async () => {
        const pwd = (box.querySelector("#newMasterPwd")?.value || "").trim();
        const conf = (box.querySelector("#confirmMasterPwd")?.value || "").trim();
        const hint = (box.querySelector("#newMasterHint")?.value || "").trim();

        if (pwd.length < 4) {
          showToast("Master password must be at least 4 characters long", "warning");
          box.querySelector("#newMasterPwd")?.focus();
          return;
        }
        if (pwd !== conf) {
          showToast("Master passwords do not match", "error");
          box.querySelector("#confirmMasterPwd")?.focus();
          return;
        }
        if (hint && hint.toLowerCase().includes(pwd.toLowerCase())) {
          showToast("Security risk: Your password hint cannot contain the password itself!", "warning");
          box.querySelector("#newMasterHint")?.focus();
          return;
        }

        if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetMasterPassword) {
          try {
            await window.go.main.App.SetMasterPassword(pwd, hint);
            isVaultUnlocked = true;
            showToast("Master password set! Your vault is now protected.", "success");
            await refreshVaultView();
          } catch (err) {
            showToast("Failed to set master password: " + err, "error");
          }
        }
      };
    }

    // 5. Change Master Password Panel
    const cancelChangeBtn = box.querySelector("#btnCancelChangeMaster");
    if (cancelChangeBtn) {
      cancelChangeBtn.onclick = () => {
        const cCard = box.querySelector("#vaultChangeCard");
        if (cCard) cCard.classList.add("hidden");
      };
    }

    const changeGenHelpBtn = box.querySelector("#btnChangeGenHelp");
    if (changeGenHelpBtn) {
      changeGenHelpBtn.onclick = async () => {
        const pwd = await triggerGeneratePassword();
        const chgNew = box.querySelector("#chgNewPwd");
        const chgConf = box.querySelector("#chgConfirmPwd");
        if (chgNew) { chgNew.value = pwd; chgNew.type = "text"; }
        if (chgConf) { chgConf.value = pwd; chgConf.type = "text"; }
        showToast("Generated new password filled into inputs", "info");
      };
    }

    const btnSubmitChange = box.querySelector("#btnSubmitChangeMaster");
    if (btnSubmitChange) {
      btnSubmitChange.onclick = async () => {
        const curr = (box.querySelector("#chgCurrPwd")?.value || "").trim();
        const newPwd = (box.querySelector("#chgNewPwd")?.value || "").trim();
        const conf = (box.querySelector("#chgConfirmPwd")?.value || "").trim();
        const newHint = (box.querySelector("#chgNewHint")?.value || "").trim();

        if (!curr) {
          showToast("Current master password is required", "warning");
          box.querySelector("#chgCurrPwd")?.focus();
          return;
        }
        if (newPwd.length < 4) {
          showToast("New master password must be at least 4 characters long", "warning");
          box.querySelector("#chgNewPwd")?.focus();
          return;
        }
        if (newPwd !== conf) {
          showToast("New passwords do not match", "error");
          box.querySelector("#chgConfirmPwd")?.focus();
          return;
        }

        if (window.go && window.go.main && window.go.main.App && window.go.main.App.ChangeMasterPassword) {
          try {
            await window.go.main.App.ChangeMasterPassword(curr, newPwd, newHint);
            showToast("Master password updated successfully!", "success");
            const cCard = box.querySelector("#vaultChangeCard");
            if (cCard) cCard.classList.add("hidden");
            await refreshVaultView();
          } catch (err) {
            showToast("Failed to update master password: " + err, "error");
          }
        }
      };
    }

    // 6. Eye Toggles
    const setupEyeToggle = (btnId, inputId) => {
      const btn = box.querySelector(`#${btnId}`);
      const input = box.querySelector(`#${inputId}`);
      if (btn && input) {
        btn.onclick = () => {
          if (input.type === "password") {
            input.type = "text";
            btn.textContent = "🔒";
          } else {
            input.type = "password";
            btn.textContent = "👁️";
          }
        };
      }
    };
    setupEyeToggle("btnToggleUnlockPwd", "vaultUnlockPwd");
    setupEyeToggle("btnToggleNewMasterPwd", "newMasterPwd");
    setupEyeToggle("btnToggleConfirmMasterPwd", "confirmMasterPwd");

    // 7. Refresh list button
    const btnRefVault = box.querySelector("#btnRefreshVaultList");
    if (btnRefVault) btnRefVault.onclick = () => loadVaultPasswords();
  };

  setupVaultUI();
  refreshVaultView();
  triggerGeneratePassword();

  const initialTheme = userSettings.uiTheme || userSettings.theme || "dark-modern";
  const themeSelect = box.querySelector("#cfgTheme");
  if (themeSelect) {
    themeSelect.onchange = (e) => {
      applyUITheme(e.target.value, false);
    };
  }

  // App Lock master toggle: enable/disable sub-controls in real time
  const secAppLockCb = box.querySelector("#secAppLockEnabled");
  const secAppLockSub = box.querySelector("#secAppLockSub");
  if (secAppLockCb && secAppLockSub) {
    secAppLockCb.onchange = () => {
      secAppLockSub.style.opacity = secAppLockCb.checked ? '1' : '0.45';
      secAppLockSub.style.pointerEvents = secAppLockCb.checked ? 'auto' : 'none';
    };
  }

  box.querySelector("#cfgSave").onclick = async () => {
    // 1. Terminal & UI Preferences
    const chosenTheme = box.querySelector("#cfgTheme").value || "dark-modern";
    userSettings.theme = chosenTheme;
    userSettings.uiTheme = chosenTheme;
    userSettings.fontSize = parseInt(box.querySelector("#cfgFontSize").value, 10) || 13;
    userSettings.cursorStyle = box.querySelector("#cfgCursor").value || "block";
    userSettings.fontFamily = box.querySelector("#cfgFont").value.trim() || "Cascadia Mono, Consolas, Fira Code, monospace";
    userSettings.scrollback = parseInt(box.querySelector("#cfgScrollback").value, 10) || 10000;
    userSettings.cursorBlink = box.querySelector("#cfgCursorBlink").checked;
    userSettings.rightClickPaste = box.querySelector("#cfgRightClickPaste").checked;
    userSettings.autoCopySelection = box.querySelector("#cfgAutoCopy").checked;
    userSettings.autoReconnect = box.querySelector("#cfgAutoReconnect") ? box.querySelector("#cfgAutoReconnect").checked : false;
    userSettings.reconnectAttempts = parseInt(box.querySelector("#cfgReconnectAttempts")?.value, 10) || 5;
    userSettings.reconnectDelay = parseInt(box.querySelector("#cfgReconnectDelay")?.value, 10) || 2;
    userSettings.notificationLevel = box.querySelector("#cfgNotifLevel") ? box.querySelector("#cfgNotifLevel").value : "minimal";

    applyUITheme(chosenTheme, true);

    // 2. Security Policy to Go backend
    if (window.go && window.go.main && window.go.main.App) {
      try {
        const updatedPolicy = {
          allowSSH: box.querySelector("#secSSH").checked,
          allowSFTP: box.querySelector("#secSFTP").checked,
          allowRDP: box.querySelector("#secRDP").checked,
          allowSerial: box.querySelector("#secSerial").checked,
          allowVNC: box.querySelector("#secVNC").checked,
          allowTelnet: box.querySelector("#secTelnet").checked,
          allowPasswordSaving: box.querySelector("#secPwdSave").checked,
          allowClipboardSharing: box.querySelector("#secClipboard").checked,
          allowFileTransfers: box.querySelector("#secTransfers").checked,
          requireAuditLog: box.querySelector("#secAudit").checked
        };
        await window.go.main.App.SaveSecurityPolicy(updatedPolicy);
      } catch (err) {
        console.error("Failed to save security policy:", err);
      }

      // 2b. App Lock & Idle Auto-Lock
      try {
        const lockEnabled = box.querySelector("#secAppLockEnabled")?.checked ?? true;
        setAppLockEnabled(lockEnabled);
        setLockOnStartup(box.querySelector("#secLockOnStart")?.checked ?? true);
        let idleVal = parseInt(box.querySelector("#secIdleMin")?.value, 10);
        if (isNaN(idleVal) || idleVal < 0) idleVal = 0;
        if (idleVal > 240) idleVal = 240;
        setIdleMinutes(idleVal);
      } catch (err) {
        console.error("Failed to save app lock settings:", err);
      }

      // 3. Customizer Config to Go backend
      try {
        const updatedCustomizer = {
          appName: box.querySelector("#custAppTitle").value.trim() || "NexTerm Professional",
          companyName: box.querySelector("#custCompany").value.trim() || "Enterprise IT",
          companyLogoText: "NexTerm",
          splashMessage: box.querySelector("#custSplash").value.trim(),
          defaultSSHPort: parseInt(box.querySelector("#custDefaultPort").value, 10) || 22,
          defaultTheme: box.querySelector("#custDefaultTheme").value || "dark-modern",
          defaultFontSize: userSettings.fontSize
        };
        await window.go.main.App.SaveCustomizerConfig(updatedCustomizer);

        // Update document title dynamically
        document.title = updatedCustomizer.appName;
      } catch (err) {
        console.error("Failed to save customizer:", err);
      }
    }

    // 4. Live update all open terminals
    const activeTheme = THEMES[userSettings.theme] || THEMES["dark-modern"];
    const tabs = getTabs();
    Object.values(tabs).forEach(t => {
      if (t.term) {
        t.term.options.theme = activeTheme;
        t.term.options.fontSize = userSettings.fontSize;
        t.term.options.cursorStyle = userSettings.cursorStyle;
        t.term.options.cursorBlink = userSettings.cursorBlink;
        t.term.options.fontFamily = userSettings.fontFamily;
        t.term.options.scrollback = userSettings.scrollback;
        if (t.fitAddon) {
          try { t.fitAddon.fit(); } catch (_) {}
        }
      }
    });

    hideModal();
    showToast("Settings and enterprise preferences saved successfully", "success");
  };

  const handleCancelSettings = () => {
    applyUITheme(initialTheme, false);
    hideModal();
  };
  box.querySelector("#modalCancel").onclick = handleCancelSettings;
  box.querySelector("#modalClose").onclick = handleCancelSettings;
}
