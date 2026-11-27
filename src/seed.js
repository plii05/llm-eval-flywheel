export const demoVersions = [
  { id: 'v2.4.0', name: '检索与忠实度优化', model: 'demo-support', prompt: '仅根据提供的参考资料回答。缺少证据时明确说明。', strategy: 'RAG', mode: 'demo' },
  { id: 'v2.3.1', name: '客服知识库基线', model: 'demo-support', prompt: '你是一个售后客服助手，请回答用户问题。', strategy: 'Prompt', mode: 'demo' },
  { id: 'v2.2.0', name: '售后问答初版', model: 'demo-support', prompt: '回答用户的售后问题。', strategy: 'Prompt', mode: 'demo' }
];

const scenarios = [
  ['退款政策查询', '购买后多久可以申请退款？', '未使用的商品可在签收后 7 天内申请退款。', '7 天', '退款政策', 'rag', true, '检索未召回'],
  ['订单物流状态', '订单什么时候发货？', '支付完成后通常在 48 小时内发货。', '48 小时', '发货说明', 'rag', true, '知识库缺失'],
  ['电子发票开具', '怎样开电子发票？', '在订单详情选择「申请发票」，填写抬头后提交。', '申请发票', '发票说明', 'rag', false, 'Prompt 歧义'],
  ['售后赔付上限', '东西运输破损能赔多少钱？', '赔付需按商品与物流凭证审核，无法提前承诺具体金额。', '审核', '物流赔付', 'rag', true, '模型推理不足'],
  ['转接人工客服', '我想找人工客服。', '{"action":"handoff","queue":"support"}', 'handoff', '转接规范', 'agent', true, '工具参数错误'],
  ['更换收货地址', '已经发货了，能换地址吗？', '已发货的订单需要联系承运方，视运输状态确认能否改址。', '承运方', '改址规则', 'rag', false, '检索未召回'],
  ['结构化工单', '把咨询转成结构化工单。', '{"category":"售后","priority":"normal"}', 'priority', '工单协议', 'prompt', false, 'Prompt 歧义'],
  ['部分订单退款', '可不可以只退订单里的一件？', '支持按商品申请部分退款。请在订单详情中选中需要退款的商品。', '部分退款', '退款政策', 'rag', false, '检索未召回'],
  ['配送区域限制', '这款商品可以配送到境外吗？', '目前仅支持中国大陆地区配送。', '中国大陆', '配送范围', 'rag', false, '知识库缺失'],
  ['编辑联系方式', '我在哪里更新账户手机号？', '打开账户设置，选择「安全设置」后更换手机号。', '安全设置', '账户帮助', 'rag', false, 'Prompt 歧义'],
  ['取消未付款订单', '还没付款的订单怎么取消？', '在订单详情选择「取消订单」，提交后立即生效。', '取消订单', '订单管理', 'rag', false, '模型推理不足'],
  ['售后服务时间', '周末有人工售后吗？', '人工售后服务时间为周一至周日 09:00–21:00。', '09:00', '客服时间', 'rag', false, '知识库缺失']
];

export const causes = ['知识库缺失', '检索未召回', 'Prompt 歧义', '模型推理不足', '工具参数错误', '待确认'];
export const feedbackTypes = ['like', 'dislike', 'correction', 'annotation', 'regenerate', 'copy', 'adopt', 'abandon'];
export const dateAgo = (days, minutes = 0) => new Date(Date.now() - (days * 1440 + minutes) * 60000).toISOString();

export function seed() {
  const golden = Array.from({ length: 24 }, (_, i) => {
    const [name, input, reference, keyword, doc, kind, critical] = scenarios[i % scenarios.length];
    return {
      id: 'GC-' + String(101 + i), name: i < 12 ? name : name + ' · 边界表述', input: i < 12 ? input : '你好，想确认一下：' + input,
      reference, context: reference, document: doc, kind, group: i < 8 ? '核心场景' : i < 16 ? '边界用例' : '历史回归',
      critical: critical && i < 12, required: [keyword], forbidden: ['保证赔付'], json: kind !== 'rag', maxLength: 280,
      tool: kind === 'agent' ? { name: 'handoff', args: { queue: 'support' } } : null,
      demoCandidate: [8, 21].includes(i) ? '请联系人工客服进一步确认。' : reference,
      demoBaseline: [0, 3, 5, 8, 14, 21].includes(i) ? '请联系人工客服进一步确认。' :
        i === 1 ? '支付后 48 小时内发货。' : i === 2 ? '在订单详情中选择「申请发票」填写抬头。' : reference,
      createdAt: dateAgo(12)
    };
  });
  const traces = Array.from({ length: 42 }, (_, i) => {
    const g = golden[i % golden.length];
    const issue = [0, 1, 3, 4, 5, 8, 11, 16, 21, 24, 29, 36].includes(i);
    const cause = scenarios[i % 12][7];
    const context = issue && ['知识库缺失', '检索未召回'].includes(cause) ? [] : [{ id: 'doc-' + (i % 12 + 1), title: g.document, text: g.reference, score: 0.97 - (i % 4) * 0.05 }];
    const assistant = issue ? i === 3 ? '运输破损保证赔付 100 元。' : '建议您联系人工客服确认。' : g.reference;
    const createdAt = dateAgo(Math.floor(i / 7), i * 19 + 17);
    return {
      id: 'TR-' + (8421 - i), input: g.input, output: assistant, expected: g.reference, name: g.name, kind: g.kind,
      prompt: demoVersions[1].prompt, version: 'v2.3.1', model: 'demo-support', createdAt,
      context, tools: g.tool ? [{ name: 'handoff', args: { queue: issue ? 'billing' : 'support' }, result: { status: 'queued' }, latencyMs: 115 }] : [],
      latencyMs: 610 + i * 13 + i % 4 * 153, inputTokens: 312 + i * 7, outputTokens: 34 + i % 11 * 8,
      telemetry: { knowledgePresent: cause === '检索未召回' ? true : cause === '知识库缺失' ? false : null },
      feedback: issue ? [{ type: i % 4 === 1 ? 'regenerate' : 'dislike', note: i === 0 ? '我想知道具体的退款期限。' : '', at: createdAt }] : i % 4 === 2 ? [{ type: 'adopt', note: '', at: createdAt }] : i % 7 === 0 ? [{ type: 'like', note: '', at: createdAt }] : [],
      demo: true
    };
  });
  const cases = traces.filter(t => t.feedback.some(f => ['dislike', 'regenerate'].includes(f.type))).map((t, i) => ({
    id: 'BC-' + String(120 + i), traceId: t.id, title: t.name, cause: scenarios[(8421 - Number(t.id.slice(3))) % 12][7],
    status: i < 8 ? 'open' : i < 10 ? 'confirmed' : 'curated', corrected: i < 8 ? '' : t.expected,
    target: i >= 10 ? 'few-shot' : 'regression', note: '', createdAt: t.createdAt
  }));
  const labels = ['11/19', '11/20', '11/21', '11/22', '11/23', '11/24', '11/25'];
  return {
    versions: structuredClone(demoVersions), traces, golden, cases, runs: [], reviews: [], releases: [],
    config: { baseline: 'v2.3.1', minPass: 90, minCritical: 100 },
    sampleTrend: labels.map((label, i) => ({
      label, pass: [83.2, 87.5, 85.1, 92.0, 89.5, 94.1, 95.3][i],
      faith: [72.4, 77.1, 80.8, 79.5, 84.5, 85.1, 88.6][i],
      traffic: [1690, 1831, 1647, 1963, 1705, 1967, 2043][i]
    }))
  };
}
