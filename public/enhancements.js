import { serviceText, t } from './i18n.js';
import { I, esc, pct, fmt, time, btn, badge, panelHead, title, table, row, mono, tagKind,
  box, pre, alert, field, input, textarea, select, check, form, show } from './ui.js';

const code = value => pre(JSON.stringify(value, null, 2));
const integer = (name, value, min, max, optional = false) => input(name, value, 'type="number" min="' + min + '" max="' + max + '"' + (optional ? '' : ' required'));
const decimal = (name, value, min, max, optional = false) => input(name, value, 'type="number" step="any" min="' + min + '" max="' + max + '"' + (optional ? '' : ' required'));
const hidden = (name, value) => '<input type="hidden" name="' + name + '" value="' + esc(value) + '">';
const amount = value => value == null ? '—' : '$' + Number(value).toFixed(6);
const ms = value => value == null ? '—' : fmt(value) + ' ms';
const statusMap = { queued: [t('排队中'), 'warn'], running: [t('抽检中'), 'info'], passed: [t('规则或评分通过'), 'ok'], failed: [t('静默失败'), 'fail'],
  skipped: [t('已有反馈 · 跳过'), ''], error: [t('抽检失败'), 'fail'] };

export function onlinePage(state) {
  const jobs = state.onlineJobs;
  const count = key => jobs.filter(job => job.status === key).length;
  return title(t('线上抽检'), t('异步检查无反馈链路，将静默失败自动归入 Bad Case。'),
    btn(t('抽检设置'), 'settings', 'online-config') + btn(t('抽检近期样本'), 'play', 'online-run', 'primary', 'sample')) +
    ('<div class="stack"><div class="inline-grid"><section class="card inner"><h3>' + t('采样比例') + '</h3><div class="metric-value">') + state.config.online.sampleRate +
    ('%</div><p>' + t('反馈等待窗口') + ' ') + state.config.online.settleMinutes + (' ' + t('分钟 · 已在采集入库前脱敏') + '</p></section>') +
    ('<section class="card inner"><h3>' + t('静默失败') + '</h3><div class="metric-value">') + fmt(count('failed')) + ('</div><p>' + t('已完成') + ' ') +
    fmt(count('failed') + count('passed')) + (' ' + t('条 · 待处理') + ' ') + fmt(count('queued') + count('running')) + (' ' + t('条') + '</p></section></div>') +
    '<section class="card table-card">' + panelHead(t('抽检记录'), t('规则失败时直接归档，符合条件的样本可交由模型裁判。'), btn(t('处理到期任务'), 'activity', 'online-run', '', 'due')) +
    table([t('链路'), t('状态'), t('评分'), t('检查说明'), t('时间')], jobs.map(job => row([mono(job.traceId), badge(...statusMap[job.status]),
      esc(job.score ?? '—'), '<span class="ellipsis" title="' + esc(serviceText(job.reason || '')) + '">' + esc(serviceText(job.reason || '—')) + '</span>', time(job.finishedAt || job.createdAt)
    ], job.caseId ? 'case-detail' : 'trace-detail', job.caseId || job.traceId)).join(''), t('暂无抽检记录。')) + '</section></div>';
}

export function onlineConfig(state) {
  const cfg = state.config.online;
  show(t('线上抽检设置'), form('online-config', '<div class="inline-grid">' +
    decimalField(t('无反馈流量采样率 (%)'), 'sampleRate', cfg.sampleRate, 0, 100) +
    decimalField(t('等待反馈 (分钟)'), 'settleMinutes', cfg.settleMinutes, 0, 1440) +
    field(t('抽检方式'), select('judgeMode', state.judgeReady || cfg.judgeMode === 'llm' ? { rules: t('快速规则'), llm: t('规则 + 模型裁判') } : { rules: t('快速规则') }, cfg.judgeMode)) +
    field(t('每新增多少案例自动聚类'), integer('clusterEvery', cfg.clusterEvery, 1, 400)) + '</div>', t('保存设置')));
}

