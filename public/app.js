import { isEnglish, serviceText, t } from './i18n.js';
import { I, esc, pct, btn, badge, table, box, alert } from './ui.js';
import { overview, chart, runTable } from './dashboard.js';
import * as pages from './pages.js';
import * as dialogs from './dialogs.js';
import * as extra from './enhancements.js';
import { workflow } from './workflow.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const nav = {
  overview: [t('闭环概览'), 'grid'], traces: [t('链路与反馈'), 'activity'], online: [t('线上抽检'), 'shield'], golden: [t('基准集'), 'database'],
  runs: [t('分层评测'), 'flask'], cases: [t('Bad Case 归因'), 'bug'], playground: [t('调试台'), 'bracket'], versions: [t('版本迭代'), 'split'], releases: [t('回归与灰度'), 'rocket']
};
const listPages = {
  traces: [pages.traceHeaders, pages.traceRows], golden: [pages.goldenHeaders, pages.goldenRows], cases: [pages.caseHeaders, pages.caseRows]
};
let state, activeRun, toastTimer, activeDataset, playDraft, playResult;
let q = '', filter = '', range = 0, tab = 'records';

const workflowPath = () => /\/workflow\/?$/.test(location.pathname);

const page = () => {
  const hash = location.hash.slice(1);
  if (Object.hasOwn(nav, hash)) return hash;
  return hash === 'workflow' || workflowPath() ? 'workflow' : 'overview';
};
function pagePath(key, english = isEnglish) {
  const base = english ? '/' : '/zh/';
  if (key === 'workflow') return base + 'workflow/';
  return key === 'overview' ? base : base + '#' + key;
}

function navHref(key) {
  return workflowPath() ? pagePath(key) : '#' + key;
}

const byId = (items, id) => items.find(item => item.id === id);

