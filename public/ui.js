import { numberLocale, t } from './i18n.js';
const glyphs = {
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 8.5 6M21 12a9 9 0 0 1-6 8.5M12 21a9 9 0 0 1-8.5-6M3 12a9 9 0 0 1 6-8.5"/><path d="m18 6 2.5 3 1-4M18 18l-3 2.5 4 1M6 18l-2.5-3-1 4M6 6l3-2.5-4-1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  flask: '<path d="M9 3h6M10 3v6l-6.5 9.5A1.6 1.6 0 0 0 4.8 21h14.4a1.6 1.6 0 0 0 1.3-2.5L14 9V3M7 15h10"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M9 7V6a3 3 0 0 1 6 0v1M3 9l4 2M3 15h4m-3 6 4-3M21 9l-4 2m4 4h-4m3 6-4-3M12 11v5"/>',
  rocket: '<path d="M4 16c-1.5 1.3-2 5-2 5s3.7-.5 5-2M12 15l-3-3c2.5-6 6-9.5 12-9.5 0 6-3.5 9.5-9 12.5ZM9 12H4l2-4 6-1m0 8v5l4-2 1-6"/><circle cx="16.5" cy="7.5" r="1"/>',
  settings: '<path d="M10 3h4l.6 2.4 2 .9 2.2-1.2 2.1 2.1-1.2 2.2.9 2 2.4.6v3l-2.4.6-.9 2 1.2 2.2-2.1 2.1-2.2-1.2-2 .9L14 23h-4l-.6-2.4-2-.9-2.2 1.2-2.1-2.1 1.2-2.2-.9-2L1 14v-3l2.4-.6.9-2-1.2-2.2 2.1-2.1 2.2 1.2 2-.9L10 3Z" transform="translate(1 0) scale(.91)"/><circle cx="12" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9a2.8 2.8 0 0 1 5.4.8c0 2-2.7 2.2-2.7 4m0 3h.01"/>',
  workspace: '<path d="m3 7 9-4 9 4v12l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v12"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  bracket: '<path d="M8 6 2 12l6 6m8-12 6 6-6 6m-2-15-4 18"/>',
  play: '<path d="M6 4.5v15l14-7.5-14-7.5Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  trend: '<path d="m3 17 6-6 4 4 7-8m-5 0h5v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  split: '<path d="M6 3v12a4 4 0 0 0 4 4h8m-4-4 4 4-4 4M6 8h8l4-4m-4 0h4v4"/>',
  shield: '<path d="M12 3 4 6v5c0 4 3 8 8 10 5-2 8-6 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'
};

