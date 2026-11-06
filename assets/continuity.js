/* A lightweight scroll chapter guide; independent of diagnosis/scoring. */
(() => {
  const rail = document.querySelector(".journey-rail");
  const hero = document.getElementById("top");
  const scenario = document.getElementById("scenario-atlas");
  const chapters = [
    { key: "method", node: document.getElementById("method") },
    { key: "scenario", node: scenario },
    { key: "start", node: document.getElementById("start") },
  ];
  if (!rail || !hero || chapters.some(({ node }) => !node)) return;

  const links = [...rail.querySelectorAll("a[data-chapter]")];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  function clamp(value) { return Math.max(0, Math.min(1, value)); }
  function absoluteTop(node) { return node.getBoundingClientRect().top + window.scrollY; }

  function update() {
    frame = 0;
    const height = window.innerHeight;
    const probe = window.scrollY + height * .45;
    const start = absoluteTop(chapters[0].node);
    const end = absoluteTop(chapters[2].node) + chapters[2].node.offsetHeight;
    const visible = window.scrollY > hero.offsetHeight * .48 && probe < end + height * .15;
    rail.classList.toggle("is-visible", visible);
    rail.style.setProperty("--journey-progress", `${(clamp((probe - start) / Math.max(1, end - start)) * 100).toFixed(1)}%`);

    let active = chapters[0].key;
    for (const chapter of chapters) {
      if (probe >= absoluteTop(chapter.node)) active = chapter.key;
    }
    for (const link of links) {
      const selected = link.dataset.chapter === active;
      link.classList.toggle("is-active", selected);
      if (selected) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }

    if (!reduced.matches && scenario) {
      const rect = scenario.getBoundingClientRect();
      const passing = clamp((height - rect.top) / Math.max(1, height + rect.height));
      scenario.style.setProperty("--signal-light-y", `${(34 + passing * 30).toFixed(1)}%`);
    }
  }

  function onScroll() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  reduced.addEventListener?.("change", onScroll);
  onScroll();
})();
