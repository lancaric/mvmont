import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sendContactEmails } from '../src/mail.js';
import { decodeImage, MAX_IMAGE, readJson } from '../src/validation.js';
import { cleanupR2 } from '../src/index.js';
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let mf, db, bucket;
const token = 'test-only-admin-token';
before(async () => {
  const bundled = await build({ entryPoints: ['src/index.js'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'test', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-11', d1Databases: ['DB'], r2Buckets: ['GALLERY_BUCKET'], bindings: { ADMIN_TOKEN: token } }));
  db = await mf.getD1Database('DB'); bucket = await mf.getR2Bucket('GALLERY_BUCKET');
  const sql = await readFile('migrations/0001_initial.sql', 'utf8');
  await db.exec(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
});
after(async () => { await mf?.dispose(); });
async function api(path, method = 'GET', body, auth = token, extra = {}) {
  return mf.dispatchFetch(`https://mvmont.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Admin-Token': auth } : {}), ...extra }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
test('contacts persist before failed email delivery, with frontend-compatible JSON', async () => {
  const response = await api('/api/contact', 'POST', { name: "O'Connor", email: 'test@example.com', phone: '123', service: 'framed', message: 'Test' });
  assert.equal(response.status, 201);
  const data = await response.json(); assert.equal(data.emailStatus, 'failed');
  const saved = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(data.contact.id).first();
  assert.equal(saved.name, "O'Connor"); assert.equal(saved.company_email_status, 'failed');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('input, method, authentication and origin validation', async () => {
  for (const body of ['{', 'null', '[]', { name: 4 }, { name: 'A', email: 'bad', phone: '1', service: 'x', message: 'm' }]) assert.equal((await api('/api/contact', 'POST', body)).status, 400);
  assert.equal((await api('/api/contact')).status, 405);
  assert.equal((await api('/api/missing')).status, 404);
  assert.equal((await api('/api/gallery', 'POST', {}, '')).status, 401);
  assert.equal((await api('/api/gallery/a', 'PUT', {}, 'wrong')).status, 401);
  assert.equal((await api('/api/gallery/a', 'DELETE', undefined, 'wrong')).status, 401);
  assert.equal((await api('/api/gallery', 'POST', {}, token, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await api('/api/contact', 'POST', '{}', token, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await api('/api/contact', 'POST', ' '.repeat(65537))).status, 413);
  assert.equal((await api('/api/gallery', 'POST', { title: 'x', category: 'other', imageUrl: 'https://example.com/a.png' })).status, 400);
  assert.equal((await api('/api/gallery', 'POST', { title: 'x', category: 'framed', imageUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await api('/uploads/%2e%2e%2fsecret.png')).status, 404);
});
test('gallery create, list, upload/download, edit, replacement, external URL and deletion', async () => {
  const response = await api('/api/gallery', 'POST', { title: 'Original', category: 'framed', imageData: png, imageName: '../../x.png' });
  assert.equal(response.status, 201);
  const { item } = await response.json(); assert.match(item.imageUrl, /^\/uploads\/[a-f0-9-]+\.png$/);
  const download = await api(item.imageUrl); assert.equal(download.status, 200); assert.equal(download.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), Buffer.from(png, 'base64'));
  assert.equal((await api(item.imageUrl, 'GET', undefined, token, { 'If-None-Match': download.headers.get('ETag') })).status, 304);
  assert.equal((await api(item.imageUrl, 'HEAD')).status, 200);
  assert.equal((await api(item.imageUrl, 'POST', {})).status, 405);
  assert.equal((await (await api('/api/gallery')).json()).items.length, 1);
  // Admin submits the existing /uploads URL when only metadata changes.
  let edit = await api(`/api/gallery/${item.id}`, 'PUT', { title: 'Edited', description: '', imageUrl: item.imageUrl });
  assert.equal(edit.status, 200); assert.equal((await edit.json()).item.description, '');
  assert.equal((await api(`/api/gallery/${item.id}`, 'PUT', { imageData: 'data:image/jpeg;base64,' + png })).status, 400);
  assert.equal((await api(item.imageUrl)).status, 200);
  edit = await api(`/api/gallery/${item.id}`, 'PUT', { imageData: 'data:image/png;base64,' + png });
  const replaced = (await edit.json()).item; assert.notEqual(replaced.imageUrl, item.imageUrl);
  assert.equal((await api(item.imageUrl)).status, 404);
  edit = await api(`/api/gallery/${item.id}`, 'PUT', { imageUrl: 'https://example.com/external.png' });
  assert.equal(edit.status, 200); assert.equal((await api(replaced.imageUrl)).status, 404);
  const row = await db.prepare('SELECT r2_key FROM gallery WHERE id=?').bind(item.id).first(); assert.equal(row.r2_key, null);
  assert.equal((await api(`/api/gallery/${item.id}`, 'DELETE')).status, 200);
  assert.equal((await api(`/api/gallery/${item.id}`, 'DELETE')).status, 404);
  const uploaded = await (await api('/api/gallery', 'POST', { title: 'Delete R2', category: 'screens', imageData: png })).json();
  assert.equal((await api(`/api/gallery/${uploaded.item.id}`, 'DELETE')).status, 200);
  assert.equal((await api(uploaded.item.imageUrl)).status, 404);
  assert.equal((await bucket.list()).objects.length, 0);
});
test('email provider receives both messages, reply_to and independent idempotency keys', async () => {
  const calls = [];
  const entry = { id: 'test', name: 'Anna', email: 'anna@example.com', phone: '123', service: 'framed', message: 'Text', createdAt: new Date().toISOString() };
  const env = { RESEND_API_KEY: 'test-only', CONTACT_TO: 'company@example.com', CONTACT_FROM: 'sender@example.com' };
  const result = await sendContactEmails(entry, env, async (_url, init) => { calls.push(init); return Response.json({ id: 'accepted' }); });
  assert.equal(result.status, 'sent'); assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].body).reply_to, env.CONTACT_TO);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  let count = 0;
  const partial = await sendContactEmails(entry, env, async () => ++count === 1 ? Response.json({}, { status: 500 }) : Response.json({ id: 'ok' }));
  assert.deepEqual(partial, { company: 'failed', customer: 'sent', status: 'partial' });
  assert.equal((await sendContactEmails(entry, env, async () => { throw new Error('secret'); })).status, 'failed');
});
test('image signatures, MIME mismatch and decoded upload limit', () => {
  assert.equal(decodeImage(png).contentType, 'image/png');
  assert.throws(() => decodeImage('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64')));
  assert.throws(() => decodeImage('not base64'));
  assert.throws(() => decodeImage(Buffer.alloc(MAX_IMAGE + 1).toString('base64')), e => e.status === 413);
  assert.equal(decodeImage(Buffer.from([255,216,255,217]).toString('base64')).contentType, 'image/jpeg');
  assert.equal(decodeImage(Buffer.from('GIF89a12345678').toString('base64')).contentType, 'image/gif');
  assert.equal(decodeImage(Buffer.from('RIFF1234WEBPVP8 ').toString('base64')).contentType, 'image/webp');
});
test('streaming size guard works without Content-Length', async () => {
  const request = new Request('https://mvmont.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); c.close(); } }), duplex: 'half' });
  await assert.rejects(readJson(request, 10), e => e.status === 413);
});
test('failed R2 cleanup stays queued, retries safely and preserves live objects', async () => {
  const key = 'cleanup-test.png';
  await bucket.put(key, Buffer.from(png, 'base64'));
  await db.prepare('INSERT INTO r2_cleanup VALUES (?,?)').bind(key, '2000-01-01T00:00:00.000Z').run();
  await cleanupR2({ DB: db, GALLERY_BUCKET: { delete() { throw new Error('temporary'); } } });
  assert.ok(await db.prepare('SELECT * FROM r2_cleanup WHERE r2_key=?').bind(key).first());
  await cleanupR2({ DB: db, GALLERY_BUCKET: bucket });
  assert.equal(await bucket.get(key), null);
  assert.equal(await db.prepare('SELECT * FROM r2_cleanup WHERE r2_key=?').bind(key).first(), null);
  const live = (await (await api('/api/gallery', 'POST', { title: 'Live', category: 'framed', imageData: png })).json()).item;
  const liveKey = live.imageUrl.slice(9);
  await db.prepare('INSERT INTO r2_cleanup VALUES (?,?)').bind(liveKey, '2000-01-01T00:00:00.000Z').run();
  await cleanupR2({ DB: db, GALLERY_BUCKET: bucket });
  assert.ok(await bucket.get(liveKey));
  await api(`/api/gallery/${live.id}`, 'DELETE');
});
