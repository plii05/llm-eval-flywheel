import { serviceText, t } from './i18n.js';
import {
  I, esc, pct, fmt, time, show, btn, badge, table, row, mono, gateBadge, tagKind, feedbackLabels, caseLabels,
  releaseLabels, targets, roots, box, pre, alert, field, input, textarea, select, check, form, optionMap
} from './ui.js';
import { batchPerformance, releaseSignals, repeatDetail } from './enhancements.js';
export { show } from './ui.js';

const typeOptions = { rag: 'RAG', prompt: 'Prompt', agent: 'Agent' };
const versionOptions = state => Object.fromEntries(state.versions.map(v => [v.id, v.id + ' · ' + t(v.name)]));
const code = value => '<div class="code">' + pre(value) + '</div>';
const jsonText = value => JSON.stringify(value, null, 2);
const numeric = (name, value, min, max, step = 1) => input(name, value, 'type="number" min="' + min + '" max="' + max + '" step="' + step + '" required');

export function guide() {
  const snippet = `curl -X POST "$FLYWHEEL_URL/api/ingest" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $INGEST_TOKEN" \\
  -d '{"id":"request-001","input":"退款期限是多久？","output":"签收后 7 天内。","version":"v2.3.1","model":"support-assistant","kind":"rag","prompt":"依据参考内容回答","context":[{"title":"退款政策","text":"签收后 7 天内。"}],"tools":[],"latencyMs":640,"inputTokens":272,"outputTokens":31}'`;
  show(t('接入采集'), '<div class="stack">' + alert(t('示例数据可直接操作。接入真实流量时，在受控部署中配置 INGEST_TOKEN 并由应用后端提交记录。')) +
    box(t('1. 提交一次交互 · POST /api/ingest'), code(snippet) + '<div class="actions" style="margin-top:8px">' + btn(t('复制代码'), 'bracket', 'copy-code') + '</div>') +
    box(t('2. 提交反馈 · POST /api/signal'), code('{"traceId":"request-001","id":"feedback-001","type":"adopt","note":""}')) +
    box(t('3. 获取灰度版本 · GET /api/route'), code('?userKey=stable-user-id') + ('<p class="quiet" style="margin-top:6px;font-size:12px">' + t('将返回的 version 用于请求处理并写回链路。') + '</p>')) +
    box(t('Agent 回放隔离'), '<p class="quiet">' + esc(t('内置回放只请求模型，评测导入轨迹时不调用业务工具。外部执行器使用工具 Mock 或只读沙箱，并通过 toolIsolation 声明隔离方式。')) + '</p>') +
    '</div>', t('HTTP 接入 · 入库前脱敏 · 支持 Session、TTFT 和候选版本标记'));
}

