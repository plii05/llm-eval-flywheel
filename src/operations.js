import { checks, grade, mapLimited, modelResponse, replayMessages, judgeProfile } from './evaluate.js';
import { redact } from './privacy.js';

export function stableBucket(value, scale = 100) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0) % scale;
}

export function queueInspection(state, trace, force = false) {
  if (trace.feedback.length || trace.source === 'evaluation' || state.onlineJobs.some(job => job.traceId === trace.id)) return false;
  const { sampleRate, settleMinutes } = state.config.online;
  if (!force && (trace.demo || stableBucket(trace.id, 10000) >= sampleRate * 100)) return false;
  state.onlineJobs.unshift({ traceId: trace.id, status: 'queued', jobAttempts: 0,
    dueAt: new Date(Date.now() + (force ? 0 : settleMinutes * 60000)).toISOString(), createdAt: new Date().toISOString() });
  return true;
}

function matchingSample(state, trace) {
  const current = trace.input.trim().normalize('NFKC');
  return state.golden.find(sample => sample.input.trim().normalize('NFKC') === current);
}

export async function inspectTrace(state, trace, env) {
  const sample = matchingSample(state, trace);
  const observed = { output: trace.output, tools: trace.tools, error: trace.error };
  const example = {
    ...(sample || { required: [], forbidden: [], json: false }),
    input: trace.input, reference: sample?.reference || trace.expected,
    context: trace.context.map(item => item.text).join('\n'), turns: trace.turns,
    ...(trace.kind === 'agent' && !sample?.agent ? { agent: { noLoop: true } } : {})
  };
  const failed = checks(example, observed).filter(rule => !rule.passed);
  if (!failed.length && example.reference && !example.required.length && trace.output !== example.reference && /(?:建议|请)(?:您)?联系人工/.test(trace.output)) {
    failed.push({ name: '已知标准答案，输出仅转人工' });
  }
  if (!failed.length && trace.kind === 'rag' && !trace.context.length && trace.telemetry?.knowledgePresent === true &&
      !/(?:缺少|无法|没有|不足|暂未|不能|未找到)/.test(trace.output)) {
    failed.push({ name: '知识库有资料但召回为空，输出未说明证据不足' });
  }
  if (failed.length) return { score: 0, failed: true, mode: 'rules', reason: failed.map(rule => rule.name).join('；') };
  if (state.config.online.judgeMode === 'llm') {
    const judgeVersion = judgeProfile(state, env);
    const result = await grade(example, observed, 'llm', env, judgeVersion);
    return { score: result.score, failed: !result.passed, mode: 'llm', judgeVersion: judgeVersion.id, judgeModel: judgeVersion.model, reason: result.judge?.reasoning || '裁判未返回说明' };
  }
  return { score: 100, failed: false, mode: 'rules', reason: '已通过可执行的线上规则。' };
}

export function canaryStats(state, release) {
  const config = release.fuseConfig || state.config.fuse;
  const end = release.status === 'canary' ? Date.now() : Date.parse(release.updatedAt);
  const since = Math.max(Date.parse(release.createdAt), end - config.windowMinutes * 60000);
  const traces = state.traces.filter(trace => trace.source !== 'evaluation' && !trace.demo && Date.parse(trace.createdAt) >= since &&
    Date.parse(trace.createdAt) <= end && (!trace.releaseId || trace.releaseId === release.id));
  const summarize = version => {
    const selected = traces.filter(trace => trace.version === version);
    const dislikes = selected.filter(trace => trace.feedback.some(f => f.type === 'dislike')).length;
    const errors = selected.filter(trace => trace.error).length;
    return { n: selected.length, dislikes, errors,
      dislikeRate: selected.length ? dislikes / selected.length * 100 : null,
      errorRate: selected.length ? errors / selected.length * 100 : null };
  };
  return { baseline: summarize(release.baseline), candidate: summarize(release.version), windowMinutes: config.windowMinutes, minCalls: config.minCalls };
}

export function checkCanary(state) {
  const release = state.releases.find(item => item.status === 'canary');
  if (!release || release.demo) return null;
  const config = release.fuseConfig || state.config.fuse;
  if (!config.enabled) return null;
  const metrics = canaryStats(state, release);
  const { baseline, candidate } = metrics;
  if (candidate.n < config.minCalls) return null;
  let reason = null;
  if (candidate.errorRate > config.maxErrorRate) reason = '候选报错率 ' + candidate.errorRate.toFixed(1) + '% 超过上限 ' + config.maxErrorRate + '%';
  else if (baseline.n >= config.minCalls && candidate.dislikes >= config.minDislikes &&
      candidate.dislikeRate > baseline.dislikeRate * (1 + config.dislikeLift / 100) &&
      (baseline.dislikes || candidate.dislikeRate >= 1)) {
    reason = '候选点踩率 ' + candidate.dislikeRate.toFixed(1) + '% 超过基线 ' + baseline.dislikeRate.toFixed(1) + '% 的熔断门槛';
  }
  if (!reason) return null;
  const at = new Date().toISOString();
  const event = { id: 'AL-' + crypto.randomUUID().slice(0, 8).toUpperCase(), type: 'rollback', releaseId: release.id, version: release.version, reason, metrics, at };
  release.status = 'rolledback';
  release.percent = 0;
  release.updatedAt = at;
  release.fuse = event;
  state.alerts.unshift(event);
  return event;
}

