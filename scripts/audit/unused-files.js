#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SCAN_DIRS = ['routes', 'utils', 'middleware', 'services', 'models', 'api'];
const ENTRY_FILES = ['app.js', 'server.js', 'botWorker.js', 'bot.js'];

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.git')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toRel(file) { return path.relative(ROOT, file).replace(/\\/g, '/'); }

const allFiles = walk(ROOT).filter((f) => f.endsWith('.js'));
const tracked = allFiles.filter((f) => SCAN_DIRS.some((d) => toRel(f).startsWith(`${d}/`)));

const contentByRel = new Map(allFiles.map((f) => [toRel(f), fs.readFileSync(f, 'utf8')]));
const visited = new Set();
const queue = ENTRY_FILES.filter((f) => contentByRel.has(f));

function resolveLocal(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.dirname(path.join(ROOT, fromRel));
  const full = path.resolve(base, spec);
  const candidates = [full, `${full}.js`, path.join(full, 'index.js')];
  for (const c of candidates) {
    const rel = toRel(c);
    if (contentByRel.has(rel)) return rel;
  }
  return null;
}

while (queue.length) {
  const rel = queue.shift();
  if (visited.has(rel)) continue;
  visited.add(rel);
  const src = contentByRel.get(rel) || '';
  const reqRe = /require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = reqRe.exec(src))) {
    const dep = resolveLocal(rel, m[1]);
    if (dep && !visited.has(dep)) queue.push(dep);
  }
}

const unreachable = tracked
  .map((f) => toRel(f))
  .filter((rel) => !visited.has(rel))
  .sort();

console.log(JSON.stringify({ scanned: tracked.length, reachable: tracked.length - unreachable.length, unreachable }, null, 2));
if (unreachable.length) {
  console.error(`Found ${unreachable.length} potentially unreachable files.`);
}
