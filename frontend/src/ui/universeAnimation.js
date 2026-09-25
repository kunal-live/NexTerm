// ============================================================================
// NexTerm Dynamic Universe & Cosmic Particle Engine
// Mesmerizing celestial particle simulation for the Home / Welcome Dashboard.
// Features orbital rotation, Keplerian cosmic drift, stellar halos,
// dynamic constellations, volumetric nebula wisps, and shooting stars.
// ============================================================================

const THEME_PALETTES = {
  "tokyo-night": {
    stars: ["#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5", "#f7768e", "#e0af68"],
    halo: "rgba(122, 162, 247, 0.45)",
    filaments: "rgba(187, 154, 247, 0.25)",
    nebulae: [
      { color: "rgba(122, 162, 247, 0.08)", r: 160 },
      { color: "rgba(187, 154, 247, 0.08)", r: 190 },
      { color: "rgba(125, 207, 255, 0.06)", r: 140 }
    ],
    meteor: "#7dcfff"
  },
  "catppuccin-mocha": {
    stars: ["#cba6f7", "#89b4fa", "#a6e3a1", "#f9e2af", "#f5e0dc", "#cdd6f4"],
    halo: "rgba(203, 166, 247, 0.45)",
    filaments: "rgba(137, 180, 250, 0.22)",
    nebulae: [
      { color: "rgba(203, 166, 247, 0.07)", r: 170 },
      { color: "rgba(137, 180, 250, 0.07)", r: 180 },
      { color: "rgba(166, 227, 161, 0.05)", r: 130 }
    ],
    meteor: "#cba6f7"
  },
  "gruvbox-dark": {
    stars: ["#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#ebdbb2", "#d3869b"],
    halo: "rgba(254, 128, 25, 0.45)",
    filaments: "rgba(250, 189, 47, 0.22)",
    nebulae: [
      { color: "rgba(254, 128, 25, 0.07)", r: 170 },
      { color: "rgba(250, 189, 47, 0.06)", r: 180 },
      { color: "rgba(142, 192, 124, 0.05)", r: 140 }
    ],
    meteor: "#fe8019"
  },
  "rose-pine": {
    stars: ["#ebbcba", "#f6c177", "#9ccfd8", "#c4a7e7", "#e0def4", "#eb6f92"],
    halo: "rgba(235, 188, 186, 0.45)",
    filaments: "rgba(196, 167, 231, 0.24)",
    nebulae: [
      { color: "rgba(235, 188, 186, 0.08)", r: 170 },
      { color: "rgba(196, 167, 231, 0.07)", r: 180 },
      { color: "rgba(156, 207, 216, 0.06)", r: 130 }
    ],
    meteor: "#ebbcba"
  },
  "github-dark": {
    stars: ["#58a6ff", "#79c0ff", "#3fb950", "#bc8cff", "#f0f6fc", "#d29922"],
    halo: "rgba(88, 166, 255, 0.45)",
    filaments: "rgba(88, 166, 255, 0.22)",
    nebulae: [
      { color: "rgba(88, 166, 255, 0.07)", r: 170 },
      { color: "rgba(63, 185, 80, 0.05)", r: 150 },
      { color: "rgba(188, 140, 255, 0.06)", r: 140 }
    ],
    meteor: "#79c0ff"
  },
  "nord": {
    stars: ["#88c0d0", "#81a1c1", "#a3be8c", "#ebcb8b", "#eceff4", "#b48ead"],
    halo: "rgba(136, 192, 208, 0.45)",
    filaments: "rgba(129, 161, 193, 0.25)",
    nebulae: [
      { color: "rgba(136, 192, 208, 0.08)", r: 180 },
      { color: "rgba(129, 161, 193, 0.07)", r: 170 },
      { color: "rgba(163, 190, 140, 0.05)", r: 140 }
    ],
    meteor: "#88c0d0"
  },
  "dracula": {
    stars: ["#bd93f9", "#ff79c6", "#8be9fd", "#50fa7b", "#f8f8f2", "#f1fa8c"],
    halo: "rgba(189, 147, 249, 0.5)",
    filaments: "rgba(255, 121, 198, 0.25)",
    nebulae: [
      { color: "rgba(189, 147, 249, 0.08)", r: 180 },
      { color: "rgba(255, 121, 198, 0.08)", r: 170 },
      { color: "rgba(139, 233, 253, 0.06)", r: 140 }
    ],
    meteor: "#ff79c6"
  },
  "cyberpunk": {
    stars: ["#00f0ff", "#ff007f", "#ffe600", "#00ff9f", "#ffffff", "#7928ca"],
    halo: "rgba(0, 240, 255, 0.6)",
    filaments: "rgba(255, 0, 127, 0.35)",
    nebulae: [
      { color: "rgba(255, 0, 127, 0.1)", r: 180 },
      { color: "rgba(0, 240, 255, 0.1)", r: 190 },
      { color: "rgba(255, 230, 0, 0.06)", r: 130 }
    ],
    meteor: "#00f0ff"
  },
  "monokai": {
    stars: ["#a6e22e", "#f92672", "#66d9ef", "#f4bf75", "#ae81ff", "#f8f8f2"],
    halo: "rgba(166, 226, 46, 0.45)",
    filaments: "rgba(249, 38, 114, 0.22)",
    nebulae: [
      { color: "rgba(166, 226, 46, 0.07)", r: 170 },
      { color: "rgba(249, 38, 114, 0.07)", r: 180 },
      { color: "rgba(102, 217, 239, 0.06)", r: 140 }
    ],
    meteor: "#a6e22e"
  },
  "solarized-dark": {
    stars: ["#268bd2", "#2aa198", "#859900", "#b58900", "#93a1a1", "#cb4b16"],
    halo: "rgba(38, 139, 210, 0.45)",
    filaments: "rgba(42, 161, 152, 0.24)",
    nebulae: [
      { color: "rgba(38, 139, 210, 0.07)", r: 180 },
      { color: "rgba(42, 161, 152, 0.07)", r: 170 },
      { color: "rgba(181, 137, 0, 0.05)", r: 130 }
    ],
    meteor: "#2aa198"
  },
  "matrix": {
    stars: ["#00ff41", "#00cc33", "#22eb4f", "#5cff77", "#ffffff", "#00bb2f"],
    halo: "rgba(0, 255, 65, 0.55)",
    filaments: "rgba(0, 255, 65, 0.3)",
    nebulae: [
      { color: "rgba(0, 255, 65, 0.09)", r: 180 },
      { color: "rgba(0, 204, 51, 0.08)", r: 170 },
      { color: "rgba(34, 235, 79, 0.06)", r: 140 }
    ],
    meteor: "#00ff41"
  },
  "one-dark": {
    stars: ["#61afef", "#c678dd", "#98c379", "#e5c07b", "#e06c75", "#abb2bf"],
    halo: "rgba(97, 175, 239, 0.45)",
    filaments: "rgba(198, 120, 221, 0.22)",
    nebulae: [
      { color: "rgba(97, 175, 239, 0.07)", r: 170 },
      { color: "rgba(198, 120, 221, 0.06)", r: 180 },
      { color: "rgba(152, 195, 121, 0.05)", r: 130 }
    ],
    meteor: "#61afef"
  },
  "avisys-navy": {
    stars: ["#38bdf8", "#4ade80", "#22d3ee", "#f8fafc", "#818cf8", "#facc15"],
    halo: "rgba(56, 189, 248, 0.5)",
    filaments: "rgba(56, 189, 248, 0.25)",
    nebulae: [
      { color: "rgba(56, 189, 248, 0.08)", r: 180 },
      { color: "rgba(74, 222, 128, 0.05)", r: 150 },
      { color: "rgba(37, 99, 235, 0.07)", r: 170 }
    ],
    meteor: "#38bdf8"
  },
  "slack-dark": {
    stars: ["#36c5f0", "#ecb22e", "#e01e5a", "#2eb67d", "#e1e4e8", "#9c27b0"],
    halo: "rgba(54, 197, 240, 0.45)",
    filaments: "rgba(236, 178, 46, 0.22)",
    nebulae: [
      { color: "rgba(54, 197, 240, 0.07)", r: 170 },
      { color: "rgba(236, 178, 46, 0.06)", r: 180 },
      { color: "rgba(224, 30, 90, 0.05)", r: 130 }
    ],
    meteor: "#36c5f0"
  },
  "light-modern": {
    stars: ["#0284c7", "#0891b2", "#16a34a", "#d97706", "#9333ea", "#475569"],
    halo: "rgba(2, 132, 199, 0.35)",
    filaments: "rgba(2, 132, 199, 0.18)",
    nebulae: [
      { color: "rgba(2, 132, 199, 0.05)", r: 160 },
      { color: "rgba(14, 165, 233, 0.04)", r: 180 }
    ],
    meteor: "#0284c7"
  },
  "dark-modern": {
    stars: ["#38bdf8", "#818cf8", "#a855f7", "#34d399", "#f1f5f9", "#38bdf8"],
    halo: "rgba(56, 189, 248, 0.48)",
    filaments: "rgba(168, 85, 247, 0.24)",
    nebulae: [
      { color: "rgba(124, 58, 237, 0.08)", r: 180 },
      { color: "rgba(56, 189, 248, 0.08)", r: 180 },
      { color: "rgba(16, 185, 129, 0.05)", r: 140 }
    ],
    meteor: "#38bdf8"
  }
};