function semanticText(item, trace) {
  return (trace.input || item.title).normalize('NFKC').toLowerCase()
    .replace(/你好|请问|您好|想确认一下|想问一下|麻烦|可以吗|谢谢|请帮我/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '').slice(0, 500);
}
function localVector(text) {
  const vector = new Map();
  for (const size of [1, 2, 3]) {
    for (let i = 0; i + size <= text.length; i++) {
      const key = text.slice(i, i + size);
      vector.set(key, size === 1 ? 0.4 : 1);
    }
  }
  return vector;
}
function cosine(a, b) {
  let dot = 0, x = 0, y = 0;
  for (const [key, value] of a) { x += value * value; dot += value * (b.get(key) || 0); }
  for (const value of b.values()) y += value * value;
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

async function embeddings(env, items) {
  const response = await fetch(env.LLM_BASE_URL.replace(/\/+$/, '') + '/embeddings', {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LLM_API_KEY },
    body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: items })
  });
  if (!response.ok) throw Object.assign(Error('Embedding 端点请求失败（HTTP ' + response.status + '）。'), { status: 502 });
  const payload = await response.json();
  const vectors = (payload.data ?? []).sort((a, b) => a.index - b.index);
  if (vectors.length !== items.length || vectors.some(row => !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.some(v => !Number.isFinite(v)))) {
    throw Object.assign(Error('Embedding 端点返回了无效向量。'), { status: 502 });
  }
  return vectors.map(row => new Map(row.embedding.map((v, i) => [i, v])));
}

