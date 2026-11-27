import { t } from './i18n.js';
import {
  I, esc, pct, fmt, time, btn, badge, title, panelHead, table, row, mono, gateBadge, tagKind, search, select,
  feedbackLabels, caseLabels, releaseLabels, targets, roots, hrefBtn, actionLink, field, input, form, alert
} from './ui.js';
import { runTable } from './dashboard.js';
import { alertsPanel, clustersPanel, judgePanel, releaseSignals } from './enhancements.js';

const caseBadge = status => badge(...caseLabels[status]);
const releaseBadge = status => badge(...releaseLabels[status]);
const label = value => '<span class="table-name">' + esc(value) + '</span>';
const filterMenu = (options, chosen) => ('<label><span class="sr-only">' + t('筛选记录') + '</span>') + select('filter', options, chosen, 'id="filter"') + '</label>';
const toolbar = (q, hint, options, f) => '<div class="toolbar">' + search(q, hint) + filterMenu(options, f) + '</div>';
const match = (q, ...columns) => columns.some(v => String(v || '').toLowerCase().includes(q.trim().toLowerCase()));
const tableRegion = (headers, rows) => '<div id="table-region">' + table(headers, rows) + '</div>';

export function traceRows(state, q, f) {
  return state.traces.filter(t => (!f || (f === 'flagged' ? t.feedback.some(s => ['dislike', 'regenerate', 'correction', 'abandon'].includes(s.type)) : t.kind === f)) &&
    match(q, t.id, t.name, t.input, t.version, t.model, t.sessionId)).map(t => row([
    mono(t.id), label(t.name), tagKind(t.kind), mono(t.version), t.sessionId ? '<button type="button" class="link" data-action="session-detail" data-id="' + esc(t.sessionId) + '">' + esc(t.sessionId) + '</button>' : '—', t.feedback.length ?
      badge(feedbackLabels[t.feedback.at(-1).type], ['dislike', 'abandon'].includes(t.feedback.at(-1).type) ? 'fail' : 'info', false) : '—',
    fmt(t.latencyMs) + ' ms', fmt(t.inputTokens + t.outputTokens), time(t.createdAt)
  ], 'trace-detail', t.id)).join('');
}
export const traceHeaders = [t('链路编号'), t('交互场景'), t('类型'), t('版本'), 'Session', t('最新反馈'), t('延迟'), 'Token', t('记录时间')];
export function traces(state, q, f) {
  return title(t('链路与反馈'), t('查看输入、系统 Prompt、检索片段、工具轨迹和用户反馈。'), btn(t('模拟采集'), 'plus', 'add-trace') + btn(t('接入采集'), 'bracket', 'guide', 'primary')) +
    '<section class="card">' + toolbar(q, t('搜索编号、场景、版本或 Session'), { '': t('全部链路'), rag: 'RAG', prompt: 'Prompt', agent: 'Agent', flagged: t('有负向信号') }, f) + tableRegion(traceHeaders, traceRows(state, q, f)) + '</section>';
}

export function goldenRows(state, q, f) {
  return state.golden.filter(s => (!f || (f === 'critical' ? s.critical : s.group === f)) && match(q, s.id, s.name, s.input)).map(s => row([
    mono(s.id), label(s.name), tagKind(s.kind), esc(t(s.group)), s.critical ? badge(t('关键用例'), 'warn', false) : '—',
    s.traceId ? mono(s.traceId) : '—', time(s.createdAt)
  ], 'golden-detail', s.id)).join('');
}
export const goldenHeaders = [t('样本编号'), t('测试用例'), t('类型'), t('分层'), t('优先级'), t('来源链路'), t('创建时间')];
export function golden(state, q, f) {
  return title(t('基准集'), (t('当前快照') + ' ') + state.datasetVersion + (' ' + t('· 维护核心场景、边界用例和历史回归样本。')), btn(t('版本历史'), 'layers', 'datasets') + hrefBtn(t('导出 JSONL'), 'download', '/api/export?target=regression') + btn(t('添加样本'), 'plus', 'add-golden', 'primary')) +
    '<section class="card">' + toolbar(q, t('搜索用例、编号或输入'), { '': t('全部分层'), 核心场景: t('核心场景'), 边界用例: t('边界用例'), 历史回归: t('历史回归'), critical: t('关键用例') }, f) +
    tableRegion(goldenHeaders, goldenRows(state, q, f)) + '</section>';
}

