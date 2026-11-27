import { upgradeState, recordDataset, datasetVersion, datasetDetail, viewGovernance, gateSnapshot, onlineDefaults, eligibleRun, assertEvalIsolation, markTrainingExport } from './governance.js';
import { stableBucket, queueInspection, inspectTrace, canaryStats, checkCanary, groupCases, makeVariants, comparePlayground } from './operations.js';
import { redact, redactTree, safeIdentifier } from './privacy.js';
import { seed, causes, feedbackTypes, dateAgo } from './seed.js';
import { regression, agreement, replayMetrics, mapLimited, agentTrajectory, judgeProfile, externalToolIsolation } from './evaluate.js';

const demoRuns = [
  ['EV-0842', 'v2.4.0', 'v2.3.1', 0, 28],
  ['EV-0841', 'v2.3.1', 'v2.2.0', 1, 132],
  ['EV-0840', 'v2.4.0', 'v2.2.0', 2, 155]
];
const negative = ['dislike', 'correction', 'regenerate', 'abandon'];
const targets = ['regression', 'few-shot', 'knowledge', 'sft', 'dpo'];
const groups = ['核心场景', '边界用例', '历史回归'];
const kinds = ['rag', 'prompt', 'agent'];
const id = prefix => prefix + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
const now = () => new Date().toISOString();
const bad = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const str = (value, limit = 3000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value, limit = 20) => Array.isArray(value) ? value.slice(0, limit) : [];
const number = (value, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) bad('数值超出有效范围。');
  return value;
};
const telemetryNumber = value => Math.max(0, Math.min(10000000, Math.round(Number(value) || 0)));
const find = (items, key, label) => items.find(item => item.id === key) || bad(label + '不存在。', 404);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

async function initialState() {
  const state = seed();
  upgradeState(state);
  state.runs = await Promise.all(demoRuns.map(([key, candidate, baseline, days, minutes]) => regression(state, { id: key, candidate, baseline, createdAt: dateAgo(days, minutes) }, {})));
  for (const run of state.runs) {
    run.datasetRevision = state.datasetRevision;
    run.datasetVersion = datasetVersion(state.datasetRevision);
    run.gateConfig = gateSnapshot(state);
  }
  state.releases.push({ id: 'RL-021', version: 'v2.3.1', baseline: 'v2.2.0', status: 'promoted', percent: 100, createdAt: dateAgo(5), updatedAt: dateAgo(4), runId: 'EV-0838' });
  return state;
}

async function load(db) {
  if (!db) bad('数据存储尚未配置。', 503);
  let row = await db.prepare('SELECT revision, body FROM flywheel_state WHERE id = 1').first();
  if (!row) {
    const state = await initialState();
    await db.prepare('INSERT OR IGNORE INTO flywheel_state (id, revision, body) VALUES (1, 0, ?)').bind(JSON.stringify(state)).run();
    row = await db.prepare('SELECT revision, body FROM flywheel_state WHERE id = 1').first();
  }
  const state = JSON.parse(row.body);
  if (state.schemaVersion === 2) return { revision: row.revision, state };
  upgradeState(state);
  const updated = await db.prepare('UPDATE flywheel_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(JSON.stringify(state), row.revision).run();
  return updated.meta.changes === 1 ? { revision: row.revision + 1, state } : load(db);
}

async function change(db, update) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { revision, state } = await load(db);
    const response = update(state);
    const body = JSON.stringify(state);
    if (new TextEncoder().encode(body).length > 1700000) bad('当前工作区达到存储上限，请使用独立存储部署。', 413);
    const saved = await db.prepare('UPDATE flywheel_state SET body = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(body, revision).run();
    if (saved.meta.changes === 1) return response;
  }
  bad('工作区刚刚发生更新，请重试。', 409);
}

function infer(trace) {
  if (trace.tools.some(call => call.args?.queue === 'billing' && trace.input.includes('人工'))) return '工具参数错误';
  if (trace.kind === 'rag' && !trace.context.length) {
    if (trace.telemetry?.knowledgePresent === false) return '知识库缺失';
    if (trace.telemetry?.knowledgePresent === true) return '检索未召回';
    return '待确认';
  }
  if (trace.kind === 'prompt') return 'Prompt 歧义';
  return '待确认';
}

