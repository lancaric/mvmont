import { HttpError, readJson, contactFields, galleryFields, externalUrl, decodeImage, requireAdmin } from './validation.js';
import { sendContactEmails } from './mail.js';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
const item = row => ({ id: row.id, title: row.title, description: row.description, category: row.category,
  imageUrl: row.image_url, createdAt: row.created_at, updatedAt: row.updated_at });
const methodError = allow => json({ message: 'Nepovolená HTTP metóda' }, 405, { Allow: allow });
const safeKey = key => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,150}\.(png|jpg|jpeg|webp|gif)$/.test(key);
const enqueue = (env, key) => env.DB.prepare('INSERT OR IGNORE INTO r2_cleanup (r2_key, created_at) VALUES (?, ?)').bind(key, new Date().toISOString());

export async function cleanupR2(env) {
  const { results } = await env.DB.prepare('SELECT r2_key FROM r2_cleanup WHERE created_at <= ? ORDER BY created_at LIMIT 100').bind(new Date().toISOString()).all();
  for (const { r2_key: key } of results) {
    try {
      if (!safeKey(key)) continue;
      // Never remove a live reference, including one preserved by an import.
      const live = await env.DB.prepare('SELECT id FROM gallery WHERE r2_key = ? LIMIT 1').bind(key).first();
      if (live) continue;
      await env.GALLERY_BUCKET.delete(key);
      await env.DB.prepare('DELETE FROM r2_cleanup WHERE r2_key = ?').bind(key).run();
    } catch { console.warn('R2 cleanup deferred'); }
  }
}

