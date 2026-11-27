import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/worker.js';
import { assets } from './assets.mjs';
import { sqlite } from './local-db.mjs';
import { createToolMock } from './replay-tools.mjs';

const handler = createHandler(await assets());

function fixture(t, env = {}) {
  const db = sqlite();
  t.after(() => db.close());
  return async (path, data, expected = 200, token = '') => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await handler(new Request('http://localhost' + path, {
      method: data === undefined ? 'GET' : 'POST', body: data === undefined ? undefined : JSON.stringify(data), headers
    }), { DB: db, INGEST_TOKEN: 'test-token', ...env });
    const content = await response.text();
    assert.equal(response.status, expected, content);
    return response.headers.get('content-type').includes('application/json') ? JSON.parse(content) : content;
  };
}

test('trace, signal, attribution, redaction and golden export', async t => {
  const call = fixture(t);
  const initial = await call('/api/state');
  assert.equal(initial.golden.length, 24);
  assert.match(await call('/'), /Flywheel/);
  await call('/api/ingest', { input: 'request', output: 'response' }, 401);
  const body = { id: 'request-001', input: '联系 test@example.com 或 13800000000', output: '错误', telemetry: { knowledgePresent: true } };
  await Promise.all([call('/api/ingest', body, 201, 'test-token'), call('/api/ingest', body, 201, 'test-token')]);
  const sign = { id: 'signal-001', traceId: body.id, type: 'dislike' };
  await Promise.all([call('/api/signal', sign, 201, 'test-token'), call('/api/signal', sign, 201, 'test-token')]);
  const updated = await call('/api/state');
  assert.equal(updated.traces.filter(trace => trace.id === body.id).length, 1);
  assert.equal(updated.traces[0].feedback.length, 1);
  const item = updated.cases.find(c => c.traceId === body.id);
  assert.equal(item.cause, '检索未召回');
  await call('/api/case', { id: item.id, cause: item.cause, target: 'regression', corrected: '答案 test@example.com', critical: true, curate: true }, 201);
  const exported = await call('/api/export?target=regression');
  assert.doesNotMatch(exported, /test@example\.com|13800000000/);
  assert.match(exported, /\[邮箱\].*\[手机号\]/);
  assert.equal((await call('/api/state')).golden.length, 25);
});

test('rules, run, blind review and gated canary routing', async t => {
  const call = fixture(t);
  const passing = await call('/api/regression', { candidate: 'v2.4.0' }, 201);
  assert.equal(passing.pass, 91.7);
  assert.equal(passing.passed, true);
  assert.equal(passing.rows.find(row => !row.candidate.passed).candidate.judge, null);
  const blind = await call('/api/review', { runId: passing.id }, 201);
  assert.equal('judge' in blind, false);
  assert.notEqual(blind.a, blind.b);
  const voted = await call('/api/review/vote', { id: blind.id, vote: 'A' }, 201);
  assert.ok(voted.judge);
  const failing = await call('/api/regression', { candidate: 'v2.2.0' }, 201);
  assert.equal(failing.passed, false);
  await call('/api/release', { runId: failing.id, percent: 20 }, 409);
  const release = await call('/api/release', { runId: passing.id, percent: 20 }, 201);
  const routes = await Promise.all(Array.from({ length: 60 }, (_, i) => call('/api/route?userKey=test-' + i)));
  assert.ok(routes.some(r => r.version === passing.candidate));
  assert.ok(routes.some(r => r.version === passing.baseline));
  assert.deepEqual(await call('/api/route?userKey=test-0'), routes[0]);
  await call('/api/release/update', { id: release.id, action: 'rollback' }, 201);
  assert.equal((await call('/api/route?userKey=test-0')).version, 'v2.3.1');
  await call('/api/config', { minPass: 99 }, 201);
  await call('/api/release', { runId: passing.id, percent: 20 }, 409);
});

test('full external replay overrides fixture output', async t => {
  const call = fixture(t);
  const golden = await call('/api/golden');
  await call('/api/regression', { candidate: 'v2.4.0', observations: {} }, 400);
  const observations = replays(golden, (attempt, _sample, side) =>
    side === 'baseline' ? { ...attempt, output: '', tools: [] } : attempt);
  const run = await call('/api/regression', { candidate: 'v2.4.0', observations }, 201);
  assert.equal(run.demo, false);
  assert.equal(run.pass, 100);
});