async function api(path, body) {
  const response = await fetch(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw Error(payload?.error ? serviceText(payload.error) : t('请求失败（HTTP {code}）。', { code: response.status }));
  return payload;
}

function navigation(route) {
  const links = keys => keys.map(key => {
    const [label, icon] = nav[key];
    return '<a href="' + navHref(key) + '" class="nav-link' + (route === key ? ' active" aria-current="page' : '') + '">' +
      I(icon) + '<span>' + label + '</span>' + (key === 'cases' ? '<span class="nav-count">' + state.cases.filter(v => v.status === 'open').length + '</span>' : '') + '</a>';
  }).join('');
  return ('<aside class="sidebar"><a class="brand" href="' + navHref('overview') + '" aria-label="' + t('飞轮 · 闭环概览') + '"><span class="brand-mark">') + I('orbit') +
    ('</span><div><div class="brand-name">' + t('飞轮') + '</div><div class="brand-sub">DATA FLYWHEEL</div></div></a>') +
    '<div class="workspace"><span class="workspace-icon">' + I('workspace') + ('</span><div><div class="workspace-title">' + t('模型评测工作台') + '</div><div class="workspace-sub">RAG · Prompt · Agent</div></div></div>') +
    ('<nav aria-label="' + t('主导航') + '"><div class="nav-group"><p class="nav-label">' + t('观测与评测') + '</p>') + links(['overview', 'traces', 'online', 'golden', 'runs']) +
    ('</div><div class="nav-group"><p class="nav-label">' + t('迭代与发布') + '</p>') + links(['cases', 'playground', 'versions', 'releases']) + '</div></nav>' +
    '<div class="side-bottom"><button class="nav-link" type="button" data-action="guide">' + I('help') + (t('接入指南') + '</button>') +
    '<button class="nav-link" type="button" data-action="settings">' + I('settings') + (t('发布门槛') + '</button>') +
    ('<div class="side-footer"><span class="dot"></span> ' + t('工作台在线') + '</div></div></aside><button class="overlay-mobile" type="button" data-action="menu" aria-label="' + t('关闭菜单') + '"></button>');
}

function languageSwitch() {
  const key = page();
  return '<div class="language-switch" role="group" aria-label="' + t('界面语言') + '">' +
    '<a href="' + pagePath(key, true) + '" lang="en" hreflang="en"' + (isEnglish ? ' aria-current="true"' : '') + '>EN</a>' +
    '<a href="' + pagePath(key, false) + '" lang="zh-CN" hreflang="zh-CN"' + (isEnglish ? '' : ' aria-current="true"') + '>中文</a></div>';
}

function render() {
  if (!state) return;
  const route = page();
  const guide = ('<button type="button" class="icon-button mobile-menu" aria-label="' + t('打开菜单') + '" data-action="menu">') + I('menu') + '</button>';
  const current = route === 'workflow'
    ? '<a class="link" href="' + pagePath('overview') + '">' + nav.overview[0] + '</a><span class="divider">/</span><strong>' + t('流程指南') + '</strong>'
    : '<strong>' + nav[route][0] + '</strong>';
  const header = '<header class="topbar"><div class="breadcrumb">' + guide + I('workspace') +
    '<span>' + t('工作台') + '</span><span class="divider">/</span>' + current + '</div><div class="top-actions">' +
    '<span class="environment"><span class="dot"></span>' + (state.modelReady ? t('模型已配置') : t('演示工作区')) + '</span>' + languageSwitch() +
    ('<button class="icon-button" type="button" data-action="activity" aria-label="' + t('查看近期动态') + '">') + I('bell') + (state.alerts.length ? '<span class="bell-dot"></span>' : '') + '</button>' +
    ('<button class="avatar" type="button" data-action="settings" aria-label="' + t('发布门槛设置') + '">' + t('飞') + '</button></div></header>');
  const body = { overview: () => overview(state, range, pagePath('workflow')), workflow: () => workflow(pagePath), traces: () => pages.traces(state, q, filter), golden: () => pages.golden(state, q, filter),
    runs: () => pages.runs(state, tab), cases: () => pages.cases(state, q, filter), online: () => extra.onlinePage(state), playground: () => extra.playgroundPage(state, playDraft, playResult),
    versions: () => pages.versions(state), releases: () => pages.releases(state) };
  app.innerHTML = '<div class="shell">' + navigation(route) + '<div class="content">' + header + '<main class="body">' + body[route]() + '</main></div></div>';
  chart(state, range);
}

async function refresh() {
  state = await api('/api/state');
  render();
}

function toast(message, error = false) {
  const target = document.querySelector('#toast');
  target.innerHTML = '<div class="toast">' + I(error ? 'info' : 'check') + esc(message) + '</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.replaceChildren(); }, 4500);
}

function refreshTable() {
  const info = listPages[page()];
  const el = document.querySelector('#table-region');
  if (info && el) el.innerHTML = table(info[0], info[1](state, q, filter));
}

const actions = {
  menu: () => document.querySelector('.shell')?.classList.toggle('menu-open'),
  close: () => dialog.close(),
  guide: dialogs.guide,
  settings: () => extra.fullGates(state),
  'fuse-config': () => extra.fuseConfig(state),
  'online-config': () => extra.onlineConfig(state),
  'judge-config': () => extra.judgeConfig(state),
  activity: () => dialogs.show(t('近期动态'), '<div class="stack">' + extra.alertsPanel(state, true) +
    box(t('最新评测'), runTable(state.runs.slice(0, 3), true)) + '</div>', t('回归评测与熔断告警'), true),
  'online-run': async key => {
    const jobs = await api('/api/online/run', { sample: key === 'sample' });
    await refresh();
    toast(jobs.length ? t('完成 {count} 条线上抽检', { count: jobs.length }) : t('没有已到期的新任务'));
  },
  'online-trace': async key => {
    const jobs = await api('/api/online/run', { traceId: key });
    await refresh();
    const job = jobs.find(item => item?.traceId === key) || state.onlineJobs.find(item => item.traceId === key);
    if (job?.caseId) dialogs.caseDetail(state, byId(state.cases, job.caseId));
    toast(job?.caseId ? t('发现静默失败，已归入 Bad Case') : job ? t('检查状态已更新') : t('这条链路暂不符合抽检条件'));
  },
  'cluster-refresh': async () => {
    const result = await api('/api/clusters', {});
    await refresh();
    toast((t('已生成') + ' ') + result.clusters.length + (' ' + t('个失败簇')));
  },
  'cluster-detail': key => extra.clusterDetail(state, byId(state.clusters, key)),
  'variants': async key => extra.variantsDialog(byId(state.cases, key), await api('/api/variants', { id: key })),
  'datasets': () => extra.datasetList(state),
  'dataset-detail': async key => {
    activeDataset = await api('/api/dataset?id=' + encodeURIComponent(key));
    extra.datasetDetails(activeDataset);
  },
  'snapshot-sample': key => dialogs.goldenDetail(byId(activeDataset.samples, key), true),
  'session-detail': async key => extra.sessionDialog(await api('/api/session?id=' + encodeURIComponent(key))),
  'add-golden': () => dialogs.addGolden(),
  'edit-golden': key => dialogs.addGolden(byId(state.golden, key)),
  'archive-golden': key => dialogs.show(t('移出活动基准'), '<div class="stack">' +
    alert(t('历史快照继续保留此用例。全量回归从下一版起跳过它，可在版本历史中恢复。')) +
    '<div class="actions">' + btn(t('移出用例'), '', 'confirm-archive-golden', 'danger', key) + '</div></div>'),
  'confirm-archive-golden': key => post('/api/golden/archive', { id: key }, t('用例已移出，基准集创建了新快照'), () => extra.datasetList(state)),
  'restore-golden': key => post('/api/golden/restore', { id: key }, t('已恢复到新的基准集快照'), () => extra.datasetList(state)),
  'judge-new': () => extra.judgeForm(state),
  'judge-detail': key => extra.judgeDetail(byId(state.judges, key)),
  'judge-activate': key => post('/api/judge/activate', { id: key }, t('裁判版本已启用'), () => {}),
  'open-playground': key => {
    const cluster = byId(state.clusters, key);
    playDraft = { ids: cluster ? cluster.ids.slice(0, 10) : [key] };
    playResult = null;
    dialog.close();
    if (page() === 'playground') render();
    else location.hash = 'playground';
  },
  'register-playground': () => dialogs.addVersion(state, playResult.profile),
  'download-curated': async key => {
    const response = await fetch('/api/export?target=' + encodeURIComponent(key));
    if (!response.ok) throw Error(serviceText((await response.json()).error));
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = href;
    link.download = key + '.jsonl';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    await refresh();
    toast((t('已导出') + ' ') + key + (' ' + t('数据')));
  },
  'curation-guide': () => dialogs.show(t('数据回流说明'), '<div class="stack">' +
    box(t('回归测试集'), ('<p>' + t('把经人工修正的样本加入后续全量评测，验证同类错误是否复发。') + '</p>')) +
    box(t('Few-shot 与知识库'), ('<p>' + t('将示例应用于 Prompt，或把修正后的知识补到检索库。') + '</p>')) +
    box(t('微调数据'), ('<p>' + t('SFT 导出用户与修正答案的消息对。DPO 导出输入、修正答案与原始失败答案。') + '</p>')) + '</div>'),
  'copy-code': async key => {
    const snippet = dialog.querySelector('.code pre').textContent;
    await navigator.clipboard.writeText(snippet);
    toast(t('已复制接入代码'));
  },
  range: key => { range = Number(key); render(); document.querySelector('[data-action="range"][data-id="' + range + '"]')?.focus(); },
  'run-tab': key => { tab = key; render(); document.querySelector('[data-action="run-tab"][data-id="' + key + '"]')?.focus(); },
  'add-trace': () => dialogs.addTrace(state),
  'trace-detail': key => dialogs.traceDetail(state, byId(state.traces, key)),
  'add-feedback': dialogs.addFeedback,
  'make-case': async key => {
    const item = await api('/api/case/create', { traceId: key });
    await refresh();
    dialogs.caseDetail(state, item);
    toast(t('已创建归因案例'));
  },
  'case-detail': key => dialogs.caseDetail(state, byId(state.cases, key)),
  'golden-detail': key => dialogs.goldenDetail(byId(state.golden, key)),
  'new-run': () => dialogs.newRun(state),
  'run-detail': async key => {
    activeRun = await api('/api/run?id=' + encodeURIComponent(key));
    dialogs.runDetail(activeRun);
  },
  'sample-detail': key => dialogs.sampleDetail(activeRun, byId(activeRun.rows, key)),
  'case-from-run': async key => {
    const item = await api('/api/case/from-run', { runId: activeRun.id, sampleId: key });
    await refresh();
    dialogs.caseDetail(state, item);
    toast(t('已归入 Bad Case'));
  },
  'pick-review': () => dialogs.pickReview(state),
  'review-detail': key => dialogs.reviewDetail(byId(state.reviews, key)),
  'add-version': () => dialogs.addVersion(state),
  'version-detail': key => dialogs.versionDetail(state, byId(state.versions, key)),
  'new-release': key => dialogs.newRelease(state, key),
  'release-detail': key => dialogs.releaseDetail(byId(state.releases, key)),
  route: () => dialogs.routeDialog()
};

for (const vote of ['A', 'B', 'tie']) {
  actions['vote-' + vote] = async key => {
    const result = await api('/api/review/vote', { id: key, vote });
    await refresh();
    dialogs.reviewDetail(result);
    toast(t('人工盲评已提交'));
  };
}

async function clickAction(event, target) {
  if (!target) return;
  const action = actions[target.dataset.action];
  if (!action) return;
  if (target.matches('button')) target.disabled = true;
  try { await action(target.dataset.id); }
  catch (error) { toast(error.message, true); }
  finally { if (target.matches('button')) target.disabled = false; }
}

document.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    return;
  }
  clickAction(event, event.target.closest('[data-action]'));
});
document.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || !event.target.matches('tr[data-action]')) return;
  event.preventDefault();
  clickAction(event, event.target);
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  q = event.target.value;
  refreshTable();
});
document.addEventListener('change', event => {
  if (event.target.id === 'play-version') {
    const version = byId(state.versions, event.target.value);
    const target = event.target.form;
    target.elements.prompt.value = version.prompt;
    target.elements.topK.value = version.topK ?? 5;
    return;
  }
  if (event.target.id !== 'filter') return;
  filter = event.target.value;
  refreshTable();
});
window.addEventListener('hashchange', () => {
  q = '';
  filter = '';
  if (dialog.open) dialog.close();
  render();
  window.scrollTo(0, 0);
});

