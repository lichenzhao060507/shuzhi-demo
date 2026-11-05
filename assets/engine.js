/* 数改判据引擎 · 浏览器端确定性计算
 *
 * 口径来源：工信厅企业〔2024〕56 号 附件（一）(二)
 * 与后端 advisor.scoring.engine 的计分规则逐条对齐，由 6 个预计算样本回归验证。
 *
 * 计分规则（从样本反推并全量验证）：
 *   单选：score = 选项索引 / (选项数 - 1) × 100
 *   多选：score = 选中数 / 有效选项数 × 100   （"无"不计入分母，选中"无"得 0）
 *   单项：points = max_points × score / 100
 *   总分：未取整的 points 求和后再四舍五入两位（half-even，对齐 Python round）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShuzhiEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NONE = "无";

  /* Python round() 是 half-even，JS toFixed 是 half-up，差 0.01 就会和样本对不上 */
  function round2(value) {
    if (typeof value !== "number" || !isFinite(value)) return 0;
    var scaled = value * 100;
    var floor = Math.floor(scaled);
    var diff = scaled - floor;
    if (Math.abs(diff - 0.5) < 1e-9) {
      return (floor % 2 === 0 ? floor : floor + 1) / 100;
    }
    return Math.round(scaled) / 100;
  }

  function isNone(option) {
    return option === NONE;
  }

  /* 单项计分，返回未取整原值供求和 */
  function scoreItem(indicator, selected) {
    var options = indicator.options || [];
    var picked = selected || [];
    var score = 0;

    if (indicator.option_type === "单选") {
      var index = options.indexOf(picked[0]);
      if (index >= 0 && options.length > 1) {
        score = (index / (options.length - 1)) * 100;
      }
    } else {
      var valid = options.filter(function (o) { return !isNone(o); });
      var hits = picked.filter(function (o) { return !isNone(o); });
      if (valid.length > 0) {
        score = (Math.min(hits.length, valid.length) / valid.length) * 100;
      }
      if (picked.length === 1 && isNone(picked[0])) score = 0;
    }

    return {
      score: round2(score),
      raw: (indicator.max_points * score) / 100,
      points: round2((indicator.max_points * score) / 100),
      max: indicator.max_points,
    };
  }

  /* 逐项打分 */
  function scoreAll(criteria, answers) {
    var items = [];
    var totals = { raw: 0, byPrimary: {}, byPrimaryMax: {} };

    criteria.indicators.forEach(function (indicator) {
      var selected = (answers && answers[String(indicator.id)]) || [];
      var result = scoreItem(indicator, selected);
      totals.raw += result.raw;
      totals.byPrimary[indicator.primary] = (totals.byPrimary[indicator.primary] || 0) + result.raw;
      totals.byPrimaryMax[indicator.primary] = (totals.byPrimaryMax[indicator.primary] || 0) + indicator.max_points;

      items.push({
        id: indicator.id,
        title: indicator.title,
        item: indicator.item,
        primary: indicator.primary,
        secondary: indicator.secondary,
        option_type: indicator.option_type,
        options: indicator.options,
        selected: selected,
        score: result.score,
        points: result.points,
        max_points: indicator.max_points,
        chain_weight: indicator.chain_weight,
        rule_gap: indicator.official_rule_gap,
      });
    });

    var dimensionScores = {};
    Object.keys(totals.byPrimary).forEach(function (key) {
      dimensionScores[key] = round2(totals.byPrimary[key]);
    });

    return {
      total: round2(totals.raw),
      raw: totals.raw,
      dimensionScores: dimensionScores,
      dimensionMax: totals.byPrimaryMax,
      items: items,
    };
  }

  /* 场景按等级聚合：达到某级及以上的场景数、其中约束性场景数
   * 口径：官方等级表最低为 1 级，未提交的场景按规则基线兜底为 1 级（对齐后端 rule_baseline） */
  function aggregateScenarios(criteria, scenarioLevels) {
    var byLevel = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var constraintByLevel = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var entered = 0;

    criteria.scenarios.forEach(function (scenario) {
      var level = Number((scenarioLevels || {})[scenario.id] || 0) || 1;
      if (level >= 1) entered += 1;
      for (var L = 1; L <= 4; L += 1) {
        if (level >= L) {
          byLevel[L] += 1;
          if (scenario.constraint) constraintByLevel[L] += 1;
        }
      }
    });

    return { byLevel: byLevel, constraintByLevel: constraintByLevel, entered: entered };
  }

  /* 四级判定：分数、场景数、约束性场景数三个门槛必须同时满足 */
  function judgeLevel(criteria, totalScore, aggregate) {
    var judgement = [];
    var achieved = null;
    var shown = Number(totalScore).toFixed(1);

    (criteria.levels || []).forEach(function (level) {
      var okScore = totalScore >= level.min_score;
      var count = aggregate.byLevel[level.level] || 0;
      var constraint = aggregate.constraintByLevel[level.level] || 0;
      var okScenario = count >= level.min_scenarios;
      var okConstraint = constraint >= level.min_constraint_scenarios;
      var satisfied = okScore && okScenario && okConstraint;

      var notes = [];
      if (!okScore) notes.push("评测得分 " + shown + " < " + level.min_score + " 分");
      if (!okScenario) notes.push("达到 " + level.level + " 级的应用场景 " + count + " 个 < " + level.min_scenarios + " 个");
      if (!okConstraint) notes.push("其中约束性场景 " + constraint + " 个 < " + level.min_constraint_scenarios + " 个");

      judgement.push({
        level: level.level,
        name: level.name,
        min_score: level.min_score,
        min_scenarios: level.min_scenarios,
        min_constraint_scenarios: level.min_constraint_scenarios,
        satisfied: satisfied,
        note: satisfied ? "得分与场景数均达标" : notes.join("；"),
        detail: {
          score: { value: totalScore, threshold: level.min_score, ok: okScore },
          scenario: { value: count, threshold: level.min_scenarios, ok: okScenario },
          constraint: { value: constraint, threshold: level.min_constraint_scenarios, ok: okConstraint },
        },
      });

      if (satisfied) achieved = level;
    });

    return { reached: achieved, judgement: judgement };
  }

  /* 未达标的高级等级说明，用于在结论旁给出"差多少" */
  function unmetFrom(judgement, reachedLevel) {
    return judgement
      .filter(function (j) { return !j.satisfied && (!reachedLevel || j.level > reachedLevel); })
      .map(function (j) { return j.level + " 级（" + j.name + "）：" + j.note; });
  }

  /* 场景缺口：从当前等级升到下一级，还差哪些场景、哪些约束性场景 */
  function scenarioGaps(criteria, scenarioLevels, judge) {
    var target = null;
    var levels = criteria.levels || [];
    var currentLevel = judge.reached ? judge.reached.level : 0;
    for (var i = 0; i < levels.length; i += 1) {
      if (levels[i].level === currentLevel + 1) { target = levels[i]; break; }
    }

    var aggregate = aggregateScenarios(criteria, scenarioLevels);
    if (!target) {
      return { target: null, current: currentLevel, rows: [], shortfall: null };
    }

    var rows = criteria.scenarios.map(function (scenario) {
      var level = Number((scenarioLevels || {})[scenario.id] || 0);
      return {
        id: scenario.id,
        name: scenario.name,
        primary: scenario.primary,
        constraint: Boolean(scenario.constraint),
        current: level,
        need: target.level,
        gap: Math.max(0, target.level - level),
        levels: scenario.levels,
      };
    });

    var pending = rows.filter(function (r) { return r.gap > 0; });
    var pendingConstraint = pending.filter(function (r) { return r.constraint; });

    return {
      target: target,
      current: currentLevel,
      rows: pending.sort(function (a, b) {
        if (a.constraint !== b.constraint) return a.constraint ? -1 : 1;
        return b.gap - a.gap;
      }),
      counts: aggregate,
      shortfall: {
        scenario: Math.max(0, target.min_scenarios - (aggregate.byLevel[target.level] || 0)),
        constraint: Math.max(0, target.min_constraint_scenarios - (aggregate.constraintByLevel[target.level] || 0)),
        score: Math.max(0, target.min_score - (judge.reached ? 0 : 0)),
        pendingScenarios: pending.length,
        pendingConstraint: pendingConstraint.length,
      },
    };
  }

  /* 一级指标短板：按得分率排序，找拖后腿的维度 */
  function dimensionGaps(score) {
    return Object.keys(score.dimensionScores)
      .map(function (name) {
        var got = score.dimensionScores[name];
        var max = score.dimensionMax[name] || 1;
        return { name: name, got: got, max: max, rate: got / max };
      })
      .sort(function (a, b) { return a.rate - b.rate; });
  }

  /* 完整评测 */
  function evaluate(criteria, profile) {
    var score = scoreAll(criteria, profile.answers);
    var aggregate = aggregateScenarios(criteria, profile.scenario_levels);
    var judge = judgeLevel(criteria, score.raw, aggregate);
    var gaps = scenarioGaps(criteria, profile.scenario_levels, judge);

    var ruleGaps = score.items
      .filter(function (item) { return item.rule_gap; })
      .map(function (item) {
        return "采集项 " + item.id + "（" + item.item + "）为 " + item.options.length + " 选项单选，官方评分逻辑未覆盖，按等距线性兜底计分";
      });

    return {
      evaluation: {
        total_score: score.total,
        level: judge.reached ? judge.reached.level : null,
        level_name: judge.reached ? judge.reached.name : "无等级",
        dimension_scores: score.dimensionScores,
        dimension_max: score.dimensionMax,
        unmet: unmetFrom(judge.judgement, judge.reached ? judge.reached.level : null),
        rule_gaps: ruleGaps,
        scenario_levels_source: Object.keys(profile.scenario_levels || {}).length ? "submitted" : "rule_baseline",
        scenario_count_by_level: aggregate.byLevel,
        constraint_count_by_level: aggregate.constraintByLevel,
      },
      level_judgement: judge.judgement,
      item_results: score.items,
      gaps: gaps,
      dimension_gaps: dimensionGaps(score),
    };
  }

  return {
    round2: round2,
    scoreItem: scoreItem,
    scoreAll: scoreAll,
    aggregateScenarios: aggregateScenarios,
    judgeLevel: judgeLevel,
    scenarioGaps: scenarioGaps,
    dimensionGaps: dimensionGaps,
    evaluate: evaluate,
  };
});
