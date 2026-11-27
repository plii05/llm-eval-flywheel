import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { assets } from './assets.mjs';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await mkdir(new URL('server/', dist), { recursive: true });
const source = await Promise.all(['seed', 'privacy', 'evaluate', 'governance', 'operations', 'worker'].map(async file => {
  const text = await readFile(new URL('src/' + file + '.js', root), 'utf8');
  return text.replace(/^import .*;\n/gm, '').replace(/^export (?=(?:const|function|async function) )/gm, '');
}));
const contents = [
  ...source,
  'const assets = ' + JSON.stringify(await assets(true)) + ';',
  'for (const asset of Object.values(assets)) if (asset.binary) asset.body = Uint8Array.from(atob(asset.body), char => char.charCodeAt(0));',
  'export default { fetch: createHandler(assets), scheduled(_event, env, ctx) { ctx.waitUntil(backgroundWork(env)); } };'
].join('\n');
await Promise.all([
  writeFile(new URL('server/index.js', dist), contents),
  cp(new URL('drizzle/', root), new URL('drizzle/', dist), { recursive: true })
]);
console.log('Built dist/server/index.js');
