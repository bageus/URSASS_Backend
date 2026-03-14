#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { readdirSync, statSync } = require('node:fs');

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(['node_modules', '.git']);

function collectJsFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      collectJsFiles(fullPath, out);
      continue;
    }

    if (stat.isFile() && entry.endsWith('.js')) {
      out.push(fullPath);
    }
  }
}

const files = [];
collectJsFiles(ROOT, files);

if (files.length === 0) {
  console.log('No .js files found to validate.');
  process.exit(0);
}

let failed = false;
for (const file of files.sort()) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed = true;
    process.stderr.write(`\nSyntax check failed for: ${file}\n`);
    if (error.stdout) process.stderr.write(error.stdout.toString());
    if (error.stderr) process.stderr.write(error.stderr.toString());
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