export const I = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (glyphs[name] || glyphs.info) + '</svg>';
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const pct = value => value == null ? '—' : Number(value).toFixed(1) + '%';
export const fmt = value => new Intl.NumberFormat(numberLocale).format(value);
export const time = value => !value ? '—' : new Intl.DateTimeFormat(numberLocale, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)).replace(',', '');
export const compactTime = value => !value ? '—' : new Intl.DateTimeFormat(numberLocale, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
export const labelKind = kind => ({ rag: 'RAG', prompt: 'Prompt', agent: 'Agent' })[kind] || kind;
export const tagKind = kind => '<span class="tag ' + esc(kind) + '">' + esc(labelKind(kind)) + '</span>';
export const badge = (text, style = '', dot = true) => '<span class="status ' + style + '">' + (dot ? '<i class="dot"></i>' : '') + esc(text) + '</span>';
export const gateBadge = passed => passed ? badge(t('通过'), 'ok') : badge(t('未通过'), 'fail');
export const feedbackLabels = { like: t('点赞'), dislike: t('点踩'), correction: t('纠错'), annotation: t('人工标注'), regenerate: t('重新生成'), copy: t('复制'), adopt: t('采纳'), abandon: t('异常中断') };
export const caseLabels = { open: [t('待归因'), 'warn'], confirmed: [t('已确认'), 'info'], curated: [t('已回流'), 'ok'] };
export const releaseLabels = { canary: [t('灰度中'), 'warn'], promoted: [t('已发布'), 'ok'], rolledback: [t('已回滚'), 'fail'] };
export const targets = { regression: t('回归测试集'), 'few-shot': t('Few-shot 示例'), knowledge: t('知识库补丁'), sft: t('SFT 数据集'), dpo: t('DPO 偏好数据集') };
export const roots = ['知识库缺失', '检索未召回', 'Prompt 歧义', '模型推理不足', '工具参数错误', '待确认'];
export const opts = (options, selected) => Object.entries(options).map(([value, label]) => '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
export const btn = (label, icon, action, variant = '', key = '') => '<button type="button" class="button ' + variant + '" data-action="' + action + '" data-id="' + esc(key) + '">' + (icon ? I(icon) : '') + esc(label) + '</button>';
export const actionLink = (label, action, key = '') => '<button type="button" class="link" data-action="' + action + '" data-id="' + esc(key) + '">' + esc(label) + I('arrow') + '</button>';
export const hrefBtn = (label, icon, url) => '<a class="button" href="' + esc(url) + '">' + I(icon) + esc(label) + '</a>';
export const title = (heading, text, actions = '') => '<div class="pagehead"><div><h1>' + esc(heading) + '</h1><p>' + esc(text) + '</p></div><div class="actions">' + actions + '</div></div>';
export const panelHead = (heading, text = '', right = '') => '<div class="card-head"><div><h2>' + esc(heading) + '</h2>' + (text ? '<p>' + esc(text) + '</p>' : '') + '</div>' + right + '</div>';
export const tbody = (cols, rows, placeholder = t('暂无匹配记录')) => rows || '<tr><td class="empty" colspan="' + cols + '">' + esc(placeholder) + '</td></tr>';
export const table = (headers, rows, placeholder) => '<div class="table-scroll"><table><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + tbody(headers.length, rows, placeholder) + '</tbody></table></div>';
export const row = (cells, action, key) => '<tr' + (action ? ' tabindex="0" data-action="' + action + '" data-id="' + esc(key) + '"' : '') + '>' + cells.map(cell => '<td>' + cell + '</td>').join('') + '</tr>';
export const mono = value => '<span class="table-id">' + esc(value) + '</span>';
export const box = (heading, display) => '<section class="detail-box"><h3>' + esc(heading) + '</h3>' + display + '</section>';
export const pre = value => '<pre>' + esc(value || '—') + '</pre>';
export const alert = (content, style = '') => '<p class="note ' + style + '">' + esc(content) + '</p>';
export const field = (label, control, help) => '<label class="field"><span>' + esc(label) + '</span>' + control + (help ? '<small>' + esc(help) + '</small>' : '') + '</label>';
export const input = (name, value = '', attrs = '') => '<input name="' + name + '" value="' + esc(value) + '" ' + attrs + '>';
export const textarea = (name, value = '', attrs = '') => '<textarea name="' + name + '" ' + attrs + '>' + esc(value) + '</textarea>';
export const select = (name, options, chosen, attrs = '') => '<select name="' + name + '" ' + attrs + '>' + opts(options, chosen) + '</select>';
export const check = (name, label, selected = false) => '<label class="check"><input type="checkbox" name="' + name + '"' + (selected ? ' checked' : '') + '>' + esc(label) + '</label>';
export const form = (action, fields, label = t('保存'), buttons = '') => '<form class="form" data-form="' + action + '">' + fields + '<div class="dialog-footer"><span class="form-error" role="alert"></span>' + buttons + '<button class="button primary" type="submit">' + esc(label) + '</button></div></form>';
export const search = (value, prompt) => '<label class="search">' + I('search') + '<input type="search" id="search" value="' + esc(value) + '" placeholder="' + esc(prompt) + '" aria-label="' + esc(prompt) + '"></label>';
export const optionMap = list => Object.fromEntries(list.map(value => [value, t(value)]));

export function show(heading, content, subtitle = '', wide = false) {
  const dialog = document.querySelector('#dialog');
  dialog.classList.toggle('wide', wide);
  dialog.innerHTML = '<div class="dialog-head"><div><h2 id="dialog-title">' + esc(heading) + '</h2>' +
    (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + ('</div><button type="button" aria-label="' + t('关闭对话框') + '" class="icon-button" data-action="close">') + I('close') +
    '</button></div><div class="dialog-body">' + content + '</div>';
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