function decimalField(label, name, value, min, max, optional = false) {
  return field(label, decimal(name, value, min, max, optional), optional ? t('留空时关闭该门槛') : '');
}

export function clustersPanel(state) {
  const info = state.clusterInfo;
  const summary = info ? ((t('最近') + ' ') + info.total + (' ' + t('条 ·') + ' ') + (info.method === 'embedding' ? 'Embedding' : t('本地文本相似度')) +
    (info.assisted ? (' ' + t('· 模型预归因')) : (' ' + t('· 规则预归因'))) + ' · ' + time(info.createdAt)) : t('按语义相似度汇总失败场景，生成根因建议。');
  return '<section class="card table-card">' + panelHead(t('语义聚类'), summary, btn(t('重新聚类'), 'split', 'cluster-refresh')) +
    table([t('失败簇'), t('案例数'), t('影响链路／会话'), t('预归因'), t('涉及版本')], state.clusters.slice(0, 8).map(cluster => row([
      esc(cluster.title), fmt(cluster.count) + ' · ' + pct(cluster.share), fmt(cluster.affected), esc(t(cluster.cause)), esc(cluster.versions.join(', '))
    ], 'cluster-detail', cluster.id)).join(''), t('点击「重新聚类」分析现有案例。')) + '</section>';
}

export function clusterDetail(state, cluster) {
  const cases = cluster.ids.map(id => state.cases.find(item => item.id === id)).filter(Boolean);
  show(cluster.title, '<div class="stack">' + alert((t('建议根因 ·') + ' ') + t(cluster.cause) + ' · ' + serviceText(cluster.rationale)) +
    '<div class="actions">' + btn(t('在调试台重跑这组案例'), 'play', 'open-playground', 'primary', cluster.id) +
    btn(t('查看代表链路'), 'activity', 'trace-detail', '', cluster.representative) + '</div>' +
    table([t('案例'), t('场景'), t('已记录根因')], cases.map(item => row([mono(item.id), esc(item.title), esc(t(item.cause))], 'case-detail', item.id)).join('')) +
    '</div>', cluster.count + (' ' + t('条案例 ·') + ' ') + cluster.affected + (' ' + t('个受影响链路或会话 ·') + ' ') + cluster.versions.join(', '), true);
}

export function variantsDialog(item, result) {
  show(t('确认 Bad Case 变体'), form('save-variants', hidden('id', item.id) +
    alert(t('请检查各变体是否保留原问题的判定标准。保存后一起生成新基准集快照。')) +
    result.variants.map((variant, index) => hidden('type' + index, variant.type) +
      field(t(variant.type), textarea('variant' + index, variant.text, 'required maxlength="800"'))).join('') +
    check('critical', t('将这组变体标为关键用例')), t('加入基准集')), result.mode === 'llm' ? t('模型生成 · 待人工确认') : t('本地规则生成 · 待人工确认'), true);
}

export function datasetList(state) {
  show(t('基准集版本'), '<div class="stack">' +
    table([t('快照'), t('变更'), t('用例数'), t('时间')], state.datasets.map(version => row([
      mono(version.id) + (version.id === state.datasetVersion ? ' ' + badge(t('当前'), 'ok', false) : ''),
      esc(t(version.reason)), fmt(version.count), time(version.createdAt)
    ], 'dataset-detail', version.id)).join('')) +
    box(t('已移出用例'), state.archivedSamples.length ? table([t('用例'), t('名称'), t('操作')], state.archivedSamples.map(sample => row([
      mono(sample.id), esc(sample.name), btn(t('恢复'), 'plus', 'restore-golden', 'small', sample.id)
    ])).join('')) : ('<p class="quiet">' + t('暂无记录') + '</p>')) +
    box(t('训练和评测隔离'), alert((t('已标记') + ' ') + fmt(state.trainingUseCount) + (' ' + t('条导出到 Few-shot 或训练的数据。活动基准包含同来源或同输入时会阻止训练导出。')))) +
    '</div>', t('每次修改保留旧快照，评测批次绑定当时的版本。'), true);
}

