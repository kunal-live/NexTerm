// ============================================================================
// NexTerm Dynamic Planetary Showcase Engine
// Implements the high-fidelity cosmic planetary viewport and frosted glass
// telemetry card showcase for all 9 Solar System worlds:
// Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto.
// Features 3D celestial sphere rendering, atmospheric coronas, planetary rings,
// galactic nebula backgrounds, and real-time astrophysics telemetry HUD.
// ============================================================================

export const PLANETARY_DATA = {
  "planet-mercury": {
    id: "planet-mercury",
    name: "Mercury",
    epithet: "The Swift Messenger",
    code: "HERMES · SOL-I",
    icon: "☿️",
    desc: "The swiftest planet in our solar system, closest to the solar core, enduring intense thermal gradients with razor-sharp speed — just like ultra-low-latency edge nodes.",
    diameter: "4,879 km",
    moons: "0",
    type: "Terrestrial",
    distance: "57.9M km",
    accentColor: "#f59e0b",
    accentRgb: "245, 158, 11",
    corona: "rgba(245, 158, 11, 0.75)",
    coronaRgb: "245, 158, 11",
    image: "assets/planet-mercury.jpg",
    hasRings: false,
    h1Grad: "linear-gradient(90deg, #f59e0b, #fbbf24)",
    primaryGrad: "linear-gradient(135deg, #d97706, #f59e0b)",
    primaryGlow: "rgba(245, 158, 11, 0.45)",
    cardBg: "rgba(20, 16, 10, 0.72)",
    cardBorder: "rgba(245, 158, 11, 0.35)",
    cardGlow: "rgba(245, 158, 11, 0.18)",
    eyebrowColor: "#fbbf24",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(245, 158, 11, 0.35) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(200, 121, 65, 0.25) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(217, 119, 6, 0.2) 0%, transparent 60%), " +
      "linear-gradient(180deg, #090807 0%, #15120e 50%, #060504 100%)"
  },
  "planet-venus": {
    id: "planet-venus",
    name: "Venus",
    epithet: "The Morning Star",
    code: "APHRODITE · SOL-II",
    icon: "♀️",
    desc: "Earth's brilliant sister world shrouded in perpetual golden cloud canopies, built to withstand extreme supercritical pressures — just like rock-solid fault-tolerant clusters.",
    diameter: "12,104 km",
    moons: "0",
    type: "Terrestrial",
    distance: "108.2M km",
    accentColor: "#fbbf24",
    accentRgb: "251, 191, 36",
    corona: "rgba(251, 191, 36, 0.75)",
    coronaRgb: "251, 191, 36",
    image: "assets/planet-venus.jpg",
    hasRings: false,
    h1Grad: "linear-gradient(90deg, #fbbf24, #f59e0b)",
    primaryGrad: "linear-gradient(135deg, #b45309, #d97706)",
    primaryGlow: "rgba(251, 191, 36, 0.45)",
    cardBg: "rgba(22, 18, 8, 0.72)",
    cardBorder: "rgba(251, 191, 36, 0.35)",
    cardGlow: "rgba(251, 191, 36, 0.18)",
    eyebrowColor: "#fde047",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(251, 191, 36, 0.36) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(245, 158, 11, 0.26) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(217, 119, 6, 0.22) 0%, transparent 60%), " +
      "linear-gradient(180deg, #0b0904 0%, #171207 50%, #070502 100%)"
  },
  "planet-earth": {
    id: "planet-earth",
    name: "Earth",
    epithet: "The Blue Marble",
    code: "TERRA · SOL-III",
    icon: "🌍",
    desc: "The vibrant oasis of humanity, cradling oceans, continents, and life through intricate global networks — just like your distributed cloud fleet operating worldwide.",
    diameter: "12,742 km",
    moons: "1",
    type: "Terrestrial",
    distance: "149.6M km",
    accentColor: "#38bdf8",
    accentRgb: "56, 189, 248",
    corona: "rgba(56, 189, 248, 0.75)",
    coronaRgb: "56, 189, 248",
    image: "assets/planet-earth.jpg",
    hasRings: false,
    h1Grad: "linear-gradient(90deg, #38bdf8, #34d399)",
    primaryGrad: "linear-gradient(135deg, #0284c7, #10b981)",
    primaryGlow: "rgba(56, 189, 248, 0.45)",
    cardBg: "rgba(8, 18, 32, 0.72)",
    cardBorder: "rgba(56, 189, 248, 0.35)",
    cardGlow: "rgba(56, 189, 248, 0.18)",
    eyebrowColor: "#34d399",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(56, 189, 248, 0.38) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(37, 99, 235, 0.28) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(16, 185, 129, 0.22) 0%, transparent 60%), " +
      "linear-gradient(180deg, #030914 0%, #08152a 50%, #02050e 100%)"
  },
  "planet-mars": {
    id: "planet-mars",
    name: "Mars",
    epithet: "The Red Frontier",
    code: "ARES · SOL-IV",
    icon: "♂️",
    desc: "The rugged rust-hued frontier of human ambition, towering volcanoes, and unexplored canyons — symbolizing bold innovation as you deploy next-generation architectures.",
    diameter: "6,779 km",
    moons: "2",
    type: "Terrestrial",
    distance: "227.9M km",
    accentColor: "#ef4444",
    accentRgb: "239, 68, 68",
    corona: "rgba(239, 68, 68, 0.75)",
    coronaRgb: "239, 68, 68",
    image: "assets/planet-mars.jpg",
    hasRings: false,
    h1Grad: "linear-gradient(90deg, #ef4444, #f97316)",
    primaryGrad: "linear-gradient(135deg, #dc2626, #ea580c)",
    primaryGlow: "rgba(239, 68, 68, 0.45)",
    cardBg: "rgba(24, 10, 8, 0.72)",
    cardBorder: "rgba(239, 68, 68, 0.35)",
    cardGlow: "rgba(239, 68, 68, 0.18)",
    eyebrowColor: "#f87171",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(239, 68, 68, 0.36) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(249, 115, 22, 0.26) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(185, 28, 28, 0.22) 0%, transparent 60%), " +
      "linear-gradient(180deg, #0d0605 0%, #1a0b09 50%, #080302 100%)"
  },
  "planet-jupiter": {
    id: "planet-jupiter",
    name: "Jupiter",
    epithet: "The Guardian",
    code: "JOVE · SOL-V",
    icon: "♃",
    desc: "The largest planet in our solar system, symbolizing power, stability and limitless possibilities — just like your infrastructure.",
    diameter: "142,984 km",
    moons: "95+",
    type: "Gas Giant",
    distance: "778.5M km",
    accentColor: "#a855f7",
    accentRgb: "168, 85, 247",
    corona: "rgba(168, 85, 247, 0.8)",
    coronaRgb: "168, 85, 247",
    image: "assets/planet-jupiter.jpg",
    hasRings: true,
    ringTilt: -24,
    ringGradient:
      "radial-gradient(ellipse at center, transparent 48%, rgba(254, 215, 170, 0.8) 51%, rgba(234, 88, 12, 0.85) 55%, rgba(168, 85, 247, 0.55) 58%, rgba(249, 115, 22, 0.7) 63%, transparent 69%)",
    h1Grad: "linear-gradient(90deg, #a855f7, #ec4899)",
    primaryGrad: "linear-gradient(135deg, #7c3aed, #9333ea)",
    primaryGlow: "rgba(124, 58, 237, 0.45)",
    cardBg: "rgba(14, 11, 32, 0.68)",
    cardBorder: "rgba(168, 85, 247, 0.35)",
    cardGlow: "rgba(168, 85, 247, 0.18)",
    eyebrowColor: "#c084fc",
    dashboardBg:
      "radial-gradient(950px 700px at 85% 20%, rgba(168, 85, 247, 0.35) 0%, transparent 65%), " +
      "radial-gradient(800px 500px at 70% 60%, rgba(217, 70, 239, 0.22) 0%, transparent 55%), " +
      "radial-gradient(1000px 750px at 15% 15%, rgba(99, 102, 241, 0.25) 0%, transparent 60%), " +
      "radial-gradient(1200px 800px at 50% 110%, rgba(147, 51, 234, 0.2) 0%, transparent 60%), " +
      "linear-gradient(180deg, #070414 0%, #0e0722 50%, #05030e 100%)"
  },
  "planet-saturn": {
    id: "planet-saturn",
    name: "Saturn",
    epithet: "The Ringed Majesty",
    code: "CHRONOS · SOL-VI",
    icon: "♄",
    desc: "The crowning jewel of the heavens girdled by millions of crystalline ice rings in celestial equilibrium — mirroring elegant microservices orchestrated in perfect balance.",
    diameter: "120,536 km",
    moons: "146+",
    type: "Gas Giant",
    distance: "1.43B km",
    accentColor: "#facc15",
    accentRgb: "250, 204, 21",
    corona: "rgba(250, 204, 21, 0.75)",
    coronaRgb: "250, 204, 21",
    image: "assets/planet-saturn.jpg",
    hasRings: true,
    ringTilt: -24,
    ringGradient:
      "radial-gradient(ellipse at center, transparent 46%, rgba(254, 240, 138, 0.85) 49%, rgba(202, 138, 4, 0.9) 53%, rgba(10, 8, 4, 0.95) 54.5%, rgba(250, 204, 21, 0.85) 56%, rgba(234, 179, 8, 0.7) 62%, rgba(161, 98, 7, 0.45) 66%, transparent 70%)",
    h1Grad: "linear-gradient(90deg, #facc15, #f59e0b)",
    primaryGrad: "linear-gradient(135deg, #ca8a04, #eab308)",
    primaryGlow: "rgba(250, 204, 21, 0.45)",
    cardBg: "rgba(18, 16, 10, 0.72)",
    cardBorder: "rgba(250, 204, 21, 0.35)",
    cardGlow: "rgba(250, 204, 21, 0.18)",
    eyebrowColor: "#fde047",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(250, 204, 21, 0.35) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(212, 184, 120, 0.25) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(202, 138, 4, 0.2) 0%, transparent 60%), " +
      "linear-gradient(180deg, #090805 0%, #17150c 50%, #060503 100%)"
  },
  "planet-uranus": {
    id: "planet-uranus",
    name: "Uranus",
    epithet: "The Tilted Ice Giant",
    code: "OURANOS · SOL-VII",
    icon: "⛢",
    desc: "The serene aquamarine world rolling along its orbital plane with unique vertical ring systems — embodying customized architectures tailored for unconventional challenges.",
    diameter: "50,724 km",
    moons: "28+",
    type: "Ice Giant",
    distance: "2.87B km",
    accentColor: "#22d3ee",
    accentRgb: "34, 211, 238",
    corona: "rgba(34, 211, 238, 0.75)",
    coronaRgb: "34, 211, 238",
    image: "assets/planet-uranus.jpg",
    hasRings: true,
    ringTilt: -82,
    ringGradient:
      "radial-gradient(ellipse at center, transparent 48%, rgba(165, 243, 252, 0.85) 52%, rgba(6, 182, 212, 0.65) 58%, transparent 64%)",
    h1Grad: "linear-gradient(90deg, #22d3ee, #38bdf8)",
    primaryGrad: "linear-gradient(135deg, #0891b2, #06b6d4)",
    primaryGlow: "rgba(34, 211, 238, 0.45)",
    cardBg: "rgba(8, 18, 24, 0.72)",
    cardBorder: "rgba(34, 211, 238, 0.35)",
    cardGlow: "rgba(34, 211, 238, 0.18)",
    eyebrowColor: "#67e8f9",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(34, 211, 238, 0.35) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(96, 192, 200, 0.25) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(6, 182, 212, 0.2) 0%, transparent 60%), " +
      "linear-gradient(180deg, #04090e 0%, #0a1720 50%, #020609 100%)"
  },
  "planet-neptune": {
    id: "planet-neptune",
    name: "Neptune",
    epithet: "The Mystic Voyager",
    code: "POSEIDON · SOL-VIII",
    icon: "♆",
    desc: "The supersonic sapphire ice giant patrolling the distant reaches with supersonic winds and deep vortices — guarding the outer perimeters of your secure server fleet.",
    diameter: "49,244 km",
    moons: "16+",
    type: "Ice Giant",
    distance: "4.50B km",
    accentColor: "#3b82f6",
    accentRgb: "59, 130, 246",
    corona: "rgba(59, 130, 246, 0.75)",
    coronaRgb: "59, 130, 246",
    image: "assets/planet-neptune.jpg",
    hasRings: true,
    ringTilt: -26,
    ringGradient:
      "radial-gradient(ellipse at center, transparent 48%, rgba(96, 165, 250, 0.75) 53%, rgba(37, 99, 235, 0.6) 60%, transparent 67%)",
    h1Grad: "linear-gradient(90deg, #3b82f6, #6366f1)",
    primaryGrad: "linear-gradient(135deg, #2563eb, #4f46e5)",
    primaryGlow: "rgba(59, 130, 246, 0.45)",
    cardBg: "rgba(6, 12, 28, 0.72)",
    cardBorder: "rgba(59, 130, 246, 0.35)",
    cardGlow: "rgba(59, 130, 246, 0.18)",
    eyebrowColor: "#93c5fd",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(59, 130, 246, 0.38) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(48, 112, 208, 0.28) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(99, 102, 241, 0.22) 0%, transparent 60%), " +
      "linear-gradient(180deg, #030510 0%, #070e24 50%, #02030a 100%)"
  },
  "planet-pluto": {
    id: "planet-pluto",
    name: "Pluto",
    epithet: "The Distant Pioneer",
    code: "HADES · SOL-IX",
    icon: "♇",
    desc: "The intrepid outpost at the frontier of the solar system with a heart of nitrogen glaciers — proving that lean, resilient microservices can achieve monumental impact.",
    diameter: "2,376 km",
    moons: "5",
    type: "Dwarf Planet",
    distance: "5.90B km",
    accentColor: "#c084fc",
    accentRgb: "192, 132, 252",
    corona: "rgba(192, 132, 252, 0.75)",
    coronaRgb: "192, 132, 252",
    image: "assets/planet-pluto.jpg",
    hasRings: false,
    h1Grad: "linear-gradient(90deg, #c084fc, #f472b6)",
    primaryGrad: "linear-gradient(135deg, #9333ea, #c026d3)",
    primaryGlow: "rgba(192, 132, 252, 0.45)",
    cardBg: "rgba(16, 12, 26, 0.72)",
    cardBorder: "rgba(192, 132, 252, 0.35)",
    cardGlow: "rgba(192, 132, 252, 0.18)",
    eyebrowColor: "#e879f9",
    dashboardBg:
      "radial-gradient(1000px 650px at 85% 15%, rgba(192, 132, 252, 0.35) 0%, transparent 65%), " +
      "radial-gradient(850px 520px at 20% 20%, rgba(147, 51, 234, 0.25) 0%, transparent 55%), " +
      "radial-gradient(1100px 700px at 50% 115%, rgba(217, 70, 239, 0.2) 0%, transparent 60%), " +
      "linear-gradient(180deg, #070511 0%, #120e23 50%, #05040d 100%)"
  }
};