function createCase(state, trace, rationale = '', source = 'feedback') {
  const prior = state.cases.find(item => item.traceId === trace.id);
  if (prior) return prior;
  const item = { id: id('BC'), traceId: trace.id, title: trace.name || str(trace.input, 60),
    cause: infer(trace), source, status: 'open', corrected: '', target: 'regression', note: redact(rationale), createdAt: now() };
  state.cases.unshift(item);
  return item;
}

function addFeedback(state, trace, body) {
  const type = str(body.type, 40);
  if (!feedbackTypes.includes(type)) bad('反馈类型无效。');
  const feedbackId = safeIdentifier(body.id, 70);
  if (feedbackId && trace.feedback.some(f => f.id === feedbackId)) return trace;
  if (trace.feedback.length >= 100) bad('这条交互的反馈记录已达上限。', 409);
  trace.feedback.push({ id: feedbackId || id('FB'), type, note: redact(str(body.note, 1000)), at: now() });
  if (negative.includes(type)) createCase(state, trace, str(body.note, 1000));
  return trace;
}

function toolCalls(value) {
  return list(value, 40).filter(plain).map(call => ({
    name: redact(str(call.name, 100)), args: plain(call.args) ? redactTree(call.args) : {},
    result: redactTree(call.result ?? null), latencyMs: telemetryNumber(call.latencyMs)
  }));
}

function dialogue(value) {
  return list(value, 30).filter(turn => ['user', 'assistant'].includes(turn?.role) && str(turn.content, 2500))
    .map(turn => ({ role: turn.role, content: redact(str(turn.content, 2500)) }));
}

function contextDocs(value) {
  return list(value, 25).filter(plain).map(doc => ({ id: redact(str(doc.id, 80)), title: redact(str(doc.title, 120)),
    text: redact(str(doc.text, 3000)), score: Number.isFinite(doc.score) ? doc.score : null }));
}

function addTrace(state, body, { demo = false, source = 'live' } = {}) {
  const turns = dialogue(body.turns);
  const input = redact(str(body.input, 10000)) || [...turns].reverse().find(turn => turn.role === 'user')?.content;
  if (!input || typeof body.output !== 'string') bad('请提供 input 与 output。');
  const key = safeIdentifier(body.id) || id('TR');
  const existing = state.traces.find(t => t.id === key);
  if (existing) return existing;
  const metrics = replayMetrics({ ...body, ...body.metrics }, state.config);
  const trace = {
    id: key, input, output: redact(str(body.output, 12000)), expected: redact(str(body.expected, 8000)), name: redact(str(body.name, 100)) || str(input, 48),
    kind: kinds.includes(body.kind) ? body.kind : 'rag', version: safeIdentifier(body.version) || state.config.baseline,
    model: redact(str(body.model, 100)) || '未指定', prompt: redact(str(body.prompt, 12000)), latencyMs: metrics.latencyMs ?? 0,
    ttftMs: metrics.ttftMs, costUsd: metrics.costUsd, inputTokens: metrics.inputTokens ?? 0, outputTokens: metrics.outputTokens ?? 0, createdAt: now(),
    sessionId: safeIdentifier(body.sessionId, 128), turnIndex: body.turnIndex == null ? null : number(body.turnIndex, 0, 1000000), turns,
    releaseId: safeIdentifier(body.releaseId), error: body.error === true || (Number.isInteger(body.statusCode) && body.statusCode >= 500),
    telemetry: { knowledgePresent: typeof body.telemetry?.knowledgePresent === 'boolean' ? body.telemetry.knowledgePresent : null },
    context: contextDocs(body.context), tools: toolCalls(body.tools), feedback: [], demo, source
  };
  if (trace.turnIndex != null && !Number.isInteger(trace.turnIndex)) bad('轮次须为整数。');
  if (trace.turns.at(-1)?.role === 'assistant' && trace.turns.at(-1).content === trace.output) trace.turns.pop();
  if (trace.kind === 'agent') trace.agentStats = agentTrajectory(trace.tools);
  state.traces.unshift(trace);
  for (const feedback of list(body.feedback).filter(plain)) addFeedback(state, trace, feedback);
  queueInspection(state, trace);
  return trace;
}