export function datasetDetails(data) {
  show((t('基准集') + ' ') + data.id, '<div class="stack"><div class="actions">' + btn(t('返回版本列表'), 'arrow', 'datasets') + '</div>' +
    table([t('用例'), t('名称'), t('类型'), t('分层'), t('治理状态')], data.samples.map(sample => row([
      mono(sample.id), esc(sample.name), tagKind(sample.kind), esc(t(sample.group)), sample.trainingExposed ? badge(t('曾用于训练导出'), 'warn') : (sample.critical ? badge(t('关键用例'), 'info') : '—')
    ], 'snapshot-sample', sample.id)).join('')) + '</div>', t(data.reason) + ' · ' + t('{count} 条用例 · ', { count: data.samples.length }) + time(data.createdAt), true);
}

export function sessionDialog(data) {
  show((t('会话') + ' ') + data.id, '<div class="stack">' +
    box(t('多轮上下文'), '<div class="dialogue">' + data.turns.map(turn => '<div class="bubble ' + turn.role + '"><strong>' +
      (turn.role === 'user' ? t('用户') : t('助手')) + '</strong>' + pre(turn.content) + '</div>').join('') +
      ('<div class="bubble assistant"><strong>' + t('最终输出') + '</strong>') + pre(data.last.output) + '</div></div>') +
    table([t('轮次'), t('链路'), t('场景'), t('延迟')], data.traces.map(trace => row([
      esc(trace.turnIndex ?? '—'), mono(trace.id), esc(trace.name), ms(trace.latencyMs)
    ], 'trace-detail', trace.id)).join('')) +
    form('session-golden', hidden('sessionId', data.id) + field(t('末轮参考答案'), textarea('reference', data.last.expected, 'required')) +
      check('critical', t('关键用例')), t('保存为 Session 用例')) + '</div>', t('按轮次回放历史消息，评测末轮回答。'), true);
}

export function judgePanel(state) {
  const cfg = state.config;
  const current = state.judgeAgreement.find(item => item.active);
  const needsCalibration = current?.n >= cfg.calibrationMin && current.observed < cfg.calibrationThreshold;
  return '<section class="card table-card">' + panelHead(t('裁判版本与校准'), t('按裁判模型和 Prompt 版本统计一致率，盲评随机交换基线和候选的位置。'),
    '<div class="actions">' + btn(t('一致率门槛'), 'settings', 'judge-config') + btn(t('新建裁判版本'), 'plus', 'judge-new') + '</div>') +
    (needsCalibration ? '<div class="inner">' + alert((t('当前裁判一致率') + ' ') + current.observed + (t('% 低于') + ' ') + cfg.calibrationThreshold + t('%，请复核盲评结果并迭代裁判 Prompt。'), 'fail') + '</div>' : '') +
    table([t('裁判 Prompt 版本'), t('裁判模型'), t('状态'), t('人工票数'), t('一致率'), 'Cohen’s κ', t('操作')], state.judgeAgreement.map(summary => {
      const judge = state.judges.find(item => item.id === summary.id);
      return row([mono(judge.id) + ' · ' + esc(t(judge.name)), mono(summary.model || (summary.configured ? '—' : t('模型标识未记录'))),
        summary.active ? badge(t('使用中'), 'ok') : badge(t('历史版'), ''),
        fmt(summary.n), summary.observed == null ? '—' : pct(summary.observed), esc(summary.kappa ?? '—'),
        btn(t('查看'), '', 'judge-detail', 'small', judge.id) +
        (summary.configured && judge.id !== cfg.activeJudge ? ' ' + btn(t('启用'), '', 'judge-activate', 'small', judge.id) : '')]);
    }).join('')) + '</section>';
}