test('model judge scores rule-eligible samples and locks model and prompt version', async t => {
  const env = { LLM_BASE_URL: 'https://example.test/v1', LLM_API_KEY: 'test', JUDGE_MODEL: 'judge-test' };
  const call = fixture(t, env);
  const judge = t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://example.test/v1/chat/completions');
    assert.equal(JSON.parse(request.body).model, 'judge-test');
    return Response.json({ choices: [{ message: { content: '{"faithfulness":95,"relevance":90,"instruction":100,"reasoning":"证据支持"}' } }] });
  });
  const run = await call('/api/regression', { candidate: 'v2.4.0', judgeMode: 'llm' }, 201);
  assert.equal(run.judgeMode, 'llm');
  assert.equal(run.judgeVersion, 'judge-v1');
  assert.equal(run.judgeModel, 'judge-test');
  assert.equal(run.faith, 95);
  assert.equal(judge.mock.callCount(), 52);
  assert.ok((await call('/api/state')).eligibleRuns.includes(run.id));
  const review = await call('/api/review', { runId: run.id }, 201);
  assert.equal(review.judgeModel, 'judge-test');
  await call('/api/review/vote', { id: review.id, vote: 'A' }, 201);
  env.JUDGE_MODEL = 'judge-changed';
  const state = await call('/api/state');
  assert.ok(!state.eligibleRuns.includes(run.id));
  assert.equal(state.judgeAgreement.find(group => group.model === 'judge-test').n, 1);
  assert.equal(state.judgeAgreement.find(group => group.active).n, 0);
  assert.equal((await call('/api/run?id=' + run.id)).judgeModel, 'judge-test');
  await call('/api/release', { runId: run.id, percent: 10 }, 409);
});

const telemetry = { latencyMs: 700, ttftMs: 140, inputTokens: 300, outputTokens: 74 };
function replays(samples, edit = value => value) {
  return Object.fromEntries(samples.map(sample => [sample.id, Object.fromEntries(['baseline', 'candidate'].map(side => [side,
    Array.from({ length: sample.critical ? 3 : 1 }, (_, index) => edit({
      output: sample.reference, tools: sample.tool ? [sample.tool] : [], metrics: telemetry
    }, sample, side, index))
  ]))]));
}

test('separates incomplete external replays from passes and failures', async t => {
  const call = fixture(t);
  const golden = await call('/api/golden');
  const key = golden.find(sample => sample.critical).id;
  const observations = replays(golden);
  observations[key].candidate = observations[key].candidate[0];
  const run = await call('/api/regression', { candidate: 'v2.4.0', observations }, 201);
  const sample = run.rows.find(row => row.id === key);
  assert.equal(sample.candidate.passed, false);
  assert.equal(sample.candidate.stability.complete, false);
  assert.equal(sample.candidate.stability.count, 1);
  assert.equal(sample.candidate.stability.required, 3);
  assert.equal(sample.candidate.stability.allPassed, null);
  assert.equal(run.pass, 95.8);
  assert.equal(run.baselinePass, 100);
  assert.equal(run.failures, 0);
  assert.deepEqual(run.incomplete, { baseline: 0, candidate: 1 });
  assert.equal(run.passed, false);
  await call('/api/case/from-run', { runId: run.id, sampleId: key }, 409);
  await call('/api/release', { runId: run.id, percent: 10 }, 409);
  assert.deepEqual((await call('/api/state')).runs[0].incomplete, run.incomplete);

  const partialBaseline = replays(golden);
  partialBaseline[key].baseline = partialBaseline[key].baseline[0];
  const other = await call('/api/regression', { candidate: 'v2.4.0', observations: partialBaseline }, 201);
  assert.equal(other.pass, 100);
  assert.equal(other.baselinePass, 95.8);
  assert.equal(other.criticalRate, null);
  assert.equal(other.failures, 0);
  assert.deepEqual(other.incomplete, { baseline: 1, candidate: 0 });
  assert.equal(other.passed, false);
});

test('upgrades saved runs that previously counted partial replays as passes', async t => {
  const db = sqlite();
  t.after(() => db.close());
  const call = fixture(t, { DB: db });
  const golden = await call('/api/golden');
  const key = golden.find(sample => sample.critical).id;
  const observations = replays(golden);
  observations[key].candidate = observations[key].candidate[0];
  const original = await call('/api/regression', { candidate: 'v2.4.0', observations }, 201);

  const record = await db.prepare('SELECT body FROM flywheel_state WHERE id = 1').first();
  const legacy = JSON.parse(record.body);
  legacy.schemaVersion = 2;
  for (const run of legacy.runs) delete run.incomplete;
  const oldRun = legacy.runs.find(run => run.id === original.id);
  oldRun.pass = 100;
  oldRun.rows.find(row => row.id === key).candidate.passed = true;
  await db.prepare('UPDATE flywheel_state SET body = ? WHERE id = 1').bind(JSON.stringify(legacy)).run();

  const migrated = await call('/api/state');
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.runs[0].pass, 95.8);
  assert.deepEqual(migrated.runs[0].incomplete, { baseline: 0, candidate: 1 });
  const saved = await call('/api/run?id=' + original.id);
  assert.equal(saved.rows.find(row => row.id === key).candidate.passed, false);
  const persisted = JSON.parse((await db.prepare('SELECT body FROM flywheel_state WHERE id = 1').first()).body);
  assert.equal(persisted.schemaVersion, 3);
  assert.equal(persisted.runs[0].pass, 95.8);
});

