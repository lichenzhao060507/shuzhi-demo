/* ai-card.js —— 可信依据卡
 * 一条诊断结论的完整交代：结论 / 为什么 / 影响 / 依据强度 / 可执行动作。
 * 只渲染数据，不生成结论；依据清单交给 provenance.js 摊开。
 * 不写"置信度"：本项目是确定性规则引擎，能数的是依据条数与官方来源占比。
 */
(() => {
  "use strict";

  const CIRCLED = ["①", "②", "③", "④", "⑤"];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else node.setAttribute(key, value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function isOfficial(ref) {
    return ref.kind === "采集项" || ref.kind === "场景" || /官方/.test(ref.doc || "");
  }

  /* 依据强度：官方原文 N 条 · 本项目构造 M 条 —— 可数、可核对，不是拍脑袋的百分比 */
  function strength(counts) {
    const wrap = el("span", { class: "ai-card__strength" }, [
      el("span", { class: "dot is-official" }),
      `官方原文 ${counts.official} 条`,
      el("span", { class: "dot is-own" }),
      `本项目 ${counts.own} 条`,
    ]);
    return wrap;
  }

  function clip(text, max) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > max ? value.slice(0, max) + "…" : value;
  }

  function reasonsFrom(entry) {
    const refs = entry.evidence_refs || [];
    if (refs.length) {
      // 依据原文在上面那句已经完整给过，这里只留一眼能扫完的摘要
      return refs.slice(0, 3).map((ref) => ({
        heavy: [ref.ref, ref.title].filter(Boolean).join(" · "),
        rest: ref.quote ? `：${clip(ref.quote, 56)}` : "",
      }));
    }
    const fallback = [];
    if ((entry.hit_items || []).length) {
      fallback.push({ heavy: `命中采集项 ${entry.hit_items.join("、")}`, rest: "" });
    }
    if ((entry.hit_scenarios || []).length) {
      fallback.push({ heavy: `命中场景 ${entry.hit_scenarios.join("、")}`, rest: "" });
    }
    return fallback;
  }

  function actionButtons(entry, refs, onCopy) {
    const bar = el("div", { class: "ai-card__actions" });

    const evidenceBtn = el("button", {
      class: "ai-card__btn ai-card__btn--primary",
      type: "button",
      text: `查看依据 · ${refs.length} 条`,
    });
    evidenceBtn.addEventListener("click", () => {
      window.AdvisorProvenance && window.AdvisorProvenance.open(entry._provenance);
    });
    bar.appendChild(evidenceBtn);

    const official = refs.find((ref) => ref.url);
    if (official) {
      const link = el("a", {
        class: "ai-card__btn",
        href: official.url,
        target: "_blank",
        rel: "noopener",
        text: "打开官方原文 ↗",
      });
      bar.appendChild(link);
    }

    const copyBtn = el("button", {
      class: "ai-card__btn",
      type: "button",
      text: "复制结论",
    });
    copyBtn.addEventListener("click", () => {
      const text = `${entry.bottleneck}\n依据：${entry.evidence || ""}`;
      const done = () => {
        copyBtn.textContent = "已复制";
        window.setTimeout(() => { copyBtn.textContent = "复制结论"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    });
    bar.appendChild(copyBtn);

    return bar;
  }

  function fallbackCopy(text, done) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); } catch (error) { /* 静默失败，按钮不变化 */ }
    document.body.removeChild(area);
  }

  function createAiCard(entry, options) {
    const opts = options || {};
    const refs = entry.evidence_refs || [];
    const official = refs.filter(isOfficial).length;

    const card = el("article", {
      class: "ai-card reveal",
      "data-tone": entry._pattern ? "clay" : (entry._tone || "accent"),
      style: opts.delay != null ? `--d:${opts.delay}ms` : null,
    });

    card.appendChild(el("div", { class: "ai-card__head" }, [
      el("span", { class: "ai-card__kind", text: entry.bottleneck_type || "瓶颈" }),
      strength({ official, own: refs.length - official }),
    ]));

    card.appendChild(el("h4", { class: "ai-card__conclusion", text: entry.bottleneck }));

    const evidenceText = entry.evidence || "";
    const cut = evidenceText.indexOf("。判据：");
    if (evidenceText) {
      card.appendChild(el("p", {
        class: "ai-card__quote",
        text: cut > 0 ? evidenceText.slice(0, cut + 1) : evidenceText,
      }));
    }

    const reasons = reasonsFrom(entry);
    if (reasons.length) {
      const list = el("ul", { class: "ai-card__reasons" });
      reasons.forEach((reason, index) => {
        list.appendChild(el("li", {}, [
          el("span", { class: "idx", text: CIRCLED[index] || `${index + 1}.` }),
          el("span", {}, [el("b", { text: reason.heavy }), reason.rest]),
        ]));
      });
      card.appendChild(list);
    }

    const facts = el("p", { class: "ai-card__facts" });
    if ((entry.hit_items || []).length) {
      facts.appendChild(el("span", {}, ["命中采集项 ", el("b", { text: entry.hit_items.join("、") })]));
    }
    if ((entry.hit_scenarios || []).length) {
      facts.appendChild(el("span", {}, ["命中场景 ", el("b", { text: entry.hit_scenarios.join("、") })]));
    }
    if (typeof entry.max_score_gain === "number" && entry.max_score_gain > 0) {
      facts.appendChild(el("span", {}, ["可提升上限 ", el("b", { text: entry.max_score_gain.toFixed(2) + " 分" })]));
    }
    if (entry.case_ref) {
      facts.appendChild(el("span", {}, ["案例 ", el("b", { text: entry.case_ref })]));
    }
    if (facts.childNodes.length) card.appendChild(facts);

    card.appendChild(actionButtons(entry, refs, opts.onCopy));
    return card;
  }

  window.AdvisorUI = { createAiCard };
})();
