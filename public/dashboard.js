import { t } from './i18n.js';
import { I, esc, fmt, pct, time, btn, badge, actionLink, title, panelHead, table, row, mono, gateBadge } from './ui.js';

export function runRows(runs, short = false) {
  return runs.map(run => row([
    mono(run.id), mono(run.candidate), mono(run.baseline), '<span class="num">' + fmt(run.count) + '</span>',
    '<span class="num emphasis">' + pct(run.pass) + '</span>',
    ...(short ? [] : [fmt(run.incomplete?.baseline ?? 0) + ' / ' + fmt(run.incomplete?.candidate ?? 0), mono(run.datasetVersion || '—'), run.judgeMode === 'llm' ? badge([run.judgeModel || t('模型标识未记录'), run.judgeVersion].filter(Boolean).join(' · '), 'info', false) : badge(t('演示评分'), '', false)]),
    gateBadge(run.passed), '<span class="num quiet">' + time(run.createdAt) + '</span>',
    ('<button aria-label="' + t('查看') + ' ') + esc(run.id) + '" type="button" class="icon-button" data-action="run-detail" data-id="' + esc(run.id) + '">' + I('chevron') + '</button>'
  ], 'run-detail', run.id)).join('');
}

const runHeaders = [t('运行编号'), t('候选版本'), t('基线版本'), t('样本数'), t('通过率')];
export const runTable = (runs, short = false) => table([...runHeaders, ...(short ? [] : [t('未完成用例（基线 / 候选）'), t('基准快照'), t('裁判')]), t('发布卡点'), t('运行时间'), ''], runRows(runs, short));

function metric(label, tone, icon, value, meta, href) {
  return '<a class="card metric" href="#' + href + '"><div class="metric-top"><span class="metric-icon ' + tone + '">' + I(icon) + '</span>' + label + '</div><div class="metric-value">' + esc(value) + '</div><div class="metric-meta">' + meta + '</div></a>';
}

function step(label, tone, icon, summary, status, dest) {
  return '<a href="#' + dest + '" class="step"><span class="step-icon ' + tone + '">' + I(icon) + '</span><div><div class="step-title">' + label + '</div><p class="step-sub">' + summary + '</p></div>' + (status || '<span class="step-arrow">' + I('chevron') + '</span>') + '</a>';
}

export function overview(state, range, workflowHref) {
  const last = state.runs[0];
  const pending = state.cases.filter(item => item.status === 'open').length;
  const rounds = state.runs.length;
  const collected = state.sampleTrend.reduce((n, v) => n + v.traffic, 0) + state.traces.filter(t => !t.demo).length;
  const curated = state.cases.filter(item => item.status === 'curated').length;
  const active = state.releases.find(rel => rel.status === 'canary');
  const delta = last ? Math.round((last.pass - last.baselinePass) * 10) / 10 : 0;
  return title(t('闭环概览'), t('追踪模型表现，从真实交互中发现并修复问题。'),
    btn(t('接入采集'), 'bracket', 'guide') + btn(t('运行评测'), 'play', 'new-run', 'primary')) +
    '<div class="metrics">' +
      metric(t('累计采集链路'), 'blue', 'activity', fmt(collected), ('<span>' + t('含') + ' ') + fmt(state.sampleTrend.reduce((n, v) => n + v.traffic, 0)) + (' ' + t('条演示汇总') + '</span>'), 'traces') +
      metric(t('基准用例'), 'purple', 'database', fmt(state.golden.length), ('<span>' + t('其中') + ' ') + state.golden.filter(v => v.critical).length + (' ' + t('条关键用例') + '</span>'), 'golden') +
      metric(t('最新评测通过率'), 'coral', 'flask', pct(last?.pass), (last ? '<span class="metric-up ' + (delta < 0 ? 'down' : '') + '">' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + (' pp</span><span>' + t('对比基线') + '</span>') : ''), 'runs') +
      metric(t('待归因 Bad Case'), 'amber', 'bug', fmt(pending), ('<span>' + t('已回流') + ' ') + curated + (' ' + t('条样本') + '</span>'), 'cases') +
    '</div>' +
    '<div class="grid-main"><section class="card">' + panelHead(t('评测质量趋势'), t('近期评测通过率与忠实度'), ('<div class="segmented" aria-label="' + t('趋势指标') + '">') +
      [t('趋势'), t('同口径批次')].map((label, i) => '<button aria-pressed="' + (range === i) + '" class="' + (range === i ? 'active' : '') + '" type="button" data-action="range" data-id="' + i + '">' + label + '</button>').join('') +
    '</div>') + ('<div class="chart-wrap"><canvas id="quality" class="chart" role="img" aria-label="' + t('通过率与忠实度折线图') + '"></canvas><div id="chart-tip" class="chart-tooltip" hidden></div></div><div class="legend"><span><i class="dot" style="background:#d85a4b"></i>' + t('通过率') + '</span><span><i class="dot" style="background:#8c78c8"></i>' + t('忠实度') + '</span><span class="quiet">') + (range === 0 ? t('演示历史') : t('同一基准快照和裁判配置')) + '</span></div></section>' +
    '<section class="card">' + panelHead(t('数据闭环'), '',
      '<a class="link" href="' + esc(workflowHref) + '">' + t('流程指南') + I('chevron') + '</a>') + '<div class="workflow">' +
      step(t('链路与反馈'), 'blue', 'activity', t('记录交互、检索与工具轨迹'), badge(t('异步抽检'), 'ok'), 'online') +
      step(t('基准集与评测'), 'purple', 'flask', rounds + (' ' + t('次回归运行')), '', 'runs') +
      step(t('归因与回流'), 'amber', 'bug', pending + (' ' + t('个案例待处理')), '', 'cases') +
      step(t('版本迭代'), 'coral', 'split', t('Prompt、RAG 与模型版本'), '', 'versions') +
      step(t('回归与灰度'), 'green', 'rocket', (t('当前基线') + ' ') + esc(state.config.baseline), active ? badge(active.percent + t('% 灰度'), 'warn') : '', 'releases') +
    '</div></section></div>' +
    '<section class="card table-card">' + panelHead(t('最近评测'), t('比较候选与基线的回归结果'), ('<a class="link" href="#runs">' + t('全部评测')) + I('arrow') + '</a>') + runTable(state.runs.slice(0, 4), true) + '</section>';
}