test('masks PII at ingestion and replays ordered conversation history', async t => {
  const call = fixture(t);
  const pii = /张三|13812345678|buyer@example\.com|X789456123/g;
  await call('/api/ingest', { id: 'thread-first', sessionId: 'chat-demo', turnIndex: 1,
    input: '我叫张三，订单号 X789456123', output: '邮箱 buyer@example.com，请提供手机号13812345678',
    context: [{ title: '客户姓名：张三', text: '订单编号：X789456123' }],
    tools: [{ name: 'lookup', args: { recipient: '张三', orderId: 'X789456123', phone: 13812345678 } }]
  }, 201, 'test-token');
  await call('/api/ingest', { id: 'thread-last', sessionId: 'chat-demo', turnIndex: 2,
    input: '那如何申请退款？', output: '去订单详情办理。'
  }, 201, 'test-token');
  const state = await call('/api/state');
  assert.doesNotMatch(JSON.stringify(state.traces), pii);
  assert.match(JSON.stringify(state.traces), /\[姓名\]/);
  const session = await call('/api/session?id=chat-demo');
  assert.deepEqual(session.traces.map(row => row.turnIndex), [1, 2]);
  assert.deepEqual(session.turns.map(turn => turn.role), ['user', 'assistant', 'user']);
  const example = await call('/api/golden/session', { sessionId: session.id, reference: '订单详情中申请退款。' }, 201);
  assert.equal(example.turns.length, 3);
  assert.equal(example.traceId, 'thread-last');
});

test('samples unreviewed traces asynchronously and groups silent cases', async t => {
  const call = fixture(t);
  await call('/api/config', { online: { sampleRate: 100, settleMinutes: 0, judgeMode: 'rules', clusterEvery: 100 } }, 201);
  for (const [index, input] of ['购买后多久可以申请退款？', '你好，想确认一下：购买后多久可以申请退款？'].entries()) {
    const trace = await call('/api/ingest', { id: 'online-' + index, input, output: '请联系人工客服确认。', version: 'v2.3.1',
      telemetry: { knowledgePresent: true }, sessionId: 'same-session'
    }, 201, 'test-token');
    assert.equal(trace.feedback.length, 0);
  }
  await call('/api/ingest', { id: 'online-reviewed', input: '另一个测试问题', output: '暂缺资料' }, 201, 'test-token');
  await call('/api/signal', { traceId: 'online-reviewed', type: 'like' }, 201, 'test-token');
  assert.equal((await call('/api/state')).onlineJobs.filter(job => job.status === 'queued').length, 3);
  await call('/api/online/tick', {}, 200, 'test-token');
  const state = await call('/api/state');
  assert.equal(state.onlineJobs.filter(job => job.status === 'failed').length, 2);
  assert.equal(state.onlineJobs.find(job => job.traceId === 'online-reviewed').status, 'skipped');
  assert.equal(state.cases.filter(item => item.source === 'online').length, 2);
  const clustered = await call('/api/clusters', {});
  assert.equal(clustered.info.method, 'local');
  const grouped = clustered.clusters.find(cluster => state.cases.filter(item => item.source === 'online').every(item => cluster.ids.includes(item.id)));
  assert.ok(grouped);
  assert.equal(grouped.cause, '检索未召回');
  assert.ok(grouped.affected < grouped.count);
});