export function traceDetail(state, trace) {
  const records = trace.feedback.map(f => '<div class="signal">' + badge(feedbackLabels[f.type], '', false) + '<span>' + esc(f.note || '—') + '</span><span class="quiet">' + time(f.at) + '</span></div>').join('');
  const item = state.cases.find(c => c.traceId === trace.id);
  show(trace.name, '<div class="stack"><div class="actions">' + tagKind(trace.kind) + mono(trace.version) + badge(trace.model, '', false) +
    badge(fmt(trace.latencyMs) + ' ms', '', false) + (trace.ttftMs != null ? badge((t('首字') + ' ') + fmt(trace.ttftMs) + ' ms', '', false) : '') + badge(fmt(trace.inputTokens) + (' ' + t('输入 /') + ' ') + fmt(trace.outputTokens) + (' ' + t('输出 Token')), '', false) + '</div>' +
    '<div class="inline-grid">' + box(t('用户输入'), pre(trace.input)) + box(t('最终输出'), pre(trace.output)) + '</div>' +
    box(t('系统 Prompt'), pre(trace.prompt)) +
    box(t('RAG 召回片段 (') + trace.context.length + ')', trace.context.length ? trace.context.map(doc =>
      '<div class="inner"><h3>' + esc(doc.title || doc.id || t('检索片段')) + (doc.score == null ? '' : ' · ' + Number(doc.score).toFixed(2)) + '</h3>' + pre(doc.text) + '</div>').join('') : pre(t('未记录召回片段'))) +
    box(t('Agent 工具调用 (') + trace.tools.length + ')', (trace.agentStats ? alert((t('重复调用') + ' ') + trace.agentStats.retries + (' ' + t('次 ·') + ' ') + (trace.agentStats.loop ? t('检测到调用循环') : t('未发现重复调用循环')), trace.agentStats.loop ? 'fail' : '') : '') +
      (trace.tools.length ? pre(jsonText(trace.tools)) : pre(t('未记录工具调用')))) +
    box(t('反馈信号'), '<div class="stack">' + (records || ('<p class="quiet">' + t('暂无反馈') + '</p>')) + '</div>') +
    '<div class="actions">' + btn(t('添加反馈'), 'plus', 'add-feedback', 'primary', trace.id) +
    (item ? btn(t('查看归因'), 'bug', 'case-detail', '', item.id) : btn(t('创建归因案例'), 'bug', 'make-case', '', trace.id)) +
    (trace.sessionId ? btn(t('打开 Session'), 'layers', 'session-detail', '', trace.sessionId) : '') +
    (!trace.feedback.length ? btn(t('抽检此链路'), 'flask', 'online-trace', '', trace.id) : '') + '</div></div>', trace.id + ' · ' + time(trace.createdAt), true);
}

export function addTrace(state) {
  show(t('模拟采集一条链路'), form('add-trace',
    field(t('场景名称'), input('name', t('退款有效期'))) +
    '<div class="inline-grid">' + field(t('应用版本'), select('version', versionOptions(state), state.config.baseline)) +
    field(t('场景类型'), select('kind', typeOptions, 'rag')) + '</div>' +
    field(t('用户输入'), textarea('input', t('签收后多久可以退货？'), 'required')) +
    field(t('模型输出'), textarea('output', t('请联系人工客服进一步确认。'), 'required')) +
    field(t('召回片段'), textarea('retrieved', '', t('placeholder="没有召回时留空"'))) +
    field(t('知识库是否包含答案'), select('knowledge', { '': t('未知'), yes: t('已存在'), no: t('未覆盖') })) +
    '<div class="inline-grid">' + field(t('Session 标识'), input('sessionId', '', t('placeholder="例如：demo-session"'))) +
    field(t('轮次'), input('turnIndex', '', 'type="number" min="0"')) + '</div>' +
    field(t('初始反馈'), select('type', { '': t('暂无'), ...feedbackLabels }, 'dislike')), t('写入链路')), t('模拟一条交互，验证反馈与归因流程'));
}

export function addFeedback(key) {
  show(t('添加反馈'), form('add-feedback', '<input type="hidden" name="traceId" value="' + esc(key) + '">' +
    field(t('反馈类型'), select('type', feedbackLabels, 'dislike')) + field(t('反馈内容'), textarea('note', '', t('placeholder="可填入用户纠错或人工标注"'))), t('保存反馈')), key);
}