function sessionData(state, key) {
  const traces = state.traces.filter(trace => trace.sessionId === key).sort((a, b) => (a.turnIndex ?? Infinity) - (b.turnIndex ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  if (!traces.length) bad('会话不存在。', 404);
  const last = traces.at(-1);
  const turns = last.turns?.length > 1 ? last.turns : traces.slice(-15).flatMap((trace, index, group) => [
    { role: 'user', content: trace.input }, ...(index === group.length - 1 ? [] : [{ role: 'assistant', content: trace.output }])
  ]);
  return { id: key, traces, last, turns };
}

function addGolden(state, body, { snapshot = true, prior = null } = {}) {
  const input = redact(str(body.input, 5000)), reference = redact(str(body.reference, 5000));
  if (!input || !reference) bad('请填写输入与参考答案。');
  const traceId = safeIdentifier(body.traceId);
  const example = {
    id: id('GC'), name: redact(str(body.name, 100)) || input.slice(0, 48), input, reference, context: redact(str(body.context, 10000)),
    kind: kinds.includes(body.kind) ? body.kind : 'rag', group: groups.includes(body.group) ? body.group : '历史回归',
    critical: body.critical === true, required: list(body.required).map(v => redact(str(v, 150))).filter(Boolean),
    forbidden: list(body.forbidden).map(v => redact(str(v, 150))).filter(Boolean), json: body.json === true,
    maxLength: body.maxLength ? number(body.maxLength, 1, 12000) : null,
    tool: plain(body.tool) && str(body.tool.name, 120) ? { name: redact(str(body.tool.name, 120)), args: plain(body.tool.args) ? redactTree(body.tool.args) : {} } : null,
    observed: redact(str(body.observed, 5000)), traceId, createdAt: now(),
    turns: dialogue(body.turns), contextDocs: contextDocs(body.contextDocs), variant: redact(str(body.variant, 48)), replaces: prior?.id || '',
    agent: plain(body.agent) ? {
      steps: list(body.agent.steps, 40).map(step => redact(str(step, 100))).filter(Boolean),
      noLoop: body.agent.noLoop === true, maxRetries: body.agent.maxRetries == null ? null : number(body.agent.maxRetries, 0, 40)
    } : null
  };
  example.familyId = prior?.familyId || state.traces.find(trace => trace.id === traceId)?.familyId || traceId || example.id;
  assertEvalIsolation(state, example);
  if (state.golden.some(sample => sample.id !== prior?.id && sample.familyId === example.familyId && sample.input === example.input)) bad('同一来源已包含该输入。', 409);
  if (prior) {
    state.golden = state.golden.filter(sample => sample.id !== prior.id);
    state.sampleArchive.unshift(prior);
  }
  state.golden.unshift(example);
  if (snapshot) recordDataset(state, prior ? '修订用例' : '新增用例');
  return example;
}

function updateCase(state, body) {
  const item = find(state.cases, body.id, '案例');
  if (item.status === 'curated') bad('已回流的案例保留原快照。', 409);
  const trace = find(state.traces, item.traceId, '链路');
  item.cause = causes.includes(body.cause) ? body.cause : item.cause;
  item.note = redact(str(body.note, 2000));
  item.corrected = redact(str(body.corrected, 8000));
  item.target = targets.includes(body.target) ? body.target : item.target;
  if (!item.corrected || item.cause === '待确认') bad('请确认根因并填写修正答案。');
  item.status = 'confirmed';
  if (body.curate) {
    item.status = 'curated';
    if (item.target === 'regression') addGolden(state, { name: item.title, input: trace.input, reference: item.corrected, observed: trace.output,
      context: trace.context.map(doc => doc.text).join('\n'), contextDocs: trace.context, turns: trace.turns,
      critical: body.critical === true, kind: trace.kind, group: '历史回归', traceId: trace.id });
  }
  return item;
}

function exportRows(state, target) {
  if (!targets.includes(target)) bad('回流目标无效。');
  if (target === 'regression') return state.golden.map(({ demoCandidate, demoBaseline, observed, ...row }) => row);
  const items = state.cases.filter(item => item.status === 'curated' && item.target === target);
  markTrainingExport(state, items.map(item => {
    const trace = find(state.traces, item.traceId, '链路');
    return { traceId: trace.id, familyId: trace.familyId || trace.id, caseId: item.id, input: trace.input };
  }), target);
  return items.map(item => {
    const trace = find(state.traces, item.traceId, '链路');
    const prompt = redact(trace.input), chosen = item.corrected, rejected = redact(trace.output);
    if (target === 'sft') return { messages: [{ role: 'user', content: prompt }, { role: 'assistant', content: chosen }] };
    if (target === 'dpo') return { prompt, chosen, rejected };
    if (target === 'knowledge') return { title: redact(item.title), body: chosen, sourceTrace: item.traceId };
    return { input: prompt, output: chosen };
  });
}

function addVersion(state, body) {
  const key = safeIdentifier(body.id, 60);
  const name = redact(str(body.name, 100));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(key) || !name) bad('请填写版本标识和名称。');
  if (state.versions.some(v => v.id === key)) bad('版本标识已存在。', 409);
  const version = { id: key, name, model: redact(str(body.model, 100)), prompt: redact(str(body.prompt, 12000)), topK: body.topK == null ? null : number(body.topK, 0, 25),
    strategy: ['Prompt', 'RAG', 'SFT', 'DPO'].includes(body.strategy) ? body.strategy : 'Prompt', mode: 'llm' };
  if (!version.model || !version.prompt) bad('请填写模型名和系统 Prompt。');
  if (version.topK != null && !Number.isInteger(version.topK)) bad('Top-K 须为整数。');
  state.versions.unshift(version);
  return version;
}

function publicReview(review) {
  if (review.human) return review;
  const { judge, order, ...blind } = review;
  return blind;
}

function newReview(state, body) {
  const run = find(state.runs, body.runId, '评测');
  if (run.judgeMode !== 'llm' && body.realJudgeOnly === true) bad('该评测未使用模型裁判。');
  const already = new Set(state.reviews.filter(r => r.runId === run.id).map(r => r.sampleId));
  const options = run.rows.filter(row => row.candidate.judge && row.baseline.judge && row.candidate.output !== row.baseline.output && !already.has(row.id));
  if (!options.length) bad('这次评测没有剩余可盲评的双裁判对照样本。', 409);
  const sample = options[crypto.getRandomValues(new Uint32Array(1))[0] % options.length];
  const swap = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 1;
  const [a, b] = swap ? [sample.candidate, sample.baseline] : [sample.baseline, sample.candidate];
  const review = { id: id('RV'), runId: run.id, sampleId: sample.id, input: sample.input, reference: sample.reference, a: a.output, b: b.output,
    order: swap ? ['candidate', 'baseline'] : ['baseline', 'candidate'], judge: a.score === b.score ? 'tie' : a.score > b.score ? 'A' : 'B',
    mode: run.judgeMode, judgeVersion: run.judgeVersion || null, judgeModel: run.judgeModel || null, human: null, createdAt: now() };
  state.reviews.unshift(review);
  return publicReview(review);
}

function startRelease(state, body, env) {
  if (state.releases.some(release => release.status === 'canary')) bad('请先完成当前灰度。', 409);
  const run = find(state.runs, body.runId, '评测');
  if (!eligibleRun(state, run, env)) bad('需要使用当前基线、基准集和门槛通过全量回归。', 409);
  const release = { id: id('RL'), version: run.candidate, baseline: run.baseline, status: 'canary',
    percent: number(body.percent, 1, 50), runId: run.id, createdAt: now(), updatedAt: now(), demo: run.demo, datasetVersion: run.datasetVersion, fuseConfig: { ...state.config.fuse } };
  state.releases.unshift(release);
  return release;
}

function updateRelease(state, body, env) {
  const release = find(state.releases, body.id, '发布记录');
  if (release.status !== 'canary') bad('这条灰度已结束。', 409);
  if (body.action === 'promote') {
    const run = find(state.runs, release.runId, '评测');
    if (!eligibleRun(state, run, env)) bad('基准集、裁判或门槛已更新，请重新评测。', 409);
    release.status = 'promoted';
    state.config.baseline = release.version;
    release.percent = 100;
  } else if (body.action === 'rollback') {
    release.status = 'rolledback';
    release.percent = 0;
  } else {
    release.percent = number(body.percent, 1, 50);
  }
  release.updatedAt = now();
  return release;
}

function route(state, user) {
  if (!str(user, 256)) bad('请提供稳定的 userKey。');
  const bucket = stableBucket(user);
  const active = state.releases.find(release => release.status === 'canary');
  return { version: active && bucket < active.percent ? active.version : state.config.baseline, bucket, releaseId: active?.id ?? null };
}

function dashboardState(state, env) {
  const { datasetSnapshots, sampleArchive, trainingUse, ...visible } = state;
  const judge = judgeProfile(state, env);
  const judgeAgreement = state.judges.flatMap(item => {
    const model = item.model || env.JUDGE_MODEL || null;
    const reviews = state.reviews.filter(review => review.mode === 'llm' && review.judgeVersion === item.id);
    const models = new Set([model, ...reviews.map(review => review.judgeModel ?? null)]);
    return [...models].map(reviewedModel => ({
      id: item.id, model: reviewedModel, configured: reviewedModel === model,
      active: item.id === judge.id && reviewedModel === model,
      ...agreement(reviews.filter(review => (review.judgeModel ?? null) === reviewedModel))
    }));
  });
  return {
    ...visible, ...viewGovernance(state), runs: state.runs.map(({ rows, ...run }) => run),
    eligibleRuns: state.runs.filter(run => eligibleRun(state, run, env)).map(run => run.id),
    releases: state.releases.map(item => ({ ...item, signals: canaryStats(state, item) })),
    reviews: state.reviews.map(publicReview), agreement: agreement(state.reviews.filter(r => r.mode === 'llm')),
    judgeAgreement, demoAgreement: agreement(state.reviews.filter(r => r.mode === 'heuristic')),
    modelReady: Boolean(env.LLM_BASE_URL && env.LLM_API_KEY), judgeReady: Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && judge.model)
  };
}

