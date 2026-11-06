/* kb.js —— 本地知识检索（BM25 + 中文二元切分 + 同义词扩展）
 * 数据来自 data/agent/*.json（由 tools/build_agent_index.py 生成）
 * 不联网、不依赖第三方库；案例库 761KB 按需懒加载。
 */
(() => {
  "use strict";

  const CACHE = new Map();
  const INDEX = new Map(); // kind -> {docs, df, avgdl, tfs}

  const SYNONYMS = {
    补贴: ["补助", "奖补", "资金", "支持"],
    补助: ["补贴", "奖补", "资金"],
    资金: ["补贴", "补助", "投入"],
    政策: ["文件", "通知", "办法"],
    案例: ["企业", "做法", "实践"],
    设备: ["联网", "采集", "产线"],
    联网: ["设备", "采集", "网络"],
    质量: ["质检", "不良", "合格率"],
    排程: ["计划", "生产计划", "排产"],
    库存: ["仓储", "物流", "周转"],
    能耗: ["用电", "能源", "节能"],
    成本: ["投入", "费用", "预算"],
    等级: ["级别", "分级", "评测"],
    评测: ["诊断", "评分", "指标"],
    改造: ["转型", "升级", "实施"],
    安全: ["合规", "数据安全"],
    申报: ["试点", "评审", "验收"],
  };

  const FILES = {
    policy: "data/agent/policy.json",
    cases: "data/agent/cases.json",
    public_cases: "data/agent/public_cases.json",
    papers: "data/agent/papers.json",
  };

  function isCJK(ch) {
    return /[\u4e00-\u9fa5]/.test(ch);
  }

  /* 中文按二元切分，英文数字按词；短查询也能命中 */
  function tokenize(text) {
    const raw = String(text || "").toLowerCase();
    const tokens = [];
    const latin = raw.match(/[a-z0-9][a-z0-9\-_.]*/g) || [];
    tokens.push(...latin);
    const cjk = raw.replace(/[^\u4e00-\u9fa5]+/g, " ").split(/\s+/).filter(Boolean);
    for (const run of cjk) {
      if (run.length === 1) tokens.push(run);
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
    }
    return tokens;
  }

  function expand(query) {
    const base = tokenize(query);
    const extra = [];
    for (const [key, words] of Object.entries(SYNONYMS)) {
      if (query.includes(key)) {
        words.forEach((word) => extra.push(...tokenize(word)));
      }
    }
    return base.concat(extra);
  }

  async function load(kind) {
    if (CACHE.has(kind)) return CACHE.get(kind);
    const url = FILES[kind];
    if (!url) throw new Error("未知知识库：" + kind);
    const promise = fetch(url, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`${kind} 载入失败：${res.status}`);
        return res.json();
      })
      .catch((error) => {
        CACHE.delete(kind);
        throw error;
      });
    CACHE.set(kind, promise);
    return promise;
  }

  function buildIndex(kind, docs) {
    if (INDEX.has(kind)) return INDEX.get(kind);
    const df = new Map();
    const tfs = [];
    let totalLen = 0;
    docs.forEach((doc, i) => {
      const fields = [doc.title, doc.text, doc.company, doc.industry, doc.issuer, doc.venue, doc.id]
        .filter(Boolean).join(" ");
      const tokens = tokenize(fields);
      totalLen += tokens.length;
      const tf = new Map();
      tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
      tfs[i] = tf;
      tf.forEach((_, token) => df.set(token, (df.get(token) || 0) + 1));
    });
    const index = { docs, df, avgdl: totalLen / Math.max(1, docs.length), tfs };
    INDEX.set(kind, index);
    return index;
  }

  /* BM25（k1=1.2, b=0.75），外加标题命中加权 */
  async function search(kind, query, options) {
    const opts = options || {};
    const k = opts.k || 3;
    const docs = await load(kind);
    const index = buildIndex(kind, docs);
    const terms = expand(query);
    if (!terms.length) return [];

    const N = docs.length;
    const scores = new Map();
    const k1 = 1.2;
    const b = 0.75;

    terms.forEach((term) => {
      const dfv = index.df.get(term) || 0;
      if (!dfv) return;
      const idf = Math.log(1 + (N - dfv + 0.5) / (dfv + 0.5));
      index.tfs.forEach((tf, i) => {
        const f = tf.get(term) || 0;
        if (!f) return;
        const dl = [...tf.values()].reduce((a, c) => a + c, 0);
        const denom = f + k1 * (1 - b + b * (dl / index.avgdl));
        const gain = idf * ((f * (k1 + 1)) / denom);
        scores.set(i, (scores.get(i) || 0) + gain);
      });
    });

    /* 标题里出现查询词的，补一点权重 */
    const titleBoost = (doc) => {
      let bonus = 0;
      terms.forEach((term) => {
        if ((doc.title || "").toLowerCase().includes(term)) bonus += 0.9;
      });
      return bonus;
    };

    return [...scores.entries()]
      .map(([i, score]) => ({ doc: docs[i], score: score + titleBoost(docs[i]) }))
      .sort((a, b2) => b2.score - a.score)
      .slice(0, k)
      .filter((row) => row.score > (opts.minScore == null ? 1.1 : opts.minScore));
  }

  window.AdvisorKB = { load, search, tokenize };
})();
