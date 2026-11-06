/* tools.js —— 工具注册表
 * 每个工具只做一件事，输入是当前企业画像的评测结果，输出是结构化答案块 + 引用。
 * 计划器（agent.js）负责选工具，执行器只负责跑和记录。
 */
(() => {
  "use strict";

  const fmt = (n, d) => (typeof n === "number" ? n.toFixed(d == null ? 2 : d) : String(n));

  /* cost_range 是 [min,max] 数组；统一成「10–30 万元/年」 */
  function fmtRange(range, unit) {
    const tail = unit || "万元/年";
    if (Array.isArray(range) && range.length === 2) {
      return `${fmt(range[0], range[0] % 1 ? 1 : 0)}–${fmt(range[1], range[1] % 1 ? 1 : 0)} ${tail}`;
    }
    if (typeof range === "string") return range;
    return "—";
  }

  function citFromRef(ref) {
    return {
      kind: ref.kind || "依据",
      ref: ref.ref || "",
      title: ref.title || "",
      quote: ref.quote || "",
      doc: ref.doc || "",
      url: ref.url || "",
      note: ref.note || "",
    };
  }

  /* level_judgement 是四级门槛数组，不是对象；next 取当前等级 +1 的那一行 */
  function nextLevel(result) {
    const current = (result.evaluation || {}).level || 0;
    const rows = result.level_judgement || [];
    return rows.find((row) => row.level === current + 1) || null;
  }

  function unmetScenarios(result, level) {
    const out = [];
    (result.scenario_results || []).forEach((sc) => {
      if (sc.constraint && sc.level < level) out.push(sc);
    });
    return out;
  }

  const TOOLS = {
    score: {
      label: "查评测分数与等级",
      run({ result }) {
        const ev = result.evaluation || {};
        const next = nextLevel(result);
        return {
          blocks: [
            { type: "kv", rows: [
              ["评测得分", `${fmt(ev.total_score)} / 100`],
              ["水平等级", ev.level ? `${ev.level_name}（${ev.level} 级）` : (ev.level_name || "无等级")],
              ["下一级", next ? `${next.name}（${next.level} 级）· 门槛 ${fmt(next.min_score, 0)} 分` : "已是最高级"],
            ] },
          ],
          citations: [],
        };
      },
    },

    gaps: {
      label: "算等级门槛差额",
      run({ result }) {
        const ev = result.evaluation || {};
        const next = nextLevel(result);
        if (!next) return { blocks: [{ type: "p", text: "四个等级已全部达标。" }], citations: [] };
        const needScore = Math.max(0, next.min_score - ev.total_score);
        const counts = ev.scenario_count_by_level || {};
        const cons = ev.constraint_count_by_level || {};
        const needScenarios = Math.max(0, next.min_scenarios - (counts[next.level] || 0));
        const needCons = Math.max(0, next.min_constraint_scenarios - (cons[next.level] || 0));
        const stuck = unmetScenarios(result, next.level).sort((a, b) => a.level - b.level);
        return {
          blocks: [
            { type: "p", text: `距 ${next.level} 级（${next.name}）还差：${fmt(needScore)} 分、${needScenarios} 个场景、${needCons} 个约束性场景。三项要同时满足。` },
            stuck.length ? {
              type: "list",
              items: stuck.slice(0, 6).map((sc) => ({
                title: `${sc.id}「${sc.name}」当前 ${sc.level} 级`,
                meta: "约束性场景 · 未达到目标等级",
              })),
            } : null,
            stuck.length > 6 ? { type: "note", text: `还有 ${stuck.length - 6} 个约束性场景没到 ${next.level} 级，这里只列了等级最低的 6 个。` } : null,
            { type: "note", text: "场景层不直接计分，但卡等级门槛；只补分数不补场景，等级上不去。" },
          ].filter(Boolean),
          citations: [],
        };
      },
    },

    pathway: {
      label: "读改造路径",
      run({ result }) {
        const steps = result.pathway || [];
        if (!steps.length) return { blocks: [{ type: "p", text: "按当前结果，没有必须先做的动作。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: steps.map((step, i) => ({
              title: `第 ${step.step || i + 1} 步 · ${step.action}`,
              meta: [
                step.target_scenario ? `目标场景 ${step.target_scenario}` : "",
                step.cost_range ? `投入 ${fmtRange(step.cost_range)}` : "",
                step.depends_on && step.depends_on.length ? `前置：${step.depends_on.join("、")}` : "无前置",
              ].filter(Boolean).join(" · "),
              body: step.symptom || "",
            })),
          }],
          citations: (steps[0] && steps[0].evidence_refs ? steps[0].evidence_refs.map(citFromRef) : []),
        };
      },
    },

    step: {
      label: "读某一步细节",
      run({ result }, args) {
        const steps = result.pathway || [];
        const index = Math.max(0, Math.min(steps.length - 1, (args.index || 1) - 1));
        const step = steps[index];
        if (!step) return { blocks: [{ type: "p", text: "没有这么多步骤。" }], citations: [] };
        const rows = [
          ["动作", step.action],
          ["目标场景", step.target_scenario || "—"],
          ["投入区间", step.cost_range ? fmtRange(step.cost_range) : "—"],
          ["前置依赖", (step.depends_on || []).join("、") || "无（可与前序并行）"],
        ];
        const expected = (step.expected || []).map((e) =>
          `采集项 ${e.indicator}「${e.metric}」：${e.expect}${e.supported ? "" : "（弹性未获公开案例支撑，仅用于排序）"}`);
        return {
          blocks: [
            { type: "kv", rows },
            step.symptom ? { type: "p", text: `现状：${step.symptom}` } : null,
            step.root_cause ? { type: "p", text: `原因：${step.root_cause}` } : null,
            step.basis ? { type: "p", text: `依据：${step.basis}` } : null,
            expected.length ? { type: "list", items: expected.map((text) => ({ title: text })) } : null,
            step.acceptance ? { type: "note", text: `验收口径：${step.acceptance}` } : null,
          ].filter(Boolean),
          citations: (step.evidence_refs || []).map(citFromRef),
        };
      },
    },

    roi: {
      label: "查投入产出排序",
      run({ result }) {
        const rows = result.ranking || [];
        if (!rows.length) return { blocks: [{ type: "p", text: "这份画像没有可测算的投入产出项。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: rows.map((row) => ({
              title: `#${row.rank} ${row.action}`,
              meta: [
                row.scenario ? `场景 ${row.scenario}` : "",
                row.invest_range ? `投入 ${row.invest_range}` : "",
                row.roi_range ? `ROI ${row.roi_range}` : "",
                row.payback ? `回收期 ${row.payback}` : "",
              ].filter(Boolean).join(" · "),
            })),
          }, {
            type: "note",
            text: "ROI 是区间不是点值：逐项扰动 40% 时排序翻转率 0.25，所以只给区间和排序，不给精确回报。",
          }],
          citations: [],
        };
      },
    },

    do_not: {
      label: "读「不建议做」清单",
      run({ result }) {
        const rows = result.do_not || [];
        if (!rows.length) return { blocks: [{ type: "p", text: "当前画像没有命中投入无效模式。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: rows.map((row) => ({
              title: row.pattern || row.title || "不建议做",
              body: row.reason || row.detail || "",
            })),
          }],
          citations: [],
        };
      },
    },

    scenario: {
      label: "查某个场景的等级",
      run({ result }, args) {
        const list = result.scenario_results || [];
        const target = args.id
          ? list.find((sc) => sc.id === args.id)
          : list.filter((sc) => sc.constraint).sort((a, b) => a.level - b.level)[0];
        if (!target) return { blocks: [{ type: "p", text: "没有找到这个场景。" }], citations: [] };
        return {
          blocks: [
            { type: "kv", rows: [
              ["场景", `${target.id}「${target.name}」`],
              ["当前等级", `${target.level} 级`],
              ["是否约束性", target.constraint ? "是（卡等级门槛）" : "否"],
            ] },
            target.judgment && target.judgment.quote
              ? { type: "p", text: `官方 ${target.level} 级要求：${target.judgment.quote}` }
              : null,
          ].filter(Boolean),
          citations: [],
        };
      },
    },

    diagnosis: {
      label: "读诊断结论",
      run({ result }, args) {
        const list = result.diagnosis || [];
        if (!list.length) return { blocks: [{ type: "p", text: "未识别出主要瓶颈。" }], citations: [] };
        const index = args.index ? Math.max(0, Math.min(list.length - 1, args.index - 1)) : 0;
        const entry = list[index];
        return {
          blocks: [
            { type: "kv", rows: [
              ["结论", entry.bottleneck],
              ["类型", entry.bottleneck_type || "—"],
              ["命中采集项", (entry.hit_items || []).join("、") || "—"],
              ["可提升上限", entry.max_score_gain ? `${fmt(entry.max_score_gain)} 分` : "—"],
            ] },
            entry.evidence ? { type: "p", text: entry.evidence } : null,
          ].filter(Boolean),
          citations: (entry.evidence_refs || []).map(citFromRef),
        };
      },
    },

    policy: {
      label: "检索政策库",
      async run({ query }) {
        const rows = await window.AdvisorKB.search("policy", query, { k: 3 });
        if (!rows.length) return { blocks: [{ type: "p", text: "政策库里没有匹配到条目。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: rows.map(({ doc }) => ({
              title: `${doc.id}｜${doc.title}`,
              meta: [doc.issuer, doc.date].filter(Boolean).join(" · "),
              body: doc.text,
            })),
          }],
          citations: rows.map(({ doc }) => ({
            kind: "政策", ref: doc.id, title: doc.title, quote: doc.text,
            doc: doc.issuer || "政策库", url: doc.url || "",
          })),
        };
      },
    },

    case: {
      label: "检索案例库",
      async run({ query }) {
        const [enterpriseRows, publicRows] = await Promise.all([
          window.AdvisorKB.search("cases", query, { k: 3 }),
          window.AdvisorKB.search("public_cases", query, { k: 3 }),
        ]);
        const rows = [...enterpriseRows, ...publicRows]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (!rows.length) return { blocks: [{ type: "p", text: "案例库里没有匹配到相似做法。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: rows.map(({ doc }) => ({
              title: `${doc.id}｜${doc.title}${doc.verification_class === "public_case_reproduction" ? "｜公开案例复现" : ""}`,
              meta: [doc.industry, doc.company, doc.source].filter(Boolean).join(" · "),
              body: doc.text,
            })),
          }],
          citations: rows.map(({ doc }) => ({
            kind: doc.verification_class === "public_case_reproduction" ? "公开案例复现" : "案例",
            ref: doc.id, title: doc.title, quote: doc.text,
            doc: doc.industry || "案例库", url: doc.url || "",
          })),
        };
      },
    },

    paper: {
      label: "检索论文库",
      async run({ query }) {
        const rows = await window.AdvisorKB.search("papers", query, { k: 3 });
        if (!rows.length) return { blocks: [{ type: "p", text: "论文库里没有匹配到条目。" }], citations: [] };
        return {
          blocks: [{
            type: "list",
            items: rows.map(({ doc }) => ({
              title: doc.title,
              meta: [doc.authors, doc.venue, doc.year].filter(Boolean).join(" · "),
            })),
          }],
          citations: rows.map(({ doc }) => ({
            kind: "论文", ref: String(doc.year || ""), title: doc.title,
            quote: doc.title, doc: doc.venue || "论文库", url: doc.url || "",
          })),
        };
      },
    },
  };

  function list() {
    return Object.entries(TOOLS).map(([name, def]) => ({ name, label: def.label }));
  }

  async function run(name, ctx, args) {
    const tool = TOOLS[name];
    if (!tool) throw new Error("未注册的工具：" + name);
    const output = await tool.run(ctx, args || {});
    return {
      tool: name,
      label: tool.label,
      args: args || {},
      blocks: output.blocks || [],
      citations: output.citations || [],
    };
  }

  window.AdvisorTools = { list, run, has: (name) => Boolean(TOOLS[name]) };
})();