export function caseRows(state, q, f) {
  return state.cases.filter(c => (!f || (f === 'online' ? c.source === 'online' : f.startsWith('group:') ?
    state.clusters.find(group => 'group:' + group.id === f)?.ids.includes(c.id) : c.status === f)) && match(q, c.title, c.cause, t(c.cause), c.traceId, c.id)).map(c => row([
    mono(c.id), label(c.title) + (c.source === 'online' ? ' ' + badge(t('抽检'), 'info', false) : ''), mono(c.traceId), esc(t(c.cause)), caseBadge(c.status), esc(targets[c.target]), time(c.createdAt)
  ], 'case-detail', c.id)).join('');
}
export const caseHeaders = [t('案例编号'), t('问题场景'), t('来源链路'), t('根因'), t('处理状态'), t('回流目标'), t('记录时间')];
export function cases(state, q, f) {
  const counts = roots.map(cause => [cause, state.cases.filter(c => c.cause === cause).length]);
  const total = Math.max(1, ...counts.map(([, n]) => n));
  const curation = Object.entries(targets).map(([key, targetLabel]) => '<div><span>' + esc(targetLabel) + '</span><span>' +
    (key === 'regression' ? state.golden.length : state.cases.filter(c => c.target === key && c.status === 'curated').length) +
    (' · <button type="button" class="link" data-action="download-curated" data-id="') + esc(key) + '">' + t('导出') + '</button></span></div>').join('');
  return title(t('Bad Case 归因'), t('核实失败根因，修正脱敏后回流到评测集或迭代数据。'), btn(t('查看回流说明'), 'info', 'curation-guide')) +
    '<div class="stack"><div class="inline-grid"><section class="card">' + panelHead(t('根因分布'), state.cases.length + (' ' + t('条案例'))) +
    '<div class="inner">' + counts.map(([cause, n]) => '<div class="cause-bar"><span>' + esc(t(cause)) + '</span><span class="track"><i style="width:' + n / total * 100 + '%"></i></span><strong>' + n + '</strong></div>').join('') +
    '</div></section><section class="card">' + panelHead(t('回流库存'), t('脱敏 JSONL · 训练导出与活动评测基准互斥')) + '<div class="inner detail-list">' + curation + '</div></section></div>' +
    clustersPanel(state) + '<section class="card">' + toolbar(q, t('搜索案例、链路或根因'),
      { '': t('全部案例'), open: t('待归因'), confirmed: t('已确认'), curated: t('已回流'), online: t('线上抽检'),
        ...Object.fromEntries(state.clusters.slice(0, 8).map(group => ['group:' + group.id, group.title])) }, f) +
    tableRegion(caseHeaders, caseRows(state, q, f)) + '</section></div>';
}

function tabs(active) {
  return '<div class="tabs" role="tablist">' + [['records',t('运行记录')],['review',t('人工校准')]].map(([key, text]) =>
    '<button type="button" role="tab" aria-selected="' + (active === key) + '" class="' + (active === key ? 'active' : '') + '" data-action="run-tab" data-id="' + key + '">' + text + '</button>').join('') + '</div>';
}

export function runs(state, tab) {
  const heading = title(t('分层评测'), t('用规则校验筛除确定性错误，再进行裁判评分与人工盲评。'), btn(t('运行评测'), 'play', 'new-run', 'primary'));
  if (tab !== 'review') return heading + tabs(tab) + '<section class="card table-card">' + panelHead(t('运行记录'), t('点击批次查看逐样本指标、规则结果和发布卡点')) + runTable(state.runs) + '</section>';
  const results = [[t('模型裁判'), state.agreement], [t('演示评分'), state.demoAgreement]].map(([mode, a]) => '<section class="card inner"><h3>' + mode +
    ('</h3><p>' + t('已校准') + ' ') + a.n + (' ' + t('条 · 观察一致率') + ' ') + (a.observed == null ? '—' : a.observed + '%') + ' · Cohen’s κ ' +
    (a.kappa == null ? '—' : a.kappa.toFixed(2)) + '</p></section>').join('');
  return heading + tabs(tab) + '<div class="stack"><div class="inline-grid">' + results + '</div>' + judgePanel(state) + '<section class="card table-card">' +
    panelHead(t('A/B 盲评'), t('对通过规则层且输出不同的双裁判样本随机换序'), btn(t('抽取样本'), 'split', 'pick-review', 'primary')) +
    table([t('盲评编号'), t('评测批次'), t('状态'), t('人类选择'), t('裁判选择'), t('时间')], state.reviews.map(v => row([
      mono(v.id), mono(v.runId), v.human ? badge(t('已提交'), 'ok') : badge(t('待评审'), 'warn'), esc(v.human || '—'),
      esc(v.judge || '—'), time(v.createdAt)
    ], 'review-detail', v.id)).join(''), t('还没有盲评记录。')) + '</section></div>';
}

