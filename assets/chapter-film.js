/*
 * Continuous cinematic motion below the hero.
 * Real generated industrial frames supply the spatial detail; 2D Canvas adds
 * gentle dolly, moving haze, dust and changing sunlight. Off-screen scenes
 * stop rendering, and reduced-motion visitors receive the still fallback.
 */
(() => {
  const nodes = [...document.querySelectorAll(".chapter-film-canvas")];
  if (!nodes.length) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = [];
  let running = false;
  let frame = 0;
  let lastFrame = 0;
  let userPaused = false;
  const pixelBudget = 1000000;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function randomSource(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function resize(scene) {
    if (!scene.ctx) return;
    const rect = scene.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const preferred = Math.min(devicePixelRatio || 1, innerWidth < 700 ? .7 : .94);
    const scale = Math.min(preferred, Math.sqrt(pixelBudget / (rect.width * rect.height)));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (scene.canvas.width !== width || scene.canvas.height !== height) {
      scene.canvas.width = width;
      scene.canvas.height = height;
    }
  }

  function draw(scene, seconds) {
    if (!scene.image.complete || !scene.image.naturalWidth || !scene.ctx) return;
    const ctx = scene.ctx;
    const w = scene.canvas.width;
    const h = scene.canvas.height;
    if (!w || !h) return;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#071a2b";
    ctx.fillRect(0, 0, w, h);

    // A slow, seamless lens move with an additional scroll-controlled drift.
    // Solid machinery stays rigid: there is no local displacement or morphing.
    const lens = 1.055 + .014 * Math.sin(seconds * .21 + scene.phase);
    const panX = Math.sin(seconds * .16 + scene.phase) * w * .014;
    const panY = Math.cos(seconds * .12 + scene.phase) * h * .009;
    const scrollOffset = (scene.progress - .5) * h * .046;
    const drawPlate = (image, alpha = 1) => {
      if (!image?.complete || !image.naturalWidth) return;
      const cover = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const dw = image.naturalWidth * cover * lens;
      const dh = image.naturalHeight * cover * lens;
      ctx.globalAlpha = alpha;
      ctx.drawImage(image, (w - dw) * .5 + panX, (h - dh) * .5 + panY + scrollOffset, dw, dh);
    };
    drawPlate(scene.image);
    if (scene.nextImage) {
      const progress = clamp((seconds * 1000 - scene.fadeStart) / 1650, 0, 1);
      const blend = progress * progress * (3 - 2 * progress);
      drawPlate(scene.nextImage, blend);
      if (progress >= 1) {
        scene.image = scene.nextImage;
        scene.nextImage = null;
      }
    }
    ctx.globalAlpha = 1;

    // The naturally lit right side slowly breathes. Each plate has its own
    // phase, so scrolling never feels like three synchronized effects.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const lampX = w * (.74 + .025 * Math.sin(seconds * .28 + scene.phase));
    const lampY = h * (.28 + .025 * Math.cos(seconds * .23 + scene.phase));
    const radius = w * (scene.name === "scenario" ? .36 : .43);
    const warmth = .75 + .25 * Math.sin(seconds * .38 + scene.phase);
    const glow = ctx.createRadialGradient(lampX,lampY,0,lampX,lampY,radius);
    glow.addColorStop(0, `rgba(249,185,94,${.085 * warmth})`);
    glow.addColorStop(.47, `rgba(220,166,101,${.04 * warmth})`);
    glow.addColorStop(1, "rgba(220,166,101,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0,0,w,h);

    // Diagonal warm volume, gently changing position as a real beam would.
    const beamShift = w * .025 * Math.sin(seconds * .18 + scene.phase);
    const beam = ctx.createLinearGradient(w*.52+beamShift,h*.72,w*.9+beamShift,0);
    beam.addColorStop(0,"rgba(241,178,95,0)");
    beam.addColorStop(.35,"rgba(241,178,95,.025)");
    beam.addColorStop(.65,"rgba(255,210,137,.085)");
    beam.addColorStop(1,"rgba(255,210,137,0)");
    ctx.fillStyle = beam;
    ctx.globalAlpha = .6 + .22 * Math.sin(seconds * .31 + scene.phase);
    ctx.beginPath();
    ctx.moveTo(w*.73+beamShift,-h*.07);
    ctx.lineTo(w*1.05+beamShift,-h*.07);
    ctx.lineTo(w*.69+beamShift,h*.81);
    ctx.lineTo(w*.35+beamShift,h*.81);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Soft film haze travels independently of the photographic perspective.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 2; i++) {
      const x = w * (.45 + i*.33 + .095*Math.sin(seconds*(.075+i*.03)+scene.phase+i));
      const y = h * (.42 + .085*Math.cos(seconds*(.06+i*.02)+i));
      const fog = ctx.createRadialGradient(x,y,0,x,y,w*(i ? .36 : .44));
      fog.addColorStop(0,i ? "rgba(209,176,135,.028)" : "rgba(116,154,181,.038)");
      fog.addColorStop(1,"rgba(116,154,181,0)");
      ctx.fillStyle = fog;
      ctx.fillRect(0,0,w,h);
    }

    // Perspective-aware floating dust, clustered in the backlit half only.
    for (const dust of scene.dust) {
      const x = ((dust.x + seconds*dust.speed*.004) % 1) * w;
      const travel = (dust.y + seconds*dust.speed*.003) % 1;
      const y = travel * h;
      const flicker = .66 + .34*Math.sin(seconds*.8+dust.phase);
      const r = dust.radius * Math.min(w,h) / 750;
      ctx.globalAlpha = dust.alpha * flicker;
      ctx.fillStyle = dust.warm ? "#ffe1ae" : "#b6d0df";
      ctx.beginPath();
      ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function tick(now) {
    frame = 0;
    if (!running || document.hidden || reduced.matches || userPaused) return;
    const interval = innerWidth < 720 ? 48 : 38;
    if (lastFrame && now-lastFrame < interval) { schedule(); return; }
    lastFrame = now;
    const seconds = now * .001;
    for (const scene of scenes) {
      if (scene.visible && scene.ready) draw(scene,seconds);
    }
    schedule();
  }
  function schedule() {
    if (!frame && running && !document.hidden && !reduced.matches && !userPaused) {
      frame = requestAnimationFrame(tick);
    }
  }
  function sync() {
    running = scenes.some(scene => scene.visible && scene.ready);
    if (running) schedule();
    else if (frame) { cancelAnimationFrame(frame); frame = 0; }
  }
  function updateScroll() {
    const viewport = innerHeight || 800;
    for (const scene of scenes) {
      if (!scene.visible) continue;
      const rect = scene.host.getBoundingClientRect();
      scene.progress = clamp((viewport-rect.top) / (viewport+rect.height),0,1);
    }
  }

  for (const [index, canvas] of nodes.entries()) {
    const host = canvas.closest(".chapter-film");
    const ctx = canvas.getContext("2d",{alpha:false,desynchronized:true});
    if (!host || !ctx) continue;
    const rand = randomSource(9173 + index*7411);
    const dust = Array.from({length: 55},() => ({
      x: .34 + rand()*.65, y: rand(), radius: .5+rand()*1.5,
      speed: .35+rand()*.75, phase: rand()*Math.PI*2,
      alpha: .1+rand()*.32, warm: rand()>.3
    }));
    const scene = {canvas,ctx,host,name:canvas.dataset.film || "method",image:new Image(),
      nextImage:null,fadeStart:0,requestSerial:0,targetSrc:"",
      phase:index*1.7,progress:0,visible:false,ready:false,dust};
    scene.image.decoding = "async";
    scene.image.onload = () => {
      resize(scene);
      scene.ready = true;
      draw(scene,performance.now()*.001);
      host.classList.add("is-ready");
      sync();
    };
    scene.image.onerror = () => { host.dataset.filmFallback = "image"; };
    scenes.push(scene);
  }

  function changeScenarioFrame(source) {
    const scene = scenes.find(item => item.name === "scenario");
    if (!scene || !source || scene.targetSrc === source) return;
    scene.targetSrc = source;
    const request = ++scene.requestSerial;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (request !== scene.requestSerial) return;
      // Replace the previous target if the visitor moves quickly between nodes.
      // The dominant visible plate becomes the base for the next dissolve.
      if (scene.nextImage) {
        const elapsed = performance.now() - scene.fadeStart;
        if (elapsed >= 825) scene.image = scene.nextImage;
      }
      if (!scene.image.naturalWidth || reduced.matches || userPaused || document.hidden) {
        scene.image = image;
        scene.nextImage = null;
      } else {
        scene.nextImage = image;
        scene.fadeStart = performance.now();
      }
      resize(scene);
      scene.ready = true;
      draw(scene, performance.now() * .001);
      scene.host.classList.add("is-ready");
      sync();
    };
    image.onerror = () => {
      if (request === scene.requestSerial) scene.host.dataset.filmFallback = "image";
    };
    image.src = source;
  }

  document.addEventListener("scenario-visual-change", event => {
    changeScenarioFrame(event.detail?.image);
  });

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const scene = scenes.find(item => item.host === entry.target);
      if (!scene) continue;
      scene.visible = entry.isIntersecting;
      if (scene.visible && !scene.image.src) {
        scene.image.src = scene.host.dataset.activeScenarioImage || scene.canvas.dataset.image;
      }
    }
    updateScroll();
    sync();
  }, {rootMargin:"160px 0px 160px 0px",threshold:0});
  for (const scene of scenes) observer.observe(scene.host);

  let scrollFrame = 0;
  addEventListener("scroll",() => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      updateScroll();
    });
  },{passive:true});
  addEventListener("resize",() => {
    for (const scene of scenes) if (scene.ready) resize(scene);
    updateScroll();
  },{passive:true});
  document.addEventListener("visibilitychange",sync);
  reduced.addEventListener?.("change",sync);

  const heroToggle = document.getElementById("cinema-toggle");
  heroToggle?.addEventListener("click",() => {
    userPaused = heroToggle.getAttribute("aria-pressed") === "true";
    sync();
  });
})();