async function contact(request, env) {
  const entry = { ...contactFields(await readJson(request, 64 * 1024)), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await env.DB.prepare('INSERT INTO contacts (id,name,email,phone,service,message,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(entry.id, entry.name, entry.email, entry.phone, entry.service, entry.message, entry.createdAt).run();
  const result = await sendContactEmails(entry, env);
  let emailStatusRecorded = true;
  try {
    await env.DB.prepare('UPDATE contacts SET email_status = ?, company_email_status = ?, customer_email_status = ? WHERE id = ?')
      .bind(result.status, result.company, result.customer, entry.id).run();
  } catch { emailStatusRecorded = false; console.warn('Contact email status persistence failed'); }
  return json({
    message: result.status === 'sent' ? 'Ďakujeme za vašu správu! Ozveme sa vám čo najskôr.' : 'Ďakujeme, vaša správa bola uložená. E-mailové potvrdenie sa nemuselo podariť odoslať.',
    contact: entry, emailStatus: result.status, emailDelivery: { company: result.company, customer: result.customer }, emailStatusRecorded,
  }, 201);
}

async function saveGallery(request, env, id) {
  await requireAdmin(request, env);
  const payload = await readJson(request);
  const current = id ? await env.DB.prepare('SELECT * FROM gallery WHERE id = ?').bind(id).first() : null;
  if (id && !current) throw new HttpError(404, 'Položka nebola nájdená');
  const fields = galleryFields(payload, current);
  let imageUrl = current?.image_url, key = current?.r2_key ?? null, newKey = null;
  if (payload.imageData !== undefined && payload.imageData !== '') {
    const image = decodeImage(payload.imageData, payload.imageName);
    newKey = `${crypto.randomUUID()}.${image.extension}`;
    key = newKey; imageUrl = `/uploads/${key}`;
    // Record cleanup before writing: interrupted uploads cannot leave untracked objects.
    // A grace period prevents another request's cleanup from deleting an in-flight upload.
    await env.DB.prepare('INSERT INTO r2_cleanup (r2_key, created_at) VALUES (?, ?)')
      .bind(newKey, new Date(Date.now() + 3600000).toISOString()).run();
    await env.GALLERY_BUCKET.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
  } else if (payload.imageUrl !== undefined && payload.imageUrl !== current?.image_url) {
    imageUrl = externalUrl(payload.imageUrl); key = null;
  }
  if (!imageUrl) throw new HttpError(400, 'Obrázok je povinný', { image: 'Pridajte URL alebo obrázok' });
  const now = new Date(Math.max(Date.now(), current ? Date.parse(current.updated_at) + 1 : 0)).toISOString();
  const row = { id: id || crypto.randomUUID(), ...fields, image_url: imageUrl, r2_key: key, created_at: current?.created_at || now, updated_at: now };
  try {
    const statements = [];
    if (current?.r2_key && current.r2_key !== key) statements.push(enqueue(env, current.r2_key));
    if (current) {
      statements.push(env.DB.prepare('UPDATE gallery SET title=?,description=?,category=?,image_url=?,r2_key=?,updated_at=? WHERE id=? AND updated_at=?')
        .bind(row.title, row.description, row.category, imageUrl, key, now, id, current.updated_at));
    } else {
      statements.push(env.DB.prepare('INSERT INTO gallery (id,title,description,category,image_url,r2_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(row.id, row.title, row.description, row.category, imageUrl, key, now, now));
    }
    const results = await env.DB.batch(statements);
    if (results.at(-1).meta.changes !== 1) throw new HttpError(409, 'Položka sa medzitým zmenila. Obnovte galériu.');
    // A live object can remain queued harmlessly if this optional cleanup fails.
    if (newKey) await env.DB.prepare('DELETE FROM r2_cleanup WHERE r2_key = ?').bind(newKey).run().catch(() => {});
  } catch (error) {
    if (newKey) await cleanupR2(env).catch(() => {});
    throw error;
  }
  await cleanupR2(env).catch(() => console.warn('R2 cleanup deferred'));
  return json({ item: item(row) }, current ? 200 : 201);
}

async function deleteGallery(request, env, id) {
  await requireAdmin(request, env);
  const current = await env.DB.prepare('SELECT * FROM gallery WHERE id = ?').bind(id).first();
  if (!current) throw new HttpError(404, 'Položka nebola nájdená');
  const statements = [];
  if (current.r2_key) statements.push(enqueue(env, current.r2_key));
  statements.push(env.DB.prepare('DELETE FROM gallery WHERE id = ? AND updated_at = ?').bind(id, current.updated_at));
  const results = await env.DB.batch(statements);
  if (results.at(-1).meta.changes !== 1) throw new HttpError(409, 'Položka sa medzitým zmenila. Obnovte galériu.');
  await cleanupR2(env).catch(() => console.warn('R2 cleanup deferred'));
  return json({ message: 'Položka bola odstránená' });
}

async function upload(request, env, key) {
  if (!['GET', 'HEAD'].includes(request.method)) return methodError('GET, HEAD');
  if (!safeKey(key)) throw new HttpError(404, 'Obrázok nebol nájdený');
  const object = await env.GALLERY_BUCKET.get(key);
  if (!object) throw new HttpError(404, 'Obrázok nebol nájdený');
  const headers = new Headers(securityHeaders);
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');
  if (request.headers.get('If-None-Match') === object.httpEtag) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), path = url.pathname;
      if (path.startsWith('/api/')) {
        const origin = request.headers.get('Origin');
        if (!['GET', 'HEAD'].includes(request.method) && origin && origin !== url.origin) throw new HttpError(403, 'Nepovolený pôvod požiadavky');
        if (path === '/api/contact') return request.method === 'POST' ? await contact(request, env) : methodError('POST');
        if (path === '/api/gallery') {
          if (request.method === 'GET') {
            const { results } = await env.DB.prepare('SELECT * FROM gallery ORDER BY created_at, id').all();
            return json({ items: results.map(item) });
          }
          return request.method === 'POST' ? await saveGallery(request, env) : methodError('GET, POST');
        }
        const match = /^\/api\/gallery\/([a-zA-Z0-9_-]{1,128})$/.exec(path);
        if (match) {
          if (request.method === 'PUT') return await saveGallery(request, env, match[1]);
          if (request.method === 'DELETE') return await deleteGallery(request, env, match[1]);
          return methodError('PUT, DELETE');
        }
        throw new HttpError(404, 'Endpoint nebol nájdený');
      }
      if (path.startsWith('/uploads/')) return await upload(request, env, path.slice(9));
      if (!['GET', 'HEAD'].includes(request.method)) return methodError('GET, HEAD');
      // html_handling:none preserves /index.html and /kontakt.html. Map only root explicitly.
      if (path === '/') { url.pathname = '/index.html'; return env.ASSETS.fetch(new Request(url, request)); }
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof HttpError) return json({ message: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
      console.error('Worker request failed');
      return json({ message: 'Nastala chyba servera. Skúste to prosím neskôr.' }, 500);
    }
  },
  async scheduled(_controller, env) { await cleanupR2(env); },
};
