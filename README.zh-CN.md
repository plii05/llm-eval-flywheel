# 飞轮 · 大模型评测与数据闭环

[English README](README.md)

飞轮是面向 Prompt、RAG 和 Agent 的大模型评测工作台。界面默认使用英文，在右上角可切换简体中文。默认数据来自模拟的电商售后场景，包含 42 条可查链路、24 条基准用例以及 3 次回归。概览的 7 日趋势使用标明来源的演示汇总。

## 启动

需要 Node.js 22.13 或更新版本。程序没有第三方包依赖。

```bash
npm run dev -- --host 127.0.0.1
npm test
npm run build
```

浏览器访问 `http://localhost:3000`。本地 SQLite 数据默认保存到 `.data/flywheel.sqlite`。使用 `FLYWHEEL_DB` 可以指定独立数据库文件。构建生成 `dist/server/index.js` 和 `dist/drizzle/`。部署到 Cloudflare Workers 时，在目标环境配置 `DB` 的 D1 绑定并应用 `drizzle/` 内的迁移。

## 体验闭环

1. 在链路页面打开任意记录，查看输入、Prompt、检索片段、工具参数、延迟、Token 和反馈。选择「模拟采集」验证新增链路。
2. 从概览运行初始候选 `v2.4.0`。规则校验覆盖关键词、格式、长度和工具断言。通过规则的样本进入裁判层。发布卡点检查候选通过率、相对基线、关键失败修复率和关键用例回归。
3. 从评测失败详情归档 Bad Case，或在链路上提交点踩、纠错、重试和异常中断。确认根因和修正答案后，选择回流目标。回归样本写入新版基准集，其他目标可导出 JSONL。
4. 在分层评测的「人工校准」中抽取 A/B 样本。提交偏好后展示裁判选择，并计算观察一致率与 Cohen’s κ。
5. 在回归与灰度页面基于通过卡点的批次创建灰度。可验证稳定分桶、调整比例、全量发布或回滚。修改基准集或阈值后需要重新跑回归。

## 接入 API

