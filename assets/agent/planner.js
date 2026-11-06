/* planner.js —— 计划器策略（规则 / 模型 / 契约替身）
 * 计划器的职责只有一个：给定意图与问题，产出 [{tool, args}] 数组。
 * 规则版离线、零成本、可解释；模型版走用户自己填的 OpenAI 兼容端点（BYOK）；
 * mock 版只在评测里用，验证「换计划器不改执行层」这条契约。
 */
(() => {
  "use strict";

  const VALID_TOOLS = new Set([
    "score", "gaps", "pathway", "step", "roi", "do_not",
    "diagnosis", "scenario", "policy", "case", "paper",
  ]);

  /* ---------- 规则版：把意图翻成工具调用 ---------- */
  function rules(intent, text, session) {
    const last = (session && session.last) || {};
    const stepIndex = () => {
      const m = String(text).match(/第\s*([一二两三四五六七八九十\d]+)\s*步/);
      if (!m) return (last.step || 1);
      const raw = m[1];
      if (/^\d+$/.test(raw)) return Number(raw);
      const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      return map[raw] || 1;
    };

    switch (intent) {
      case "score": return [{ tool: "score" }];
      case "gaps": return [{ tool: "gaps" }];
      case "pathway": return [{ tool: "pathway" }];
      case "roi": return [{ tool: "roi" }];
      case "do_not": return [{ tool: "do_not" }];
      case "diagnosis": return [{ tool: "diagnosis" }];
      case "step": return [{ tool: "step", args: { index: stepIndex() } }];
      case "scenario": {
        const m = String(text).match(/S(\d{2})/i);
        const alias = [["设备管理", "S08"], ["质量管理", "S07"], ["排产", "S05"], ["能耗", "S10"],
          ["仓储", "S12"], ["采购", "S11"], ["营销", "S03"], ["售后", "S04"]]
          .find(([w]) => String(text).includes(w));
        const id = m ? "S" + m[1] : alias ? alias[1] : last.scenario || null;
        return [{ tool: "scenario", args: id ? { id } : {} }];
      }
      case "policy": return [{ tool: "policy", args: { query: text } }];
      case "case": return [{ tool: "case", args: { query: text } }];
      case "paper": return [{ tool: "paper", args: { query: text } }];
      case "explain":
        if (last.intent === "pathway" || last.tool === "step") {
          return [{ tool: "step", args: { index: last.step || 1 } }];
        }
        if (last.intent === "policy" || last.intent === "case") {
          return [{ tool: last.intent, args: { query: text } }];
        }
        return [{ tool: "diagnosis" }];
      case "greeting": return [];
      default: return [];
    }
  }

  /* ---------- 模型版：BYOK，OpenAI 兼容端点 ---------- */
  const SYS = `你是工具选择器。只输出 JSON：{"tool":"<工具名>","args":{...}}。
可选工具：score,gaps,pathway,step,roi,do_not,diagnosis,scenario,policy,case,paper。
规则：
- 问分数/等级用 score；问差多少用 gaps；问先做什么用 pathway；问第 N 步用 step（args.index）。
- 问某场景用 scenario（args.id 形如 S08）；问政策用 policy；问案例用 case。
- 问为什么：如果上一轮在做改造步骤，用 step；否则用 diagnosis。
- 与本企业评测无关的问题返回 {"tool":"none"}。`;

  async function llm(intent, text, session, options) {
    const cfg = (options && options.llm) || {};
    if (!cfg.baseUrl || !cfg.key || !cfg.model) throw new Error("模型计划器未配置");
    const history = ((session && session.turns) || []).slice(-4)
      .map((t) => `用户：${t.q}\n意图：${t.intent}`).join("\n");
    const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: `${history}\n\n当前问题：${text}` },
        ],
      }),
    });
    if (!res.ok) throw new Error("模型返回 " + res.status);
    const data = await res.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "{}";
    const parsed = JSON.parse(raw);
    if (!parsed.tool || parsed.tool === "none") return [];
    if (!VALID_TOOLS.has(parsed.tool)) throw new Error("模型给了未注册工具：" + parsed.tool);
    return [{ tool: parsed.tool, args: parsed.args || {} }];
  }

  /* ---------- mock：评测用，证明「换计划器不动执行层」 ---------- */
  const MOCK_TABLE = [
    [/等级|几级|多少分/, "score"],
    [/差多少|还差|门槛/, "gaps"],
    [/先改|哪一步|顺序/, "pathway"],
    [/第\s*[一二两三四五六七八九十\d]+\s*步|花多少钱/, "step"],
    [/投入|产出|roi|回本/i, "roi"],
    [/不建议|别做|白花/, "do_not"],
    [/S\d{2}|场景|设备管理|质量管理/, "scenario"],
    [/政策|补贴|资金/, "policy"],
    [/案例|同行/, "case"],
    [/为什么|依据/, "diagnosis"],
  ];

  function mock(intent, text, session) {
    const hit = MOCK_TABLE.find(([re]) => re.test(String(text)));
    if (hit) return [{ tool: hit[1], args: {} }];
    // 模拟模型在「为什么」这类省略句上依赖上下文
    if (/为什么/.test(text) && session && session.last && session.last.tool === "step") {
      return [{ tool: "step", args: { index: session.last.step || 1 } }];
    }
    return [];
  }

  const STRATEGIES = { rules, llm, mock };

  function get(name) {
    return STRATEGIES[name] || rules;
  }

  function validate(calls) {
    if (!Array.isArray(calls)) return { ok: false, reason: "不是数组" };
    for (const call of calls) {
      if (!call || !VALID_TOOLS.has(call.tool)) return { ok: false, reason: "未注册工具：" + (call && call.tool) };
      if (call.args != null && typeof call.args !== "object") return { ok: false, reason: "args 不是对象" };
    }
    return { ok: true };
  }

  window.AdvisorPlanner = { get, validate, list: () => Object.keys(STRATEGIES), VALID_TOOLS };
})();
