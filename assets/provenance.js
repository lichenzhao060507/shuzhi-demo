/* provenance.js —— 依据抽屉
 * 职责：把一条结论的全部依据（判据 / 采集项 / 场景 / 案例）连同七项溯源字段
 *       一次性摊开，供评委逐条核对。
 * 纯 DOM，无第三方依赖；由 ai-card.js 调用，也可单独 window.AdvisorProvenance.open()。
 */
(() => {
  "use strict";

  let root = null;
  let panel = null;
  let lastFocus = null;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else node.setAttribute(key, value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function ensure() {
    if (root) return;
    root = el("div", { class: "provenance", role: "presentation" });
    panel = el("div", {
      class: "provenance__panel",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "依据与溯源",
    });
    root.appendChild(panel);
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("is-open")) close();
    });
    document.body.appendChild(root);
  }

  function refCard(ref) {
    const head = el("div", { class: "provenance__ref-head" }, [
      el("span", { class: "provenance__kind", "data-kind": ref.kind || "", text: ref.kind || "依据" }),
      el("span", { class: "provenance__ref-title", text: [ref.ref, ref.title].filter(Boolean).join(" · ") }),
    ]);
    const doc = el("p", { class: "provenance__doc" });
    if (ref.doc) doc.appendChild(el("span", { text: ref.doc }));
    if (ref.url) {
      doc.appendChild(el("a", {
        href: ref.url,
        target: "_blank",
        rel: "noopener",
        text: /^https?:/.test(ref.url) ? "打开原文 ↗" : "打开原文 PDF ↗",
      }));
    }
    return el("div", { class: "provenance__ref" }, [
      head,
      ref.quote ? el("p", { class: "provenance__quote", text: ref.quote }) : null,
      ref.note ? el("p", { class: "provenance__note", text: ref.note }) : null,
      doc.childNodes.length ? doc : null,
    ]);
  }

  function metaList(rows) {
    if (!rows || !rows.length) return null;
    const dl = el("dl", { class: "provenance__meta" });
    rows.forEach((row) => {
      dl.appendChild(el("div", { class: "provenance__meta-row" }, [
        el("dt", { text: row.label }),
        el("dd", { text: row.value }),
      ]));
    });
    return dl;
  }

  function open(payload) {
    ensure();
    lastFocus = document.activeElement;
    const data = payload || {};
    const refs = data.refs || [];

    panel.textContent = "";
    panel.appendChild(el("div", { class: "provenance__head" }, [
      el("div", {}, [
        el("h3", { class: "provenance__title", text: data.title || "依据清单" }),
        el("p", {
          class: "provenance__sub",
          text: data.subtitle || `共 ${refs.length} 条依据，逐条可回查原文`,
        }),
      ]),
      el("button", {
        class: "provenance__close",
        type: "button",
        "aria-label": "关闭",
        text: "✕",
      }),
    ]));

    const body = el("div", { class: "provenance__body" });
    if (data.metaRows && data.metaRows.length) body.appendChild(metaList(data.metaRows));
    if (refs.length) refs.forEach((ref) => body.appendChild(refCard(ref)));
    else body.appendChild(el("p", { class: "provenance__note", text: "这条结论没有附带可回查依据。" }));
    panel.appendChild(body);

    panel.appendChild(el("div", { class: "provenance__foot" }, [
      el("span", { text: "依据来自官方附件原文与本项目构造判据，二者在标签上区分" }),
      el("button", { type: "button", text: "关闭", "data-action": "close" }),
    ]));

    panel.querySelector(".provenance__close").addEventListener("click", close);
    panel.querySelector('[data-action="close"]').addEventListener("click", close);

    root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    const first = root.querySelector(".provenance__close");
    if (first) first.focus({ preventScroll: true });
  }

  function close() {
    if (!root) return;
    root.classList.remove("is-open");
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  window.AdvisorProvenance = { open, close };
})();
