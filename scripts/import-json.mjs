// Offline migration tooling only. The Worker never reads or writes local files.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contactFields, galleryFields, externalUrl } from '../src/validation.js';

const [directory = 'data', output = 'import.sql'] = process.argv.slice(2);
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid legacy id');
  return value;
};
const date = value => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Missing/invalid legacy timestamp');
  return new Date(value).toISOString();
};
async function collection(name) {
  const content = await readFile(resolve(directory, `${name}.json`), 'utf8');
  if (!content.trim()) { console.log(`${name}: empty file, 0 records`); return []; }
  const rows = JSON.parse(content);
  if (!Array.isArray(rows)) throw new Error(`${name}: expected a JSON array; no output was written`);
  return rows;
}
const contacts = await collection('contacts'), gallery = await collection('gallery');
const lines = ['-- Reviewed legacy JSON import. Contains personal data; do not commit.'];
for (const row of contacts) {
  const value = contactFields(row);
  const values = [id(row.id), value.name, value.email, value.phone, value.service, value.message, date(row.createdAt), 'unknown', 'unknown', 'unknown'];
  lines.push(`INSERT INTO contacts (id,name,email,phone,service,message,created_at,email_status,company_email_status,customer_email_status) VALUES (${values.map(quote).join(',')});`);
}
for (const row of gallery) {
  const value = galleryFields(row);
  let imageUrl, key = null;
  if (typeof row.imageUrl === 'string' && row.imageUrl.startsWith('/uploads/')) {
    key = row.imageUrl.slice(9);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,150}\.(png|jpg|jpeg|webp|gif)$/.test(key)) throw new Error('Unsafe legacy upload key');
    imageUrl = row.imageUrl;
    console.log(`MANUAL STEP: validate image bytes and upload uploads/${key} to R2 key ${key} before importing SQL.`);
  } else imageUrl = externalUrl(row.imageUrl);
  const values = [id(row.id), value.title, value.description, value.category, imageUrl, key, date(row.createdAt), date(row.updatedAt || row.createdAt)];
  lines.push(`INSERT INTO gallery (id,title,description,category,image_url,r2_key,created_at,updated_at) VALUES (${values.map(quote).join(',')});`);
}
// Fail on duplicate identifiers instead of silently discarding/overwriting data.
for (const rows of [contacts, gallery]) if (new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('Duplicate legacy ids');
await writeFile(output, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(`Prepared ${contacts.length} contacts and ${gallery.length} gallery records in ${output}. No database was modified.`);
