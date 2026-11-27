import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createHandler, backgroundWork } from '../src/worker.js';
import { assets } from './assets.mjs';
import { sqlite } from './local-db.mjs';

const flags = process.argv.slice(2);
const getFlag = name => flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined;
const port = Number(getFlag('--port') || process.env.PORT || 3000);
const host = getFlag('--host') || process.env.HOST || '0.0.0.0';
const folder = new URL('../.data/', import.meta.url);
await mkdir(folder, { recursive: true });
const db = sqlite(process.env.FLYWHEEL_DB || new URL('flywheel.sqlite', folder).pathname);
const handler = createHandler(await assets());
const env = { ...process.env, DB: db };
const waitUntil = promise => promise.catch(error => console.error('后台评测失败', error.status || error.name));
setInterval(() => waitUntil(backgroundWork(env)), 30000).unref();

createServer(async (req, res) => {
  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
    const endpoint = new URL(req.url, 'http://localhost');
    const response = await handler(new Request(endpoint, { method: req.method, headers: req.headers, body, duplex: 'half' }), env, { waitUntil });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Internal Server Error');
  }
}).listen(port, host, () => console.log('飞轮工作台 http://' + host + ':' + port));
