// Read-only check against wrangler dev or a deployed origin.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
const base = process.argv[2] || 'http://127.0.0.1:8787';
async function files(dir, prefix = '') {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(`${dir}/${e.name}`, `${prefix}${e.name}/`) : `${prefix}${e.name}`))).flat();
}
const paths = ['/', ...(await files('public')).filter(f => !f.startsWith('_')).map(f => `/${f}`)];
for (const path of paths) {
  const response = await fetch(new URL(path, base), { redirect: 'manual' });
  assert.equal(response.status, 200, `${path}: expected 200 without a redirect`);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', path);
  await response.arrayBuffer();
}
const gallery = await fetch(new URL('/api/gallery', base));
assert.equal(gallery.status, 200); assert.ok(Array.isArray((await gallery.json()).items));
for (const path of ['/server.js', '/src/index.js', '/data/contacts.json', '/.git/config', '/node_modules/wrangler/package.json', '/.dev.vars', '/api/missing', '/uploads/missing.png']) {
  const response = await fetch(new URL(path, base), { redirect: 'manual' });
  assert.equal(response.status, 404, path);
}
assert.equal((await fetch(new URL('/api/contact', base))).status, 405);
console.log(`PASS: ${paths.length} static URLs without redirects, gallery API, method checks and private-file isolation at ${base}`);