export function addGolden(sample = {}) {
  show(sample.id ? t('修订基准样本') : t('添加基准样本'), form('add-golden',
    (sample.id ? '<input type="hidden" name="replaces" value="' + esc(sample.id) + '">' : '') +
    field(t('用例名称'), input('name', sample.name, t('placeholder="例如：部分退款政策"'))) +
    '<div class="inline-grid">' + field(t('样本类型'), select('kind', typeOptions, sample.kind || 'rag')) +
    field(t('评测分层'), select('group', optionMap(['核心场景', '边界用例', '历史回归']), sample.group)) + '</div>' +
    field(t('用户输入'), textarea('input', sample.input, 'required')) + field(t('参考答案'), textarea('reference', sample.reference, 'required')) +
    field(t('参考上下文'), textarea('context', sample.context)) +
    '<div class="inline-grid">' + field(t('必含关键词'), input('required', sample.required?.join('，'), t('placeholder="逗号分隔"'))) +
    field(t('禁止关键词'), input('forbidden', sample.forbidden?.join('，'), t('placeholder="逗号分隔"'))) +
    field(t('最大输出字符数'), input('maxLength', sample.maxLength, 'type="number" min="1" max="12000"')) +
    field(t('工具调用断言'), input('tool', sample.tool ? JSON.stringify(sample.tool) : '', 'placeholder=\'{"name":"handoff","args":{"queue":"support"}}\'')) + '</div>' +
    ('<details class="detail-box"><summary>' + t('Session 与 Agent 轨迹') + '</summary><div class="form" style="margin-top:10px">') +
    field(t('会话消息 JSON'), textarea('turns', sample.turns?.length ? jsonText(sample.turns) : '', t('placeholder=\'[{"role":"user","content":"你好"}]\''))) +
    '<div class="inline-grid">' + field(t('预期工具顺序'), input('agentSteps', sample.agent?.steps?.join('，'), t('placeholder="逗号分隔"'))) +
    field(t('最多无效重试'), input('agentRetries', sample.agent?.maxRetries, 'type="number" min="0" max="40"')) + '</div>' +
    check('noLoop', t('要求调用轨迹无循环'), sample.agent?.noLoop) + '</div></details>' +
    '<div class="actions">' + check('critical', t('关键用例'), sample.critical) + check('json', t('必须输出合法 JSON'), sample.json) + '</div>', sample.id ? t('保存并生成快照') : t('添加样本')),
  t('样本保存时自动脱敏并绑定基准集快照'), true);
}

export function goldenDetail(s, historical = false) {
  show(s.name, '<div class="stack"><div class="actions">' + tagKind(s.kind) + badge(t(s.group), '', false) +
    (s.critical ? badge(t('关键用例'), 'warn') : '') + (s.traceId ? btn(t('查看来源'), 'activity', 'trace-detail', '', s.traceId) : '') +
    (historical ? '' : btn(t('修订用例'), 'bracket', 'edit-golden', '', s.id) + btn(t('移出活动基准'), '', 'archive-golden', '', s.id)) + '</div>' +
    (s.trainingExposed ? alert(t('样本或同来源变体已用于训练导出。'), 'fail') : '') +
    '<div class="inline-grid">' + box(t('用户输入'), pre(s.input)) + box(t('参考答案'), pre(s.reference)) + '</div>' +
    box(t('参考上下文'), pre(s.context)) +
    (s.turns?.length ? box(t('Session 上下文'), pre(jsonText(s.turns))) : '') +
    box(t('规则配置'), pre(jsonText({ json: s.json, required: s.required, forbidden: s.forbidden, maxLength: s.maxLength, tool: s.tool, agent: s.agent }))) +
    '</div>', s.id + ' · ' + time(s.createdAt));
}

export function caseDetail(state, item) {
  const trace = state.traces.find(t => t.id === item.traceId);
  const cluster = state.clusters.find(group => group.ids.includes(item.id));
  const top = '<div class="actions">' + badge(...caseLabels[item.status]) +
    (item.source === 'online' ? badge(t('线上抽检'), 'info') : '') + btn(t('查看原始链路'), 'activity', 'trace-detail', '', item.traceId) +
    btn(t('在调试台重跑'), 'play', 'open-playground', '', item.id) +
    (item.corrected ? btn(t('生成变体'), 'split', 'variants', '', item.id) : '') + '</div>' +
    (cluster ? alert((t('预归因 ·') + ' ') + t(cluster.cause) + ' · ' + serviceText(cluster.rationale)) : '') +
    '<div class="inline-grid">' + box(t('用户输入'), pre(trace.input)) + box(t('原始输出'), pre(trace.output)) + '</div>';
  const fields = '<input type="hidden" name="id" value="' + esc(item.id) + '">' +
    '<div class="inline-grid">' + field(t('确认根因'), select('cause', optionMap(roots), item.cause === '待确认' ? cluster?.cause || item.cause : item.cause)) +
    field(t('数据回流目标'), select('target', targets, item.target)) + '</div>' +
    field(t('归因说明'), textarea('note', item.note)) + field(t('修正答案'), textarea('corrected', item.corrected || trace.expected, 'required')) +
    check('critical', t('作为关键用例加入回归集'));
  const curate = ('<button class="button primary" name="intent" value="curate" type="submit">' + t('确认并回流') + '</button>');
  show(item.title, '<div class="stack">' + top + (item.status === 'curated' ?
    box((t('已回流至') + ' ') + targets[item.target], pre(item.corrected)) : form('update-case', fields, t('保存归因'), curate)) + '</div>',
  item.id + ' · ' + item.traceId, true);
}