export function judgeForm(state) {
  const active = state.judges.find(item => item.id === state.config.activeJudge);
  show(t('新建裁判版本'), form('judge-new',
    field(t('版本名称'), input('name', '', t('required placeholder="例如：忠实度校准"'))) +
    field(t('覆盖模型名'), input('model', active.model), t('留空时使用运行环境的 JUDGE_MODEL')) +
    field(t('裁判 Prompt'), textarea('prompt', active.prompt, 'required rows="6"')) +
    check('activate', t('立即设为使用中的裁判'), true), t('登记裁判版本')));
}

export function judgeDetail(judge) {
  show(t(judge.name), box(t('裁判 Prompt'), pre(judge.prompt)), judge.id + ' · ' + (judge.model || t('使用 JUDGE_MODEL')));
}

export function judgeConfig(state) {
  show(t('一致率门槛'), form('judge-config', '<div class="inline-grid">' +
    decimalField(t('一致率下限 (%)'), 'calibrationThreshold', state.config.calibrationThreshold, 0, 100) +
    field(t('提醒前所需人工票数'), integer('calibrationMin', state.config.calibrationMin, 1, 1000)) + '</div>', t('保存门槛')));
}

export function fullGates(state) {
  const cfg = state.config;
  show(t('发布门槛'), form('settings', '<div class="inline-grid">' +
    decimalField(t('候选最低通过率 (%)'), 'minPass', cfg.minPass, 0, 100) +
    decimalField(t('关键失败最低修复率 (%)'), 'minCritical', cfg.minCritical, 0, 100) +
    decimalField(t('延迟 P95 上限 (ms)'), 'maxLatencyP95', cfg.maxLatencyP95, 1, 120000, true) +
    decimalField(t('首字延迟 P95 上限 (ms)'), 'maxTtftP95', cfg.maxTtftP95, 1, 120000, true) +
    decimalField(t('单次成本增幅上限 (%)'), 'maxCostDelta', cfg.maxCostDelta, 0, 1000, true) +
    field(t('关键用例重复次数'), integer('criticalRepeats', cfg.criticalRepeats, 1, 10)) +
    field(t('稳定性方差上限'), decimal('stabilityVariance', cfg.stabilityVariance, 0, 2500, true), t('留空时要求全部通过。配置后也需均分 ≥ 80。')) +
    decimalField(t('输入 Token 估算单价 (USD / 百万)'), 'inputPrice', cfg.inputPrice, 0, 10000) +
    decimalField(t('输出 Token 估算单价 (USD / 百万)'), 'outputPrice', cfg.outputPrice, 0, 10000) + '</div>' +
    alert(t('启用的性能门槛需要候选回放提供对应指标。成本增幅需要两侧数据。保存后需重新回归。')), t('保存门槛')),
  t('质量 · 性能 · 成本 · 稳定性'), true);
}

export function batchPerformance(run) {
  const p = run.performance;
  if (!p) return '';
  return box(t('性能与成本'), table([t('指标'), t('基线'), t('候选')], [
    row([t('回放次数'), fmt(p.baseline.calls), fmt(p.candidate.calls)]),
    row([t('延迟 P95'), ms(p.baseline.latencyP95), ms(p.candidate.latencyP95)]),
    row([t('首字延迟 P95'), ms(p.baseline.ttftP95), ms(p.candidate.ttftP95)]),
    row([t('单次平均成本'), amount(p.baseline.costPerCall), amount(p.candidate.costPerCall) + (p.costDelta == null ? '' : '（' + (p.costDelta >= 0 ? '+' : '') + pct(p.costDelta) + '）')]),
    row([t('Agent 工具匹配率'), pct(p.baseline.toolAccuracy), pct(p.candidate.toolAccuracy)]),
    row([t('Agent 循环 / 重试'), p.baseline.loops + ' / ' + p.baseline.retries, p.candidate.loops + ' / ' + p.candidate.retries])
  ].join('')));
}

