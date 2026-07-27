#!/usr/bin/env node
// Asserts install.sh actually installs everything the repo ships.
//
//   node tools/check-install.mjs
//
// This exists because the copy list used to live in the README as prose, and
// it drifted: a fresh install silently received no pi keybindings and none of
// the prompt templates, so the welcome panel advertised slash commands that
// did not exist on that machine. Nothing failed loudly — the files were simply
// never copied.
//
// The failure mode is always the same shape: someone adds a config to the repo
// and forgets the installer. So compare the two directly.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures++;
  console.log(` FAIL  ${m}`);
};

// ── Parse the MAP out of install.sh ─────────────────────────────────────────
const script = readFileSync(join(ROOT, 'install.sh'), 'utf8');
const mapBlock = script.slice(script.indexOf('MAP=('), script.indexOf('\n)', script.indexOf('MAP=(')));
const entries = [...mapBlock.matchAll(/"(file|dir):([^:]+):/g)].map((m) => ({
  kind: m[1],
  src: m[2],
}));

if (entries.length < 8) {
  bad(`only parsed ${entries.length} MAP entries from install.sh — the parser is wrong`);
} else {
  ok(`install.sh declares ${entries.length} install targets`);
}

const covered = new Set(entries.map((e) => e.src));

// ── Every shipped config must be covered ────────────────────────────────────
// Directories the repo ships that are NOT configs to install.
// vendor/ holds upstream reference data (cmux's published shortcut list) that
// tools/keymap.mjs reads. It is not configuration and has no install target.
const NOT_CONFIG = new Set([
  'tools', 'docs', 'wallpapers', 'swift', 'backups', 'vendor', '.git', '.github',
]);

const isCovered = (p) => {
  if (covered.has(p)) return true;
  // A file is covered if any declared directory contains it.
  for (const e of entries) {
    if (e.kind === 'dir' && p.startsWith(`${e.src}/`)) return true;
  }
  return false;
};

const topLevel = readdirSync(ROOT).filter((n) => !n.startsWith('.') || n === '.aerospace.toml');
for (const name of topLevel) {
  if (NOT_CONFIG.has(name)) continue;
  const abs = join(ROOT, name);
  if (statSync(abs).isFile()) {
    // Loose top-level files that are documentation or scaffolding, not config.
    if (/\.(md|sh|mjs|json)$/.test(name) && name !== '.aerospace.toml') {
      if (name === 'install.sh' || name === 'README.md') continue;
    }
    if (!isCovered(name)) bad(`${name} is shipped but install.sh never copies it`);
  } else if (!isCovered(name) && !entries.some((e) => e.src.startsWith(`${name}/`))) {
    bad(`${name}/ is shipped but install.sh never copies it`);
  }
}

// ── pi is copied file-by-file, so each piece needs its own entry ────────────
// This is the exact case that broke: pi/ is deliberately NOT copied wholesale
// (credentials live alongside it), so every subdirectory must be listed.
const piDir = join(ROOT, 'pi');
if (existsSync(piDir)) {
  for (const name of readdirSync(piDir)) {
    const rel = `pi/${name}`;
    if (!isCovered(rel)) {
      bad(`${rel} exists but install.sh never copies it — pi is copied piecewise, so it needs its own entry`);
    }
  }
  if (failures === 0) ok('every pi/ subdirectory has an install target');
}

// ── The hook must be executable at the destination ──────────────────────────
if (!/chmod \+x "\$HOME\/\.config\/cmux\/dock-hook\.sh"/.test(script)) {
  bad('install.sh does not chmod +x the cmux dock hook — cmux fails silently on a non-executable hook');
} else {
  ok('dock hook is made executable');
}

// ── Backup before overwrite ─────────────────────────────────────────────────
if (!/dotfiles-backup-/.test(script)) {
  bad('install.sh does not back up before overwriting');
} else {
  ok('install.sh backs up before overwriting');
}

console.log('\n' + '═'.repeat(76));
console.log(failures === 0 ? 'PASS\n' : `FAIL — ${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
