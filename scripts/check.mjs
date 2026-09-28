import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name)))).flat();
}
for (const file of (await Promise.all(['src', 'scripts', 'tests', 'public'].map(files))).flat()) {
  if (/\.(?:m?js)$/.test(file)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${file}: ${result.stderr}`);
  }
}
const assets = await files('public');
for (const file of assets) {
  if (/(?:node_modules|\.git|server\.js|\.env|\.dev\.vars|contacts\.json|gallery\.json)/.test(file)) throw new Error(`Private asset: ${file}`);
}
for (const file of await files('src')) {
  const source = await readFile(file, 'utf8');
  if (/node:|require\(|nodemailer|dotenv|SMTP_|fs\/promises/.test(source)) throw new Error(`Node runtime dependency: ${file}`);
}
console.log(`Syntax checks passed; ${assets.length} public files; Worker has no Node runtime dependencies.`);
