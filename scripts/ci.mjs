import { readFile } from 'node:fs/promises';

const [candidate, baseline] = process.argv.slice(2);
if (!candidate) {
  console.error('用法：npm run regression -- <候选版本> [基线版本]');
  process.exit(2);
}

try {
  const observations = process.env.FLYWHEEL_OBSERVATIONS
    ? JSON.parse(await readFile(process.env.FLYWHEEL_OBSERVATIONS, 'utf8'))
    : undefined;
  const origin = (process.env.FLYWHEEL_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.FLYWHEEL_ACCESS_TOKEN) headers.Authorization = 'Bearer ' + process.env.FLYWHEEL_ACCESS_TOKEN;
  if (process.env.FLYWHEEL_SITES_TOKEN) headers['OAI-Sites-Authorization'] = 'Bearer ' + process.env.FLYWHEEL_SITES_TOKEN;
  const response = await fetch(origin + '/api/regression', { method: 'POST', headers, body: JSON.stringify({
    candidate, baseline, judgeMode: process.env.FLYWHEEL_JUDGE || 'heuristic', observations
  }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || String(response.status));
  const { rows, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = result.passed ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