class Star {
  constructor(w, h) {
    this.reset(w, h, true);
  }

  reset(w, h, initial = false) {
    const maxR = Math.sqrt(w * w + h * h) * 0.65;
    // Distribution favoring middle and expansive cosmos
    this.orbitRadius = Math.pow(Math.random(), 0.65) * maxR + 15;
    this.angle = Math.random() * Math.PI * 2;
    // Keplerian orbital velocity: inner stars rotate faster, outer stars drift gracefully
    const baseSpeed = 0.00045 + (Math.random() * 0.0004);
    this.angularSpeed = (baseSpeed / (Math.sqrt(this.orbitRadius / 80) + 0.35)) * (Math.random() > 0.5 ? 1 : 1.05);

    // Subtle radial breathing oscillation
    this.radialAmp = 4 + Math.random() * 12;
    this.radialFreq = 0.0008 + Math.random() * 0.0015;
    this.radialPhase = Math.random() * Math.PI * 2;

    // 3D depth layer
    this.z = 0.15 + Math.random() * 0.85; // 0.15 = far, 1.0 = near
    this.baseRadius = (0.55 + Math.random() * 1.6) * (0.4 + this.z * 0.6);
    this.baseAlpha = (0.25 + Math.random() * 0.65) * (0.35 + this.z * 0.65);

    // Twinkling mechanics
    this.twinklePhase = Math.random() * Math.PI * 2;
    this.twinkleSpeed = 0.015 + Math.random() * 0.04;

    this.hasHalo = this.z > 0.7 && this.baseRadius > 1.25;
    this.colorIndex = Math.floor(Math.random() * 6);

    // Current coordinates
    this.x = 0;
    this.y = 0;
  }