export function newRun(state) {
  const options = versionOptions(state);
  const next = state.versions.find(v => v.id !== state.config.baseline);
  show(t('运行全量评测'), form('run',
    '<div class="inline-grid">' + field(t('基线版本'), select('baseline', options, state.config.baseline)) +
    field(t('候选版本'), select('candidate', options, next?.id)) + '</div>' +
    field(t('评分方式'), select('judgeMode', state.judgeReady ? { heuristic: t('演示评分'), llm: t('模型裁判') } : { heuristic: t('演示评分') }, state.judgeReady ? 'llm' : 'heuristic'),
      state.judgeReady ? t('先执行规则层，再对通过的样本打分。') : t('配置 JUDGE_MODEL 后可启用模型裁判。')) +
    alert(t('基准快照 {snapshot} · {count} 条用例。关键用例各回放 {replays} 次。通过率至少 {pass}% 且不低于基线，关键用例修复率至少 {fix}%。', {
      snapshot: state.datasetVersion, count: state.golden.length, replays: state.config.criticalRepeats,
      pass: state.config.minPass, fix: state.config.minCritical
    })),
  t('开始评测')), t('规则校验 · 裁判评分 · 回归卡点'));
}

export function runDetail(run) {
  const gates = run.gates.map(g => '<div><span>' + esc(serviceText(g.name)) + '</span>' + gateBadge(g.passed) + '</div>').join('');
  const rows = run.rows.map(r => row([
    mono(r.id), esc(r.name), tagKind(r.kind), r.critical ? badge(t('关键'), 'warn', false) : '—', gateBadge(r.baseline.passed), gateBadge(r.candidate.passed),
    r.candidate.judge ? r.candidate.judge.faithfulness + ' / ' + r.candidate.judge.relevance + ' / ' + r.candidate.judge.instruction : '—'
  ], 'sample-detail', r.id)).join('');
  show((t('评测') + ' ') + run.id, '<div class="stack"><div class="actions">' + gateBadge(run.passed) + badge(run.judgeMode === 'llm' ? t('模型裁判') : t('演示评分'), 'info', false) +
    badge(run.demo ? t('演示回放') : t('实际回放'), '', false) +
    (run.datasetVersion ? btn(run.datasetVersion, 'database', 'dataset-detail', 'small', run.datasetVersion) : badge(t('历史批次无基准快照'), '', false)) +
    (run.judgeMode === 'llm' ? badge(t('裁判模型') + ' · ' + (run.judgeModel || t('模型标识未记录')), 'info', false) : '') +
    (run.judgeVersion ? btn(t('裁判 Prompt 版本') + ' · ' + run.judgeVersion, 'flask', 'judge-detail', 'small', run.judgeVersion) : '') + (run.passed ? btn(t('创建灰度'), 'rocket', 'new-release', '', run.id) : '') + '</div>' +
    '<div class="inline-grid">' + box(t('批次指标'), ('<div class="detail-list"><div><span>' + t('候选通过率') + '</span><strong>') + pct(run.pass) + ('</strong></div><div><span>' + t('基线通过率') + '</span><strong>') +
    pct(run.baselinePass) + ('</strong></div><div><span>' + t('关键失败修复率') + '</span><strong>') + pct(run.criticalRate) +
    ('</strong></div><div><span>' + t('新增失败') + '</span><strong>') + run.failures + '</strong></div></div>') +
    box(t('发布卡点'), '<div class="detail-list">' + gates + '</div>') + '</div>' + batchPerformance(run) +
    '<section class="card">' + table([t('样本'), t('测试用例'), t('类型'), t('优先级'), t('基线'), t('候选'), t('忠实 / 相关 / 遵循')], rows) + '</section></div>',
  run.candidate + (' ' + t('对比') + ' ') + run.baseline + ' · ' + time(run.createdAt), true);
}

