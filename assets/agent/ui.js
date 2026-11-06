/* ui.js —— 问答页界面：账号门、对话流、调用链、可观测面板
 * 纯 DOM；不依赖框架。所有回答内容由 agent.js 产出，本文件只负责显示与记录。
 */
(() => {
  "use strict";

  const DEMO_CODE = "shuzhi-2026";
  const STORE_KEY = "advisor.ask.user";
  const LOG_KEY = "advisor.ask.log";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    session: null,
    sample: null,
    user: null,
    events: [],
    busy: false,
    startedAt: 0,
    lastOtel: null,
  };

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child == null) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  /* ---------------- 账号门（演示级） ---------------- */

  function currentUser() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) { return null; }
  }

  function renderGate() {
    const gate = $("#ask-gate");
    const form = $("#gate-form");
    gate.hidden = false;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = $("#gate-name").value.trim() || "评委";
      const code = $("#gate-code").value.trim();
      if (code !== DEMO_CODE) {
        $("#gate-error").textContent = "访问码不对。演示访问码是 shuzhi-2026";
        return;
      }
      state.user = { name, at: new Date().toISOString() };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(state.user));
      gate.hidden = true;
      start();
    });
    $("#gate-name").focus();
  }

  /* ---------------- 数据 ---------------- */

  async function loadFixtures() {
    const listing = await fetch("data/fixtures.json").then((r) => r.json());
    const fixtures = listing.fixtures || [];
    const select = $("#ask-fixture");
    select.textContent = "";
    fixtures.forEach((fixture) => {
      const score = fixture.total_score == null ? "—" : Number(fixture.total_score).toFixed(2);
      select.appendChild(el("option", {
        value: fixture.name,
        text: `${fixture.label}（${score} 分 · ${fixture.level_name || "无等级"}）`,
      }));
    });
    const preferred = fixtures.find((f) => f.name.startsWith("ap1")) || fixtures[0];
    select.value = preferred.name;
    await loadSample(preferred.name, preferred.label);
  }

  async function loadSample(name, label) {
    state.sample = await fetch("data/samples/" + encodeURIComponent(name)).then((r) => r.json());
    state.sample._label = label || name.replace(/\.json$/, "");
    state.session = window.AdvisorAgent.createSession(name);
    resetChat();
  }

  /* ---------------- 对话 ---------------- */

  function resetChat() {
    const flow = $("#ask-flow");
    flow.textContent = "";
    push("bot", {
      blocks: [{
        type: "p",
        text: `已载入示例企业「${state.sample._label || "合成样本"}」。可以问我：现在几级、差多少分、先改哪一步、有哪些政策依据。`,
      }],
      citations: [],
      suggested: [
        "我现在是什么等级？",
        `还差多少分到 ${Math.min(4, ((state.sample.result.evaluation || {}).level || 0) + 1)} 级？`,
        "先改哪一步？",
        "有哪些政策依据？",
      ],
    });
  }

  function push(role, payload) {
    const flow = $("#ask-flow");
    const wrap = el("div", { class: `msg msg--${role}` });
    const bubble = el("div", { class: "bubble" });

    if (role === "user") {
      bubble.appendChild(el("p", { text: payload }));
    } else {
      (payload.blocks || []).forEach((block) => bubble.appendChild(renderBlock(block)));
      if (payload.citations && payload.citations.length) {
        bubble.appendChild(renderCitations(payload));
      }
      if (payload.fallback) {
        bubble.appendChild(el("p", { class: "bubble__flag", text: "这条是兜底回答：只给原文，不下结论。" }));
      }
      if (payload.suggested && payload.suggested.length) {
        bubble.appendChild(el("div", { class: "chips" },
          payload.suggested.map((text) => el("button", {
            class: "chip", type: "button", text,
            onclick: () => send(text),
          }))));
      }
    }

    wrap.appendChild(bubble);
    flow.appendChild(wrap);
    flow.scrollTop = flow.scrollHeight;
    return wrap;
  }

  function renderBlock(block) {
    if (block.type === "p") return el("p", { class: "bubble__p", text: block.text });
    if (block.type === "note") return el("p", { class: "bubble__note", text: block.text });
    if (block.type === "kv") {
      const dl = el("dl", { class: "bubble__kv" });
      block.rows.forEach(([k, v]) => {
        dl.appendChild(el("div", { class: "bubble__row" }, [
          el("dt", { text: k }), el("dd", { text: v }),
        ]));
      });
      return dl;
    }
    if (block.type === "list") {
      const ul = el("ul", { class: "bubble__list" });
      block.items.forEach((item) => {
        const li = el("li", {});
        li.appendChild(el("strong", { text: item.title }));
        if (item.meta) li.appendChild(el("span", { class: "bubble__meta", text: item.meta }));
        if (item.body) {
          // 对话里只给摘要，完整原文在「查看依据」抽屉里
          const text = String(item.body);
          li.appendChild(el("p", {
            class: "bubble__body",
            text: text.length > 120 ? text.slice(0, 120) + "…" : text,
          }));
        }
        ul.appendChild(li);
      });
      return ul;
    }
    return el("p", { class: "bubble__p", text: String(block.text || "") });
  }

  function renderCitations(payload) {
    const count = payload.citations.length;
    const wrap = el("div", { class: "cites" });
    wrap.appendChild(el("button", {
      class: "cites__btn",
      type: "button",
      text: `查看依据 · ${count} 条`,
      onclick: () => {
        window.AdvisorProvenance.open({
          title: "回答引用的依据",
          subtitle: `${count} 条 · 官方原文与知识库检索结果`,
          refs: payload.citations,
        });
      },
    }));
    return wrap;
  }

  async function send(text) {
    if (state.busy || !text) return;
    state.busy = true;
    push("user", text);
    $("#ask-input").value = "";
    const thinking = push("bot", { blocks: [{ type: "p", text: "…" }] });
    thinking.classList.add("is-thinking");
    const t0 = performance.now();

    try {
      const out = await window.AdvisorAgent.ask(text, {
        result: state.sample.result,
        sample: state.sample,
        session: state.session,
      }, (event) => {
        if (event.type === "node" && event.status === "running") {
          $("#trace-status").textContent = `正在${event.label}…`;
        }
      });

      thinking.remove();
      push("bot", out.answer || { blocks: [{ type: "p", text: "我没有组织出答案。" }] });
      renderTrace(out.trace);
      state.lastOtel = out.otel;
      record({ q: text, intent: out.intent, tools: out.tools, ms: out.ms, citations: (out.answer && out.answer.citations.length) || 0, fallback: Boolean(out.answer && out.answer.fallback), verified: out.verified });
    } catch (error) {
      thinking.remove();
      push("bot", { blocks: [{ type: "p", text: "这一轮出错了：" + error.message }] });
      record({ q: text, intent: "error", tools: [], ms: Math.round(performance.now() - t0), citations: 0, error: String(error.message) });
    } finally {
      state.busy = false;
      $("#trace-status").textContent = "";
      $("#ask-input").focus();
    }
  }

  /* ---------------- 调用链 ---------------- */

  function renderTrace(trace) {
    const host = $("#trace-list");
    host.textContent = "";
    trace.forEach((node, i) => {
      host.appendChild(el("li", { "data-status": node.status }, [
        el("span", { class: "trace__idx", text: String(i + 1).padStart(2, "0") }),
        el("span", { class: "trace__label", text: node.label }),
        el("span", { class: "trace__meta", text: node.status === "skipped" ? "跳过" : `${node.ms} ms` }),
      ]));
    });
  }

  /* ---------------- 可观测 ---------------- */

  function record(event) {
    state.events.push({ t: new Date().toISOString(), ...event });
    try { localStorage.setItem(LOG_KEY, JSON.stringify(state.events.slice(-200))); } catch (e) { /* 存储满就算了 */ }
    renderMetrics();
  }

  function renderMetrics() {
    const events = state.events;
    const asked = events.length;
    const toolCalls = events.reduce((sum, e) => sum + (e.tools ? e.tools.length : 0), 0);
    const cited = events.filter((e) => e.citations > 0).length;
    const fallbacks = events.filter((e) => e.fallback).length;
    const p50 = (() => {
      const list = events.map((e) => e.ms).filter((n) => typeof n === "number").sort((a, b) => a - b);
      return list.length ? list[Math.floor(list.length / 2)] : 0;
    })();
    const rows = [
      ["提问轮次", String(asked)],
      ["工具调用", String(toolCalls)],
      ["带依据的回答", asked ? `${cited} / ${asked}` : "—"],
      ["兜底回答", String(fallbacks)],
      ["中位耗时", p50 ? `${p50} ms` : "—"],
    ];
    const dl = $("#metrics");
    dl.textContent = "";
    rows.forEach(([k, v]) => {
      dl.appendChild(el("div", { class: "metrics__row" }, [
        el("dt", { text: k }), el("dd", { text: v }),
      ]));
    });
    const list = $("#event-list");
    list.textContent = "";
    events.slice(-8).reverse().forEach((e) => {
      list.appendChild(el("li", {}, [
        el("code", { text: e.intent || "?" }),
        el("span", { text: ` ${e.tools && e.tools.length ? e.tools.join("→") : "无工具"} · ${e.ms}ms · 引用 ${e.citations}` }),
      ]));
    });
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportLog() {
    download(
      `ask-log-${Date.now()}.jsonl`,
      state.events.map((e) => JSON.stringify(e)).join("\n"),
      "application/x-ndjson",
    );
  }

  /* ---------------- 启动 ---------------- */

  async function start() {
    if (state.startedAt) return;
    state.startedAt = Date.now();
    await loadFixtures();
    renderMetrics();

    $("#ask-form").addEventListener("submit", (event) => {
      event.preventDefault();
      send($("#ask-input").value.trim());
    });
    $("#ask-fixture").addEventListener("change", async (event) => {
      const option = event.target.selectedOptions[0];
      await loadSample(event.target.value, option ? option.textContent.split("（")[0] : "");
    });
    $("#export-log").addEventListener("click", exportLog);
    $("#export-trace").addEventListener("click", () => {
      if (!state.lastOtel) {
        $("#trace-status").textContent = "还没有可导出的 trace";
        setTimeout(() => { $("#trace-status").textContent = ""; }, 2000);
        return;
      }
      download(`ask-trace-${Date.now()}.json`, JSON.stringify(state.lastOtel, null, 2), "application/json");
    });
    $$(".ask-suggest button").forEach((btn) => {
      btn.addEventListener("click", () => send(btn.dataset.q || btn.textContent));
    });
    $("#ask-input").focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      const saved = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      if (Array.isArray(saved)) state.events = saved;
    } catch (error) { state.events = []; }

    state.user = currentUser();
    if (!state.user) {
      renderGate();
      return;
    }
    $("#ask-gate").hidden = true;
    start();
  });
})();