  update(time, cx, cy, mouseOffset, scrollY, w, h) {
    this.angle += this.angularSpeed;

    // Compute dynamic radial distance with subtle cosmic breathing
    const r = this.orbitRadius + Math.sin(time * this.radialFreq + this.radialPhase) * this.radialAmp;

    // Elliptical orbital projection for natural spiral galaxy perspective
    const rawX = cx + Math.cos(this.angle) * r;
    const rawY = cy + Math.sin(this.angle) * (r * 0.72);

    // Parallax response from cursor & scroll
    const parallaxX = mouseOffset.x * this.z * 0.035;
    const parallaxY = mouseOffset.y * this.z * 0.035;
    const scrollParallax = (scrollY * 0.15) * (1 - this.z);

    this.x = rawX + parallaxX;
    this.y = rawY + parallaxY + scrollParallax;

    // Twinkle modulation
    this.currentAlpha = Math.max(0.1, Math.min(1.0, this.baseAlpha + Math.sin(time * this.twinkleSpeed + this.twinklePhase) * 0.28));
  }

  draw(ctx, palette) {
    if (this.x < -20 || this.x > ctx.canvas.width + 20 || this.y < -20 || this.y > ctx.canvas.height + 20) return;

    const colors = palette.stars;
    const color = colors[this.colorIndex % colors.length];

    // Soft stellar halo for bright near stars
    if (this.hasHalo && this.currentAlpha > 0.35) {
      const haloR = this.baseRadius * 4.2;
      const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, haloR);
      grad.addColorStop(0, palette.halo);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.x, this.y, haloR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stellar core
    ctx.save();
    ctx.globalAlpha = this.currentAlpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.baseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class NebulaWisp {
  constructor(w, h, config) {
    this.config = config;
    this.reset(w, h);
  }

  reset(w, h) {
    this.angle = Math.random() * Math.PI * 2;
    this.orbitR = 60 + Math.random() * (Math.min(w, h) * 0.45);
    this.speed = 0.00015 + Math.random() * 0.0002;
    this.r = this.config.r * (0.8 + Math.random() * 0.4);
    this.x = 0;
    this.y = 0;
  }

  update(cx, cy, w, h) {
    this.angle += this.speed;
    this.x = cx + Math.cos(this.angle) * this.orbitR;
    this.y = cy + Math.sin(this.angle) * (this.orbitR * 0.7);
  }

  draw(ctx, color) {
    const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class ShootingStar {
  constructor(w, h, color) {
    this.color = color;
    this.reset(w, h);
  }

  reset(w, h) {
    this.x = Math.random() * w * 0.8 + w * 0.1;
    this.y = Math.random() * h * 0.35;
    this.length = 70 + Math.random() * 80;
    this.speed = 12 + Math.random() * 8;
    this.angle = Math.PI / 4 + (Math.random() - 0.5) * 0.25; // ~45 deg downward streak
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.opacity = 1.0;
    this.fade = 0.02 + Math.random() * 0.015;
    this.active = true;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.opacity -= this.fade;
    if (this.opacity <= 0) {
      this.active = false;
    }
  }

  draw(ctx) {
    if (!this.active || this.opacity <= 0) return;

    const tailX = this.x - Math.cos(this.angle) * this.length;
    const tailY = this.y - Math.sin(this.angle) * this.length;

    const grad = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
    grad.addColorStop(0, "rgba(255, 255, 255, 0)");
    grad.addColorStop(1, this.color);

    ctx.save();
    ctx.globalAlpha = Math.max(0, this.opacity);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();

    // Luminous head
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

let animInstance = null;

export function initUniverseAnimation() {
  if (animInstance) return animInstance;

  const canvas = document.getElementById("universeCanvas");
  const welcomeState = document.getElementById("welcomeState");
  if (!canvas || !welcomeState) {
    console.warn("[UniverseAnimation] Canvas or welcomeState not found.");
    return null;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let animId = null;
  let isRunning = false;
  let time = 0;

  // Mouse interaction state with smooth spring easing
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let scrollY = 0;

  // Star & Nebula collections
  const stars = [];
  const nebulae = [];
  const shootingStars = [];
  let lastShootingStarTime = 0;
  const STAR_COUNT = 150;

  function getCurrentThemeKey() {
    return document.documentElement.getAttribute("data-theme") || "dark-modern";
  }

  function getPalette() {
    const key = getCurrentThemeKey();
    return THEME_PALETTES[key] || THEME_PALETTES["dark-modern"];
  }

  function resize() {
    const rect = welcomeState.getBoundingClientRect();
    width = rect.width || window.innerWidth;
    height = rect.height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);

    // Re-anchor universe center: upper-right quadrant for majestic framing behind hero
    const cx = width * 0.58;
    const cy = height * 0.42;

    if (stars.length === 0) {
      for (let i = 0; i < STAR_COUNT; i++) {
        stars.push(new Star(width, height));
      }

      const palette = getPalette();
      palette.nebulae.forEach(cfg => {
        nebulae.push(new NebulaWisp(width, height, cfg));
      });
    }
  }

  function handleMouseMove(e) {
    const rect = welcomeState.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    mouse.targetX = curX - width * 0.5;
    mouse.targetY = curY - height * 0.5;
  }

  function handleMouseLeave() {
    mouse.targetX = 0;
    mouse.targetY = 0;
  }

  function handleScroll() {
    scrollY = welcomeState.scrollTop;
    // Keep canvas fixed in the visible viewport with hardware-accelerated transform
    canvas.style.transform = `translateY(${scrollY}px)`;
  }

  function maybeSpawnShootingStar(now, palette) {
    if (now - lastShootingStarTime > 4500 + Math.random() * 4000) {
      lastShootingStarTime = now;
      shootingStars.push(new ShootingStar(width, height, palette.meteor));
    }
  }

  function render(timestamp) {
    if (!isRunning) return;

    time++;
    // Smooth mouse easing
    mouse.x += (mouse.targetX - mouse.x) * 0.045;
    mouse.y += (mouse.targetY - mouse.y) * 0.045;

    ctx.clearRect(0, 0, width, height);

    const palette = getPalette();
    const cx = width * 0.58;
    const cy = height * 0.42;

    // 1. Draw volumetric nebulae clouds
    for (let i = 0; i < nebulae.length; i++) {
      const wisp = nebulae[i];
      wisp.update(cx, cy, width, height);
      const color = palette.nebulae[i % palette.nebulae.length]?.color || "rgba(124, 58, 237, 0.06)";
      wisp.draw(ctx, color);
    }

    // 2. Update stars & collect coordinates for constellations
    const nearStars = [];
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.update(time, cx, cy, mouse, scrollY, width, height);
      star.draw(ctx, palette);

      if (star.z > 0.45 && star.currentAlpha > 0.3) {
        nearStars.push(star);
      }
    }

    // 3. Draw ethereal cosmic constellation filaments
    ctx.save();
    ctx.strokeStyle = palette.filaments;
    ctx.lineWidth = 0.85;
    const maxDist = 88;
    for (let i = 0; i < nearStars.length; i++) {
      const a = nearStars[i];
      for (let j = i + 1; j < nearStars.length; j++) {
        const b = nearStars[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          const alphaFactor = (1 - dist / maxDist) * 0.28 * Math.min(a.currentAlpha, b.currentAlpha);
          if (alphaFactor > 0.02) {
            ctx.globalAlpha = alphaFactor;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    // 4. Update & draw cosmic shooting stars
    maybeSpawnShootingStar(timestamp, palette);
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      s.update();
      s.draw(ctx);
      if (!s.active) {
        shootingStars.splice(i, 1);
      }
    }

    animId = requestAnimationFrame(render);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    resize();
    animId = requestAnimationFrame(render);
  }

  function stop() {
    if (!isRunning) return;
    isRunning = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function checkVisibility() {
    const isWelcomeActive = welcomeState.classList.contains("active");
    if (isWelcomeActive && !isRunning) {
      start();
    } else if (!isWelcomeActive && isRunning) {
      stop();
    }
  }

  // Setup event listeners
  welcomeState.addEventListener("mousemove", handleMouseMove, { passive: true });
  welcomeState.addEventListener("mouseleave", handleMouseLeave, { passive: true });
  welcomeState.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", () => {
    if (isRunning) resize();
  });

  // Watch welcomeState active class to save CPU when switching to terminal tabs
  const classObserver = new MutationObserver(checkVisibility);
  classObserver.observe(welcomeState, { attributes: true, attributeFilter: ["class"] });

  // Watch document data-theme changes to adapt particle colors instantly
  const themeObserver = new MutationObserver(() => {
    // Colors dynamically queried via getPalette() in next render frame
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Pause when window/tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else {
      checkVisibility();
    }
  });

  // Initial check
  checkVisibility();

  animInstance = { start, stop, resize };
  return animInstance;
}