test('requires independent attempts, performance metrics and healthy tool trajectories', async t => {
  const call = fixture(t);
  const a = await call('/api/golden', { name: '健康的 Agent 流程', input: '为我查资料并建立工单', reference: '工单已提交', kind: 'agent',
    critical: true, agent: { steps: ['lookup', 'ticket'], noLoop: true, maxRetries: 0 }
  }, 201);
  const samples = await call('/api/golden');
  const observations = replays(samples, (attempt, sample, side, index) => {
    if (sample.id === a.id) {
      attempt.tools = [{ name: 'lookup' }, { name: 'ticket' }];
      attempt.toolIsolation = 'mock';
    }
    if (sample.id === a.id && side === 'candidate' && index === 2) {
      attempt.tools = [{ name: 'lookup' }, { name: 'lookup' }, { name: 'lookup' }, { name: 'ticket' }];
      attempt.metrics = { ...telemetry, ttftMs: 2000 };
    }
    if (side === 'candidate') attempt.metrics = { ...attempt.metrics, outputTokens: 500 };
    return attempt;
  });
  const run = await call('/api/regression', { candidate: 'v2.4.0', observations }, 201);
  const result = run.rows.find(item => item.id === a.id).candidate;
  assert.equal(result.stability.successes, 2);
  assert.equal(result.stability.passAtK, 100);
  assert.equal(result.stability.passRate, 66.7);
  assert.equal(result.stability.allPassed, false);
  assert.equal(result.attempts[0].toolIsolation, 'mock');
  assert.equal(result.attempts[2].agent.loop, true);
  assert.equal(result.attempts[2].agent.retries, 2);
  assert.equal(result.attempts[2].agent.accuracy, 50);
  assert.equal(run.passed, false);
  assert.equal(run.gates.find(gate => gate.name.includes('成本增幅')).passed, false);
  const single = Object.fromEntries(Object.entries(observations).map(([key, value]) => [key, { baseline: value.baseline[0], candidate: value.candidate[0] }]));
  const incomplete = await call('/api/regression', { candidate: 'v2.4.0', observations: single }, 201);
  assert.equal(incomplete.gates.find(gate => gate.name.includes('次独立回放')).passed, false);
  assert.equal(incomplete.datasetVersion, 'DS-0002');
  assert.equal(incomplete.rows.find(item => item.id === a.id).candidate.stability.allPassed, null);
  single[a.id].candidate.toolIsolation = 'live';
  await call('/api/regression', { candidate: 'v2.4.0', observations: single }, 400);
  const config = await call('/api/config', { criticalRepeats: 2 }, 201);
  assert.equal(config.criticalRepeats, 2);
  assert.equal(config.passAtK, 2);
  const slow = replays(samples, (attempt, sample, side) => ({
    ...attempt, tools: sample.id === a.id ? [{ name: 'lookup' }, { name: 'ticket' }] : attempt.tools,
    metrics: side === 'candidate' ? { latencyMs: 3000, ttftMs: 1500, costUsd: 0.0003 } : telemetry
  }));
  const slowRun = await call('/api/regression', { candidate: 'v2.4.0', observations: slow }, 201);
  assert.equal(slowRun.performance.candidate.latencyP95, 3000);
  assert.equal(slowRun.gates.find(gate => gate.name.startsWith('首字延迟')).passed, false);
});

test('keeps dataset snapshots and blocks training leakage in both directions', async t => {
  const call = fixture(t);
  const original = await call('/api/golden', { name: '训练隔离测试', input: '独有测试：如何补写附注？', reference: '提交附注。' }, 201);
  const latest = await call('/api/golden', { replaces: original.id, reference: '在工单提交附注。' }, 201);
  assert.notEqual(latest.id, original.id);
  const previous = await call('/api/dataset?id=DS-0002');
  assert.equal(previous.samples.find(row => row.id === original.id).reference, '提交附注。');
  const trace = await call('/api/ingest', { id: 'isolation-trace', input: original.input, output: '错误', feedback: [{ type: 'dislike' }] }, 201, 'test-token');
  const item = (await call('/api/state')).cases.find(row => row.traceId === trace.id);
  await call('/api/case', { id: item.id, cause: 'Prompt 歧义', corrected: '在工单提交附注。', target: 'dpo', curate: true }, 201);
  await call('/api/export?target=dpo', undefined, 409);
  await call('/api/golden/archive', { id: latest.id }, 201);
  assert.match(await call('/api/export?target=dpo'), /"chosen":"在工单提交附注。"/);
  await call('/api/golden/restore', { id: latest.id }, 409);
  await call('/api/golden', { input: trace.input, reference: '附注' }, 409);
  await call('/api/variants', { id: item.id }, 409);
  assert.equal((await call('/api/dataset?id=DS-0003')).samples.find(row => row.id === latest.id).trainingExposed, true);
});

