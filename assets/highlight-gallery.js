/*
 * Apple 风格滚动翻页（highlight gallery）
 * —— 与 apple.com/iphone-18-pro 的 sticky 高亮区同一套机制：
 *    外层 .highlight-gallery 提供数屏高的滚动轨道，内层 .highlight-stage
 *    sticky 吸顶；滚动进度驱动各帧的交叉淡化与轻微缩放，底部圆点
 *    指示当前高亮，可点击跳转。
 *  - 独立脚本：不读写 engine.js / app.js 的任何状态，不承载业务逻辑。
 *  - prefers-reduced-motion: reduce 时不加 is-live，CSS 自动退化为
 *    纵向静态排列，滚动监听与圆点均不启用。
 *  - 页面不可见（document.hidden）时不做任何滚动计算。
 *  - 仅使用 opacity / transform / visibility，不触发重排。
 */
(() => {
  const root = document.querySelector(".highlight-gallery");
  if (!root) return;

  const stage = root.querySelector(".highlight-stage");
  const frames = [...root.querySelectorAll(".highlight-frame")];
  if (!stage || frames.length < 2) return;

  const dotsWrap = root.querySelector(".highlight-dots");
  const progress = root.querySelector(".highlight-progress > i");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  if (reduced.matches) return; // 减少动态：保持静态纵向排列

  /* ---------- 圆点指示器 ---------- */
  let dots = [];
  if (dotsWrap) {
    frames.forEach((frame, index) => {
      const label = frame.dataset.title || `0${index + 1}`;
      const li = document.createElement("li");
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "highlight-dot";
      dot.setAttribute("aria-label", `查看：${label}`);
      const text = document.createElement("span");
      text.className = "highlight-dot-label";
      text.textContent = label;
      dot.appendChild(text);
      dot.addEventListener("click", () => {
        // 跳到该帧的滚动中点，让 sticky 段自然吸附
        const top = root.getBoundingClientRect().top + window.scrollY;
        const span = (root.offsetHeight - innerHeight) / frames.length;
        window.scrollTo({
          top: top + span * (index + 0.5) - innerHeight * 0.02,
          behavior: reduced.matches ? "auto" : "smooth",
        });
      });
      li.appendChild(dot);
      dotsWrap.appendChild(li);
      dots.push(dot);
    });
  }

  root.classList.add("is-live");

  /* ---------- 滚动驱动 ---------- */
  const hold = 0.86;        // 每帧内停留区占单帧行程的比例（太长会让两帧的文字叠在一起）
  const fade = 1 - hold;    // 交叉淡化区
  let frame = 0;
  let activeIndex = -1;
  let seen = false;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => t * t * (3 - 2 * t); // smoothstep

  function localProgress() {
    const rect = root.getBoundingClientRect();
    const total = rect.height - innerHeight;
    if (total <= 0) return 0;
    return clamp(-rect.top / total, 0, 1);
  }

  function framePosition(p) {
    // 单帧行程内：hold 区间保持 1（完全显示），边界处与相邻帧交叉淡化
    const span = 1 / frames.length;
    const start = p - span / 2;
    const center = start / span; // 当前"理论帧位置"（0..frames.length）
    const local = center - Math.floor(center);
    let value;
    if (local < fade / 2) value = ease(0.5 + local / fade);
    else if (local > 1 - fade / 2) value = ease(0.5 + (1 - local) / fade);
    else value = 1;
    return { center: Math.floor(center), value };
  }

  function update() {
    frame = 0;
    if (document.hidden) return;

    const p = localProgress();
    if (progress) progress.style.transform = `scaleX(${p.toFixed(4)})`;

    // 视口是否已进入 gallery（圆点淡入淡出）
    const rect = root.getBoundingClientRect();
    const inView = rect.top < innerHeight * 0.9 && rect.bottom > innerHeight * 0.35;
    if (dotsWrap) dotsWrap.classList.toggle("is-visible", inView);

    if (!inView && seen) return;
    seen = inView;

    const { center: rawCenter, value } = framePosition(p);
    // 进入/离开 gallery 时（p 处于首尾缓冲），把索引钳制到帧范围内，
    // 避免出现整屏空白。
    const center = clamp(rawCenter, 0, frames.length - 1);

    for (let i = 0; i < frames.length; i++) {
      const el = frames[i];
      let opacity = 0;
      let shift = 0;
      if (i === center) {
        opacity = value;
        shift = (1 - value) * 18; // 淡出方向微微下坠
      } else if (i === center + 1 && value < 1) {
        opacity = 1 - value;
        shift = (1 - value) * -18; // 新帧从上方落定
      } else if (i === center - 1 && value < 1) {
        opacity = 1 - value;
        shift = (1 - value) * 18;
      }
      el.classList.toggle("is-active", opacity > 0.5);
      el.classList.toggle("is-adjacent", opacity > 0 && opacity <= 0.5);
      el.style.opacity = opacity.toFixed(3);
      el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0) scale(${(0.96 + 0.04 * ease(opacity)).toFixed(4)})`;
      if (i >= center - 1 && i <= center + 1) el.style.visibility = opacity > 0.001 ? "visible" : "hidden";
      else el.style.visibility = "hidden";
    }

    const index = clamp(center, 0, frames.length - 1);
    if (index !== activeIndex) {
      activeIndex = index;
      dots.forEach((dot, i) => {
        const on = i === index;
        dot.classList.toggle("is-active", on);
        if (on) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }
  }

  function onScroll() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onScroll);
  reduced.addEventListener?.("change", (event) => {
    // 中途切换偏好时彻底退回静态布局
    if (event.matches) {
      window.removeEventListener("scroll", onScroll);
      root.classList.remove("is-live");
      frames.forEach((el) => {
        el.style.cssText = "";
        el.classList.remove("is-active", "is-adjacent");
      });
    }
  });

  onScroll();
})();