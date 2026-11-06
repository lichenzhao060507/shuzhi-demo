/* agent.js —— 问答运行时
 * 一条链路：意图识别 → 计划工具 → 执行 → 自检 → 组织回答 →（必要时）长尾兜底
 * 设计约束：
 *   1. 所有数字只能来自确定性评测结果，模型/模板不产生新数字
 *   2. 涉及外部知识的回答必须带检索引用，检索不到就明说，不编
 *   3. 每一次调用都进 trace，供「可观测」面板展示
 */
(() => {
  "use strict";

  const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  const RULES = [
    { intent: "greeting", re: /^(你好|您好|在吗|嗨|hi|hello|哈喽)/i },
    { intent: "step", re: /第\s*([一二两三四五六七八九十\d]+)\s*步|这一步|下一步|上一步/ },
    { intent: "do_not", re: /不建议|不要做|别做|白花|避坑|无效投入|没必要/ },
    { intent: "roi", re: /投入|产出|回本|回收期|值不值|划算|多少钱|预算|费用|roi/i },
    { intent: "gaps", re: /差多少|还差|差几|缺什么|差距|门槛|够不够/ },
    // 场景问句要先于「几级」判断：问「设备管理现在几级」时，主语是场景不是总分
    { intent: "scenario", re: /S\d{2}|场景|设备管理|质量管理|排产|计划排程|能耗|仓储|物流|采购|营销|售后|安全生产|财务|人力|协同办公|产品设计|工艺设计/ },
    { intent: "score", re: /多少分|几分|得分|什么等级|几级|评级|我的分/ },
    { intent: "pathway", re: /先做|先改|改哪|做什么|干什么|第一步|顺序|路线|怎么改|改造路径|从哪(开始|下手)|优先/ },
    { intent: "diagnosis", re: /诊断|问题在哪|瓶颈|卡在|短板/ },
    { intent: "policy", re: /政策|补贴|补助|文件|文号|申报|试点|验收|支持/ },
    { intent: "case", re: /案例|别家|同行|有没有企业|借鉴|别人怎么/ },
    { intent: "paper", re: /论文|研究|文献|学术/ },
    { intent: "explain", re: /为什么|原因|依据|凭什么|怎么算的|哪来的/ },
  ];

  function matchIntent(text) {
    for (const rule of RULES) {
      const m = text.match(rule.re);
      if (m) return { intent: rule.intent, match: m };
    }
    return { intent: "unknown", match: null };
  }

  function parseStepIndex(text) {
    const m = text.match(/第\s*([一二两三四五六七八九十\d]+)\s*步/);
    if (!m) return null;
    const raw = m[1];
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw === "十") return 10;
    if (raw.length === 2 && raw[0] === "十") return 10 + (CN_NUM[raw[1]] || 1);
    if (raw.length === 2 && raw[1] === "十") return (CN_NUM[raw[0]] || 1) * 10;
    return CN_NUM[raw] || null;
  }

  function parseScenario(text) {
    const m = text.match(/S(\d{2})/i);
    if (m) return "S" + m[1];
    const ALIAS = [
      ["设备管理", "S08"], ["质量管理", "S07"], ["排产", "S05"], ["计划排程", "S05"],
      ["能耗", "S10"], ["仓储", "S12"], ["物流", "S12"], ["采购", "S11"],
      ["营销", "S03"], ["售后", "S04"], ["安全生产", "S09"], ["财务", "S13"],
      ["人力", "S14"], ["协同办公", "S15"], ["产品设计", "S01"], ["工艺设计", "S02"],
      ["生产管控", "S06"],
    ];
    const hit = ALIAS.find(([word]) => text.includes(word));
    return hit ? hit[1] : null;
  }

  /* ---------------- 计划器 ---------------- */

  function plan(intent, text, session) {
    switch (intent) {
      case "score": return [{ tool: "score" }];
      case "gaps": return [{ tool: "gaps" }];
      case "pathway": return [{ tool: "pathway" }];
      case "roi": return [{ tool: "roi" }];
      case "do_not": return [{ tool: "do_not" }];
      case "diagnosis": return [{ tool: "diagnosis" }];
      case "step": {
        const index = parseStepIndex(text) || (session.last && session.last.step) || 1;
        return [{ tool: "step", args: { index } }];
      }
      case "scenario": {
        const id = parseScenario(text) || (session.last && session.last.scenario);
        return [{ tool: "scenario", args: id ? { id } : {} }];
      }
      case "policy": return [{ tool: "policy", args: { query: text } }];
      case "case": return [{ tool: "case", args: { query: text } }];
      case "paper": return [{ tool: "paper", args: { query: text } }];
      case "explain": {
        const last = session.last || {};
        if (last.intent === "pathway" || last.tool === "step") {
          return [{ tool: "step", args: { index: last.step || 1 } }];
        }
        if (last.intent === "policy" || last.intent === "case") {
          return [{ tool: last.intent, args: { query: session.lastQuery || text } }];
        }
        return [{ tool: "diagnosis" }];
      }
      case "greeting": return [];
      // 未识别：不直接调工具，交给兜底节点统一加「超出判据范围」的前缀
      default: return [];
    }
  }

  /* ---------------- 组织回答 ---------------- */

  const OPENERS = {
    score: "按当前画像算，结果是这样的：",
    gaps: "升级还差这几项：",
    pathway: "改造顺序按前置依赖排，不用按 ROI 排：",
    step: "这一步的细节：",
    roi: "投入产出只给区间，不给点值：",
    do_not: "这几件事现在做会白花钱：",
    diagnosis: "卡点在这儿：",
    scenario: "这个场景的情况：",
    policy: "在政策库里检索到：",
    case: "案例库里有相似的做法：",
    paper: "论文库里相关的条目：",
    explain: "依据是这样推出来的：",
    greeting: "我在。可以问：我现在几级、差多少分、先改什么、有哪些政策依据。",
  };

  function compose(ctx) {
    const { intent, outputs, session } = ctx;
    const blocks = [];
    if (OPENERS[intent] && intent !== "greeting") {
      blocks.push({ type: "p", text: OPENERS[intent], src: "opener" });
    }
    const citations = [];
    outputs.forEach((out) => {
      // 打上来源标记，句级核验据此判断「字段 / 引用 / 说明」
      (out.blocks || []).forEach((block) => blocks.push({ ...block, src: "tool:" + out.tool }));
      (out.citations || []).forEach((cit) => citations.push(cit));
    });

    if (intent === "greeting") {
      return {
        intent,
        blocks: [{ type: "p", text: OPENERS.greeting }],
        citations: [],
        suggested: ["我现在是什么等级？", "还差多少分到 3 级？", "先改哪一步？", "有哪些政策依据？"],
      };
    }

    if (!blocks.length) return null;
    // 未知意图且检索不到任何引用：交给兜底节点，别硬答
    if (intent === "unknown" && citations.length === 0) return null;

    return {
      intent,
      blocks,
      citations,
      suggested: suggestFor(intent, session, ctx.result),
    };
  }

  function suggestFor(intent, session, result) {
    const current = (result && result.evaluation && result.evaluation.level) || 0;
    const target = Math.min(4, current + 1);
    const gapChip = `还差多少分到 ${target} 级？`;
    const base = {
      score: [gapChip, "先改哪一步？", "哪些事不建议做？"],
      gaps: ["第一步该做什么？", "这些场景的官方要求是什么？"],
      pathway: ["第一步要花多少钱？", "为什么先做这一步？", "有没有类似企业的案例？"],
      roi: ["哪些事不建议做？", "第一步的验收口径是什么？"],
      do_not: ["那我应该先做什么？", "有没有相反的成功案例？"],
      diagnosis: ["还差多少分？", "第一步做什么？"],
      policy: ["有补贴类的政策吗？", "试点申报有什么要求？"],
      case: ["政策依据是什么？", "这家企业投了多少钱？"],
    };
    return base[intent] || ["我现在是什么等级？", "先改哪一步？"];
  }

  /* ---------------- 自检 ---------------- */

  function verify(ctx) {
    const { answer } = ctx;
    if (!answer) return { ok: false, reason: "empty" };
    // 只核对两位小数的分数/金额（模板里写死的说明文字不参与）
    const checked = answer.blocks
      .filter((block) => block.type !== "note")
      .map((block) => JSON.stringify(block))
      .join(" ");
    const numeric = [...new Set(checked.match(/\d+\.\d{2}/g) || [])].map(Number);
    // 结果里出现过的数，以及两数相减能得到数（如 60 − 51.95 = 8.05）都算可追溯
    const pool = (JSON.stringify(ctx.result || {}).match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const near = (a, b) => Math.abs(a - b) < 0.005;
    const missing = numeric.filter((n) => {
      if (pool.some((v) => near(v, n))) return false;
      for (let i = 0; i < pool.length; i += 1) {
        for (let j = i + 1; j < pool.length; j += 1) {
          if (near(pool[i] - pool[j], n) || near(pool[j] - pool[i], n)) return false;
        }
      }
      return true;
    });
    return {
      ok: missing.length === 0,
      missing: missing.map((n) => n.toFixed(2)),
      cited: answer.citations.length > 0,
      reason: missing.length ? "数字未在评测结果中找到：" + missing.map((n) => n.toFixed(2)).join("、") : "ok",
    };
  }

  /* ---------------- 会话 ---------------- */

  /* ---------------- OpenTelemetry 结构（gen_ai.* 语义约定子集） ---------------- */

  const NODE_OP = {
    understand: "agent.intent",
    plan: "agent.plan",
    execute: "execute_tool",
    compose: "agent.compose",
    verify: "agent.verify",
    fallback: "agent.fallback",
  };

  function hexId(len) {
    let out = "";
    while (out.length < len) out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    return out.slice(0, len);
  }

  function toNanos(ms) {
    return Math.max(0, Math.round(ms * 1e6));
  }

  /* 把一次问答转成 OTel span 树：根 span 是 invoke_agent，子 span 是各节点 */
  function buildOtel(trace, startedAt, meta) {
    const traceId = hexId(32);
    const rootId = hexId(16);
    const spans = [];
    const base = startedAt;

    spans.push({
      traceId, spanId: rootId, parentSpanId: null,
      name: "invoke_agent",
      kind: "INTERNAL",
      startTimeUnixNano: toNanos(base),
      endTimeUnixNano: toNanos(base + trace.reduce((sum, n) => sum + (n.ms || 0), 0)),
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "shuzhi-advisor",
        "gen_ai.agent.version": "1.0.0",
        "shuzhi.profile": meta.profileName || "",
        "shuzhi.intent": meta.intent || "",
        "shuzhi.tools": (meta.tools || []).join(","),
        "shuzhi.citations": meta.citations || 0,
        "shuzhi.verified": Boolean(meta.verified),
      },
      status: { code: meta.verified && meta.verified.ok ? "OK" : "ERROR" },
    });

    let cursor = base;
    trace.forEach((node) => {
      const start = cursor;
      cursor += node.ms || 0;
      spans.push({
        traceId, spanId: hexId(16), parentSpanId: rootId,
        name: NODE_OP[node.id] || node.id,
        kind: "INTERNAL",
        startTimeUnixNano: toNanos(start),
        endTimeUnixNano: toNanos(start + (node.ms || 0)),
        attributes: {
          "gen_ai.operation.name": NODE_OP[node.id] || node.id,
          "shuzhi.node.label": node.label,
          "shuzhi.node.status": node.status,
        },
        status: { code: node.status === "error" ? "ERROR" : "OK" },
      });
    });

    return {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "shuzhi-advisor-web" } }] },
        scopeSpans: [{ scope: { name: "shuzhi.agent", version: "1.0.0" }, spans }],
      }],
    };
  }

  function createSession(profileName) {
    return {
      id: "s" + Date.now().toString(36),
      profileName: profileName || "",
      turns: [],
      last: null,
      lastQuery: "",
    };
  }

  async function ask(question, ctx, onEvent) {
    const text = String(question || "").trim();
    const session = ctx.session;
    const started = performance.now();

    const nodes = [
      {
        id: "understand", label: "识别意图",
        run: (c) => {
          const { intent, match } = matchIntent(text);
          c.intent = intent;
          c.match = match;
          return { intent };
        },
      },
      {
        id: "plan", label: "编排工具计划",
        run: (c) => {
          c.plan = plan(c.intent, text, session);
          return c.plan;
        },
      },
      {
        id: "execute", label: "执行工具",
        when: (c) => (c.plan || []).length > 0,
        run: async (c) => {
          const outputs = [];
          for (const call of c.plan) {
            const out = await window.AdvisorTools.run(call.tool, {
              result: c.result,
              sample: c.sample,
              query: (call.args && call.args.query) || text,
            }, call.args);
            outputs.push(out);
          }
          c.outputs = outputs;
          return outputs.map((o) => o.tool);
        },
      },
      {
        id: "compose", label: "组织回答",
        run: (c) => {
          c.answer = compose({ ...c, outputs: c.outputs || [], session });
          return Boolean(c.answer);
        },
      },
      {
        id: "verify", label: "自检数字与引用",
        run: (c) => (c.verifyResult = verify(c)),
      },
      {
        id: "fallback", label: "长尾兜底",
        when: (c) => !c.answer || (c.intent === "unknown" && !(c.answer && c.answer.citations.length)),
        optional: true,
        run: async (c) => {
          const searchSafe = async (kind) => {
            try {
              return await window.AdvisorKB.search(kind, text, { k: 2, minScore: 0.8 });
            } catch (error) {
              return [];
            }
          };
          const [policies, cases] = await Promise.all([searchSafe("policy"), searchSafe("cases")]);
          const citations = [
            ...policies.map(({ doc }) => ({ kind: "政策", ref: doc.id, title: doc.title, quote: doc.text, doc: doc.issuer || "政策库", url: doc.url || "" })),
            ...cases.map(({ doc }) => ({ kind: "案例", ref: doc.id, title: doc.title, quote: doc.text, doc: doc.industry || "案例库", url: "" })),
          ];
          c.answer = {
            intent: "fallback",
            blocks: [
              { type: "p", src: "opener", text: citations.length
                ? "这个问题不在我的判据范围内，先把库里相关的原文给你，别当成结论用："
                : "这个问题超出我的判据范围：我只回答本企业的等级、缺口、改造顺序、投入产出与政策案例。要不要换个问法？" },
              ...(citations.length ? [{ type: "list", src: "tool:policy", items: citations.slice(0, 4).map((cit) => ({
                title: `${cit.kind}｜${cit.title}`, body: cit.quote,
              })) }] : []),
            ],
            citations,
            suggested: ["我现在是什么等级？", "还差多少分到 3 级？", "先改哪一步？"],
            fallback: true,
          };
          c.verifyResult = { ok: true, cited: citations.length > 0, reason: "fallback" };
          return citations.length;
        },
      },
    ];

    const state = { ...ctx, session };
    const { trace } = await window.AdvisorGraph.run(nodes, state, onEvent);

    const ms = Math.round(performance.now() - started);

    // 记住上下文，供下一轮指代（"那第二步呢""为什么要改这个"）
    const plan0 = (state.plan && state.plan[0]) || {};
    session.turns.push({ q: text, intent: state.intent, ms });
    session.last = {
      intent: state.intent,
      tool: plan0.tool || null,
      step: plan0.tool === "step" ? (plan0.args && plan0.args.index) : (session.last && session.last.step) || null,
      scenario: plan0.tool === "scenario" ? (plan0.args && plan0.args.id) : (session.last && session.last.scenario) || null,
    };
    session.lastQuery = text;

    const answer = state.answer;
    const tools = (state.outputs || []).map((o) => o.tool);
    const claims = window.AdvisorClaims ? window.AdvisorClaims.verify(answer, state.result) : null;
    return {
      answer,
      claims,
      trace,
      ms,
      intent: state.intent,
      verified: state.verifyResult,
      tools,
      otel: buildOtel(trace, started, {
        profileName: session.profileName,
        intent: state.intent,
        tools,
        citations: (answer && answer.citations.length) || 0,
        verified: state.verifyResult,
      }),
    };
  }

  window.AdvisorAgent = { ask, createSession, matchIntent, parseStepIndex, parseScenario };
})();