const toolIsolationLabels = {
  mock: '工具 Mock', 'read-only': '只读沙箱', recorded: '已记录轨迹',
  'no-tools': '内置回放 · 无工具执行', undeclared: '外部执行器未声明'
};

export function repeatDetail(result) {
  if (!result.stability) return '';
  const { successes, count, required, variance } = result.stability;
  const rate = result.stability.passRate ?? (count ? successes / count * 100 : null);
  const allPassed = count === required && (result.stability.allPassed ?? successes === required);
  const outcome = count !== required ? t('回放未完成') : allPassed ? t('全部通过') : t('未全部通过');
  const summary = t('通过 {passed}/{count} 次（{rate}） · 计划 {required} 次 · 方差 {variance}', {
    passed: successes, count, rate: pct(rate), required, variance
  });
  const hasTools = result.attempts.some(attempt => attempt.agent);
  const headings = [t('轮次'), t('结果'), t('得分'), t('延迟'), t('首字'), t('成本'), ...(hasTools ? [t('工具隔离方式')] : [])];
  const rows = result.attempts.map((attempt, index) => row([
    String(index + 1), badge(attempt.passed ? t('通过') : t('未通过'), attempt.passed ? 'ok' : 'fail', false),
    String(attempt.score), ms(attempt.metrics.latencyMs), ms(attempt.metrics.ttftMs), amount(attempt.metrics.costUsd),
    ...(hasTools ? [esc(t(toolIsolationLabels[attempt.toolIsolation] || '外部执行器未声明'))] : [])
  ])).join('');
  return box(t('重复回放'), '<div class="actions">' + badge(outcome, allPassed ? 'ok' : count !== required ? '' : 'warn') +
    '<p>' + esc(summary) + '</p></div>' + table(headings, rows));
}

export function fuseConfig(state) {
  const cfg = state.config.fuse;
  show(t('自动熔断设置'), form('fuse-config', check('enabled', t('启用线上自动熔断'), cfg.enabled) +
    '<div class="inline-grid">' +
    field(t('滚动窗口 (分钟)'), integer('windowMinutes', cfg.windowMinutes, 1, 1440)) +
    field(t('每组最少链路数'), integer('minCalls', cfg.minCalls, 2, 9999)) +
    decimalField(t('相对基线点踩率增幅上限 (%)'), 'dislikeLift', cfg.dislikeLift, 0, 1000) +
    field(t('触发前最少候选点踩'), integer('minDislikes', cfg.minDislikes, 1, 9999)) +
    decimalField(t('候选报错率上限 (%)'), 'maxErrorRate', cfg.maxErrorRate, 0, 100) + '</div>' +
    alert(t('使用真实线上链路。达到最小样本量后，任一熔断条件触发即切回基线并记录告警。新发布使用保存时的配置。')), t('保存熔断规则')));
}

export function alertsPanel(state, compact = false) {
  const rows = state.alerts.slice(0, compact ? 4 : 10).map(item => row([
    mono(item.releaseId), mono(item.version), esc(serviceText(item.reason)), time(item.at)
  ], 'release-detail', item.releaseId)).join('');
  return '<section class="card table-card">' + panelHead(t('熔断告警'), state.alerts.length ? t('触发后已切回基线') : '') +
    table([t('灰度'), t('候选'), t('触发原因'), t('时间')], rows, t('暂无自动熔断告警。')) + '</section>';
}

