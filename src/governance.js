import { defaultJudgePrompt, agentTrajectory, judgeProfile } from './evaluate.js';
import { redact, redactTree } from './privacy.js';

export const gateDefaults = {
  maxLatencyP95: 2500, maxTtftP95: 1000, maxCostDelta: 20,
  inputPrice: 1, outputPrice: 3, criticalRepeats: 3, passAtK: 3, stabilityVariance: null
};
export const onlineDefaults = { sampleRate: 5, settleMinutes: 0, judgeMode: 'rules', clusterEvery: 100 };
export const fuseDefaults = { enabled: true, minCalls: 20, dislikeLift: 50, minDislikes: 2, maxErrorRate: 5, windowMinutes: 60 };

export const datasetVersion = revision => 'DS-' + String(revision).padStart(4, '0');
export const gateSnapshot = state => ({ minPass: state.config.minPass, minCritical: state.config.minCritical,
  ...Object.fromEntries(Object.keys(gateDefaults).map(key => [key, state.config[key]]))
});
export function eligibleRun(state, run, env) {
  const gates = gateSnapshot(state);
  return run.passed && run.baseline === state.config.baseline && run.datasetRevision === state.datasetRevision &&
    Object.entries(gates).every(([key, value]) => run.gateConfig?.[key] === value) &&
    (run.judgeMode !== 'llm' || (run.judgeVersion === state.config.activeJudge && !!run.judgeModel &&
      run.judgeModel === judgeProfile(state, env).model));
}

export function recordDataset(state, reason, advance = true) {
  if (advance) state.datasetRevision++;
  const entry = { id: datasetVersion(state.datasetRevision), revision: state.datasetRevision,
    samples: state.golden.map(sample => sample.id), createdAt: new Date().toISOString(), reason };
  state.datasetSnapshots.unshift(entry);
  return entry;
}

export function upgradeState(state) {
  if (state.schemaVersion === 2) return state;
  // Preserve relational identifiers while masking all legacy text at rest.
  const traceIds = state.traces.map(trace => trace.id);
  const references = [...state.cases, ...state.golden].map(item => item.traceId);
  Object.assign(state, redactTree(state));
  state.datasetRevision ??= 1;
  state.datasetSnapshots ??= [];
  state.sampleArchive ??= [];
  state.trainingUse ??= [];
  state.onlineJobs ??= [];
  state.clusters ??= [];
  state.clusterInfo ??= null;
  state.alerts ??= [];
  state.judges ??= [{ id: 'judge-v1', name: '默认裁判', model: '', prompt: defaultJudgePrompt, createdAt: new Date().toISOString() }];
  state.config = { ...gateDefaults, calibrationThreshold: 80, calibrationMin: 5, activeJudge: state.judges[0].id, ...state.config,
    online: { ...onlineDefaults, ...state.config.online }, fuse: { ...fuseDefaults, ...state.config.fuse } };
  const mapped = new Map();
  const used = new Set();
  for (const [index, trace] of state.traces.entries()) {
    const original = traceIds[index];
    if (used.has(trace.id) || trace.id !== original) {
      trace.id = 'TR-' + crypto.randomUUID().slice(0, 10).toUpperCase();
      mapped.set(original, trace.id);
    }
    used.add(trace.id);
    if (trace.kind === 'agent') trace.agentStats = agentTrajectory(trace.tools);
  }
  for (const [index, item] of [...state.cases, ...state.golden].entries()) {
    if (mapped.has(references[index])) item.traceId = mapped.get(references[index]);
  }
  for (const sample of state.golden) sample.familyId ??= sample.traceId || sample.id;
  if (!state.datasetSnapshots.length) recordDataset(state, '现有样本快照', false);
  for (const run of state.runs) {
    if (run.datasetRevision === state.datasetRevision) run.datasetVersion = datasetVersion(state.datasetRevision);
    if (run.judgeMode === 'llm') run.judgeVersion ??= state.config.activeJudge;
  }
  for (const review of state.reviews) {
    if (review.mode === 'llm') review.judgeVersion ??= state.config.activeJudge;
  }
  state.schemaVersion = 2;
  return state;
}

const canonicalInput = text => redact(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
function sameSource(a, b) {
  const family = a.familyId && b.familyId && a.familyId === b.familyId;
  const source = a.traceId && b.traceId && a.traceId === b.traceId;
  const text = canonicalInput(a.input);
  return family || source || Boolean(text && text === canonicalInput(b.input));
}
const isolationError = message => { throw Object.assign(Error(message), { status: 409 }); };

export function assertEvalIsolation(state, sample) {
  if (state.trainingUse.some(entry => sameSource(entry, sample))) isolationError('该样本或同来源变体已导出用于 Few-shot 或训练，不能加入评测基准。');
}

export function markTrainingExport(state, records, target) {
  if (!['few-shot', 'sft', 'dpo'].includes(target)) return;
  if (records.some(record => state.golden.some(sample => sameSource(record, sample)))) {
    isolationError('导出包含评测基准中的样本或同来源变体。请先移出冲突样本。');
  }
  for (const record of records) {
    if (state.trainingUse.some(previous => previous.target === target && sameSource(previous, record))) continue;
    state.trainingUse.unshift({ ...record, target, exportedAt: new Date().toISOString() });
  }
}

export function datasetDetail(state, key) {
  const version = state.datasetSnapshots.find(entry => entry.id === key);
  if (!version) throw Object.assign(Error('找不到该基准集快照。'), { status: 404 });
  const catalog = new Map([...state.golden, ...state.sampleArchive].map(sample => [sample.id, sample]));
  const samples = version.samples.map(sampleId => catalog.get(sampleId)).filter(Boolean).map(sample => ({
    ...sample, trainingExposed: state.trainingUse.some(record => sameSource(record, sample))
  }));
  return { ...version, samples };
}

export function viewGovernance(state) {
  return {
    datasetVersion: datasetVersion(state.datasetRevision),
    datasets: state.datasetSnapshots.map(({ samples, ...entry }) => ({ ...entry, count: samples.length })),
    trainingUseCount: state.trainingUse.length,
    trainingUse: state.trainingUse.map(({ input, ...entry }) => entry),
    archivedSamples: state.sampleArchive.map(({ id, name, createdAt }) => ({ id, name, createdAt }))
  };
}
