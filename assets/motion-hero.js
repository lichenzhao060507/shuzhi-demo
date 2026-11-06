/* Non-essential hero animation. Isolated from the diagnostic engine. */
(() => {
  const hero = document.getElementById("top");
  const canvas = document.getElementById("hero-particles");
  if (!hero || !canvas) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(pointer: fine)");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context || reduced.matches) return;

  let width = 1, height = 1, pixelRatio = 1;
  let particles = [], visible = true, frame = 0, lastFrame = 0;
  let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
  let intersecting = true;

  function resetSize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const count = Math.min(56, Math.max(18, Math.floor(width / 26)));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.35 + .35,
      speed: Math.random() * .22 + .06,
      phase: Math.random() * Math.PI * 2,
      opacity: Math.random() * .28 + .08,
    }));
  }

  function render(time) {
    frame = 0;
    if (reduced.matches || document.hidden || !intersecting) return;
    // Limit visual work to around 30fps on typical screens.
    if (time - lastFrame < 30) {
      schedule();
      return;
    }
    lastFrame = time;
    currentX += (targetX - currentX) * .055;
    currentY += (targetY - currentY) * .055;
    hero.style.setProperty("--parallax-x", (currentX * -14).toFixed(2) + "px");
    hero.style.setProperty("--parallax-y", (currentY * -10).toFixed(2) + "px");

    context.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.y -= p.speed;
      p.x += Math.sin(time * .00022 + p.phase) * .065;
      if (p.y < -4) { p.y = height + 4; p.x = Math.random() * width; }
      const locationWeight = .3 + .7 * (p.x / width);
      context.beginPath();
      context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      context.fillStyle = "rgba(255,218,159," + (p.opacity * locationWeight).toFixed(3) + ")";
      context.fill();
    }
    schedule();
  }
  function schedule() {
    if (!frame && !document.hidden && intersecting && !reduced.matches) {
      frame = requestAnimationFrame(render);
    }
  }
  function onPointer(event) {
    if (!finePointer.matches) return;
    const rect = hero.getBoundingClientRect();
    targetX = ((event.clientX - rect.left) / rect.width - .5) * 2;
    targetY = ((event.clientY - rect.top) / rect.height - .5) * 2;
  }
  hero.addEventListener("pointermove", onPointer, { passive: true });
  hero.addEventListener("pointerleave", () => { targetX = 0; targetY = 0; }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  });
  const observer = new IntersectionObserver(entries => {
    intersecting = entries[0]?.isIntersecting ?? false;
    if (!intersecting && frame) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  }, { threshold: .01 });
  observer.observe(hero);
  const resize = new ResizeObserver(resetSize);
  resize.observe(hero);
  reduced.addEventListener?.("change", () => {
    if (reduced.matches && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!reduced.matches) schedule();
  });
  resetSize();
  schedule();
})();