function addJudge(state, body) {
  const name = redact(str(body.name, 80));
  const prompt = redact(str(body.prompt, 10000));
  if (!name || !prompt) bad('填写裁判版本名称与裁判 Prompt。');
  const judge = { id: id('JUDGE'), name, prompt, model: redact(str(body.model, 100)), createdAt: now() };
  state.judges.unshift(judge);
  if (body.activate !== false) state.config.activeJudge = judge.id;
  return judge;
}

function setConfig(state, body) {
  const ranges = { minPass: [0, 100], minCritical: [0, 100], maxLatencyP95: [1, 120000], maxTtftP95: [1, 120000],
    maxCostDelta: [0, 1000], inputPrice: [0, 10000], outputPrice: [0, 10000], criticalRepeats: [1, 10], passAtK: [1, 10],
    stabilityVariance: [0, 2500], calibrationThreshold: [0, 100], calibrationMin: [1, 1000] };
  for (const [key, limits] of Object.entries(ranges)) {
    if (!Object.hasOwn(body, key)) continue;
    const optional = ['maxLatencyP95', 'maxTtftP95', 'maxCostDelta', 'stabilityVariance'].includes(key);
    const value = body[key] === null && optional ? null : number(body[key], ...limits);
    if (['criticalRepeats', 'passAtK', 'calibrationMin'].includes(key) && !Number.isInteger(value)) bad('重复次数、K 和最少票数应为整数。');
    state.config[key] = value;
  }
  if (Object.hasOwn(body, 'passAtK') && state.config.passAtK > state.config.criticalRepeats) bad('Pass@k 的 k 不能大于关键用例重复次数。');
  state.config.passAtK = Math.min(state.config.passAtK, state.config.criticalRepeats);
  if (plain(body.online)) state.config.online = {
    sampleRate: number(body.online.sampleRate, 0, 100), settleMinutes: number(body.online.settleMinutes, 0, 1440),
    judgeMode: body.online.judgeMode === 'llm' ? 'llm' : 'rules',
    clusterEvery: number(body.online.clusterEvery ?? onlineDefaults.clusterEvery, 1, 400)
  };
  if (plain(body.fuse)) state.config.fuse = {
    enabled: body.fuse.enabled === true, minCalls: number(body.fuse.minCalls, 2, 9999), dislikeLift: number(body.fuse.dislikeLift, 0, 1000),
    minDislikes: number(body.fuse.minDislikes, 1, 9999), maxErrorRate: number(body.fuse.maxErrorRate, 0, 100),
    windowMinutes: number(body.fuse.windowMinutes, 1, 1440)
  };
  return state.config;
}

