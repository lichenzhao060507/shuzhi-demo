/*
 * Exploratory visualization of official scenario labels only.
 * Does not calculate grades, scores or diagnostic recommendations.
 */
(() => {
  const orbit = document.querySelector(".signal-orbit");
  const host = document.getElementById("signal-nodes");
  const outputId = document.getElementById("signal-id");
  const outputName = document.getElementById("signal-name");
  const outputType = document.getElementById("signal-type");
  const toggle = document.getElementById("signal-toggle");
  const toggleText = document.getElementById("signal-toggle-text");
  const previewZoom = document.getElementById("signal-preview-zoom");
  const previewCounter = document.getElementById("signal-preview-counter");
  const previewLayers = [document.getElementById("signal-preview-a"), document.getElementById("signal-preview-b")];
  const lightbox = document.getElementById("signal-lightbox");
  const lightboxImage = document.getElementById("signal-lightbox-image");
  const lightboxTitle = document.getElementById("signal-lightbox-title");
  if (!orbit || !host || !toggle) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // 扫描臂转一圈 = 16 个节点各停留一次。切换间隔与 transition 时长同源，
  // 改这里就同时改了两者，不会再出现"扫描比切换快"。
  const CYCLE_MS = 2800;
  orbit.style.setProperty("--scan-duration", `${CYCLE_MS}ms`);
  let scanAngle = 0;
  let scenarios = [];
  let current = 0;
  let paused = false;
  let isVisible = false;
  let timeoutId = null;
  let activeLayer = 0;
  let imageRequest = 0;
  const preloaded = new Map();
  const imagePath = (id) => `assets/img/scenes/${id.toLowerCase()}.webp`;
  const filmHost = document.querySelector(".chapter-film-scenario");

  function preload(id) {
    if (preloaded.has(id)) return preloaded.get(id);
    const image = new Image();
    image.decoding = "async";
    image.src = imagePath(id);
    preloaded.set(id, image);
    return image;
  }

  function updateVisual(scenario, index) {
    if (!previewLayers.every(Boolean)) return;
    const src = imagePath(scenario.id);
    const request = ++imageRequest;
    const previous = previewLayers[activeLayer];
    const nextLayer = 1 - activeLayer;
    const next = previewLayers[nextLayer];
    previewCounter.textContent = `${String(index + 1).padStart(2,"0")} / 16`;
    previewZoom.setAttribute("aria-label", `放大 ${scenario.id} ${scenario.name} 的主题图`);

    if (previous.getAttribute("src") !== src) {
      next.src = src;
      const commit = () => {
        if (request !== imageRequest) return;
        next.classList.add("is-current");
        previous.classList.remove("is-current");
        activeLayer = nextLayer;
      };
      if (next.complete && next.naturalWidth) commit();
      else next.addEventListener("load", commit, {once:true});
    }

    if (lightbox?.open) {
      lightboxImage.src = src;
      lightboxImage.alt = `${scenario.id} ${scenario.name}主题概念画面`;
      lightboxTitle.textContent = `${scenario.id} ${scenario.name}`;
    }
    // Keep the large moving scene behind the radar in step with its active node.
    // The cinematic layer handles its own image loading and gentle dissolve.
    if (filmHost) {
      // 自定义属性里的 url() 会按 chapter-film.css 的位置解析，这里给绝对地址，
      // 否则会请求 /assets/assets/img/scenes/**.webp。
      const absoluteSrc = new URL(src, document.baseURI).href;
      filmHost.dataset.activeScenarioImage = src;
      filmHost.style.setProperty("--chapter-still", `url("${absoluteSrc}")`);
      document.dispatchEvent(new CustomEvent("scenario-visual-change", {
        detail: {image: src, id: scenario.id, name: scenario.name}
      }));
    }
    // The next two images tend to be requested before the next auto-scan tick.
    if (scenarios.length) {
      preload(scenarios[(index + 1) % scenarios.length].id);
      preload(scenarios[(index + 2) % scenarios.length].id);
    }
  }

  /* 扫描臂只按节点索引走：每个间隔前进 360/16 度。
     自动扫描时臂领先一格，在节点切换的同一瞬间正好落到被点亮的节点上；
     暂停或人工点选时臂停在当前节点，不会出现"扫描比切换快"。 */
  function syncSweep(index) {
    const step = 360 / Math.max(1, scenarios.length);
    const currentMod = ((scanAngle % 360) + 360) % 360;
    const targetMod = (((index % scenarios.length) + scenarios.length) % scenarios.length) * step;
    let delta = (targetMod - currentMod + 360) % 360;
    if (delta > 180) delta -= 360;
    scanAngle += delta;
    orbit.style.setProperty("--scan-angle", `${scanAngle.toFixed(3)}deg`);
  }

  function selectScene(index, initiatedByUser = false) {
    if (!scenarios.length) return;
    current = (index + scenarios.length) % scenarios.length;
    const scenario = scenarios[current];
    outputId.textContent = scenario.id;
    outputName.textContent = scenario.name;
    outputType.textContent = scenario.constraint
      ? "约束性业务场景 · 官方重点场景"
      : "工信部 2024 年评测场景";
    updateVisual(scenario, current);
    [...host.children].forEach((node, i) => {
      const active = i === current;
      node.classList.toggle("active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    const running = !paused && !initiatedByUser && !motion.matches && !document.hidden;
    syncSweep(running ? current + 1 : current);
    if (initiatedByUser) {
      paused = true;
      updateToggle();
      stopCycle();
    }
  }
  function reposition() {
    const size = Math.min(orbit.clientWidth, orbit.clientHeight);
    const r = size * .405;
    const center = size / 2;
    [...host.children].forEach((node, i) => {
      const theta = (-Math.PI / 2) + (2 * Math.PI * i / scenarios.length);
      node.style.left = (center + Math.cos(theta) * r).toFixed(2) + "px";
      node.style.top = (center + Math.sin(theta) * r).toFixed(2) + "px";
    });
  }
  function stopCycle() {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
  }
  function cycle() {
    stopCycle();
    if (paused || !isVisible || motion.matches || document.hidden) {
      if (scenarios.length) syncSweep(current);
      return;
    }
    if (scenarios.length) syncSweep(current + 1);
    timeoutId = window.setTimeout(() => {
      selectScene(current + 1);
      cycle();
    }, CYCLE_MS);
  }
  function updateToggle() {
    toggle.setAttribute("aria-pressed", String(paused));
    toggleText.textContent = paused ? "继续自动扫描" : "暂停自动扫描";
    orbit.classList.toggle("paused", paused);
    const icon = toggle.querySelector(".signal-toggle-icon");
    if (icon) icon.textContent = paused ? "▶" : "Ⅱ";
  }
  toggle.addEventListener("click", () => {
    paused = !paused;
    updateToggle();
    cycle();
  });

  previewZoom?.addEventListener("click", () => {
    if (!scenarios.length || !lightbox || !lightboxImage) return;
    paused = true;
    updateToggle();
    stopCycle();
    const scene = scenarios[current];
    lightboxImage.src = imagePath(scene.id);
    lightboxImage.alt = `${scene.id} ${scene.name}主题概念画面`;
    lightboxTitle.textContent = `${scene.id} ${scene.name}`;
    lightbox.showModal();
  });
  document.getElementById("signal-lightbox-close")?.addEventListener("click", () => lightbox?.close());
  document.getElementById("signal-lightbox-prev")?.addEventListener("click", () => selectScene(current - 1,true));
  document.getElementById("signal-lightbox-next")?.addEventListener("click", () => selectScene(current + 1,true));
  lightbox?.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); selectScene(current - 1,true); }
    if (event.key === "ArrowRight") { event.preventDefault(); selectScene(current + 1,true); }
  });
  lightbox?.addEventListener("click", event => {
    if (event.target === lightbox) lightbox.close();
  });

  document.addEventListener("visibilitychange", cycle);
  motion.addEventListener?.("change", () => {
    if (motion.matches) paused = true;
    updateToggle(); cycle();
  });

  async function boot() {
    try {
      const res = await fetch("data/criteria.json");
      if (!res.ok) throw new Error("criteria");
      const data = await res.json();
      scenarios = (data.scenarios || []).slice(0, 16);
      if (!scenarios.length) throw new Error("empty");
      scenarios.forEach((scenario, index) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "signal-node";
        node.textContent = String(index + 1).padStart(2, "0");
        node.title = scenario.id + " · " + scenario.name;
        node.setAttribute("aria-label", scenario.id + " " + scenario.name);
        node.setAttribute("aria-pressed", "false");
        node.addEventListener("click", () => selectScene(index, true));
        node.addEventListener("focus", () => { stopCycle(); if (scenarios.length) syncSweep(current); });
        node.addEventListener("blur", cycle);
        host.appendChild(node);
      });
      reposition();
      selectScene(0);
      const preloadAll = () => scenarios.forEach(scenario => preload(scenario.id));
      if ("requestIdleCallback" in window) requestIdleCallback(preloadAll,{timeout:3000});
      else setTimeout(preloadAll,700);
      if (motion.matches) { paused = true; updateToggle(); }
      new ResizeObserver(reposition).observe(orbit);
      new IntersectionObserver(entries => {
        isVisible = entries[0]?.isIntersecting ?? false;
        cycle();
      }, { threshold: .1 }).observe(orbit);
    } catch (err) {
      outputId.textContent = "—";
      outputName.textContent = "场景目录暂不可用";
      outputType.textContent = "请使用下方正式评测入口";
      toggle.disabled = true;
      toggleText.textContent = "不可用";
    }
  }
  boot();
})();
