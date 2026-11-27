import { readdir, readFile } from 'node:fs/promises';

const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png' };
const directory = new URL('../public/', import.meta.url);

export async function assets(encoded = false) {
  const entries = await Promise.all((await readdir(directory)).map(async filename => {
    const extension = filename.split('.').at(-1);
    const bytes = await readFile(new URL(filename, directory));
    return ['/' + filename, { type: types[extension], body: extension === 'png' ? (encoded ? bytes.toString('base64') : bytes) : bytes.toString('utf8'), binary: extension === 'png' }];
  }));
  return Object.fromEntries(entries);
}