async function drainOnline(env) {
  const database = env.DB;
  const { state: snapshot } = await load(database);
  const expired = Date.now() - 90000;
  const isDue = job => (job.status === 'queued' && Date.parse(job.dueAt) <= Date.now()) ||
    (job.status === 'running' && Date.parse(job.startedAt) <= expired);
  if (!snapshot.onlineJobs.some(isDue)) return [];
  const scheduled = await change(database, state => {
    const items = [];
    for (const job of [...state.onlineJobs].reverse().filter(isDue).slice(0, 5)) {
      const trace = state.traces.find(item => item.id === job.traceId);
      if (!trace || trace.feedback.length) {
        job.status = 'skipped';
        job.finishedAt = now();
      } else {
        job.status = 'running';
        job.jobAttempts++;
        job.startedAt = now();
        items.push({ job: { ...job }, trace });
      }
    }
    return items;
  });
  if (!scheduled.length) return [];
  return mapLimited(scheduled, 2, async ({ job, trace }) => {
    let result, error;
    try { result = await inspectTrace(snapshot, trace, env); }
    catch (problem) { error = problem.status ? problem.message : '抽检服务暂时不可用。'; }
    return change(database, state => {
      const live = state.onlineJobs.find(item => item.traceId === job.traceId);
      if (!live || live.jobAttempts !== job.jobAttempts || live.status !== 'running') return null;
      const latest = state.traces.find(item => item.id === trace.id);
      if (!latest || latest.feedback.length) live.status = 'skipped';
      else if (error) {
        live.reason = error;
        live.status = live.jobAttempts < 3 ? 'queued' : 'error';
        live.dueAt = new Date(Date.now() + 30000 * live.jobAttempts).toISOString();
      } else {
        Object.assign(live, result, { status: result.failed ? 'failed' : 'passed' });
        if (result.failed) live.caseId = createCase(state, latest, result.reason, 'online').id;
      }
      live.finishedAt = now();
      return live;
    });
  });
}

