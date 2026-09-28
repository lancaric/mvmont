export const categories = ['frameless', 'framed', 'shutters', 'blinds', 'terraces', 'railings', 'screens'];
export const MAX_IMAGE = 3 * 1024 * 1024;
export const MAX_BODY = 4 * 1024 * 1024 + 64 * 1024;
export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export async function readJson(request, limit = MAX_BODY) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new HttpError(415, 'Vyžaduje sa application/json');
  }
  if (Number(request.headers.get('Content-Length')) > limit) throw new HttpError(413, 'Požiadavka je príliš veľká');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Neplatný JSON');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'Požiadavka je príliš veľká'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Neplatný JSON'); }
}
export function field(value, name, max, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max || value.includes('\0')) {
    throw new HttpError(400, 'Formulár obsahuje chyby', { [name]: 'Neplatná alebo príliš dlhá hodnota' });
  }
  return value.trim();
}
export function contactFields(payload) {
  const result = {};
  for (const [name, max] of Object.entries({ name: 200, email: 254, phone: 80, service: 200, message: 10000 })) {
    result[name] = field(payload[name], name, max);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new HttpError(400, 'Formulár obsahuje chyby', { email: 'Prosím, zadajte platný e-mail' });
  return result;
}
export function galleryFields(payload, current) {
  const result = {
    title: field(payload.title ?? current?.title, 'title', 200),
    description: field(payload.description ?? current?.description, 'description', 5000, true),
    category: field(payload.category ?? current?.category, 'category', 30),
  };
  if (!categories.includes(result.category)) throw new HttpError(400, 'Neplatná kategória', { category: 'Vyberte podporovanú kategóriu' });
  return result;
}
export function externalUrl(value) {
  const text = field(value, 'imageUrl', 2048);
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new HttpError(400, 'Obrázok musí mať platnú HTTP alebo HTTPS URL'); }
}
export function decodeImage(imageData, imageName = '') {
  if (typeof imageData !== 'string' || typeof imageName !== 'string') throw new HttpError(400, 'Neplatný obrázok');
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(imageData);
  const encoded = (match ? match[2] : imageData).replace(/\s/g, '');
  if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new HttpError(400, 'Neplatné base64 dáta');
  if (encoded.length > Math.ceil(MAX_IMAGE / 3) * 4) throw new HttpError(413, 'Obrázok môže mať najviac 3 MiB');
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  if (bytes.length > MAX_IMAGE) throw new HttpError(413, 'Obrázok môže mať najviac 3 MiB');
  const starts = values => values.every((v, i) => bytes[i] === v);
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  let type;
  if (bytes.length >= 24 && starts([137,80,78,71,13,10,26,10]) && ascii(12,4) === 'IHDR') type = ['image/png','png'];
  else if (bytes.length >= 4 && starts([255,216,255])) type = ['image/jpeg','jpg'];
  else if (bytes.length >= 14 && ['GIF87a','GIF89a'].includes(ascii(0,6))) type = ['image/gif','gif'];
  else if (bytes.length >= 16 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(ascii(12,4))) type = ['image/webp','webp'];
  if (!type || (match && match[1].toLowerCase() !== type[0])) throw new HttpError(400, 'Nepodporovaný formát alebo nesúlad MIME typu obrázka');
  return { bytes, contentType: type[0], extension: type[1] };
}
export async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new HttpError(503, 'Administrácia nie je nakonfigurovaná');
  const token = request.headers.get('X-Admin-Token') || '';
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [actual, expected] = await Promise.all([digest(token), digest(env.ADMIN_TOKEN)]);
  const a = new Uint8Array(actual), b = new Uint8Array(expected);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (!token || difference !== 0) throw new HttpError(401, 'Nesprávny administrátorský token');
}
