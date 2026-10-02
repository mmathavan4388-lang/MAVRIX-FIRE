// Fails if any t('key') used in source lacks a complete Tamil/Hindi/English entry.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { DICT } = await import(pathToFileURL(join(root, 'i18n', 'dict.js')).href);
const files = []; (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(f) && f !== 'dict.js' && files.push(p); } })(root);
const used = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\['[^'\n]*',\s*'[a-z]+',\s*'([a-z]+\.[a-z_.]+)'/g)) used.add(m[1]);   // nav tables
  for (const m of src.matchAll(/\[\s*'[^'\n]+'\s*,\s*'([a-z]+\.[a-z_.]+)'\s*\]/g)) used.add(m[1]);
}
let bad = 0;
for (const [k, v] of Object.entries(DICT)) if (!Array.isArray(v) || v.length !== 3 || v.some((x) => !x || !String(x).trim())) { console.error('incomplete entry:', k); bad++; }
for (const k of [...used].sort()) if (!DICT[k]) { console.error('missing key:', k); bad++; }
console.log(`${Object.keys(DICT).length} entries, ${used.size} static keys referenced, ${bad} problems`);
process.exit(bad ? 1 : 0);
