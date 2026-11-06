/* graph.js —— 极简编排引擎
 * 节点顺序执行，支持条件跳过（when）、失败降级（optional）、事件回调（用于 UI 显示调用链）。
 * 不做并行、不做持久化：这个规模的项目不需要，也没时间验证。
 */
(() => {
  "use strict";

  async function run(nodes, ctx, onEvent) {
    const trace = [];
    const emit = (event) => { if (typeof onEvent === "function") onEvent(event); };

    for (const node of nodes) {
      const started = performance.now();

      if (typeof node.when === "function" && !node.when(ctx)) {
        trace.push({ id: node.id, label: node.label, status: "skipped", ms: 0 });
        emit({ type: "node", id: node.id, label: node.label, status: "skipped" });
        continue;
      }

      emit({ type: "node", id: node.id, label: node.label, status: "running" });
      try {
        const output = await node.run(ctx);
        if (output !== undefined) ctx[node.id] = output;
        const ms = Math.round(performance.now() - started);
        trace.push({ id: node.id, label: node.label, status: "ok", ms });
        emit({ type: "node", id: node.id, label: node.label, status: "ok", ms });
      } catch (error) {
        const ms = Math.round(performance.now() - started);
        trace.push({ id: node.id, label: node.label, status: "error", ms, error: String(error.message || error) });
        emit({ type: "node", id: node.id, label: node.label, status: "error", ms });
        if (!node.optional) throw error;
      }
    }

    return { ctx, trace };
  }

  window.AdvisorGraph = { run };
})();