export const PLANET_KEYS = [
  "planet-mercury",
  "planet-venus",
  "planet-earth",
  "planet-mars",
  "planet-jupiter",
  "planet-saturn",
  "planet-uranus",
  "planet-neptune",
  "planet-pluto"
];

let currentActiveTheme = null;
let heroArtContainer = null;
let planetCardEl = null;
let isInitialized = false;

/**
 * Initializes the Planetary Hero Viewport and Interactive Card Showcase.
 */
export function initPlanetHero() {
  if (isInitialized) return;
  heroArtContainer = document.querySelector(".nx-hero-art");
  if (!heroArtContainer) return;

  // Render the glassmorphic Planetary Showcase Card
  heroArtContainer.innerHTML = `
    <div class="nx-planet-card" id="nxPlanetCard">
      <!-- Left Column: Header, Epithet, Infrastructure Metaphor, Action Buttons -->
      <div class="nx-planet-card-main">
        <div class="nx-planet-header">
          <span class="nx-planet-dot" id="nxPlanetDot"></span>
          <h2 class="nx-planet-title" id="nxPlanetTitle">Jupiter</h2>
        </div>
        <div class="nx-planet-epithet" id="nxPlanetEpithet">The Guardian</div>
        <p class="nx-planet-desc" id="nxPlanetDesc">
          The largest planet in our solar system, symbolizing power, stability and limitless possibilities — just like your infrastructure.
        </p>
        <div class="nx-planet-actions">
          <button class="nx-planet-explore-btn" id="nxPlanetExploreBtn" type="button" title="Explore next planet in the Solar System">
            <span>Explore Space</span>
            <svg class="nx-btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
          <div class="nx-planet-quick-nav">
            <button class="nx-pnav-btn" id="nxPlanetPrevBtn" type="button" title="Previous Planet">‹</button>
            <span class="nx-pnav-index" id="nxPlanetNavIndex">5 / 9</span>
            <button class="nx-pnav-btn" id="nxPlanetNextBtn" type="button" title="Next Planet">›</button>
          </div>
        </div>
      </div>

      <!-- Right Column: 4 Telemetry Stats (Diameter, Moons, Type, Distance from Sun) -->
      <div class="nx-planet-stats-grid">
        <div class="nx-pstat-box">
          <div class="nx-pstat-label">DIAMETER</div>
          <div class="nx-pstat-val" id="nxPstatDiameter">142,984 km</div>
        </div>
        <div class="nx-pstat-box">
          <div class="nx-pstat-label">MOONS</div>
          <div class="nx-pstat-val" id="nxPstatMoons">95+</div>
        </div>
        <div class="nx-pstat-box">
          <div class="nx-pstat-label">TYPE</div>
          <div class="nx-pstat-val" id="nxPstatType">Gas Giant</div>
        </div>
        <div class="nx-pstat-box">
          <div class="nx-pstat-label">DISTANCE FROM SUN</div>
          <div class="nx-pstat-val" id="nxPstatDistance">778.5M km</div>
        </div>
      </div>
    </div>
  `;

  planetCardEl = heroArtContainer.querySelector("#nxPlanetCard");
  const exploreBtn = heroArtContainer.querySelector("#nxPlanetExploreBtn");
  const prevBtn = heroArtContainer.querySelector("#nxPlanetPrevBtn");
  const nextBtn = heroArtContainer.querySelector("#nxPlanetNextBtn");

  // Cycle to next planet on "Explore Space"
  if (exploreBtn) {
    exploreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cyclePlanet(1);
    });
  }

  // Quick navigation arrows
  if (prevBtn) {
    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cyclePlanet(-1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cyclePlanet(1);
    });
  }

  // Subtle 3D mouse parallax tracking
  const dashboard = document.getElementById("welcomeState");
  if (dashboard) {
    dashboard.addEventListener("mousemove", handleDashboardParallax, { passive: true });
    dashboard.addEventListener("mouseleave", handleDashboardMouseLeave, { passive: true });
  }

  isInitialized = true;

  // Apply current theme
  const initialTheme = document.documentElement.getAttribute("data-theme") || "planet-jupiter";
  updatePlanetHero(initialTheme);
}

