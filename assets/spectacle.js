/* Visual-only interactions. The scoring and fixture modules are untouched. */
(() => {
  const hero = document.getElementById("top");
  const progress = document.querySelector(".page-scroll-progress");
  const cards = [...document.querySelectorAll(".method article")];
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let scrollFrame = 0;

  function paintScroll() {
    scrollFrame = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progress?.style.setProperty("--page-progress", String(Math.max(0, Math.min(1, window.scrollY / max))));
    if (!motion.matches && hero) {
      const distance = Math.max(1, hero.offsetHeight);
      const fraction = Math.min(1, Math.max(0, window.scrollY / distance));
      hero.style.setProperty("--hero-scroll-shift", (fraction * 60).toFixed(1) + "px");
      hero.style.setProperty("--hero-scroll-opacity", String(Math.max(0, 1 - fraction * 1.35)));
    }
  }
  function queueScroll() {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(paintScroll);
  }
  window.addEventListener("scroll", queueScroll, { passive: true });
  window.addEventListener("resize", queueScroll, { passive: true });
  queueScroll();

  if (hero && pointer.matches && !motion.matches) {
    hero.addEventListener("pointermove", event => {
      const bounds = hero.getBoundingClientRect();
      hero.style.setProperty("--spot-x", ((event.clientX - bounds.left) / bounds.width * 100).toFixed(1) + "%");
      hero.style.setProperty("--spot-y", ((event.clientY - bounds.top) / bounds.height * 100).toFixed(1) + "%");
    }, { passive: true });
    hero.addEventListener("pointerleave", () => {
      hero.style.setProperty("--spot-x", "73%");
      hero.style.setProperty("--spot-y", "46%");
    }, { passive: true });
  }

  if (pointer.matches && !motion.matches) {
    for (const card of cards) {
      card.addEventListener("pointermove", event => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        card.style.setProperty("--card-x", (x * 100).toFixed(1) + "%");
        card.style.setProperty("--card-y", (y * 100).toFixed(1) + "%");
        card.style.setProperty("--tilt-x", ((.5 - y) * 4).toFixed(2) + "deg");
        card.style.setProperty("--tilt-y", ((x - .5) * 4).toFixed(2) + "deg");
      }, { passive: true });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
      }, { passive: true });
    }
  }
})();
