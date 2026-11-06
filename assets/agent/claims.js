/* claims.js —— 句子级接地核验
 * 把回答拆成句子，逐句判定它靠什么站住：
 *   字段：来自确定性评测结果（分数、等级、步骤、ROI）
 *   引用：来自政策/案例/论文原文
 *   说明：方法性文字与提示，不计入分母
 *   未核验：既没有字段来源，也没有引用
 * 数字另外加一道：两位小数必须能在评测结果里找到（或由两数相减得到）。
 */
(() => {
  "use strict";

  function splitSentences(text) {
    return String(text || "")
      .split(/[。！？；\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  }

  function blockText(block) {
    if (!block) return "";
    if (block.type === "p" || block.type === "note") return block.text || "";
    if (block.type === "kv") return (block.rows || []).map(([, v]) => v).join("。");
    if (block.type === "list") {
      return (block.items || []).map((it) => [it.title, it.meta, it.body].filter(Boolean).join("。")).join("。");
    }
    return "";
  }

  function numericPool(result) {
    return (JSON.stringify(result || {}).match(/-?\d+(\.\d+)?/g) || []).map(Number);
  }

  function traceable(value, pool) {
    const near = (a, b) => Math.abs(a - b) < 0.005;
    if (pool.some((v) => near(v, value))) return true;
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        if (near(pool[i] - pool[j], value) || near(pool[j] - pool[i], value)) return true;
      }
    }
    return false;
  }

  /* blocks 里每条带 src（tool:xxx / opener / suggestion），据此判来源 */
  function basisOf(block) {
    const src = String(block && block.src || "");
    if (block && block.type === "note") return "说明";
    if (!src) return "说明";
    if (/tool:(policy|cases?|paper)s?$/.test(src)) return "引用";
    if (src.startsWith("tool:")) return "字段";
    return "说明";
  }

  function verify(answer, result) {
    const blocks = (answer && answer.blocks) || [];
    const pool = numericPool(result);
    const items = [];

    blocks.forEach((block) => {
      const basis = basisOf(block);
      splitSentences(blockText(block)).forEach((sentence) => {
        const numbers = [...new Set(sentence.match(/\d+\.\d{2}/g) || [])].map(Number);
        const badNumbers = numbers.filter((n) => !traceable(n, pool));
        let final = basis;
        if (basis !== "说明" && badNumbers.length) final = "未核验";
        items.push({ text: sentence.slice(0, 90), basis: final, badNumbers });
      });
    });

    const scored = items.filter((it) => it.basis !== "说明");
    const verified = scored.filter((it) => it.basis === "字段" || it.basis === "引用");
    return {
      total: scored.length,
      verified: verified.length,
      ratio: scored.length ? verified.length / scored.length : 1,
      unverified: items.filter((it) => it.basis === "未核验").map((it) => it.text),
      items,
    };
  }

  window.AdvisorClaims = { verify, splitSentences };
})();