export function versions(state) {
  return title(t('版本迭代'), t('登记 Prompt、检索策略和微调模型对应的评测版本。'), '<a href="#playground" class="button">' + I('play') + (t('打开调试台') + '</a>') + btn(t('登记版本'), 'plus', 'add-version', 'primary')) +
    '<div class="stack"><section class="card table-card">' + panelHead(t('版本库'), (t('当前生产基线') + ' ') + state.config.baseline) +
    table([t('版本标识'), t('版本名称'), t('策略'), t('模型'), t('状态')], state.versions.map(v => row([
      mono(v.id), label(t(v.name)), badge(v.strategy, 'info', false), mono(v.model), state.config.baseline === v.id ? badge(t('生产基线'), 'ok') : badge(v.mode === 'demo' ? t('演示版本') : t('已登记'), '', false)
    ], 'version-detail', v.id)).join('')) + '</section><section class="card">' + panelHead(t('迭代顺序'), t('根据归因选择修改成本最低的策略')) +
    ('<div class="inner detail-list"><div><strong>' + t('Prompt 与上下文') + '</strong><span>' + t('收敛歧义、补充约束与 Few-shot 示例') + '</span></div><div><strong>' + t('RAG 检索') + '</strong><span>' + t('补齐知识、验证切分与召回，再调整重排') + '</span></div><div><strong>' + t('模型微调') + '</strong><span>' + t('导出 SFT 或 DPO 数据，登记训练后的模型版本') + '</span></div></div></section></div>');
}

export function releases(state) {
  const live = state.releases.find(r => r.status === 'canary');
  const options = state.eligibleRuns;
  const traffic = [state.config.baseline, ...(live ? [live.version] : [])].filter((v, i, a) => a.indexOf(v) === i).map(version => {
    const ts = state.traces.filter(t => t.version === version && (!live || t.createdAt >= live.createdAt));
    const relevant = ts.filter(t => t.feedback.length);
    const up = ts.filter(t => t.feedback.some(s => ['adopt', 'like'].includes(s.type))).length;
    const down = ts.filter(t => t.feedback.some(s => ['dislike', 'correction', 'abandon', 'regenerate'].includes(s.type))).length;
    const adopt = ts.filter(t => t.feedback.some(s => s.type === 'adopt')).length;
    return row([mono(version), fmt(ts.length), fmt(relevant.length), fmt(up), fmt(down), ts.length ? pct(adopt / ts.length * 100) : '—']);
  }).join('');
  return title(t('回归与灰度'), t('使用全量回归结果控制发布，按版本观察线上反馈。'), btn(t('发布门槛'), 'settings', 'settings') + btn(t('自动熔断'), 'shield', 'fuse-config') + (live ? btn(t('管理灰度'), 'rocket', 'release-detail', 'primary', live.id) : btn(t('创建灰度'), 'rocket', 'new-release', 'primary'))) +
    ('<div class="stack"><div class="inline-grid"><section class="card inner"><h3>' + t('当前基线') + '</h3><div class="metric-value">') + esc(state.config.baseline) + ('</div><p>' + t('候选通过率 ≥') + ' ') + state.config.minPass + (t('% · 关键失败修复率 ≥') + ' ') + state.config.minCritical + '%</p></section>' +
    ('<section class="card inner"><h3>' + t('灰度流量') + '</h3><div class="metric-value">') + (live ? live.percent + '%' : '0%') + '</div><p>' +
    (live ? esc(live.version) + (' ' + t('· 基线') + ' ') + esc(live.baseline) + (live.demo ? (' ' + t('· 演示运行')) : '') : options.length + (' ' + t('个评测批次满足发布条件'))) + '</p></section></div>' +
    '<section class="card table-card">' + panelHead(t('观测信号'), live ? t('灰度开始后按版本汇总') : t('当前基线的全部可查链路'), btn(t('验证路由'), 'split', 'route')) +
    table([t('版本'), t('采集链路'), t('含反馈'), t('正向信号'), t('负向信号'), t('采纳率')], traffic) + '</section>' +
    (live ? '<section class="card inner">' + releaseSignals(live) + '</section>' : '') +
    alertsPanel(state) +
    '<section class="card table-card">' + panelHead(t('发布历史'), t('灰度、全量与回滚状态')) +
    table([t('发布编号'), t('版本'), t('基线'), t('流量占比'), t('状态'), t('更新时间')], state.releases.map(r => row([
      mono(r.id), mono(r.version), mono(r.baseline), r.percent + '%', releaseBadge(r.status), time(r.updatedAt)
    ], 'release-detail', r.id)).join('')) + '</section></div>';
}