const commaList = value => value.split(/[,，]/).map(v => v.trim()).filter(Boolean);
async function post(path, data, message, open) {
  const result = await api(path, data);
  await refresh();
  if (open) open(result);
  else dialog.close();
  toast(message);
}

const submissions = {
  'add-trace': fields => {
    const { type, retrieved, knowledge, turnIndex, ...details } = fields;
    const version = byId(state.versions, fields.version);
    return post('/api/demo-trace', { ...details, turnIndex: turnIndex === '' ? null : Number(turnIndex), prompt: version.prompt, model: version.model, latencyMs: 612,
      inputTokens: 210, outputTokens: 26, telemetry: { knowledgePresent: knowledge ? knowledge === 'yes' : null },
      context: retrieved ? [{ title: t('参考资料'), text: retrieved }] : [], feedback: type ? [{ type }] : []
    }, t('已写入链路'), result => dialogs.traceDetail(state, result));
  },
  'add-feedback': fields => post('/api/feedback', fields, t('反馈已保存'), result => dialogs.traceDetail(state, result)),
  'add-golden': fields => {
    let tool = null;
    if (fields.tool.trim()) {
      try { tool = JSON.parse(fields.tool); }
      catch { throw Error(t('工具调用断言需要合法 JSON。')); }
      if (!tool || typeof tool.name !== 'string') throw Error(t('工具调用断言需要 name 字段。'));
    }
    let turns = [];
    if (fields.turns.trim()) {
      try { turns = JSON.parse(fields.turns); }
      catch { throw Error(t('会话消息需要合法 JSON。')); }
      if (!Array.isArray(turns) || turns.some(turn => !['user', 'assistant'].includes(turn?.role) || !turn.content?.trim?.())) throw Error(t('会话消息需要包含 role 和 content。'));
    }
    const agent = fields.agentSteps || fields.agentRetries || fields.noLoop ? {
      steps: commaList(fields.agentSteps), maxRetries: fields.agentRetries === '' ? null : Number(fields.agentRetries), noLoop: fields.noLoop === 'on'
    } : null;
    return post('/api/golden', { ...fields, turns, agent, required: commaList(fields.required), forbidden: commaList(fields.forbidden),
      maxLength: Number(fields.maxLength) || null, json: fields.json === 'on', critical: fields.critical === 'on', tool
    }, t('基准样本已保存'), dialogs.goldenDetail);
  },
  'update-case': fields => {
    const curate = fields.intent === 'curate';
    return post('/api/case', { ...fields, curate, critical: fields.critical === 'on' }, curate ? t('已完成数据回流') : t('归因已保存'), result => dialogs.caseDetail(state, result));
  },
  run: fields => post('/api/regression', fields, t('回归评测完成'), run => {
    activeRun = run;
    dialogs.runDetail(run);
  }),
  'pick-review': fields => post('/api/review', fields, t('已抽取盲评样本'), dialogs.reviewDetail),
  'add-version': fields => post('/api/version', { ...fields, topK: fields.topK === '' ? null : Number(fields.topK) }, t('版本已登记'), result => dialogs.versionDetail(state, result)),
  settings: fields => post('/api/config', Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === '' ? null : Number(value)])), t('发布门槛已更新')),
  'online-config': fields => post('/api/config', { online: {
    sampleRate: Number(fields.sampleRate), settleMinutes: Number(fields.settleMinutes), clusterEvery: Number(fields.clusterEvery), judgeMode: fields.judgeMode
  } }, t('抽检设置已更新')),
  'judge-config': fields => post('/api/config', { calibrationThreshold: Number(fields.calibrationThreshold), calibrationMin: Number(fields.calibrationMin) }, t('一致率门槛已保存')),
  'judge-new': fields => post('/api/judge', { ...fields, activate: fields.activate === 'on' }, t('裁判版本已登记'), extra.judgeDetail),
  'fuse-config': fields => post('/api/config', { fuse: Object.fromEntries(Object.entries({
    ...fields, enabled: fields.enabled === 'on'
  }).map(([key, value]) => [key, key === 'enabled' ? value : Number(value)])) }, t('自动熔断设置已保存')),
  'session-golden': fields => post('/api/golden/session', { ...fields, critical: fields.critical === 'on' }, t('会话用例已保存'), dialogs.goldenDetail),
  'save-variants': fields => {
    const drafts = Object.keys(fields).filter(key => key.startsWith('variant')).map(key => ({
      text: fields[key], type: fields['type' + key.replace('variant', '')]
    }));
    return post('/api/variants/save', { id: fields.id, variants: drafts, critical: fields.critical === 'on' },
      t('变体已加入新的基准集快照'), result => {
        activeDataset = { ...result.dataset, samples: state.golden };
        extra.datasetDetails(activeDataset);
      });
  },
  playground: async (fields, values) => {
    const ids = values.getAll('ids');
    if (!ids.length || ids.length > 10) throw Error(t('请选择 1–10 条案例。'));
    const pending = { ...fields, ids, topK: Number(fields.topK) };
    playResult = await api('/api/playground', pending);
    playDraft = pending;
    render();
    document.querySelector('[data-action="register-playground"]')?.focus();
    toast((t('已完成') + ' ') + playResult.comparisons.length + (' ' + t('条重跑')));
  },
  'new-release': fields => post('/api/release', { runId: fields.runId, percent: Number(fields.percent) }, t('灰度已启动'), result => dialogs.releaseDetail(byId(state.releases, result.id))),
  'update-release': fields => {
    const message = { rollback: t('灰度已回滚'), promote: t('已全量发布') }[fields.intent] || t('流量比例已更新');
    return post('/api/release/update', { id: fields.id, action: fields.intent, percent: Number(fields.percent) }, message, result => dialogs.releaseDetail(byId(state.releases, result.id)));
  },
  route: async fields => dialogs.routeDialog(await api('/api/route?userKey=' + encodeURIComponent(fields.userKey)), fields.userKey)
};

document.addEventListener('submit', async event => {
  const target = event.target;
  if (!target.dataset.form) return;
  event.preventDefault();
  const handler = submissions[target.dataset.form];
  if (!handler) return;
  const elements = [...target.querySelectorAll('button[type="submit"]')];
  const values = new FormData(target, event.submitter);
  const fields = Object.fromEntries(values);
  const errorMessage = target.querySelector('.form-error');
  errorMessage.textContent = '';
  const original = event.submitter?.textContent;
  if (event.submitter) event.submitter.textContent = t('处理中…');
  for (const item of elements) item.disabled = true;
  try { await handler(fields, values); }
  catch (error) { errorMessage.textContent = error.message; }
  finally {
    for (const item of elements) item.disabled = false;
    if (event.submitter) event.submitter.textContent = original;
  }
});

refresh().catch(error => {
  app.innerHTML = ('<div class="initial"><h2>' + t('工作台加载失败') + '</h2>') + alert(error.message, 'fail') +
    ('<button class="button" type="button" id="retry">' + t('重试') + '</button></div>');
  document.querySelector('#retry').addEventListener('click', () => location.reload());
});
