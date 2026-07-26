#!/usr/bin/env node
// Validates vscode/settings.json against the INSTALLED VS Code.
//
//   node tools/check-vscode.mjs
//
// VS Code ignores unknown settings and unknown colour keys in silence. A
// typo, or a key removed in a later release, simply does nothing — the config
// looks right and the editor does not change. That is the same silent-failure
// shape as pi's keybindings and sketchybar's fonts, both of which cost real
// debugging time here, so it gets the same treatment: check against what is
// actually installed rather than against documentation.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures++;
  console.log(` FAIL  ${m}`);
};

const APP = '/Applications/Visual Studio Code.app';
if (!existsSync(APP)) {
  console.log('  skip  VS Code is not installed');
  process.exit(0);
}

const RES = join(APP, 'Contents/Resources/app');
const product = JSON.parse(readFileSync(join(RES, 'product.json'), 'utf8'));
console.log(`\n── VS Code ${product.version} ${'─'.repeat(52)}`);

// The workbench bundle carries the settings and colour registries. Bundled
// extensions register their own keys (gitDecoration.* live in the git
// extension's package.json), so those manifests are part of the corpus.
const sources = [join(RES, 'out/vs/workbench/workbench.desktop.main.js')].filter(existsSync);
const extDir = join(RES, 'extensions');
if (existsSync(extDir)) {
  for (const name of readdirSync(extDir)) {
    const pkg = join(extDir, name, 'package.json');
    if (existsSync(pkg)) sources.push(pkg);
  }
}
const corpus = sources.map((f) => readFileSync(f, 'utf8')).join('\n');
ok(`registry corpus: workbench bundle + ${sources.length - 1} bundled extension manifests`);

const settings = JSON.parse(readFileSync(join(ROOT, 'vscode/settings.json'), 'utf8'));

// ── Every setting id must be known ──────────────────────────────────────────
// Monaco's editor options are registered WITHOUT the `editor.` prefix — the
// prefix is added when they are merged into the settings registry — so
// checking the qualified name alone reports every one of them as unknown.
const known = (k) => {
  if (corpus.includes(`"${k}"`)) return true;
  if (k.startsWith('editor.')) return corpus.includes(`"${k.slice(7)}"`);
  return false;
};
const unknownSettings = Object.keys(settings).filter((k) => !known(k));
if (unknownSettings.length) {
  bad(`unknown setting(s), silently ignored by ${product.version}: ${unknownSettings.join(', ')}`);
} else {
  ok(`all ${Object.keys(settings).length} setting ids exist`);
}

// ── Enum values must be legal ───────────────────────────────────────────────
// A wrong value is worse than a wrong key: VS Code falls back to the default
// without saying so, which looks exactly like the setting having no effect.
const ENUMS = {
  'workbench.sideBar.location': ['left', 'right'],
  'workbench.activityBar.location': ['default', 'top', 'bottom', 'hidden'],
  'workbench.secondarySideBar.defaultVisibility': ['hidden', 'visible'],
  'workbench.panel.defaultLocation': ['left', 'bottom', 'right'],
  'workbench.editor.editorActionsLocation': ['default', 'titleBar', 'hidden'],
  'workbench.editor.showTabs': ['multiple', 'single', 'none'],
  'editor.renderLineHighlight': ['none', 'gutter', 'line', 'all'],
  'editor.lightbulb.enabled': ['off', 'onCode', 'on'],
  'editor.occurrencesHighlight': ['off', 'singleFile', 'multiFile'],
  'window.titleBarStyle': ['native', 'custom'],
  'scm.diffDecorations': ['all', 'gutter', 'overview', 'minimap', 'none'],
};
let enumBad = 0;
for (const [k, allowed] of Object.entries(ENUMS)) {
  if (!(k in settings)) continue;
  if (!allowed.includes(settings[k])) {
    bad(`${k} = ${JSON.stringify(settings[k])} is not one of ${allowed.join(' | ')}`);
    enumBad++;
  }
}
if (enumBad === 0) ok('every enum value is legal for this version');

// ── Colour keys ─────────────────────────────────────────────────────────────
const colours = settings['workbench.colorCustomizations'] ?? {};
const unknownColours = Object.keys(colours).filter((k) => !corpus.includes(`"${k}"`));
if (unknownColours.length) {
  bad(`unknown colour key(s): ${unknownColours.join(', ')}`);
} else {
  ok(`all ${Object.keys(colours).length} colour keys exist`);
}

const badHex = Object.entries(colours).filter(([, v]) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v));
if (badHex.length) {
  bad(`malformed colour value(s): ${badHex.map(([k]) => k).join(', ')}`);
} else {
  ok('every colour value is #rrggbb or #rrggbbaa');
}

// ── The system's own rule ───────────────────────────────────────────────────
// The accent means focus. If it leaks into a git decoration or a diff, the
// editor stops agreeing with every other surface in the repo.
const ACCENT = '#be84fb';
const leaked = Object.entries(colours).filter(
  ([k, v]) => v.toLowerCase().startsWith(ACCENT) && /^(gitDecoration|editorGutter|diffEditor)/.test(k),
);
if (leaked.length) {
  bad(`accent used as a STATUS colour: ${leaked.map(([k]) => k).join(', ')}`);
} else {
  ok('the accent is not used for any git or diff state');
}

console.log('\n' + '═'.repeat(76));
console.log(failures === 0 ? 'PASS\n' : `FAIL — ${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
