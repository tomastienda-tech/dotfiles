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
// User-installed extensions register their own settings too, so they are part
// of the corpus — but they are tracked separately, because a setting that only
// exists thanks to an installed extension is a PORTABILITY problem: on a fresh
// machine it silently does nothing until that extension is present.
const bundledCount = sources.length - 1;
const userExtDir = join(process.env.HOME ?? '', '.vscode/extensions');
const userSources = [];
if (existsSync(userExtDir)) {
  for (const name of readdirSync(userExtDir)) {
    const pkg = join(userExtDir, name, 'package.json');
    if (existsSync(pkg)) userSources.push(pkg);
  }
}
const coreCorpus = sources.map((f) => readFileSync(f, 'utf8')).join('\n');
const userCorpus = userSources.map((f) => readFileSync(f, 'utf8')).join('\n');
const corpus = `${coreCorpus}\n${userCorpus}`;
ok(`registry: workbench + ${bundledCount} bundled + ${userSources.length} user extension manifests`);

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

// Which settings only work because an extension is installed?
const fromExtension = Object.keys(settings).filter(
  (k) => !coreCorpus.includes(`"${k}"`) && !(k.startsWith('editor.') && coreCorpus.includes(`"${k.slice(7)}"`)),
);
if (fromExtension.length) {
  const prefixes = [...new Set(fromExtension.map((k) => k.split('.')[0]))];
  ok(`${fromExtension.length} setting(s) come from user extensions (${prefixes.join(', ')})`);
  // The repo must declare them, or a fresh install gets settings that do nothing.
  const listFile = join(ROOT, 'vscode/extensions.txt');
  if (!existsSync(listFile)) {
    bad('settings depend on extensions but vscode/extensions.txt does not exist');
  } else {
    const declared = readFileSync(listFile, 'utf8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#'));
    const missing = prefixes.filter(
      (pre) => !declared.some((d) => d.includes(pre.toLowerCase())),
    );
    if (missing.length) bad(`no declared extension provides: ${missing.join(', ')}`);
    else ok(`every extension-provided prefix is declared in vscode/extensions.txt`);
  }
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

// ── Keybindings ─────────────────────────────────────────────────────────────
// A binding whose command does not exist is dead, and a `when` clause with a
// misspelt context key never matches. Both fail silently — the key simply does
// nothing, which is indistinguishable from the binding not being loaded.
{
  const kbPath = join(ROOT, 'vscode/keybindings.json');
  if (existsSync(kbPath)) {
    // VS Code accepts JSONC here; strip line comments the way it does.
    const raw = readFileSync(kbPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    let kb;
    try {
      kb = JSON.parse(raw);
      ok(`keybindings.json parses (${kb.length} bindings)`);
    } catch (e) {
      bad(`keybindings.json is not valid JSONC: ${e.message}`);
      kb = [];
    }

    const cmds = [...new Set(kb.map((b) => b.command))];
    // Some commands are registered in a loop with the index appended, so the
    // numbered id never appears as a literal in the bundle. Match the base.
    const GENERATED = [/^workbench\.action\.openEditorAtIndex\d$/];
    const deadCmds = cmds.filter(
      (c) => !corpus.includes(`"${c}"`) && !GENERATED.some((re) => re.test(c)),
    );
    if (deadCmds.length) bad(`command(s) that do not exist: ${deadCmds.join(', ')}`);
    else ok(`all ${cmds.length} bound commands exist`);

    // Context keys used in `when`, minus operators, literals and command ids.
    const ctx = new Set();
    for (const b of kb) {
      for (const t of (b.when ?? '').match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
        if (!['true', 'false', 'workbench', 'view', 'scm', 'action'].includes(t)) ctx.add(t);
      }
    }
    const deadCtx = [...ctx].filter((t) => !corpus.includes(`"${t}"`));
    if (deadCtx.length) bad(`when-clause context key(s) that do not exist: ${deadCtx.join(', ')}`);
    else ok(`all ${ctx.size} when-clause context keys exist`);
  }
}

// ── Vim leader maps ─────────────────────────────────────────────────────────
// Same failure shape: vscodevim silently does nothing for a command id it
// cannot resolve.
{
  const maps = [
    ...(settings['vim.normalModeKeyBindingsNonRecursive'] ?? []),
    ...(settings['vim.visualModeKeyBindingsNonRecursive'] ?? []),
  ];
  const cmds = [...new Set(maps.flatMap((m) => m.commands ?? []))].filter(
    // `:`-prefixed entries are vim ex-commands, not VS Code command ids.
    (c) => typeof c === 'string' && !c.startsWith(':'),
  );
  const dead = cmds.filter((c) => !corpus.includes(`"${c}"`));
  if (dead.length) bad(`vim leader map(s) target missing command(s): ${dead.join(', ')}`);
  else ok(`all ${cmds.length} vim leader-map commands exist`);
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