export function sampleDetail(run, sample) {
  function scores(label, result) {
    return box(label, '<div class="stack">' + pre(result.output) +
      '<div class="detail-list">' + result.rules.map(rule => '<div><span>' + esc(serviceText(rule.name)) + '</span>' + gateBadge(rule.passed) + '</div>').join('') + '</div>' +
      (result.judge ? alert((t('忠实度') + ' ') + result.judge.faithfulness + (' ' + t('· 相关性') + ' ') + result.judge.relevance + (' ' + t('· 指令遵循') + ' ') + result.judge.instruction +
      ' · ' + serviceText(result.judge.reasoning)) : alert(t('首次回放规则未通过，跳过裁判评分。'))) +
      (result.agent ? alert((t('首次轨迹 · 工具匹配率') + ' ') + pct(result.agent.accuracy) + (' ' + t('· 重试') + ' ') + result.agent.retries + (' ' + t('次 ·') + ' ') + (result.agent.loop ? t('发现循环') : t('无循环'))) : '') +
      repeatDetail(result) + '</div>');
  }
  show(sample.name, '<div class="stack"><div class="actions">' + btn(t('返回评测'), 'arrow', 'run-detail', '', run.id) +
    (!sample.candidate.passed ? btn(t('归入 Bad Case'), 'bug', 'case-from-run', 'primary', sample.id) : '') + '</div>' +
    '<div class="inline-grid">' + box(t('原始输入'), pre(sample.input)) + box(t('参考答案'), pre(sample.reference)) + '</div><div class="inline-grid">' +
    scores((t('基线 ·') + ' ') + run.baseline, sample.baseline) + scores((t('候选 ·') + ' ') + run.candidate, sample.candidate) + '</div></div>',
  sample.id + ' · ' + run.id, true);
}

export function pickReview(state) {
  const choices = Object.fromEntries(state.runs.map(v => [v.id, v.id + ' · ' + v.candidate + (v.judgeMode === 'llm' ? (' ' + t('· 模型裁判')) : (' ' + t('· 演示评分')))]));
  show(t('抽取 A/B 盲评样本'), form('pick-review', field(t('评测批次'), select('runId', choices, state.runs[0]?.id)) +
    alert(t('样本输出随机排列，版本和裁判选择在提交后显示。')), t('抽取样本')));
}

export function reviewDetail(review) {
  const vote = review.human;
  show(t('A/B 盲评'), '<div class="stack"><div class="inline-grid">' +
    box(t('用户输入'), pre(review.input)) + box(t('参考答案'), pre(review.reference)) + '</div><div class="inline-grid">' +
    box(t('回答 A'), pre(review.a)) + box(t('回答 B'), pre(review.b)) + '</div>' +
    (vote ? alert(t('你的选择：') + vote + (' ' + t('· 裁判选择：')) + review.judge + (' ' + t('· A 为')) +
      (review.order[0] === 'candidate' ? t('候选版本') : t('基线版本')) + '。', vote === review.judge ? 'ok' : '') :
      '<div class="actions">' + ['A', 'B', 'tie'].map(key => btn(key === 'tie' ? t('同等表现') : (t('选择') + ' ') + key, '', 'vote-' + key, key === 'tie' ? '' : 'primary', review.id)).join('') + '</div>') +
    '</div>', review.id + ' · ' + (review.mode === 'llm' ? [review.judgeVersion || t('模型裁判'), review.judgeModel].filter(Boolean).join(' · ') : t('演示评分')), true);
}

