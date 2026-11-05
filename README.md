# 静态演示站（评委点开就看的那一版）

纯静态：无后端、无构建、无第三方依赖。`index.html` + `assets/` + `data/` 直接丢进任何
静态托管（nginx 子路径、OSS/COS、GitHub Pages）就能跑。

```
index.html            页面骨架
assets/styles.css     设计令牌与全部样式（含深色模式）
assets/engine.js      判据引擎：计分、定级、场景缺口（可直接 require，用于回归测试）
assets/app.js         渲染与交互
assets/img/           首屏配图（AI 生成的车间示意图，非实拍）
data/criteria.json    官方判据（15 采集项 + 16 场景 + 四级门槛）
data/fixtures.json    6 个示例企业的元信息
data/samples/*.json   6 个示例企业的完整预计算结果（诊断 / 路径 / 排序 / 政策）
data/policy-notes.json  与结论直接相关的政策注解
official/             官方 PDF 原文（证据卡"打开原文"指向它）
单文件版/             打包好的单文件 HTML，双击即可离线演示
```

## 本地预览

```bash
python -m http.server 8000 --directory static_site
# 打开 http://127.0.0.1:8000
```

直接双击 `index.html` 不行：`file://` 会被同源策略拦住，读不到 `data/*.json`。
要双击看，用 `单文件版/数改指导智能体-演示.html`。

## 数据从哪来（别再手工导出）

```bash
python tools/sync_site_data.py            # 从后端重导 data/
python tools/sync_site_data.py --check    # 只比对：与后端不一致就返回 1
node static_site/test-regression.mjs      # 浏览器引擎 vs 后端，6 份样本逐项比对
node static_site/build-single.mjs         # 重新打包单文件版
```

判据、结果、政策库任一改动后，这四条跑一遍再提交。`data/` 是**导出快照**，
不是手写文件；`meta.generated_at` 故意写成固定说明文字，避免每次导出都产生无意义 diff。

## 两条数据通路

| 通路 | 数据来源 | 投入产出 |
|---|---|---|
| 示例企业 | `data/samples/*.json`（后端预计算） | 完整，含 ROI 区间与排序 |
| 自定义画像 | `assets/engine.js` 浏览器内实算 | 不出金额，改出场景缺口优先级表 |

自定义画像不给金额是**故意的**：金额依赖后端的成本区间与成效弹性系数，前端没有这份库，
编一个数出来会毁掉"可回查"这个立身之本。页面对应位置已写明。

## 引擎与后端的对齐

`engine.js` 是从 6 份样本反推并全量验证的：

- 单选：`score = 选项索引 / (选项数 - 1) × 100`
- 多选：`score = 选中数 / 有效选项数 × 100`，「无」不计入分母，单选「无」得 0
- 单项：`points = max_points × score / 100`
- 总分：未取整 points 求和后 `round2`，采用 half-even（对齐 Python `round`，用 `toFixed` 会差 0.01）
- 定级：得分、达标场景数、其中约束性场景数**三项同时满足**
- 场景缺失：按规则基线兜底为 1 级（对齐后端 `rule_baseline`）

`node static_site/test-regression.mjs` 当前：**6/6 通过，二级校验 6/6 通过**。

## 部署

见 `docs/` 与工作区里的《公网部署方案》。最短路径：nginx 里给这个目录一个 location，
配 `auth_basic` 给评委账号密码；后端挂了也不影响，页面自动走预计算数据并在顶部标注。