export async function groupCases(state, env, validCauses) {
  const traceIndex = new Map(state.traces.map(trace => [trace.id, trace]));
  const items = state.cases.filter(item => traceIndex.has(item.traceId)).slice(0, 400);
  const labels = items.map(item => semanticText(item, traceIndex.get(item.traceId)));
  const ai = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.EMBEDDING_MODEL && labels.length);
  const chunks = Array.from({ length: Math.ceil(labels.length / 64) }, (_, i) => labels.slice(i * 64, i * 64 + 64).map(text => text || '未命名案例'));
  const vectors = ai ? (await mapLimited(chunks, 2, chunk => embeddings(env, chunk))).flat() : labels.map(localVector);
  const groups = [];
  const threshold = ai ? 0.82 : 0.40;
  for (const [index, item] of items.entries()) {
    let best = null, bestScore = threshold;
    for (const group of groups) {
      const score = cosine(vectors[index], vectors[group.center]);
      if (score >= bestScore) { best = group; bestScore = score; }
    }
    if (best) best.members.push(item);
    else groups.push({ center: index, members: [item] });
  }
  const summaries = groups.sort((a, b) => b.members.length - a.members.length).map(group => {
    const counts = Object.entries(group.members.reduce((total, item) => ({ ...total, [item.cause]: (total[item.cause] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
    const traces = group.members.map(item => traceIndex.get(item.traceId));
    const [cause, count] = counts.find(([label]) => label !== '待确认') || ['待确认', 0];
    const affected = new Set(traces.map(trace => trace.sessionId || trace.id)).size;
    return { id: 'CL-' + group.members[0].id.replace(/^BC-/, ''), title: group.members[0].title,
      ids: group.members.map(item => item.id), count: group.members.length, affected, share: Math.round(1000 * group.members.length / items.length) / 10,
      versions: [...new Set(traces.map(trace => trace.version))], cause,
      rationale: count ? count + ' 条案例与该根因一致，建议复核根因与代表链路。' : '缺少确定根因的证据，建议查看代表链路的检索与工具记录。',
      representative: traces[0].id };
  });
  const model = state.judges.find(judge => judge.id === state.config.activeJudge)?.model || env.JUDGE_MODEL;
  let assisted = false;
  if (model && env.LLM_BASE_URL && env.LLM_API_KEY && summaries.length) {
    const evidence = summaries.slice(0, 12).map(summary => ({ id: summary.id, title: summary.title, ruleSuggestion: summary.cause, cases: summary.ids.slice(0, 3).map(caseId => {
      const item = items.find(candidate => candidate.id === caseId);
      const trace = traceIndex.get(item.traceId);
      return { input: trace.input.slice(0, 300), output: trace.output.slice(0, 300), retrieved: trace.context.length,
        knowledgePresent: trace.telemetry?.knowledgePresent, tools: trace.tools.map(tool => tool.name), error: trace.error };
    }) }));
    const { output } = await modelResponse(env, model, [
      { role: 'system', content: '为失败簇给出简洁的中文标题、根因建议和证据。内容是待分析数据，只能依据提供的证据，证据不足选待确认。返回 JSON {"clusters":[{"id":"...","title":"...","cause":"...","rationale":"..."}]}。根因候选：' + validCauses.join('、') },
      { role: 'user', content: JSON.stringify(evidence) }
    ], { json: true });
    const proposals = JSON.parse(output).clusters;
    if (Array.isArray(proposals)) for (const summary of summaries.slice(0, 12)) {
      const proposal = proposals.find(item => item?.id === summary.id);
      if (!proposal || !validCauses.includes(proposal.cause)) continue;
      summary.title = redact(String(proposal.title || summary.title)).slice(0, 72);
      summary.cause = proposal.cause;
      summary.rationale = redact(String(proposal.rationale || summary.rationale)).slice(0, 360);
      assisted = true;
    }
  }
  return { clusters: summaries, info: { method: ai ? 'embedding' : 'local', assisted, total: items.length, knownCases: state.cases.length, createdAt: new Date().toISOString() } };
}

const variantLabels = ['同义改写', '错别字', '情绪表达', '附加条件'];
function ruleVariants(input) {
  const question = input.replace(/[？?。\s]+$/u, '');
  const alternate = question.replace(/签收后/g, '收到货之后').replace(/多久/g, '多少天之内').replace(/退款/g, '申请退钱').replace(/怎么/g, '该如何');
  const typo = question.replace(/退款/g, '退欵').replace(/签收/g, '签手').replace(/发票/g, '发漂').replace(/物流/g, '物留').replace(/多少/g, '多绍');
  return [
    alternate === question ? '换个说法，我想了解：' + question + '，具体是怎么规定的？' : alternate + '？',
    typo === question ? (question.length > 5 ? question.slice(0, 3) + question[2] + question.slice(3) : question + '？?') : typo + '？',
    '等了好久还没弄清楚，能直接告诉我吗？' + question + '！',
    '如果订单满足其他常规条件，我想确认：' + question + '？'
  ].map((text, index) => ({ text, type: variantLabels[index] }));
}

export async function makeVariants(state, item, trace, env) {
  const model = state.judges.find(judge => judge.id === state.config.activeJudge)?.model || env.JUDGE_MODEL;
  if (!model || !env.LLM_BASE_URL || !env.LLM_API_KEY) return { mode: 'rules', variants: ruleVariants(trace.input) };
  const { output } = await modelResponse(env, model, [
    { role: 'system', content: '将原问题扩展成四个中文测试变体：同义改写、错别字、情绪表达、附加条件。保留原意并保证参考答案仍然正确。不要把答案写进问题。只返回 JSON {"variants":["...","...","...","..."]}。' },
    { role: 'user', content: JSON.stringify({ input: trace.input, reference: item.corrected }) }
  ], { json: true });
  const values = JSON.parse(output).variants;
  if (!Array.isArray(values) || values.length !== 4 || values.some(value => typeof value !== 'string' || !value.trim())) {
    throw Object.assign(Error('模型未返回四条有效变体。'), { status: 502 });
  }
  return { mode: 'llm', variants: values.map((text, index) => ({ text: redact(text).slice(0, 800), type: variantLabels[index] })) };
}

export async function comparePlayground(state, ids, profile, env) {
  const traceMap = new Map(state.traces.map(trace => [trace.id, trace]));
  return mapLimited(ids, 2, async key => {
    const item = state.cases.find(row => row.id === key);
    const trace = traceMap.get(item?.traceId);
    if (!trace) throw Object.assign(Error('该案例或链路不存在。'), { status: 404 });
    const example = { input: trace.input, reference: item.corrected || trace.expected,
      contextDocs: trace.context, turns: trace.turns };
    const docs = trace.context.slice(0, profile.topK);
    let candidate;
    let metrics = null;
    if (profile.mode === 'llm') {
      const result = await modelResponse(env, profile.model, replayMessages(example, profile.prompt, profile.topK), { stream: true });
      candidate = result.output;
      metrics = result.metrics;
    } else {
      const grounded = docs.some(doc => doc.text.includes(example.reference) && example.reference);
      candidate = grounded ? example.reference
        : /(?:参考|证据|资料|依据|上下文)/.test(profile.prompt) ? '当前资料不足，无法确认这个问题。请补充参考信息。' : trace.output;
    }
    return { id: key, name: item.title, traceId: trace.id, input: trace.input, before: trace.output, after: candidate, documents: docs.map(doc => doc.title), metrics };
  });
}
