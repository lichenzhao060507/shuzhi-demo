/* memory.js —— Episode 记忆（跨会话）
 * 只记「上一轮问到哪、停在哪一步」这类可复述的事实，不记聊天原文。
 * 存储可注入，便于在 Node 评测里用内存替身跑。
 */
(() => {
  "use strict";

  const KEY = "advisor.ask.memory.v1";
  const MAX_TURNS = 5;

  function readAll(store) {
    try {
      const raw = store.getItem(KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (error) {
      return {};
    }
  }

  function writeAll(store, data) {
    try {
      store.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (error) {
      return false; // 隐私模式/配额满：记忆失效但不影响问答
    }
  }

  function load(store, profile) {
    if (!store || !profile) return null;
    const rec = readAll(store)[profile];
    return rec && typeof rec === "object" ? rec : null;
  }

  function save(store, profile, payload) {
    if (!store || !profile) return null;
    const all = readAll(store);
    const prev = all[profile] || { turns: [], visits: 0 };
    const turns = [].concat(prev.turns || []);
    if (payload && payload.q) {
      turns.push({ q: String(payload.q).slice(0, 80), intent: payload.intent || "", at: Date.now() });
    }
    const rec = {
      profile,
      visits: (prev.visits || 0) + (payload && payload.visit ? 1 : 0),
      turns: turns.slice(-MAX_TURNS),
      lastIntent: (payload && payload.intent) || prev.lastIntent || "",
      lastTool: (payload && payload.tool) || prev.lastTool || "",
      lastQuestion: (payload && payload.q) || prev.lastQuestion || "",
      lastStep: payload && payload.step != null ? payload.step : prev.lastStep,
      lastScenario: payload && payload.scenario ? payload.scenario : prev.lastScenario,
      lastLevel: payload && payload.level != null ? payload.level : prev.lastLevel,
      updatedAt: Date.now(),
    };
    all[profile] = rec;
    writeAll(store, all);
    return rec;
  }

  /* 给二次访问用的开场白：只说记得住的事实，不做推断 */
  function summarize(rec) {
    if (!rec || !rec.turns || !rec.turns.length) return "";
    const parts = [];
    if (rec.lastQuestion) parts.push(`上次你问的是「${rec.lastQuestion}」`);
    if (rec.lastStep) parts.push(`停在改造第 ${rec.lastStep} 步`);
    if (rec.lastScenario) parts.push(`在看 ${rec.lastScenario}`);
    if (rec.lastLevel != null) parts.push(`当前 ${rec.lastLevel} 级`);
    const tail = parts.length ? parts.join("，") : "上次聊过这家企业";
    return `${tail}。记忆存在本机浏览器里，可以随时清空。`;
  }

  function clear(store, profile) {
    if (!store) return;
    const all = readAll(store);
    if (profile && all[profile]) {
      delete all[profile];
      writeAll(store, all);
      return;
    }
    writeAll(store, {});
  }

  window.AdvisorMemory = { KEY, load, save, summarize, clear };
})();