async function refreshClusters(env, force) {
  const { state } = await load(env.DB);
  if (!force && state.cases.length - (state.clusterInfo?.knownCases || 0) < state.config.online.clusterEvery) return null;
  const result = await groupCases(state, env, causes);
  return change(env.DB, latest => {
    if ((latest.clusterInfo?.createdAt || '') > result.info.createdAt) return { clusters: latest.clusters, info: latest.clusterInfo };
    latest.clusters = result.clusters;
    latest.clusterInfo = result.info;
    return result;
  });
}

export async function backgroundWork(env) {
  await drainOnline(env);
  await refreshClusters(env, false);
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length'));
  if (length > 1250000) bad('请求体过大。', 413);
  const text = await request.text();
  if (text.length > 1250000) bad('请求体过大。', 413);
  let parsed;
  try { parsed = JSON.parse(text); } catch { bad('请求体需要使用 JSON。'); }
  if (!plain(parsed)) bad('请求体需要使用 JSON 对象。');
  return parsed;
}

function requireToken(request, env) {
  if (env.INGEST_TOKEN && request.headers.get('Authorization') !== 'Bearer ' + env.INGEST_TOKEN) bad('采集密钥无效。', 401);
}

async function api(request, env, context) {
  const { pathname, searchParams } = new URL(request.url);
  if (request.method === 'GET') {
    const { state } = await load(env.DB);
    if (pathname === '/api/state') return json(dashboardState(state, env));
    if (pathname === '/api/run') return json(find(state.runs, searchParams.get('id'), '评测'));
    if (pathname === '/api/golden') {
      const version = searchParams.get('version');
      return json(version ? datasetDetail(state, version).samples : exportRows(state, 'regression'));
    }
    if (pathname === '/api/dataset') return json(datasetDetail(state, searchParams.get('id')));
    if (pathname === '/api/session') return json(sessionData(state, searchParams.get('id')));
    if (pathname === '/api/route') return json(route(state, searchParams.get('userKey') || ''));
    if (pathname === '/api/export') {
      const target = searchParams.get('target');
      const rows = ['few-shot', 'sft', 'dpo'].includes(target)
        ? await change(env.DB, latest => exportRows(latest, target)) : exportRows(state, target);
      return new Response(rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), { headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + target + '.jsonl"', 'Cache-Control': 'no-store'
      } });
    }
    bad('接口不存在。', 404);
  }
  if (request.method !== 'POST') bad('请求方法无效。', 405);
  if (['/api/ingest', '/api/signal', '/api/online/tick'].includes(pathname)) requireToken(request, env);
  const body = await readBody(request);
  if (pathname === '/api/online/tick') {
    await backgroundWork(env);
    return json({ ok: true });
  }
  if (pathname === '/api/online/run') {
    if (body.traceId || body.sample === true) await change(env.DB, state => {
      const candidates = body.traceId ? [find(state.traces, body.traceId, '链路')] : state.traces.filter(trace => !trace.feedback.length);
      let queued = 0;
      for (const trace of candidates) if (queued < 5 && queueInspection(state, trace, true)) queued++;
      return queued;
    });
    return json(await drainOnline(env));
  }
  if (pathname === '/api/clusters') return json(await refreshClusters(env, true));
  if (pathname === '/api/variants') {
    const { state } = await load(env.DB);
    const item = find(state.cases, body.id, '案例');
    if (!item.corrected) bad('请先确认归因并填写修正答案。', 409);
    const trace = find(state.traces, item.traceId, '链路');
    assertEvalIsolation(state, { traceId: trace.id, familyId: trace.familyId || trace.id, input: trace.input });
    return json(await makeVariants(state, item, trace, env));
  }
  if (pathname === '/api/playground') {
    const { state } = await load(env.DB);
    const ids = [...new Set(list(body.ids, 10))];
    const version = find(state.versions, body.version, '版本');
    const mode = body.mode === 'rules' ? 'rules' : 'llm';
    const prompt = redact(str(body.prompt, 12000));
    const topK = number(body.topK, 0, 25);
    if (!ids.length || !prompt || !Number.isInteger(topK)) bad('选择案例、填写 Prompt 并提供有效 Top-K。');
    const profile = { prompt, topK, model: version.model, mode, version: version.id };
    return json({ profile, comparisons: await comparePlayground(state, ids, profile, env) });
  }
  if (pathname === '/api/regression') {
    const { state } = await load(env.DB);
    const validObservation = value => {
      const items = Array.isArray(value) ? value : [value];
      return items.length > 0 && items.length <= 10 && items.every(entry => typeof entry?.output === 'string');
    };
    if (body.observations != null && (!plain(body.observations) || state.golden.some(item =>
      !['baseline', 'candidate'].every(side => validObservation(body.observations[item.id]?.[side]))))) bad('外部回放需要提交全量样本的基线和候选输出。');
    for (const sample of state.golden) {
      assertEvalIsolation(state, sample);
      if (sample.kind !== 'agent' || !body.observations) continue;
      const attempts = [body.observations[sample.id].baseline, body.observations[sample.id].candidate].flat();
      if (attempts.some(attempt => attempt.toolIsolation != null && !externalToolIsolation.includes(attempt.toolIsolation))) {
        bad('Agent 回放的工具隔离方式必须是 mock、read-only 或 recorded。');
      }
    }
    const run = await regression(state, { candidate: body.candidate, baseline: body.baseline, judgeMode: body.judgeMode, observations: body.observations }, env);
    run.datasetRevision = state.datasetRevision;
    run.datasetVersion = datasetVersion(state.datasetRevision);
    run.gateConfig = gateSnapshot(state);
    await change(env.DB, latest => {
      if (latest.datasetRevision !== state.datasetRevision || latest.config.baseline !== state.config.baseline ||
          JSON.stringify(gateSnapshot(latest)) !== JSON.stringify(run.gateConfig) ||
          (run.judgeMode === 'llm' && (latest.config.activeJudge !== run.judgeVersion ||
            judgeProfile(latest, env).model !== run.judgeModel))) bad('评测期间基准集、基线、裁判或门槛已更新，请重试。', 409);
      latest.runs.unshift(run);
    });
    return json(run, 201);
  }
  const actions = {
    '/api/ingest': state => addTrace(state, body),
    '/api/demo-trace': state => addTrace(state, { ...body, id: undefined }, { demo: true, source: 'demo' }),
    '/api/feedback': state => addFeedback(state, find(state.traces, body.traceId, '链路'), body),
    '/api/signal': state => addFeedback(state, find(state.traces, body.traceId, '链路'), body),
    '/api/case': state => updateCase(state, body),
    '/api/case/create': state => {
      const trace = find(state.traces, body.traceId, '链路');
      return createCase(state, trace, '人工归档');
    },
    '/api/case/from-run': state => {
      const run = find(state.runs, body.runId, '评测');
      const row = find(run.rows, body.sampleId, '样本');
      const sample = find([...state.golden, ...state.sampleArchive], row.id, '样本');
      if (row.candidate.passed) bad('通过的样本无需归因。');
      const traceId = run.id + '-' + row.id;
      const trace = addTrace(state, { id: traceId, name: row.name, input: row.input, expected: row.reference, output: row.candidate.output,
        kind: row.kind, version: run.candidate, context: sample.context ? [{ title: sample.document || '基准上下文', text: sample.context }] : [],
        turns: sample.turns, tools: row.candidate.tools }, { demo: run.demo, source: 'evaluation' });
      trace.familyId = sample.familyId;
      return createCase(state, trace, '回归评测未通过', 'evaluation');
    },
    '/api/golden': state => {
      const prior = body.replaces ? find(state.golden, body.replaces, '样本') : null;
      const contextDocs = prior?.context === body.context ? prior?.contextDocs : body.contextDocs;
      return addGolden(state, { ...prior, ...body, contextDocs }, { prior });
    },
    '/api/golden/archive': state => {
      const sample = find(state.golden, body.id, '样本');
      state.golden = state.golden.filter(item => item.id !== sample.id);
      state.sampleArchive.unshift(sample);
      return recordDataset(state, '移出用例');
    },
    '/api/golden/restore': state => {
      const sample = find(state.sampleArchive, body.id, '样本');
      assertEvalIsolation(state, sample);
      if (state.golden.some(item => item.familyId === sample.familyId && item.input === sample.input)) bad('活动基准已存在同来源用例。', 409);
      state.sampleArchive = state.sampleArchive.filter(item => item.id !== sample.id);
      state.golden.unshift(sample);
      return recordDataset(state, '恢复用例');
    },
    '/api/golden/session': state => {
      const session = sessionData(state, body.sessionId);
      return addGolden(state, { ...body, traceId: session.last.id, input: session.last.input, kind: session.last.kind, observed: session.last.output,
        context: session.last.context.map(doc => doc.text).join('\n'), contextDocs: session.last.context, turns: session.turns });
    },
    '/api/variants/save': state => {
      const item = find(state.cases, body.id, '案例');
      if (!item.corrected) bad('请先确认归因与修正答案。', 409);
      const trace = find(state.traces, item.traceId, '链路');
      const variants = list(body.variants, 5).filter(variant => plain(variant) && str(variant.text, 800));
      if (variants.length < 3 || new Set(variants.map(variant => redact(str(variant.text, 800)))).size !== variants.length) bad('需要 3–5 条互不重复的变体。');
      const added = variants.map(variant => addGolden(state, {
        name: item.title + ' · ' + str(variant.type, 32), input: variant.text, reference: item.corrected,
        kind: trace.kind, traceId: trace.id, variant: variant.type, context: trace.context.map(doc => doc.text).join('\n'), contextDocs: trace.context,
        turns: (trace.turns || []).filter((turn, index, turns) => index !== turns.length - 1 || turn.role !== 'user'),
        group: '历史回归', critical: body.critical === true
      }, { snapshot: false }));
      return { added, dataset: recordDataset(state, '批量加入 Bad Case 变体') };
    },
    '/api/version': state => addVersion(state, body),
    '/api/review': state => newReview(state, body),
    '/api/review/vote': state => {
      const review = find(state.reviews, body.id, '盲评');
      if (review.human || !['A', 'B', 'tie'].includes(body.vote)) bad('投票无效或已提交。');
      review.human = body.vote;
      return review;
    },
    '/api/config': state => setConfig(state, body),
    '/api/judge': state => addJudge(state, body),
    '/api/judge/activate': state => {
      const judge = find(state.judges, body.id, '裁判版本');
      state.config.activeJudge = judge.id;
      return judge;
    },
    '/api/release': state => startRelease(state, body, env),
    '/api/release/update': state => updateRelease(state, body, env)
  };
  if (!Object.hasOwn(actions, pathname)) bad('接口不存在。', 404);
  const shouldMonitor = ['/api/ingest', '/api/feedback', '/api/signal'].includes(pathname);
  const result = await change(env.DB, state => {
    const value = actions[pathname](state);
    if (shouldMonitor) checkCanary(state);
    return value;
  });
  if (shouldMonitor && context?.waitUntil) context.waitUntil(backgroundWork(env).catch(error => console.error('后台评测执行失败', error.status || 'internal')));
  return json(result, 201);
}

export function createHandler(assets) {
  return async (request, env, context) => {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) return await api(request, env, context);
      if (path === '/health') return json({ ok: true });
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
      const routePath = path.replace(/\/$/, '');
      const assetPath = ['', '/en', '/workflow', '/en/workflow'].includes(routePath) ? '/index.en.html'
        : ['/zh', '/zh/workflow'].includes(routePath) ? '/index.html' : path;
      const asset = assets[assetPath];
      if (!asset) return new Response('Not Found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
        'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'
      } });
    } catch (error) {
      if (!error.status) console.error('处理请求时发生内部错误', error.name);
      return json({ error: error.status ? error.message : '服务处理失败，请检查运行配置或模型端点。' }, error.status || 500);
    }
  };
}
