const personFields = /^(?:first_?name|last_?name|full_?name|user_?name|customer_?name|recipient|contact_?name|real_?name|姓名|客户姓名|收件人|联系人)$/i;
const orderFields = /^(?:order_?(?:id|number|no)|tracking_?(?:id|number|no)|订单(?:号|编号)|运单号|快递单号)$/i;
const phoneFields = /^(?:phone(?:_?number)?|mobile|tel(?:ephone)?|手机号|电话|联系电话)$/i;
const personalLabel = /((?:收件人|联系人|客户姓名|真实姓名|姓名|我叫|我名叫|本人叫)\s*[:：=]?\s*)([\p{Script=Han}]{2,4}?)(?=\s*(?:[，,。.!！;；\n]|的|请|想|要|订|买|申|问|反馈|有|手|电|想|$))/gu;

export function redact(value) {
  return String(value ?? '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱]')
    .replace(/(?<!\d)(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)/g, '[手机号]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[证件号]')
    .replace(/\b(?:sk-[\w-]{10,}|Bearer\s+[\w.-]{10,})\b/gi, '[密钥]')
    .replace(/((?:订单(?:号|编号)?|运单号|快递单号|order[\s_-]*(?:number|id|no))\s*[:：=#]?\s*)[A-Z0-9][A-Z0-9-]{4,}(?![A-Z0-9-])/gi, '$1[订单号]')
    .replace(/(?<![\w-])(?:ORD|ORDER|SO)[-#]?\d{5,}(?![\w-])/gi, '[订单号]')
    .replace(personalLabel, '$1[姓名]')
    .replace(/(^|[。！？、，;；\n])([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕张孔曹严金魏陶姜谢邹喻柏窦章苏潘葛彭鲁韦马苗方袁柳任唐费薛雷贺倪汤罗傅曾胡郭徐叶黄刘梁宋谢丁邓董蔡余戴程林][\p{Script=Han}]{1,2})(?=(?:在|于)?(?:下单|签收|提交订单|登记|申请退款|办理))/gu, '$1[姓名]')
    .replace(/((?:customer name|recipient|contact name|my name is)\s*[:=]?\s*)([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})/g, '$1[姓名]')
    .replace(/((?:收件人|联系人|客户姓名|真实姓名|姓名)\s*[:：=]\s*)[^\s，,。！;；\n]{2,24}/gu, '$1[姓名]');
}

export function redactTree(value, field = '', depth = 0) {
  if (value == null) return value;
  if (depth >= 20) return '[已省略]';
  if (personFields.test(field)) return '[姓名]';
  if (orderFields.test(field)) return '[订单号]';
  if (phoneFields.test(field)) return '[手机号]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(item => redactTree(item, '', depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactTree(item, key, depth + 1)]));
}

export function safeIdentifier(value, limit = 80) {
  const raw = typeof value === 'string' ? value.trim().slice(0, limit) : '';
  if (raw && (redact(raw) !== raw || /(?:^|[-_])\d{10,}(?:$|[-_])/.test(raw))) {
    throw Object.assign(Error('链路、会话与版本标识须使用不含个人信息的技术 ID。'), { status: 400 });
  }
  return raw;
}