export function addVersion(state, draft = null) {
  show(t('登记迭代版本'), form('add-version',
    '<div class="inline-grid">' + field(t('版本标识'), input('id', '', 'placeholder="v2.5.0" required')) +
    field(t('版本名称'), input('name', '', t('placeholder="新版售后 Prompt" required'))) +
    field(t('迭代策略'), select('strategy', optionMap(['Prompt', 'RAG', 'SFT', 'DPO']))) +
    field(t('模型标识'), input('model', draft?.model || '', t('placeholder="模型端点接受的 model 名称" required'))) + '</div>' +
    field(t('系统 Prompt'), textarea('prompt', draft?.prompt || '', 'required')) + field('Top-K', input('topK', draft?.topK ?? '', 'type="number" min="0" max="25"'), t('留空时最多使用 10 个已记录的片段')) +
    (!state.modelReady ? alert(t('调用模型前需配置模型端点。也可以通过 CI API 提交外部基线和候选回放。')) : ''), t('登记版本')));
}

export function versionDetail(state, version) {
  show(t(version.name), '<div class="stack"><div class="actions">' + badge(version.strategy, 'info', false) + mono(version.model) +
    (state.config.baseline === version.id ? badge(t('生产基线'), 'ok') : '') + '</div>' +
    box(t('系统 Prompt'), pre(version.prompt)) + (version.topK != null ? box('Top-K', pre(String(version.topK))) : '') + '</div>', version.id);
}

export function newRelease(state, selected) {
  const active = state.releases.some(r => r.status === 'canary');
  if (active) return show(t('创建灰度'), alert(t('当前已有灰度，请到「回归与灰度」处理后再启动。')));
  const passing = state.runs.filter(r => state.eligibleRuns.includes(r.id));
  if (!passing.length) return show(t('创建灰度'), '<div class="stack">' + alert(t('当前没有符合基线、门槛和基准集的合格评测。')) +
    '<div class="actions">' + btn(t('运行评测'), 'play', 'new-run', 'primary') + '</div></div>');
  show(t('创建灰度'), form('new-release',
    field(t('已通过发布卡点的评测'), select('runId', Object.fromEntries(passing.map(v => [v.id, v.id + ' · ' + v.candidate + (v.demo ? (' ' + t('· 演示')) : '')])), selected)) +
    field(t('候选流量（%）'), numeric('percent', 10, 1, 50)) +
    alert(t('路由使用稳定的 userKey 分流。业务应用接入路由 API 后开始返回实际流量。')), t('启动灰度')), (t('当前基线') + ' ') + state.config.baseline);
}

export function releaseDetail(release) {
  show((t('发布') + ' ') + release.id, '<div class="stack"><div class="actions">' + badge(...releaseLabels[release.status]) +
    (release.demo ? badge(t('演示运行'), '', false) : '') + '</div>' + box(t('版本'), ('<div class="detail-list"><div><span>' + t('候选') + '</span>') + mono(release.version) +
    ('</div><div><span>' + t('基线') + '</span>') + mono(release.baseline) + ('</div><div><span>' + t('当前占比') + '</span><strong>') + release.percent + '%</strong></div></div>') +
    (release.fuse ? alert(serviceText(release.fuse.reason), 'fail') : '') + releaseSignals(release) +
    (release.status === 'canary' ? form('update-release', '<input type="hidden" name="id" value="' + esc(release.id) + '">' +
      field(t('候选流量（%）'), numeric('percent', release.percent, 1, 50)), t('更新流量'),
      ('<button class="button danger" name="intent" value="rollback" type="submit">' + t('回滚') + '</button><button class="button" name="intent" value="promote" type="submit">' + t('全量发布') + '</button>')) : '') + '</div>',
  (t('评测') + ' ') + release.runId + ' · ' + time(release.updatedAt));
}

export function routeDialog(result, key) {
  show(t('验证路由'), form('route', field(t('稳定的用户标识'), input('userKey', key || 'sample-user-001', 'required')) +
    (result ? alert((t('分配版本') + ' ') + result.version + (' ' + t('· 分桶') + ' ') + result.bucket + ' / 99' + (result.releaseId ? (' ' + t('· 灰度') + ' ') + result.releaseId : ''), 'ok') : ''), t('查询版本')));
}