/**
 * Cycles to the next or previous planet in sequence and applies the theme.
 */
function cyclePlanet(direction = 1) {
  let curIndex = PLANET_KEYS.indexOf(currentActiveTheme);
  if (curIndex === -1) {
    // If current theme is not a planet, default to Jupiter
    curIndex = PLANET_KEYS.indexOf("planet-jupiter");
  }
  let nextIndex = (curIndex + direction + PLANET_KEYS.length) % PLANET_KEYS.length;
  switchPlanetTheme(PLANET_KEYS[nextIndex]);
}

/**
 * Switches the global UI theme to the specified planet theme.
 */
function switchPlanetTheme(planetKey) {
  if (window.__applyUITheme && typeof window.__applyUITheme === "function") {
    window.__applyUITheme(planetKey, true);
  } else {
    updatePlanetHero(planetKey);
  }
}

/**
 * 3D Parallax tracking when mouse hovers over the dashboard.
 */
function handleDashboardParallax(e) {
  const orb = document.getElementById("planetCelestialOrb");
  const rings = document.getElementById("planetCelestialRings");
  const card = document.getElementById("nxPlanetCard");
  if (!orb) return;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const xRatio = (e.clientX / w) - 0.5;
  const yRatio = (e.clientY / h) - 0.5;

  orb.style.transform = `translate3d(${-xRatio * 18}px, ${-yRatio * 18}px, 0) scale(1.02)`;
  if (rings) {
    rings.style.transform = `translate3d(${-xRatio * 24}px, ${-yRatio * 24}px, 0) rotate(${rings.dataset.tilt || -24}deg) scale(1.02)`;
  }
  if (card) {
    card.style.transform = `translate3d(${xRatio * 6}px, ${yRatio * 6}px, 0)`;
  }
}

