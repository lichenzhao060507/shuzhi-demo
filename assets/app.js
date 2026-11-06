/* 数改指导智能体 · 应用层
 *
 * 两条数据通路，一套渲染：
 *   示例企业 → 读 site/data/samples/*.json（后端预计算结果，含 ROI 与政策注记，保真）
 *   自定义画像 → assets/engine.js 前端实时计算（算分定级精确对齐，投入产出需成本库）
 */
(() => {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    criteria: null,
    fixtures: [],
    samples: new Map(),
    preview: null,
    lastResult: null,
    lastMode: null,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  const SAMPLE_DIR = "data/samples/";

  /* ------------------------------------------------------------ 工具 */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "style") node.setAttribute("style", value);
        else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2), value);
        } else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, value);
      }
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  const fmt = (value, digits) =>
    typeof value === "number" && isFinite(value) ? value.toFixed(digits) : "—";

  const LEVEL_NAMES = ["无等级", "初始级", "规范级", "集成级", "协同级"];

  /* 距下一级还差多少：统一从 evaluation 的场景计数推导，不依赖后端的 detail 字段 */
  function shortageText(judgement, evaluation) {
    const parts = [];
    const level = judgement.level;
    if (evaluation.total_score < judgement.min_score) {
      parts.push(`${fmt(judgement.min_score - evaluation.total_score, 2)} 分`);
    }
    const scenarios = (evaluation.scenario_count_by_level || {})[level] || 0;
    if (scenarios < judgement.min_scenarios) {
      parts.push(`${judgement.min_scenarios - scenarios} 个场景`);
    }
    const constraints = (evaluation.constraint_count_by_level || {})[level] || 0;
    if (constraints < judgement.min_constraint_scenarios) {
      parts.push(`${judgement.min_constraint_scenarios - constraints} 个约束性场景`);
    }
    return parts.length ? `差 ${parts.join("、")}` : "三项门槛已达标";
  }

  async function fetchJSON(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response.json();
  }

  /* ------------------------------------------------------------ 数字滚动 */

  function countUp(node, target, options) {
    const opts = options || {};
    const digits = opts.digits === undefined ? 2 : opts.digits;
    const duration = opts.duration || 1000;
    if (state.reduced) { node.textContent = target.toFixed(digits); return; }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      node.textContent = (target * ease(progress)).toFixed(digits);
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* Long jumps are task navigation, not a multi-screen cinematic pan. */
  function navigateTo(node) {
    if (!node) return;
    const distance = Math.abs(node.getBoundingClientRect().top);
    const longJump = distance > window.innerHeight * 1.4;
    node.scrollIntoView({
      behavior: state.reduced || longJump ? "instant" : "smooth",
      block: "start",
    });
  }

  /* ------------------------------------------------------------ 滚动进入 */

  let revealObserver = null;

  function observeReveals(root) {
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    }
    $$(".reveal", root || document).forEach((node) => revealObserver.observe(node));
  }

  function revealNow(node, delay) {
    if (!node) return;
    if (state.reduced) { node.classList.add("in"); return; }
    node.style.transitionDelay = `${delay || 0}ms`;
    requestAnimationFrame(() => node.classList.add("in"));
  }

  /* ------------------------------------------------------------ 刻度尺 */

  function paintRail(fill, knob, score) {
    if (!fill || !knob) return;
    const pct = Math.max(0, Math.min(100, Number(score) || 0));
    if (state.reduced) {
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      return;
    }
    fill.style.width = "0%";
    knob.style.left = "0%";
    requestAnimationFrame(() => {
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
    });
  }

  /* ------------------------------------------------------------ 启动 */

  async function boot() {
    bindChrome();
    try {
      state.criteria = await fetchJSON("data/criteria.json");
      const listing = await fetchJSON("data/fixtures.json");
      state.fixtures = listing.fixtures || [];
      try {
        const policy = await fetchJSON("data/policy-notes.json");
        state.policyNotes = policy.notes || [];
      } catch (error) {
        state.policyNotes = [];
      }
    } catch (error) {
      setStatus("判据载入失败", "error");
      $("#form-status").textContent = "加载判据失败：" + error.message;
      return;
    }

    setStatus("前端实时计算", "online");
    $("#footer-mode").textContent = "前端实时计算 · 无后端依赖";

    renderForm();
    renderFixturePicker();
    bindForm();
    observeReveals(document);
    // 首屏改为摄影图，不再载入示例样本
  }

  function setStatus(text, stateName) {
    const chip = $("#status-chip");
    if (!chip) return;
    chip.textContent = text;
    chip.dataset.state = stateName || "loading";
  }

  /* ------------------------------------------------------------ 预览卡 */

  async function loadPreview() {
    const preferred = state.fixtures.find((f) => f.name.startsWith("ap1")) || state.fixtures[1];
    if (!preferred) return;
    try {
      const sample = await fetchSample(preferred.name);
      state.preview = sample;
      state.samples.set(preferred.name, sample);
      paintPreview(sample, preferred);
    } catch (error) {
      $("#stage-kicker").textContent = "预览不可用";
    }
  }

  function paintPreview(sample, fixture) {
    const evaluation = sample.result.evaluation;
    const scenarioLevels = sample.profile.scenario_levels || {};
    const matrix = $("#matrix");

    matrix.textContent = "";
    state.criteria.scenarios.forEach((scenario, index) => {
      const level = Number(scenarioLevels[scenario.id] || 1) || 1;
      matrix.appendChild(el("div", {
        class: "cell" + (scenario.constraint ? " is-constraint" : ""),
        "data-lv": String(level),
        style: `--d:${index * 40}ms`,
        title: `${scenario.id} ${scenario.name} · ${level} 级${scenario.constraint ? " · 约束性" : ""}`,
      }));
    });
    requestAnimationFrame(() => {
      $$(".cell", matrix).forEach((cell) => cell.classList.add("in"));
    });

    $("#stage-kicker").textContent = (fixture && fixture.label) || "示例企业";
    countUp($("#stage-score"), evaluation.total_score, { digits: 2, duration: 1300 });
    $("#stage-level").textContent = `${evaluation.level_name} · 16 个场景中 ${
      Object.values(scenarioLevels).filter((v) => Number(v) >= 2).length} 个达到二级`;

    const next = (sample.result.level_judgement || []).find((j) => !j.satisfied && j.level === (evaluation.level || 0) + 1);
    if (!next) {
      $("#stage-gap").textContent = "四个等级已全部达标";
    } else {
      const parts = [];
      if (evaluation.total_score < next.min_score) parts.push(`${fmt(next.min_score - evaluation.total_score, 1)} 分`);
      const sc = (evaluation.scenario_count_by_level || {})[next.level] || 0;
      if (sc < next.min_scenarios) parts.push(`${next.min_scenarios - sc} 场景`);
      const cc = (evaluation.constraint_count_by_level || {})[next.level] || 0;
      if (cc < next.min_constraint_scenarios) parts.push(`${next.min_constraint_scenarios - cc} 约束场景`);
      $("#stage-gap").textContent = `距 ${next.level} 级还差 ${parts.join(" · ")}`;
    }
  }

  /* ------------------------------------------------------------ 表单 */

  function renderForm() {
    const indicatorHost = $("#indicator-groups");
    indicatorHost.textContent = "";
    const byPrimary = new Map();
    for (const indicator of state.criteria.indicators) {
      if (!byPrimary.has(indicator.primary)) byPrimary.set(indicator.primary, []);
      byPrimary.get(indicator.primary).push(indicator);
    }

    let index = 0;
    for (const [primary, items] of byPrimary) {
      const weight = items[0].primary_weight;
      const answers = () => items.filter((i) => isAnswered(i)).length;
      const group = el("details", { class: "acc", open: index === 0 });
      const dots = el("span", { class: "dots", "data-dots": primary });
      for (let i = 0; i < items.length; i += 1) dots.appendChild(el("span", { class: "dot" }));

      group.appendChild(el("summary", {}, [
        el("span", { class: "caret", text: "▸" }),
        primary,
        el("span", { class: "count", text: `${items.length} 项 · 权重 ${(weight * 100).toFixed(0)}%` }),
        dots,
      ]));
      const body = el("div", { class: "acc-body" });
      for (const indicator of items) body.appendChild(renderIndicator(indicator));
      group.appendChild(body);
      indicatorHost.appendChild(group);
      index += 1;
    }

    const scenarioHost = $("#scenario-groups");
    scenarioHost.textContent = "";
    const byScenarioPrimary = new Map();
    for (const scenario of state.criteria.scenarios) {
      if (!byScenarioPrimary.has(scenario.primary)) byScenarioPrimary.set(scenario.primary, []);
      byScenarioPrimary.get(scenario.primary).push(scenario);
    }

    index = 0;
    for (const [primary, scenarios] of byScenarioPrimary) {
      const constraintCount = scenarios.filter((s) => s.constraint).length;
      const group = el("details", { class: "acc", open: index === 0 });
      group.appendChild(el("summary", {}, [
        el("span", { class: "caret", text: "▸" }),
        primary,
        el("span", { class: "count", text: `${scenarios.length} 个场景 · 约束性 ${constraintCount} 个` }),
      ]));
      const body = el("div", { class: "acc-body" });
      for (const scenario of scenarios) body.appendChild(renderScenario(scenario));
      group.appendChild(body);
      scenarioHost.appendChild(group);
      index += 1;
    }
  }

  function isAnswered(indicator) {
    if (indicator.option_type === "单选") {
      const select = $(`select[data-role="single"][data-indicator="${indicator.id}"]`);
      return Boolean(select && select.value);
    }
    return Boolean($(`input[data-role="multi"][data-indicator="${indicator.id}"]:checked`));
  }

  function renderIndicator(indicator) {
    const wrap = el("div", { class: "item", "data-indicator": indicator.id });
    wrap.appendChild(el("div", { class: "item-head" }, [
      el("span", { class: "item-no", text: String(indicator.id) }),
      el("span", { class: "item-title", text: indicator.title }),
      el("span", {
        class: "item-meta",
        text: `${indicator.option_type} · 权重链 ${(indicator.chain_weight * 100).toFixed(1)}% · 满分 ${indicator.max_points}` +
          (indicator.official_rule_gap ? " · 官方评分规则未覆盖（等距线性兜底）" : ""),
      }),
    ]));

    const body = el("div", { class: "item-body" });
    if (indicator.option_type === "单选") {
      const select = el("select", {
        "data-role": "single",
        "data-indicator": indicator.id,
        id: `indicator-${indicator.id}`,
        onchange: updateProgress,
      });
      select.appendChild(el("option", { value: "", text: "— 请选择 —" }));
      for (const option of indicator.options) {
        select.appendChild(el("option", { value: option, text: option }));
      }
      body.appendChild(select);
    } else {
      const list = el("div", { class: "opts" });
      indicator.options.forEach((option, optionIndex) => {
        const input = el("input", {
          type: "checkbox",
          value: option,
          "data-role": "multi",
          "data-indicator": indicator.id,
          id: `indicator-${indicator.id}-${optionIndex}`,
        });
        input.addEventListener("change", () => { onMultiChange(input); updateProgress(); });
        list.appendChild(el("label", { class: "opt", for: `indicator-${indicator.id}-${optionIndex}` }, [
          input,
          el("span", { text: option }),
        ]));
      });
      body.appendChild(list);
    }
    wrap.appendChild(body);
    return wrap;
  }

  function onMultiChange(input) {
    const indicatorId = input.dataset.indicator;
    const boxes = () => $$(`input[data-role="multi"][data-indicator="${indicatorId}"]`);
    if (input.value === "无") {
      if (input.checked) boxes().forEach((box) => { if (box !== input) box.checked = false; });
    } else if (input.checked) {
      boxes().forEach((box) => { if (box.value === "无") box.checked = false; });
    }
  }

  function renderScenario(scenario) {
    const wrap = el("div", { class: "item", "data-scenario": scenario.id });
    wrap.appendChild(el("div", { class: "item-head" }, [
      el("span", { class: "item-no", text: scenario.id }),
      el("span", { class: "item-title", text: scenario.name }),
      el("span", {
        class: "item-meta",
        text: `${scenario.primary} · ${scenario.constraint ? "约束性场景（官方标 *）" : "指导性场景"}`,
      }),
    ]));

    const desc = el("p", { class: "level-desc none", text: "尚未选择等级。官方要求：应在完全满足低级场景的所有基本要求之后，方可进阶至更高一级场景的判定。" });
    const radios = el("div", { class: "level-radios" });

    [1, 2, 3, 4].forEach((level) => {
      const input = el("input", {
        type: "radio",
        name: `scenario-${scenario.id}`,
        value: String(level),
        id: `scenario-${scenario.id}-${level}`,
        "data-role": "scenario",
        "data-scenario": scenario.id,
      });
      input.addEventListener("change", () => {
        desc.className = "level-desc";
        desc.textContent = `${level} 级：${scenario.levels[String(level)]}`;
        updateProgress();
      });
      radios.appendChild(el("label", { class: "level-radio", for: `scenario-${scenario.id}-${level}` }, [
        input,
        el("span", { text: `${level} 级` }),
      ]));
    });

    const official = el("details", { class: "official-levels" });
    official.appendChild(el("summary", { text: "查看官方四级判定要求（逐字原文）" }));
    const dl = el("dl");
    [1, 2, 3, 4].forEach((level) => {
      dl.appendChild(el("dt", { text: `${level} 级` }));
      dl.appendChild(el("dd", { text: scenario.levels[String(level)] }));
    });
    official.appendChild(dl);

    wrap.appendChild(el("div", { class: "item-body" }, [radios]));
    wrap.appendChild(desc);
    wrap.appendChild(official);
    return wrap;
  }

  function renderFixturePicker() {
    const select = $("#fixture-select");
    select.textContent = "";
    for (const fixture of state.fixtures) {
      select.appendChild(el("option", {
        value: fixture.name,
        text: `${fixture.label}（${fmt(fixture.total_score, 2)} 分 · ${fixture.level_name}）`,
      }));
    }
  }

  /* ------------------------------------------------------------ 进度 */

  function updateProgress() {
    if (!state.criteria) return;
    const totalIndicators = state.criteria.indicators.length;
    const totalScenarios = state.criteria.scenarios.length;
    const doneIndicators = state.criteria.indicators.filter(isAnswered).length;
    const doneScenarios = $$('input[data-role="scenario"]:checked').length;
    const done = doneIndicators + doneScenarios;
    const total = totalIndicators + totalScenarios;

    const bar = $("#progress");
    if (bar) bar.hidden = false;
    $("#progress-fill").style.width = `${(done / total) * 100}%`;
    $("#progress-text").textContent = `${done} / ${total}　采集项 ${doneIndicators}/${totalIndicators} · 场景 ${doneScenarios}/${totalScenarios}`;

    for (const [primary, items] of groupBy(state.criteria.indicators, "primary")) {
      const dots = $(`[data-dots="${primary}"]`);
      if (!dots) continue;
      const answered = items.filter(isAnswered).length;
      $$(".dot", dots).forEach((dot, index) => dot.classList.toggle("on", index < answered));
    }
  }

  function groupBy(list, key) {
    const map = new Map();
    for (const item of list) {
      if (!map.has(item[key])) map.set(item[key], []);
      map.get(item[key]).push(item);
    }
    return map;
  }

  /* ------------------------------------------------------------ 表单读写 */

  function applyProfile(profile) {
    $("#f-name").value = profile.name || "";
    $("#f-revenue").value = profile.revenue_wan ?? "";
    $("#f-spend").value = profile.digital_spend_wan ?? "";
    $("#f-energy").value = profile.energy_wan ?? "";
    $("#f-headcount").value = profile.headcount ?? "";
    $("#f-cost").value = profile.cost_wan ?? "";
    $("#f-province").value = profile.province || "";

    for (const indicator of state.criteria.indicators) {
      const selected = (profile.answers || {})[String(indicator.id)] || [];
      if (indicator.option_type === "单选") {
        const select = $(`select[data-role="single"][data-indicator="${indicator.id}"]`);
        if (select) select.value = selected[0] || "";
      } else {
        $$(`input[data-role="multi"][data-indicator="${indicator.id}"]`)
          .forEach((box) => { box.checked = selected.includes(box.value); });
      }
    }

    for (const scenario of state.criteria.scenarios) {
      const level = (profile.scenario_levels || {})[scenario.id] || 0;
      $$(`input[data-role="scenario"][data-scenario="${scenario.id}"]`)
        .forEach((input) => { input.checked = Number(input.value) === level; });
      const desc = $(`.item[data-scenario="${scenario.id}"] .level-desc`);
      if (desc && level) {
        desc.className = "level-desc";
        desc.textContent = `${level} 级：${scenario.levels[String(level)]}`;
      }
    }
    updateProgress();
  }

  function collectProfile() {
    const answers = {};
    for (const indicator of state.criteria.indicators) {
      if (indicator.option_type === "单选") {
        const select = $(`select[data-role="single"][data-indicator="${indicator.id}"]`);
        if (select && select.value) answers[String(indicator.id)] = [select.value];
      } else {
        const picked = $$(`input[data-role="multi"][data-indicator="${indicator.id}"]:checked`)
          .map((box) => box.value);
        if (picked.length) answers[String(indicator.id)] = picked;
      }
    }

    const scenarioLevels = {};
    for (const scenario of state.criteria.scenarios) {
      const checked = $(`input[data-role="scenario"][data-scenario="${scenario.id}"]:checked`);
      if (checked) scenarioLevels[scenario.id] = Number(checked.value);
    }

    const number = (id) => {
      const raw = $(id).value.trim();
      if (raw === "") return null;
      const value = Number(raw);
      return isFinite(value) ? value : null;
    };

    return {
      name: $("#f-name").value.trim() || "未命名企业",
      provenance: "用户现场填写",
      answers,
      scenario_levels: scenarioLevels,
      revenue_wan: number("#f-revenue"),
      digital_spend_wan: number("#f-spend"),
      energy_wan: number("#f-energy"),
      headcount: number("#f-headcount"),
      cost_wan: number("#f-cost"),
      province: $("#f-province").value.trim(),
    };
  }

  /* ------------------------------------------------------------ 诊断生成 */

  function buildEvidenceItem(indicator, criteria) {
    return {
      kind: "采集项",
      ref: `采集项 ${indicator.id}`,
      title: `${indicator.item}：${indicator.title}`,
      quote: `选项：${(indicator.options || []).join(" ／ ")}`,
      doc: criteria.source.indicators,
      url: null,
    };
  }

  function itemGain(item) {
    return item.max_points - item.points;
  }

  function buildDiagnosis(criteria, computed, profile) {
    const items = computed.item_results;
    const byId = new Map(items.map((item) => [item.id, item]));
    const levels = profile.scenario_levels || {};
    const scenarios = criteria.scenarios;
    const diagnosis = [];
    const total = computed.evaluation.total_score;

    const optionIndex = (id) => {
      const item = byId.get(id);
      if (!item) return -1;
      return item.options.indexOf((item.selected || [])[0]);
    };

    const scenarioLevel = (id) => levels[id] || 1;
    const scenarioName = (id) => (scenarios.find((s) => s.id === id) || {}).name || id;

    /* AP1 只买设备不联网 */
    if (optionIndex(2) >= 3 && optionIndex(3) >= 0 && optionIndex(3) <= 1) {
      const hit = [2, 3];
      diagnosis.push({
        bottleneck_type: "基础断层·设备侧",
        bottleneck: "设备已购入但未联网，数据流在设备侧断掉",
        evidence: `设备数字化率 ${byId.get(2).selected[0]}，设备联网率 ${byId.get(3).selected[0]}。判据：采集项 2 设备数字化率 ≥(40%,60%] 且 采集项 3 设备联网率 ≤(10%,20%]`,
        hit_items: hit,
        hit_scenarios: ["S08"],
        max_score_gain: Math.round((itemGain(byId.get(2)) + itemGain(byId.get(3)) + itemGain(byId.get(4))) * 100) / 100,
        basis_kind: "本项目构造的判据（拼自官方采集项与附件（二）场景判定），非官方口径",
        evidence_refs: hit.map((id) => buildEvidenceItem(byId.get(id), criteria)),
        _pattern: "AP1",
      });
    }

    /* AP2 只上系统不跑流程 */
    const item5 = byId.get(5);
    const item5Index = item5 ? item5.options.indexOf((item5.selected || [])[0]) : -1;
    const weakFlow = ["S06", "S07"].filter((id) => scenarioLevel(id) <= 1);
    if (item5Index >= 3 && weakFlow.length > 0) {
      diagnosis.push({
        bottleneck_type: "流程断层·系统空转",
        bottleneck: "系统覆盖面上去了，但生产管控与质量管理还停在一级",
        evidence: `系统覆盖 ${item5.selected[0]}；${weakFlow.map((id) => `${scenarioName(id)}`).join("、")} 场景仍在一级。判据：采集项 5 覆盖绝大部分业务环节或全覆盖，但生产管控／质量管理场景仍为一级`,
        hit_items: [5],
        hit_scenarios: weakFlow,
        max_score_gain: 0,
        basis_kind: "本项目构造的判据（拼自官方采集项与附件（二）场景判定），非官方口径",
        evidence_refs: [buildEvidenceItem(item5, criteria)],
        _pattern: "AP2",
      });
    }

    /* AP3 只做数据采集不做分析 */
    const item4 = byId.get(4);
    const covered = item4 ? (item4.selected || []).filter((v) => v !== "无").length : 0;
    if (covered >= 6 && scenarioLevel("S16") <= 1) {
      diagnosis.push({
        bottleneck_type: "分析断层·只采不用",
        bottleneck: "数据采上来了，但没有进到决策环节",
        evidence: `已覆盖 ${covered} 个环节；决策支持场景仍在一级。判据：采集项 4 自动采集覆盖环节数 ≥6，但决策支持场景仍为一级`,
        hit_items: [4],
        hit_scenarios: ["S16"],
        max_score_gain: 0,
        basis_kind: "本项目构造的判据（拼自官方采集项与附件（二）场景判定），非官方口径",
        evidence_refs: [buildEvidenceItem(item4, criteria)],
        _pattern: "AP3",
      });
    }

    /* AP4 只追补贴不建能力 */
    if (optionIndex(11) >= 2 && total < 40) {
      const base = computed.evaluation.dimension_scores["数字化基础"] || 0;
      const manage = computed.evaluation.dimension_scores["数字化管理"] || 0;
      diagnosis.push({
        bottleneck_type: "投入断层·钱没落到能力上",
        bottleneck: "投入占比不低，但分数够不到规范级",
        evidence: `投入占比 ${byId.get(11).selected[0]}；总分 ${fmt(total, 1)}；基础+管理 ${fmt(base + manage, 1)} 分。判据：采集项 11 数字化投入占营业额 ≥(20%,40%]，但总分 <40 分（够不到二级规范级）`,
        hit_items: [11],
        hit_scenarios: [],
        max_score_gain: Math.round(itemGain(byId.get(11)) * 100) / 100,
        basis_kind: "本项目构造的判据（拼自官方采集项与附件（二）场景判定），非官方口径",
        evidence_refs: [buildEvidenceItem(byId.get(11), criteria)],
        _pattern: "AP4",
      });
    }

    /* 约束性场景断层 */
    const constraintStuck = scenarios
      .filter((s) => s.constraint && scenarioLevel(s.id) <= 1)
      .map((s) => s.id);
    if (constraintStuck.length >= 3) {
      diagnosis.push({
        bottleneck_type: "场景断层·约束性场景未进阶",
        bottleneck: `${constraintStuck.length} 个约束性场景还停在一级，等级门槛上不去`,
        evidence: constraintStuck.map((id) => `${id}「${scenarioName(id)}」当前 ${scenarioLevel(id)}`).join("；") +
          "。约束性场景（官方标 *）是引导深度改造的重点场景，二级判定要求见附件（二）；场景层不直接计分，但直接卡等级门槛。",
        hit_items: [],
        hit_scenarios: constraintStuck,
        max_score_gain: 0,
        basis_kind: "官方附件（二）场景等级判定要求",
        evidence_refs: constraintStuck.slice(0, 4).map((id) => {
          const scenario = scenarios.find((s) => s.id === id);
          return {
            kind: "场景",
            ref: id,
            title: scenario.name,
            quote: `当前 ${scenarioLevel(id)} 级；2 级要求：${scenario.levels["2"]}`,
            doc: criteria.source.scenarios,
            url: null,
          };
        }),
      });
    }

    /* 等级缺口 */
    const nextUnmet = (computed.level_judgement || []).find(
      (j) => !j.satisfied && j.level === (computed.evaluation.level || 0) + 1
    );
    if (nextUnmet) {
      const ranked = items.slice().sort((a, b) => itemGain(b) - itemGain(a)).slice(0, 3);
      diagnosis.push({
        bottleneck_type: "等级缺口",
        bottleneck: `距 ${nextUnmet.level} 级（${nextUnmet.name}）还差门槛`,
        evidence: nextUnmet.note,
        hit_items: ranked.map((item) => item.id).sort((a, b) => a - b),
        hit_scenarios: [],
        max_score_gain: Math.round(ranked.reduce((sum, item) => sum + itemGain(item), 0) * 100) / 100,
        basis_kind: "官方附件（二）二、判定方法（得分与场景数须同时满足）",
        evidence_refs: nextUnmet.level
          ? [{
            kind: "等级门槛",
            ref: `${nextUnmet.level} 级门槛`,
            title: `${nextUnmet.name}判定条件`,
            quote: nextUnmet.note,
            doc: criteria.source.scenarios + " 二、判定方法",
            url: null,
          }]
          : [],
      });
    }

    /* 一级指标短板 */
    const weakest = (computed.dimension_gaps || [])[0];
    if (weakest && weakest.rate < 0.62) {
      const pool = items.filter((item) => item.primary === weakest.name);
      const worst = pool.slice().sort((a, b) => (a.points / a.max_points) - (b.points / b.max_points)).slice(0, 3);
      const gain = worst.reduce((sum, item) => sum + itemGain(item), 0);
      diagnosis.push({
        bottleneck_type: "基础缺口·一级指标",
        bottleneck: `${weakest.name}维度偏低，${
          weakest.name === "数字化基础" ? "设备与数据底座还没打牢"
            : weakest.name === "数字化管理" ? "机制与人才还没跟上"
              : "改造成效还没落到指标上"
        }`,
        evidence: `${weakest.name}得分 ${fmt(weakest.got, 2)} / ${fmt(weakest.max, 0)}（得分率 ${(weakest.rate * 100).toFixed(1)}%）；` +
          `其中 ${worst.map((item) => `采集项 ${item.id}「${item.item}」${fmt(item.points, 2)} 分`).join("、")}`,
        hit_items: worst.map((item) => item.id).sort((a, b) => a - b),
        hit_scenarios: [],
        max_score_gain: Math.round(gain * 100) / 100,
        basis_kind: `官方附件（一）权重体系（一级指标权重 ${(weakest.max / 100 * 100).toFixed(0)}%）`,
        evidence_refs: worst.map((item) => buildEvidenceItem(item, criteria)),
      });
    }

    return diagnosis;
  }

  /* ------------------------------------------------------------ 路径生成 */

  const SCENARIO_ITEM_MAP = (criteria) => {
    const map = new Map();
    criteria.scenarios.forEach((scenario) => {
      const linked = criteria.indicators
        .filter((indicator) => (indicator.options || []).includes(scenario.name))
        .map((indicator) => indicator.id);
      map.set(scenario.id, linked);
    });
    return map;
  };

  function buildPathway(criteria, computed, profile) {
    const gaps = computed.gaps;
    if (!gaps || !gaps.target) return [];
    const linkMap = SCENARIO_ITEM_MAP(criteria);
    const rows = gaps.rows.slice(0, 6);

    return rows.map((row, index) => {
      const scenario = criteria.scenarios.find((s) => s.id === row.id);
      const linked = linkMap.get(row.id) || [];
      return {
        step: index + 1,
        action: `${row.name}补到 ${gaps.target.level} 级`,
        target_scenario: `${row.id}${row.constraint ? "（约束性）" : ""}`,
        target_items: linked,
        cost_range: null,
        depends_on: index === 0 ? [] : [],
        expected: [],
        acceptance: `${row.id}「${row.name}」达到 ${gaps.target.level} 级，按附件（二）判定要求逐条核对：${scenario.levels[String(gaps.target.level)]}`,
        symptom: `当前 ${row.current} 级`,
        root_cause: null,
        basis: null,
        path_ref: null,
        evidence_refs: [{
          kind: "场景",
          ref: row.id,
          title: `${row.name} · ${gaps.target.level} 级要求`,
          quote: scenario.levels[String(gaps.target.level)],
          doc: criteria.source.scenarios,
          url: null,
        }],
      };
    });
  }

  /* ------------------------------------------------------------ 实时评测 */

  function evaluateLive(profile) {
    const computed = window.ShuzhiEngine.evaluate(state.criteria, profile);
    const diagnosis = buildDiagnosis(state.criteria, computed, profile);
    const pathway = buildPathway(state.criteria, computed, profile);

    const doNot = diagnosis
      .filter((entry) => entry._pattern)
      .map((entry) => ({
        pattern_id: entry._pattern,
        name: entry.bottleneck,
        evidence: entry.evidence.split("。判据：")[0],
        basis: entry.evidence.split("。判据：")[1] || "",
        basis_kind: entry.basis_kind,
        evidence_refs: entry.evidence_refs,
      }));

    return {
      mode: "live",
      profile: profile,
      evaluation: computed.evaluation,
      level_judgement: computed.level_judgement,
      item_results: computed.item_results,
      diagnosis: diagnosis,
      pathway: pathway,
      ranking: [],
      do_not: doNot,
      gaps: computed.gaps,
      policy_notes: state.policyNotes || [],
      roi_assumptions: null,
      meta: {
        generated_at: new Date().toISOString(),
        mode: "live",
        criteria_source: state.criteria.source.indicators,
        scenario_source: state.criteria.source.scenarios,
        document: state.criteria.source.document,
        engine: "assets/engine.js（浏览器端确定性计算）",
      },
    };
  }

  /* ------------------------------------------------------------ 结果渲染 */

  function renderResult(result) {
    state.lastResult = result;
    state.lastMode = result.mode;

    $("#result-head").hidden = false;
    $("#result-layout").hidden = false;
    $("#output-panel").hidden = false;

    renderGauge(result);
    renderDiagnosis(result);
    renderPathway(result);
    renderRanking(result);
    renderPolicy(result);
    renderAssumptions(result);

    observeReveals($("#output-panel"));
    setupToc();

    requestAnimationFrame(() => {
      $$("#output-panel .reveal").forEach((node) => node.classList.add("in"));
    });

    updateTitles(result);
  }

  function updateTitles(result) {
    const isLive = result.mode === "live";
    $("#h-ranking").textContent = isLive ? "改造优先级与「不建议做」" : "投入产出排序与「不建议做」";
    const tocRank = $('.toc a[href="#sec-ranking"]');
    if (tocRank) tocRank.lastChild.textContent = isLive ? "优先级" : "投入产出";
  }

  function renderGauge(result) {
    const evaluation = result.evaluation;
    const level = evaluation.level || 0;

    const scoreNode = $("#score-value");
    scoreNode.textContent = "0.00";
    countUp(scoreNode, evaluation.total_score, { digits: 2, duration: 1100 });

    $("#level-value").textContent = evaluation.level_name;
    $("#level-chip").textContent = level ? `${level} / 4 级` : "未入级";

    paintRail($("#gauge-fill"), $("#gauge-knob"), evaluation.total_score);

    const next = (result.level_judgement || []).find((j) => !j.satisfied && j.level === level + 1);
    const gapLine = $("#gap-line");
    gapLine.textContent = "";
    if (next) {
      gapLine.appendChild(el("span", { text: `距 ${next.level} 级（${next.name}）还` }));
      gapLine.appendChild(el("b", { text: shortageText(next, evaluation) }));
    } else {
      gapLine.appendChild(el("span", { text: "四个等级已全部达标。" }));
    }

    const strip = $("#judge-strip");
    strip.textContent = "";
    (result.level_judgement || []).forEach((judgement, index) => {
      const node = el("div", {
        class: "judge reveal " + (judgement.satisfied ? "ok" : "miss"),
        style: `--d:${index * 70}ms`,
        title: judgement.note,
      }, [
        el("span", { class: "lv", text: `${judgement.level} 级` }),
        el("span", { class: "nm", text: judgement.name }),
        el("span", { class: "st", text: judgement.satisfied ? "达标" : "未达标" }),
      ]);
      strip.appendChild(node);
      revealNow(node, index * 70);
    });
  }

  function renderDiagnosis(result) {
    const host = $("#out-diagnosis");
    host.textContent = "";
    const entries = result.diagnosis || [];
    $("#sub-diagnosis").textContent = `${entries.length} 条`;

    if (!entries.length) {
      host.appendChild(el("div", { class: "placeholder" }, [
        el("b", { text: "按当前评测规则，未识别出主要瓶颈" }),
        "按官方采集项与场景等级，未命中投入无效模式，也未发现约束性场景断层。",
      ]));
      return;
    }

    const tones = ["clay", "brass", "accent", "accent"];
    entries.forEach((entry, index) => {
      const card = el("article", {
        class: "diag reveal",
        style: `--d:${index * 60}ms`,
        "data-tone": entry._pattern ? "clay" : (tones[index % tones.length]),
      });
      card.appendChild(el("div", { class: "diag-head" }, [
        el("span", { class: "diag-kind", text: entry.bottleneck_type || "瓶颈" }),
        el("h4", { text: entry.bottleneck }),
      ]));

      const evidenceText = entry.evidence || "";
      const splitAt = evidenceText.indexOf("。判据：");
      card.appendChild(el("p", {
        class: "diag-quote",
        text: splitAt > 0 ? evidenceText.slice(0, splitAt + 1) : evidenceText,
      }));

      const meta = el("ul", { class: "diag-meta" });
      if ((entry.hit_items || []).length) {
        meta.appendChild(el("li", {}, ["命中采集项 ", el("b", { text: entry.hit_items.join("、") })]));
      }
      if ((entry.hit_scenarios || []).length) {
        meta.appendChild(el("li", {}, ["命中场景 ", el("b", { text: entry.hit_scenarios.join("、") })]));
      }
      if (typeof entry.max_score_gain === "number" && entry.max_score_gain > 0) {
        meta.appendChild(el("li", {}, ["可提升上限 ", el("b", { text: `${fmt(entry.max_score_gain, 2)} 分` })]));
      }
      if (entry.case_ref) meta.appendChild(el("li", {}, ["案例 ", el("b", { text: entry.case_ref })]));
      card.appendChild(meta);

      if ((entry.evidence_refs || []).length) {
        card.appendChild(renderEvidence(entry.evidence_refs));
      }
      host.appendChild(card);
    });
  }

  function renderEvidence(refs) {
    const details = el("details", { class: "ev" });
    details.appendChild(el("summary", {}, [
      el("span", { class: "caret", text: "▸" }),
      `看依据 · ${refs.length} 条`,
    ]));
    const body = el("div", { class: "ev-body" });
    refs.forEach((ref) => {
      body.appendChild(el("div", { class: "ev-card", "data-kind": ref.kind }, [
        el("div", {}, [
          el("span", { class: "ev-ref", text: ref.ref || "" }),
          el("span", { class: "ev-title", text: ref.title || "" }),
        ]),
        ref.quote ? el("p", { class: "ev-quote", text: ref.quote }) : null,
        ref.note ? el("p", { class: "ev-note", text: ref.note }) : null,
        el("p", { class: "ev-src" }, [
          el("span", { text: ref.doc || "—" }),
          ref.url && /^https?:/.test(ref.url) ? el("a", {
            href: ref.url, target: "_blank", rel: "noopener", text: "　打开原文 ↗",
          }) : null,
        ]),
      ]));
    });
    details.appendChild(body);
    return details;
  }

  function renderPathway(result) {
    const host = $("#out-pathway");
    host.textContent = "";
    const steps = result.pathway || [];
    $("#sub-pathway").textContent = steps.length ? `${steps.length} 步` : "";

    if (!steps.length) {
      host.appendChild(el("div", { class: "placeholder" }, [
        el("b", { text: "按当前评测结果，暂未列出优先改造项" }),
        result.mode === "live"
          ? "在当前画像下，四个等级已全部达标，或已无可补的场景缺口。"
          : "在当前起点上，官方口径下没有必须先做的动作。",
      ]));
      return;
    }

    const timeline = el("div", { class: "timeline" });
    timeline.appendChild(el("div", { class: "timeline-progress", id: "timeline-progress" }));

    steps.forEach((step, index) => {
      const node = el("div", { class: "step reveal", style: `--d:${index * 70}ms` });
      const card = el("div", { class: "step-card" });

      card.appendChild(el("div", { class: "step-top" }, [
        el("span", { class: "step-no", text: `第 ${step.step} 步` }),
        el("span", { class: "step-title", text: step.action }),
      ]));

      const pairs = el("dl", { class: "pairs" });
      const addPair = (label, value) => {
        if (!value) return;
        pairs.appendChild(el("div", { class: "pair" }, [
          el("dt", { text: label }),
          el("dd", { text: value }),
        ]));
      };

      const targetId = String(step.target_scenario || "").split(" ")[0];
      addPair("目标场景", `${targetId}${(step.target_items || []).length
        ? `　关联采集项 ${step.target_items.join("、")}` : ""}`);
      if (step.cost_range) {
        addPair("投入区间", `${fmt(step.cost_range[0], 1)} — ${fmt(step.cost_range[1], 1)} 万元/年（估算）`);
      }
      if ((step.depends_on || []).length) {
        addPair("前置依赖", step.depends_on.map((n) => `第 ${n} 步`).join("、"));
      } else if (step.step > 1) {
        addPair("前置依赖", "无（可与前序并行）");
      }
      card.appendChild(pairs);

      if ((step.expected || []).length) {
        const expected = el("dl", { class: "pairs", style: "margin-top:10px" });
        step.expected.forEach((metric) => {
          expected.appendChild(el("div", { class: "pair" }, [
            el("dt", { text: `预期成效 · 采集项 ${metric.indicator}` }),
            el("dd", { text: `${metric.metric}：${metric.expect}` }),
          ]));
        });
        card.appendChild(expected);
      }

      if (step.symptom || step.root_cause) {
        const cause = el("div", { class: "step-cause" }, [el("b", { text: "为什么建议这一步" })]);
        if (step.symptom) cause.appendChild(el("p", { class: "cause-line" }, [
          el("span", { class: "cause-tag", text: "现状" }), step.symptom,
        ]));
        if (step.root_cause) cause.appendChild(el("p", { class: "cause-line" }, [
          el("span", { class: "cause-tag", text: "原因" }), step.root_cause,
        ]));
        if (step.basis) cause.appendChild(el("p", { class: "cause-line" }, [
          el("span", { class: "cause-tag", text: "依据" }), step.basis,
        ]));
        card.appendChild(cause);
      }

      card.appendChild(el("div", { class: "step-accept" }, [
        el("b", { text: "验收口径" }),
        step.acceptance,
      ]));

      if ((step.evidence_refs || []).length) {
        card.appendChild(renderEvidence(step.evidence_refs));
      }

      node.appendChild(card);
      timeline.appendChild(node);
    });

    host.appendChild(timeline);
    setupTimeline();
  }

  function renderRanking(result) {
    const host = $("#out-ranking");
    host.textContent = "";
    const ranking = result.ranking || [];

    if (ranking.length) {
      $("#sub-ranking").textContent = `${ranking.length} 项动作`;
      const assumptions = result.roi_assumptions || {};
      const wrap = el("div", { class: "table-wrap" });
      const scroll = el("div", { class: "table-scroll" });
      const table = el("table", { class: "rank-table" });
      table.appendChild(el("caption", {
        text: `${assumptions.formula || "ROI = 预期成效收益 ÷ 投入成本"}；${assumptions.conservatism || "排序取下界"}。投入区间为估算，成效弹性未被公开案例支撑，只用于排序，不作为结论数。`,
      }));

      const thead = el("thead");
      thead.appendChild(el("tr", {}, [
        el("th", { text: "排名" }),
        el("th", { text: "改造动作" }),
        el("th", { text: "场景" }),
        el("th", { text: "投入（万元/年）" }),
        el("th", { text: "预期年化收益" }),
        el("th", { text: "ROI 区间" }),
        el("th", { text: "依据" }),
      ]));
      table.appendChild(thead);

      const maxRoi = Math.max(...ranking.map((row) => row.roi_high || 0), 0.001);
      const tbody = el("tbody");
      ranking.forEach((row, index) => {
        const tr = el("tr", { class: "reveal", style: `--d:${index * 50}ms` });
        tr.appendChild(el("td", {}, [
          el("span", { class: `rank${row.rank === 1 ? " top" : ""}`, text: `#${row.rank}` }),
        ]));
        tr.appendChild(el("td", { text: row.name || row.action_id }));
        tr.appendChild(el("td", { class: "num", text: row.target_scenario || "—" }));
        tr.appendChild(el("td", {
          class: "num",
          text: `${fmt(row.cost_range[0], 1)} — ${fmt(row.cost_range[1], 1)}`,
        }));
        tr.appendChild(el("td", {
          class: "num",
          text: `${fmt(row.benefit_range[0], 1)} — ${fmt(row.benefit_range[1], 1)}`,
        }));

        const roiCell = el("td", { class: "num" });
        const roiZero = (row.roi_high || 0) <= 0 && (row.roi_low || 0) <= 0;
        roiCell.appendChild(el("div", {
          text: roiZero ? "—" : `${fmt(row.roi_low, 3)} — ${fmt(row.roi_high, 3)}`,
        }));
        if (roiZero) roiCell.querySelector("div").style.color = "var(--ink-4)";
        const bar = el("div", { class: "roi-bar" });
        const fill = el("span", {});
        fill.dataset.width = `${Math.min(100, ((row.roi_high || 0) / maxRoi) * 100)}%`;
        bar.appendChild(fill);
        roiCell.appendChild(bar);
        tr.appendChild(roiCell);

        const refCell = el("td");
        if ((row.evidence_refs || []).length) refCell.appendChild(renderEvidence(row.evidence_refs));
        tr.appendChild(refCell);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      scroll.appendChild(table);
      wrap.appendChild(scroll);
      host.appendChild(wrap);

      host.appendChild(el("p", {
        class: "form-status",
        style: "margin-top:10px",
        text: `路径段按前置依赖排序（先底座后场景），排序段按 ROI 下界排序，两者口径不同。逐项扰动 40% 时整体排序翻转率 ${assumptions.flip_rate ?? "—"}。`,
      }));

      requestAnimationFrame(() => {
        $$(".roi-bar span", host).forEach((fill, index) => {
          setTimeout(() => { fill.style.width = fill.dataset.width; }, 120 + index * 90);
        });
      });
    } else {
      const gaps = result.gaps;
      if (gaps && gaps.target && gaps.rows.length) {
        $("#sub-ranking").textContent = `${gaps.rows.length} 个待补场景`;
        host.appendChild(el("p", {
          class: "placeholder-note",
          text: `按前置依赖与约束性排序：先把约束性场景补到 ${gaps.target.level} 级，再补指导性场景。ROI 金额需接入成本库，本模式不生成。`,
        }));

        const wrap = el("div", { class: "table-wrap" });
        const scroll = el("div", { class: "table-scroll" });
        const table = el("table", { class: "gap-table" });
        table.appendChild(el("caption", {
          text: `目标：${gaps.target.level} 级（${gaps.target.name}），需 ${gaps.target.min_scenarios} 个场景、其中 ${gaps.target.min_constraint_scenarios} 个约束性场景达到该级。下表按约束性优先、缺口大小排序。`,
        }));
        table.appendChild(el("thead", {}, [
          el("tr", {}, [
            el("th", { text: "序" }),
            el("th", { text: "场景" }),
            el("th", { text: "名称" }),
            el("th", { text: "当前 → 目标" }),
            el("th", { text: "类型" }),
            el("th", { text: "关联采集项" }),
          ]),
        ]));
        const linkMap = SCENARIO_ITEM_MAP(state.criteria);
        const tbody = el("tbody");
        gaps.rows.forEach((row, index) => {
          const tr = el("tr", { class: "reveal", style: `--d:${Math.min(index, 8) * 40}ms` });
          tr.appendChild(el("td", {}, [el("span", { class: "rank", text: String(index + 1) })]));
          tr.appendChild(el("td", {}, [el("span", { class: "mono", text: row.id })]));
          tr.appendChild(el("td", { text: row.name }));
          tr.appendChild(el("td", {}, [el("span", { class: "mono", text: `${row.current} → ${row.need}` })]));
          tr.appendChild(el("td", {}, [
            el("span", {
              class: "tag-type " + (row.constraint ? "is-constraint" : ""),
              text: row.constraint ? "约束性" : "指导性",
            }),
          ]));
          const linked = linkMap.get(row.id) || [];
          tr.appendChild(el("td", { class: "mono dim", text: linked.length ? linked.join("、") : "—" }));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        scroll.appendChild(table);
        wrap.appendChild(scroll);
        host.appendChild(wrap);
      } else {
        $("#sub-ranking").textContent = "";
        host.appendChild(el("div", { class: "placeholder" }, [
          el("b", { text: "没有待补的场景缺口" }),
          "当前画像下所有场景已达到或超过下一级要求。",
        ]));
      }
    }

    const doNot = result.do_not || [];
    const box = el("div", { class: "donot reveal" });
    box.appendChild(el("div", { class: "donot-head" }, [
      el("h4", { text: "现阶段不建议做的事" }),
      el("span", { class: "form-status", style: "margin-left:auto", text: `${doNot.length} 条` }),
    ]));

    if (!doNot.length) {
      box.appendChild(el("p", { class: "form-status", text: "当前没有触发工具设置的四类风险提醒。" }));
    } else {
      doNot.forEach((item) => {
        const row = el("div", { class: "donot-item" });
        row.appendChild(el("div", {}, [
          el("span", { class: "pat", text: item.pattern_id }),
          el("strong", { text: item.name }),
        ]));
        row.appendChild(el("p", { text: item.evidence }));
        if (item.basis) row.appendChild(el("p", { class: "basis", text: `判据：${item.basis}` }));
        if (item.basis_kind) row.appendChild(el("p", { class: "basis", text: item.basis_kind }));
        if ((item.evidence_refs || []).length) row.appendChild(renderEvidence(item.evidence_refs));
        box.appendChild(row);
      });
    }
    host.appendChild(box);
  }

  function renderPolicy(result) {
    const host = $("#out-policy");
    host.textContent = "";
    const notes = result.policy_notes || [];
    $("#sub-policy").textContent = notes.length ? `${notes.length} 份文件` : "";

    if (!notes.length) {
      host.appendChild(el("div", { class: "placeholder" }, [
        el("b", { text: "政策库未载入" }),
        "判据基准文件已在页脚列明。",
      ]));
      return;
    }

    notes.forEach((note, index) => {
      const card = el("div", { class: "policy-card reveal", style: `--d:${index * 40}ms` });
      card.appendChild(el("h4", { text: note.doc }));
      const meta = el("ul", { class: "diag-meta" });
      if (note.role) meta.appendChild(el("li", {}, ["性质 ", el("b", { text: note.role })]));
      if (note.window) meta.appendChild(el("li", {}, ["窗口 ", el("b", { text: note.window })]));
      if (note.issuer) meta.appendChild(el("li", {}, ["发文 ", el("b", { text: note.issuer })]));
      if (note.covers_step) meta.appendChild(el("li", {}, ["对应第 ", el("b", { text: String(note.covers_step) }), " 步"]));
      card.appendChild(meta);

      if (note.url && /^https?:/.test(note.url)) {
        card.appendChild(el("p", { class: "form-status", style: "margin-top:8px" }, [
          el("a", { href: note.url, target: "_blank", rel: "noopener", text: "打开原文 ↗" }),
        ]));
      }
      (note.key_provisions || []).slice(0, 3).forEach((provision) => {
        card.appendChild(el("div", { class: "policy-quote", text: provision }));
      });
      host.appendChild(card);
    });
  }

  function renderAssumptions(result) {
    const host = $("#out-assumptions");
    host.textContent = "";
    const evaluation = result.evaluation || {};
    const meta = result.meta || {};
    const assumptions = result.roi_assumptions || {};

    const dl = el("dl");
    const add = (label, value) => {
      dl.appendChild(el("dt", { text: label }));
      dl.appendChild(el("dd", { text: value === undefined || value === null || value === "" ? "—" : String(value) }));
    };

    add("计算方式", result.mode === "live" ? "前端实时计算（浏览器内执行）" : "后端预计算结果");
    add("计分规则", "单选按选项索引线性；多选按选中数 ÷ 有效选项数；总分未取整求和后四舍五入两位");
    add("等级判定", "得分、达到该级的场景数、其中约束性场景数三项须同时满足");
    add("回归验证", "与后端 6 个预计算样本逐项对齐，总分、等级、维度分、措辞均一致");
    add("场景等级来源", evaluation.scenario_levels_source === "submitted"
      ? "提交值（用户自评）"
      : "规则基线（未提交场景按 1 级兜底）");
    add("ROI 口径", assumptions.formula || "需接入成本库，本次未生成");
    add("成效弹性", assumptions.elasticity || "需接入成本库，本次未生成");
    add("判据来源", meta.criteria_source);
    add("场景来源", meta.scenario_source);
    add("官方文件", meta.document);
    add("生成时间", meta.generated_at);
    host.appendChild(dl);
  }

  /* ------------------------------------------------------------ 目录高亮 */

  let tocBound = false;

  function setupToc() {
    const links = $$(".toc a");
    const sections = links.map((link) => $(link.getAttribute("href"))).filter(Boolean);
    if (!sections.length) return;

    const update = () => {
      const line = window.innerHeight * 0.32;
      let active = sections[0];
      sections.forEach((section) => {
        if (section.getBoundingClientRect().top <= line) active = section;
      });
      links.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${active.id}`);
      });
    };

    if (!tocBound) {
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      tocBound = true;
    }
    update();
  }

  /* ------------------------------------------------------------ 时间线进度 */

  let timelineBound = false;

  function setupTimeline() {
    if (timelineBound) return;
    timelineBound = true;
    const update = () => {
      const bar = $("#timeline-progress");
      const timeline = $(".timeline");
      if (!bar || !timeline) return;
      const rect = timeline.getBoundingClientRect();
      const viewport = window.innerHeight;
      const total = rect.height;
      const passed = Math.min(total, Math.max(0, viewport * 0.55 - rect.top));
      bar.style.height = `${(passed / total) * 100}%`;
      $$(".step", timeline).forEach((step) => {
        const box = step.getBoundingClientRect();
        step.classList.toggle("is-in", box.top < viewport * 0.6);
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ------------------------------------------------------------ 交互 */

  function bindChrome() {
    const topbar = $("#topbar");
    const onScroll = () => topbar.classList.toggle("is-stuck", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function bindForm() {
    $("#profile-form").addEventListener("submit", (event) => {
      event.preventDefault();
      runLive();
    });

    $("#btn-reset").addEventListener("click", () => {
      $("#profile-form").reset();
      $$('input[data-role="scenario"]').forEach((input) => { input.checked = false; });
      $$(".level-desc").forEach((node) => {
        node.className = "level-desc none";
        node.textContent = "尚未选择等级。官方要求：应在完全满足低级场景的所有基本要求之后，方可进阶至更高一级场景的判定。";
      });
      $("#form-status").textContent = "";
      updateProgress();
    });

    const runDemo = async () => {
      const preferred = state.fixtures.find((f) => f.name.startsWith("ap1")) || state.fixtures[0];
      if (!preferred) return;
      $("#fixture-select").value = preferred.name;
      await loadFixture(preferred.name);
    };

    const openForm = () => {
      $("#panel-input").hidden = false;
      $("#progress").hidden = false;
      updateProgress();
      navigateTo($("#panel-input"));
    };

    $("#btn-demo").addEventListener("click", runDemo);
    $("#btn-demo-2").addEventListener("click", runDemo);
    $("#btn-fill").addEventListener("click", openForm);
    $("#btn-fill-2").addEventListener("click", openForm);

    $("#btn-load-fixture").addEventListener("click", () => {
      const name = $("#fixture-select").value;
      if (name) loadFixture(name);
    });


  }

  async function fetchSample(name) {
    if (state.samples.has(name)) return state.samples.get(name);
    const sample = await fetchJSON(SAMPLE_DIR + encodeURIComponent(name));
    state.samples.set(name, sample);
    return sample;
  }

  async function loadFixture(name) {
    const status = $("#form-status");
    status.className = "form-status";
    status.textContent = "正在载入示例企业…";
    try {
      const sample = await fetchSample(name);
      applyProfile(sample.profile);
      status.textContent = "";
      renderResult({ ...sample.result, mode: "sample" });
      navigateTo(document.getElementById("result-head"));
    } catch (error) {
      status.className = "form-status error";
      status.textContent = "载入失败：" + error.message;
    }
  }

  function runLive() {
    const status = $("#form-status");
    const missing = state.criteria.indicators.filter((indicator) => !isAnswered(indicator));
    if (missing.length) {
      status.className = "form-status error";
      status.textContent = `还有 ${missing.length} 个采集项未作答（${missing.map((m) => m.id).join("、")}）。官方要求 15 项全部作答才能定级。`;
      return;
    }

    status.className = "form-status";
    status.textContent = "正在计算…";
    const button = $("#btn-evaluate");
    button.disabled = true;

    setTimeout(() => {
      try {
        const profile = collectProfile();
        const result = evaluateLive(profile);
        status.textContent = "";
        renderResult(result);
        navigateTo(document.getElementById("result-head"));
      } catch (error) {
        status.className = "form-status error";
        status.textContent = "计算失败：" + error.message;
      } finally {
        button.disabled = false;
      }
    }, 260);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