test('validates generated variants and registers the playground settings', async t => {
  const call = fixture(t);
  const initial = await call('/api/state');
  const item = initial.cases.find(row => row.traceId === 'TR-8418');
  await call('/api/case', { id: item.id, cause: item.cause, corrected: '赔付需按商品与物流凭证审核，无法提前承诺具体金额。' }, 201);
  const draft = await call('/api/variants', { id: item.id });
  assert.equal(draft.variants.length, 4);
  const added = await call('/api/variants/save', { id: item.id, variants: draft.variants }, 201);
  assert.equal(added.added.length, 4);
  assert.ok(added.added.every(sample => sample.familyId === item.traceId));
  assert.equal(added.dataset.id, 'DS-0002');
  const compare = { ids: [item.id], version: 'v2.3.1', mode: 'rules', prompt: '仅根据证据回答。' };
  const withContext = await call('/api/playground', { ...compare, topK: 1 });
  const withoutContext = await call('/api/playground', { ...compare, topK: 0 });
  assert.notEqual(withContext.comparisons[0].after, withoutContext.comparisons[0].after);
  assert.equal(withContext.comparisons[0].documents.length, 1);
  const version = await call('/api/version', { id: 'v2.5.0', name: '调试配置', ...withContext.profile }, 201);
  assert.equal(version.topK, 1);
});

test('rolls back live canaries for error rates and dislike spikes', async t => {
  const call = fixture(t);
  await call('/api/config', { fuse: { enabled: true, minCalls: 2, minDislikes: 2, dislikeLift: 50, maxErrorRate: 10, windowMinutes: 60 } }, 201);
  const samples = await call('/api/golden');
  const run = await call('/api/regression', { candidate: 'v2.4.0', observations: replays(samples) }, 201);
  assert.equal(run.passed, true);
  assert.equal(run.demo, false);
  const release = await call('/api/release', { runId: run.id, percent: 30 }, 201);
  const routes = await Promise.all(Array.from({ length: 30 }, (_, index) => call('/api/route?userKey=smoke-' + index)));
  const candidateKey = 'smoke-' + routes.findIndex(route => route.version === run.candidate);
  const event = (key, release, version, fields = {}) => call('/api/ingest', {
    id: key, input: '灰度业务测试', output: '业务回答', releaseId: release.id, version, ...fields
  }, 201, 'test-token');
  await event('canary-error-1', release, run.candidate, { statusCode: 503 });
  assert.equal((await call('/api/route?userKey=' + candidateKey)).version, run.candidate);
  await event('canary-error-2', release, run.candidate);
  assert.equal((await call('/api/route?userKey=' + candidateKey)).version, run.baseline);
  assert.match((await call('/api/state')).alerts[0].reason, /报错率/);
  const second = await call('/api/release', { runId: run.id, percent: 30 }, 201);
  for (let index = 0; index < 2; index++) {
    await event('canary-base-' + index, second, run.baseline);
    await event('canary-dislike-' + index, second, run.candidate, { feedback: [{ type: 'dislike' }] });
  }
  const state = await call('/api/state');
  assert.equal(state.releases[0].status, 'rolledback');
  assert.match(state.alerts[0].reason, /点踩率/);
  assert.equal((await call('/api/route?userKey=' + candidateKey)).version, run.baseline);
});

test('English is the default with separate English and Chinese workflow URLs', async t => {
  const call = fixture(t);
  const zh = await call('/zh/');
  const en = await call('/');
  assert.match(zh, /<html lang="zh-CN">/);
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Loading the Flywheel workspace/);
  assert.match(zh, /src="\/app.js"/);
  assert.match(en, /src="\/app.js"/);
  assert.equal(await call('/en'), en);
  assert.equal(await call('/workflow/'), en);
  assert.equal(await call('/zh/workflow/'), zh);
  assert.match(await call('/workflow.en.js'), /Generate and review variants from corrected cases/);
  assert.match(await call('/workflow.zh.js'), /基于修正案例生成并审核变体/);
  assert.match(await call('/i18n.js'), /Online Evaluation/);
});

test('tool mock returns fixtures and never dispatches an unexpected call', async () => {
  const fixtures = [{ name: 'lookup_policy', args: { region: 'CN', topic: 'refund' }, result: { windowDays: 7 } }];
  for (let index = 0; index < 3; index++) {
    const tools = createToolMock(fixtures);
    const args = { topic: 'refund', region: 'CN' };
    const output = await tools.call('lookup_policy', args);
    assert.equal(output.windowDays, 7);
    output.windowDays = 0;
    assert.equal(tools.calls[0].result.windowDays, 7);
    await assert.rejects(tools.call('unexpected_business_action', {}), /No matching mock fixture/);
    assert.equal(tools.calls[1].result.error, 'No matching mock fixture');
  }
});