function handleDashboardMouseLeave() {
  const orb = document.getElementById("planetCelestialOrb");
  const rings = document.getElementById("planetCelestialRings");
  const card = document.getElementById("nxPlanetCard");
  if (orb) orb.style.transform = "translate3d(0, 0, 0) scale(1.0)";
  if (rings) rings.style.transform = `translate3d(0, 0, 0) rotate(${rings.dataset.tilt || -24}deg) scale(1.0)`;
  if (card) card.style.transform = "translate3d(0, 0, 0)";
}

/**
 * Updates the Planetary Hero Viewport and Card contents based on active theme.
 */
export function updatePlanetHero(themeKey) {
  if (!isInitialized) {
    initPlanetHero();
  }
  if (!heroArtContainer) return;

  currentActiveTheme = themeKey;
  const data = PLANETARY_DATA[themeKey];

  const dashboard = document.getElementById("welcomeState");
  const scene = document.getElementById("planetViewportScene");
  const orb = document.getElementById("planetCelestialOrb");
  const rings = document.getElementById("planetCelestialRings");
  const coronaRim = document.getElementById("planetAtmosphereCorona");
  const ambientBackdrop = document.getElementById("planetAmbientBackdrop");

  const titleEl = heroArtContainer.querySelector("#nxPlanetTitle");
  const epithetEl = heroArtContainer.querySelector("#nxPlanetEpithet");
  const descEl = heroArtContainer.querySelector("#nxPlanetDesc");
  const dotEl = heroArtContainer.querySelector("#nxPlanetDot");
  const navIndexEl = heroArtContainer.querySelector("#nxPlanetNavIndex");

  const pstatDiameter = heroArtContainer.querySelector("#nxPstatDiameter");
  const pstatMoons = heroArtContainer.querySelector("#nxPstatMoons");
  const pstatType = heroArtContainer.querySelector("#nxPstatType");
  const pstatDistance = heroArtContainer.querySelector("#nxPstatDistance");

  if (data) {
    // 1. Planetary Theme Active
    heroArtContainer.classList.add("planet-mode-active");

    // Set dynamic CSS properties on root & dashboard
    const root = document.documentElement;
    root.style.setProperty("--planet-accent", data.accentColor);
    root.style.setProperty("--planet-accent-rgb", data.accentRgb);
    root.style.setProperty("--planet-corona", data.corona);
    root.style.setProperty("--planet-h1-grad", data.h1Grad);
    root.style.setProperty("--planet-btn-grad", data.primaryGrad);
    root.style.setProperty("--planet-btn-glow", data.primaryGlow);
    root.style.setProperty("--planet-card-bg", data.cardBg);
    root.style.setProperty("--planet-card-border", data.cardBorder);
    root.style.setProperty("--planet-card-glow", data.cardGlow);
    root.style.setProperty("--planet-eyebrow", data.eyebrowColor);

    if (dashboard) {
      dashboard.style.background = data.dashboardBg;
    }

    // Update Celestial Orb
    if (scene) {
      scene.style.opacity = "1";
    }
    if (orb) {
      orb.style.backgroundImage = `url('${data.image}')`;
      orb.style.boxShadow = "none";
    }

    // Update Planetary Rings
    if (rings) {
      if (data.hasRings) {
        rings.dataset.tilt = data.ringTilt || -24;
        rings.style.background = data.ringGradient;
        rings.style.transform = `rotate(${data.ringTilt || -24}deg)`;
        rings.classList.add("has-rings");
      } else {
        rings.classList.remove("has-rings");
      }
    }

    // Update Atmospheric Corona
    if (coronaRim) {
      coronaRim.style.boxShadow = `0 0 100px 30px ${data.corona}`;
    }

    // Ambient Backdrop
    if (ambientBackdrop) {
      ambientBackdrop.style.backgroundImage = `url('${data.image}')`;
      ambientBackdrop.style.opacity = "0.45";
    }

    // Update Card Content with smooth fade
    if (planetCardEl) {
      planetCardEl.classList.remove("planet-card-pulse");
      void planetCardEl.offsetWidth;
      planetCardEl.classList.add("planet-card-pulse");
    }

    if (dotEl) {
      dotEl.style.background = data.accentColor;
      dotEl.style.boxShadow = `0 0 12px ${data.accentColor}`;
    }
    if (titleEl) titleEl.textContent = data.name;
    if (epithetEl) epithetEl.textContent = data.epithet;
    if (descEl) descEl.textContent = data.desc;

    if (pstatDiameter) pstatDiameter.textContent = data.diameter;
    if (pstatMoons) pstatMoons.textContent = data.moons;
    if (pstatType) pstatType.textContent = data.type;
    if (pstatDistance) pstatDistance.textContent = data.distance;

    // Update index e.g. "5 / 9"
    const pIdx = PLANET_KEYS.indexOf(themeKey);
    if (navIndexEl && pIdx !== -1) {
      navIndexEl.textContent = `${pIdx + 1} / ${PLANET_KEYS.length}`;
    }

  } else {
    // 2. Non-planetary Theme Active (e.g. dark-modern, catppuccin, etc.)
    heroArtContainer.classList.remove("planet-mode-active");
    if (scene) {
      scene.style.opacity = "0";
    }
    if (ambientBackdrop) {
      ambientBackdrop.style.backgroundImage = "none";
      ambientBackdrop.style.opacity = "0";
    }
    if (dashboard) {
      dashboard.style.background = "";
    }
    // Set showcase card to solar explorer callout
    if (titleEl) titleEl.textContent = "Solar System";
    if (epithetEl) epithetEl.textContent = "Planetary Collection";
    if (descEl) descEl.textContent = "Explore our 9 hyper-realistic cinematic planetary environments with orbital physics, solar telemetry and tailored terminal contrast.";
    if (dotEl) {
      dotEl.style.background = "#38bdf8";
      dotEl.style.boxShadow = "0 0 10px #38bdf8";
    }
    if (navIndexEl) navIndexEl.textContent = "Explore";
  }
}