export function releaseSignals(release) {
  if (!release.signals) return '';
  const { baseline, candidate, windowMinutes, minCalls } = release.fuse?.metrics || release.signals;
  return box((t('熔断观测 ·') + ' ') + windowMinutes + (' ' + t('分钟窗口')), table([t('组'), t('样本'), t('点踩率'), t('报错率')], [
    row([t('基线'), fmt(baseline.n), pct(baseline.dislikeRate), pct(baseline.errorRate)]),
    row([t('候选'), fmt(candidate.n), pct(candidate.dislikeRate), pct(candidate.errorRate)])
  ].join('')) + ('<p class="quiet" style="margin-top:8px">' + t('最少') + ' ') + t('{count} 条链路 · ', { count: minCalls }) +
    (release.demo ? t('演示灰度不参与熔断') : release.fuse ? t('已自动回滚') : release.fuseConfig?.enabled ? t('熔断监测已启用') : t('自动熔断未开启')) + '</p>');
}

function diffText(before, after) {
  const left = [...before], right = [...after];
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left.at(-suffix - 1) === right.at(-suffix - 1)) suffix++;
  const start = esc(left.slice(0, prefix).join('')), end = suffix ? esc(left.slice(-suffix).join('')) : '';
  const removed = esc(left.slice(prefix, left.length - suffix).join('')), added = esc(right.slice(prefix, right.length - suffix).join(''));
  return ('<div class="inline-grid"><section class="detail-box"><h3>' + t('原始输出') + '</h3><div class="pre">') + start + (removed ? '<del>' + removed + '</del>' : '') + end +
    ('</div></section><section class="detail-box"><h3>' + t('重跑输出') + '</h3><div class="pre">') + start + (added ? '<ins>' + added + '</ins>' : '') + end + '</div></section></div>';
}

export function playgroundPage(state, draft, result) {
  const cases = state.cases;
  const profile = draft || {};
  const version = state.versions.find(entry => entry.id === profile.version) || state.versions.find(entry => entry.id === state.config.baseline) || state.versions[0];
  const options = Object.fromEntries(state.versions.map(entry => [entry.id, entry.id + ' · ' + entry.model]));
  const selected = new Set(profile.ids || (cases.length ? [cases[0].id] : []));
  return title(t('调试台'), t('用原始链路对比 Prompt 与 Top-K 的改动，确认后再登记候选版本。')) +
    '<div class="stack"><section class="card">' + panelHead(t('重跑设置'), t('选择最多 10 条 Bad Case。Top-K 按顺序截取链路已记录的召回片段。')) +
    '<div class="inner">' + form('playground',
      '<div class="inline-grid">' + field(t('模型版本'), select('version', options, version.id, 'id="play-version"')) +
      field('Top-K', integer('topK', profile.topK ?? version.topK ?? 5, 0, 25)) + '</div>' +
      field(t('重跑方式'), select('mode', state.modelReady ? { llm: t('模型回放'), rules: t('规则预览') } : { rules: t('规则预览') }, profile.mode || (state.modelReady ? 'llm' : 'rules'))) +
      field(t('系统 Prompt'), textarea('prompt', profile.prompt || version.prompt, 'required rows="4"')) +
      ('<fieldset class="case-picks"><legend>' + t('选择对比用例') + '</legend>') + cases.map(item => '<label class="check"><input type="checkbox" name="ids" value="' +
        esc(item.id) + '"' + (selected.has(item.id) ? ' checked' : '') + '><span>' + esc(item.title) + '</span><small>' + esc(item.id) + '</small></label>').join('') +
      '</fieldset>', t('对比重跑')) + '</div></section>' +
    (result ? '<section class="card table-card">' + panelHead(t('输出对比'), (result.profile.mode === 'llm' ? t('模型回放') : t('规则预览')) + ' · ' + t('{count} 条案例', { count: result.comparisons.length }),
      btn(t('登记为候选版本'), 'plus', 'register-playground', 'primary')) + '<div class="inner stack">' +
      result.comparisons.map(item => '<article class="detail-box"><h3>' + esc(item.name) + ' · ' + esc(item.traceId) +
        ('</h3><p class="muted">' + t('召回片段') + ' ') + esc(item.documents.join(', ') || t('0 条')) + '</p>' + pre(item.input) +
        diffText(item.before, item.after) + '</article>').join('') + '</div></section>' : '') + '</div>';
}
