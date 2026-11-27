# Flywheel · LLM Evaluation and Continuous Improvement

[简体中文](README.zh-CN.md)

Flywheel turns production failures into versioned regression tests and uses the results to control canary releases. It is an evaluation workbench for teams iterating on prompts, retrieval pipelines, agents, and models.

## Getting started

Requires Node.js 22.13 or later. The project has no third-party dependencies.

```bash
npm run dev -- --host 127.0.0.1
```

Open [the workbench](http://localhost:3000). It starts with synthetic customer support data and a rule-based scoring mode. The interface opens in English and can switch to Simplified Chinese. The **Workflow guide** link is in the **Data Flywheel** card on the Overview page.

Try running the demo regression for `v2.4.0` against `v2.3.1`. Then inspect a failing sample, review a bad case, or start a demo canary from a run that passed its release gates.

```bash
npm test
npm run build
```

Local state is stored in SQLite at `.data/flywheel.sqlite`. Set `FLYWHEEL_DB` to use a different database file. The build produces a Cloudflare Worker at `dist/server/index.js` and copies SQL migrations to `dist/drizzle/`. For a Workers deployment, configure a D1 binding named `DB` and apply the migrations in `drizzle/`.

## Workflow

1. **Find failures.** Ingest traces and feedback, mask common PII before storage, and sample 5% of traces without feedback by default to surface silent failures.
2. **Curate examples.** Group related failures and review suggested root causes. Correct bad cases and generate variants for regression, or export approved examples for few-shot use, knowledge base patches, SFT, or DPO. Active evaluation data is isolated from training exports.
3. **Compare candidates.** Replay up to 10 cases in the Playground before registering a candidate. Playground Top-K limits the passages already recorded in the trace. Run a full regression against a pinned dataset snapshot, with rules, an optional LLM judge, and human blind review.
4. **Check stability and release.** For each critical case, the default is three independent replays and all three must pass. Judged runs record the judge model ID and prompt version. Release gates cover quality, P95 latency, time to first token, and cost. When enough live traffic has been observed, a dislike or error rate breach triggers automatic canary rollback and an alert.

## Integration

Use a backend service for ingestion. Set `INGEST_TOKEN` to require a Bearer token on trace and feedback requests. Environment settings are listed in [.env.example](.env.example). Export the variables in your shell before starting the server.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/ingest` | Store an interaction with prompts, retrieved passages, tool calls, latency, token usage, and a version tag. Stable trace IDs support idempotent retries. |
| POST | `/api/signal` | Record feedback with an ID, trace ID, signal type, and optional note. |
| GET | `/api/golden` | Fetch the current golden evaluation dataset. |
| POST | `/api/regression` | Compare candidate and baseline versions using direct or external replay. |
| GET | `/api/route?userKey=...` | Resolve a version and release ID for stable traffic assignment. |
| GET | `/api/export?target=regression` | Download JSONL for `regression`, `few-shot`, `knowledge`, `sft`, or `dpo`. |
| POST | `/api/online/tick` | Process online checks that are ready. The local server also polls the queue every 30 seconds. |

Protect the workbench and its management endpoints at the deployment layer before connecting production traffic. For canary measurement, write the routed version and release ID back to the trace. Report live failures with `error: true` or a 5xx `statusCode`.

Traces can include multi-turn history through `sessionId` and `turnIndex` or an explicit `turns` array. Feedback types include `like`, `dislike`, `correction`, `annotation`, `regenerate`, `copy`, `adopt`, and `abandon`.

### Models and replay

Set `LLM_BASE_URL` to the API root of an OpenAI-compatible service, usually ending in `/v1`. Set `LLM_API_KEY` and `JUDGE_MODEL` to enable LLM judging. Set `EMBEDDING_MODEL` to enable embedding-based clustering. The workbench also supports local similarity clustering and demo scoring.

For a direct replay, the workbench sends a request to the configured model endpoint. For business-specific retrieval or agent execution, run an external replay and submit the recorded output, tool trajectory, and metrics. Supply independent results for each planned attempt on both sides of a critical case. An observation can include `latencyMs`, `ttftMs`, `inputTokens`, `outputTokens`, and `costUsd` inside `metrics`.

For agent evaluation, score imported tool trajectories and isolate execution in the external runner. [The fixture-backed tool mock](scripts/replay-tools.mjs) rejects unmatched calls. Use a fresh fixture set per replay and record `toolIsolation` as `mock`, `read-only`, or `recorded` when submitting the observations.

### Run regression in CI

```bash
npm run regression -- v2.4.0 v2.3.1
```

Set `FLYWHEEL_URL` to point CI at an instance, `FLYWHEEL_JUDGE=llm` to use the model judge, and `FLYWHEEL_OBSERVATIONS` to provide a complete external replay JSON file. The script returns exit code 0 for a passing release gate, 1 for a blocked release, and 2 for a request or configuration error.

## Source layout

| Path | Contents |
| --- | --- |
| `public/` | Workbench UI and localized workflow guides |
| `src/` | Ingestion, evaluation, dataset governance, and release logic |
| `scripts/` | Local server, Worker build, regression CLI, tool mock, and tests |
| `drizzle/` | SQLite and D1 schema migration |