应用后端发送 JSON。使用稳定的请求 ID 和反馈 ID 支持幂等重试。配置 `INGEST_TOKEN` 时，接入请求需要 `Authorization: Bearer <token>`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/ingest` | 写入 `id`、`input`、`output`、`prompt`、`model`、`version`、`kind`、`context`、`tools`、`latencyMs`、`inputTokens`、`outputTokens` |
| POST | `/api/signal` | 写入 `id`、`traceId`、`type`、可选 `note` |
| GET | `/api/route?userKey=...` | 业务应用取回路由的 `version`，并在实际调用后把该版本写回链路 |
| GET | `/api/golden` | 取得全量评测输入、上下文与规则 |
| POST | `/api/regression` | 以 `candidate`、`baseline`、`judgeMode` 和可选 `observations` 触发回归 |
| GET | `/api/export?target=regression` | 导出回归、Few-shot、知识库、SFT 或 DPO，目标取值为 `regression`、`few-shot`、`knowledge`、`sft`、`dpo` |

`kind` 支持 `rag`、`prompt`、`agent`。`context` 使用 `{id,title,text,score}` 数组，`tools` 使用 `{name,args,result,latencyMs}` 数组。反馈类型为 `like`、`dislike`、`correction`、`annotation`、`regenerate`、`copy`、`adopt`、`abandon`。如果检索没有返回，可在 `telemetry.knowledgePresent` 明确知识库是否覆盖。

## 模型裁判与 CI

在受控执行环境中设置 `LLM_BASE_URL`（OpenAI 兼容 API 根路径，通常包含 `/v1`）、`LLM_API_KEY` 和 `JUDGE_MODEL`。登记版本的系统 Prompt 和模型名后，直接回放将调用该 Chat Completions 端点。RAG 检索、重排和真实 Agent 工具回放由业务应用执行。使用 `/api/golden` 取样后，从应用提交全量观察结果。

```json
{
  "GC-101": {
    "baseline": {"output": "基线回答", "tools": []},
    "candidate": {"output": "候选回答", "tools": []}
  }
}
```

CI 可在 Prompt、模型或知识库变更的流水线里执行以下命令。环境变量 `FLYWHEEL_URL` 指向可被 CI 访问的实例。若前层身份验证接受 Bearer，则设置 `FLYWHEEL_ACCESS_TOKEN`。使用 `FLYWHEEL_OBSERVATIONS` 指向完整的外部回放 JSON 文件。

```bash
FLYWHEEL_JUDGE=llm npm run regression -- my-candidate my-baseline
```

退出码 0 表示通过，1 表示卡点未通过，2 表示调用或配置失败。演示评分使用字符重合度估算，界面和运行数据均标注模式。训练、业务知识库更新、流量切分后的模型调用由接入方执行。回流时自动遮盖常见手机号、邮箱、身份证号和密钥格式，保留原始链路供归因。真实数据接入前，应按业务的数据治理要求配置访问和源头脱敏。内置数据库使用基于版本的并发更新，建议把该 MVP 用于小规模试点。

## 线上抽检、评测门槛与治理

- 采集入口在保存前对文本和结构化字段遮盖常见手机号、邮箱、身份证号、带标记的订单号和上下文可识别的姓名。使用不含个人信息的技术 ID。线上抽检默认将 5% 的无反馈链路加入持久队列，采集请求返回后执行。反馈在抽检提交前到达时跳过该任务。本地部署每 30 秒检查队列。若设置等待窗口，Hosted 部署由后续采集或反馈触发到期任务处理，也可由业务调度调用 `POST /api/online/tick`。具备 Worker Cron 的部署可直接使用 `scheduled` 入口。
- 设置 `EMBEDDING_MODEL` 后，聚类使用同一兼容端点的 `/embeddings`；配置裁判模型后可提供簇标题、建议根因和证据。未配置时使用本地文本相似度与规则。聚类基于最近至多 400 条有链路的案例。
- 链路可通过相同 `sessionId` 和递增 `turnIndex` 组成 Session，也可提交 `turns: [{role,content}]`。会话用例重放历史消息并评测末轮回答。Agent 回放接收外部执行器记录的工具轨迹，工具约束可检查顺序、相同参数的重复调用和三次重复子序列。
- 回归对关键用例默认要求基线和候选独立执行三次。外部回放的每个侧别可提交数组，数组中的每次回放均可带 `metrics: {latencyMs,ttftMs,inputTokens,outputTokens,costUsd}`。客户端未提供 `costUsd` 时按配置的输入与输出 Token 单价估算。从兼容模型流式响应测量首字延迟。配置启用的指标缺失时会拦截发布。稳定性报告记录已完成的通过次数、通过比例、得分方差和是否完成全部计划回放。默认要求候选连续三次全部通过。未完成用例按基线和候选分别计数。批次通过率是完整通过的用例数除以计划用例总数。有未完成用例时，发布卡点会拦截该批结果。配置方差策略时也须达到均分门槛。旧版 API 的 `passAtK` 字段保留给已有客户端，含义为至少成功一次的估计概率。
- 用例新增、修订、移出或恢复均保留快照。训练与 Few-shot 数据导出会记录使用，活动基准与其同输入或同来源变体的冲突会被拦截。生成的变体经人工确认后可批量写入同一快照。
- 调试台可以对一至十条 Bad Case 进行模型回放或规则预览。Top-K 截取已记录的召回结果；若需要验证业务侧重新检索，使用外部回放提交实际输出。
- 灰度时将路由返回的 `releaseId`、`version` 以及 `error: true` 或 5xx `statusCode` 写回链路。自动熔断使用真实流量的滚动窗口，达到最少样本量后，超出点踩率或报错率阈值会切回基线并在工作台记录告警。Hosted 私有部署的服务调用可使用平台提供的服务凭证，CI 支持 `FLYWHEEL_SITES_TOKEN`。

## Agent 回放与裁判可追溯性

内置回放只调用模型接口，导入的轨迹用于评测。外部 Agent 执行器可使用 `scripts/replay-tools.mjs` 的工具 Mock。每次独立回放创建一个新的 Mock，按工具名和参数匹配夹具。未匹配的调用会失败，夹具中没有生产工具处理器。

```js
import { createToolMock } from './scripts/replay-tools.mjs';

const tools = createToolMock([
  { name: 'lookup_policy', args: { topic: 'refund' }, result: { windowDays: 7 } }
]);

// 将 tools.call 接到测试 Agent 的工具执行接口，再提交本次回放结果。
await tools.call('lookup_policy', { topic: 'refund' });
const replay = { output: '可在签收后 7 天内申请退款。', tools: tools.calls, toolIsolation: 'mock' };
```

外部执行器也可以使用只读沙箱并在回放观察结果上提交 `toolIsolation: 'read-only'`。重评历史轨迹使用 `recorded`。`toolIsolation` 由执行器声明，外部环境的权限和隔离由该执行器控制。

LLM 裁判批次记录基准快照、发给模型端点的裁判模型标识和不可变的裁判 Prompt 版本。横向比较时使用相同三项配置，并优先使用固定版本的模型标识。人工校准的分组也采用裁判模型和 Prompt 版本组合。历史批次缺少模型标识时会保留缺失状态。