const series = [{ key: 'pass', color: '#d85a4b' }, { key: 'faith', color: '#8c78c8' }];
let observer;

function curve(ctx, pts) {
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const prev = pts[Math.max(0, i - 1)], a = pts[i], b = pts[i + 1], next = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(a.x + (b.x - prev.x) / 6, a.y + (b.y - prev.y) / 6, b.x - (next.x - a.x) / 6, b.y - (next.y - a.y) / 6, b.x, b.y);
  }
}

export function chart(state, range) {
  observer?.disconnect();
  const canvas = document.querySelector('#quality');
  if (!canvas) return;
  const tip = document.querySelector('#chart-tip');
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
  const completed = state.runs.filter(run => !run.incomplete?.baseline && !run.incomplete?.candidate);
  const latest = completed[0];
  const comparable = run => run === latest || (latest.datasetVersion && run.datasetVersion === latest.datasetVersion &&
    run.demo === latest.demo && run.judgeMode === latest.judgeMode &&
    run.gateConfig?.criticalRepeats === latest.gateConfig?.criticalRepeats &&
    run.gateConfig?.stabilityVariance === latest.gateConfig?.stabilityVariance &&
    (run.judgeMode !== 'llm' || (latest.judgeModel && latest.judgeVersion &&
      run.judgeModel === latest.judgeModel && run.judgeVersion === latest.judgeVersion)));
  const points = range === 0 ? state.sampleTrend : completed.filter(comparable).slice(0, 8).reverse()
    .map(r => ({ label: formatter.format(new Date(r.createdAt)), pass: r.pass, faith: r.faith, id: r.id }));
  canvas.setAttribute('aria-label', points.map(p => p.label + (' ' + t('通过率') + ' ') + pct(p.pass) + (t('，忠实度') + ' ') + pct(p.faith)).join('；'));
  const ctx = canvas.getContext('2d');
  let mouse = null;
  function draw() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || !points.length) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    ctx.scale(scale, scale);
    const left = 41, right = width - 13, top = 17, bottom = height - 29;
    const min = range === 0 ? 60 : Math.min(60, ...points.flatMap(p => [p.pass, p.faith].filter(v => v != null)));
    const x = i => points.length < 2 ? (left + right) / 2 : left + i * (right - left) / (points.length - 1);
    const y = value => bottom - (value - min) * (bottom - top) / (100 - min);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#778293';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let i = 0; i < 5; i++) {
      const value = min + (100 - min) * (i / 4);
      ctx.beginPath();
      ctx.strokeStyle = '#e9edf2';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
      ctx.fillText(Math.round(value) + '%', left - 7, y(value));
    }
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    points.forEach((p, i) => {
      if (points.length > 5 && width < 420 && i % 2 && i !== points.length - 1) return;
      ctx.fillText(p.label, x(i), bottom + 17);
    });
    const index = mouse == null ? -1 : points.reduce((best, _, i) => Math.abs(mouse - x(i)) < Math.abs(mouse - x(best)) ? i : best, 0);
    if (index >= 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#cdd2dc';
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x(index), top);
      ctx.lineTo(x(index), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const { key, color } of series) {
      const values = points.map((p, i) => ({ x: x(i), y: p[key] == null ? null : y(p[key]), i })).filter(p => p.y != null);
      if (!values.length) continue;
      if (key === 'pass' && values.length > 1) {
        const fill = ctx.createLinearGradient(0, top, 0, bottom);
        fill.addColorStop(0, '#ed92851e');
        fill.addColorStop(1, '#ed928503');
        ctx.beginPath();
        curve(ctx, values);
        ctx.lineTo(values.at(-1).x, bottom);
        ctx.lineTo(values[0].x, bottom);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.beginPath();
      curve(ctx, values);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const point of values) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.i === index ? 4 : 2.6, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = 1.7;
        ctx.stroke();
      }
    }
    tip.hidden = index < 0;
    if (index >= 0) {
      const p = points[index];
      tip.innerHTML = '<strong>' + esc(p.id || p.label) + ('</strong><br>' + t('通过率') + ' ') + pct(p.pass) + ('<br>' + t('忠实度') + ' ') + pct(p.faith);
      tip.style.left = Math.max(4, Math.min(width - 119, x(index) + 9)) + 'px';
      tip.style.top = '10px';
    }
  }
  observer = new ResizeObserver(draw);
  observer.observe(canvas);
  canvas.addEventListener('pointermove', event => { mouse = event.offsetX; draw(); });
  canvas.addEventListener('pointerleave', () => { mouse = null; draw(); });
  draw();
}
