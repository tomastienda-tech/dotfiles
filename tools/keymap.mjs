#!/usr/bin/env node
// Builds one reference for every keybinding on this machine, and finds the
// ones that can never fire.
//
//   node tools/keymap.mjs           write docs/KEYMAP.md
//   node tools/keymap.mjs --check   fail if it is out of date, or if a
//                                   shadowed binding exists
//
// Six tools bind keys here and none of them knows about the others. A binding
// in a lower layer whose combination is already claimed above it is DEAD — it
// looks configured, it validates, and it never runs. That is exactly what
// happened to pi's ⌥N: cmux took it and opened a window instead.
//
// So the point of this file is not the table. It is the conflict list.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// ── Layers, outermost first ─────────────────────────────────────────────────
// A key is delivered top-down. Whoever claims it first consumes it, so
// anything below with the same combination never sees the keystroke.
const LAYERS = [
  ['karabiner', 'remaps at the HID level, before any application sees the key'],
  ['aerospace', 'global hotkeys — claimed system-wide, in every application'],
  ['cmux', 'the terminal application, when it is frontmost'],
  ['vscode', 'the editor, when it is frontmost'],
  ['ghostty', 'the terminal surface, inside cmux'],
  ['pi', 'the TUI, inside that surface'],
];
const DEPTH = Object.fromEntries(LAYERS.map(([n], i) => [n, i]));

// Layers that only compete when the SAME application is focused. cmux and
// vscode never run in front of each other, so they cannot shadow each other.
const EXCLUSIVE = [
  ['cmux', 'vscode'],
  ['vscode', 'ghostty'],
  ['vscode', 'pi'],
];
const exclusive = (a, b) =>
  EXCLUSIVE.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

// ── Notation ────────────────────────────────────────────────────────────────
const GLYPH = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' };
const ALIAS = {
  ctrl: 'ctrl', control: 'ctrl', '⌃': 'ctrl',
  alt: 'alt', opt: 'alt', option: 'alt', '⌥': 'alt',
  shift: 'shift', '⇧': 'shift',
  cmd: 'cmd', command: 'cmd', super: 'cmd', meta: 'cmd', '⌘': 'cmd',
};
const KEYNAME = {
  leftsquarebracket: '[', rightsquarebracket: ']',
  semicolon: ';', equal: '=', slash: '/', comma: ',', period: '.',
  minus: '-', backtick: '`', grave: '`', quote: "'",
  left: '←', right: '→', up: '↑', down: '↓',
  enter: '↩', return: '↩', tab: 'Tab', space: 'Space', escape: 'Esc', esc: 'Esc',
};

/** Canonical form: modifiers in a fixed order, then the key. */
function canon(mods, key) {
  const set = new Set(mods.map((m) => ALIAS[m.toLowerCase()]).filter(Boolean));
  const k = KEYNAME[String(key).toLowerCase()] ?? String(key).toUpperCase();
  return ['ctrl', 'alt', 'shift', 'cmd'].filter((m) => set.has(m)).map((m) => GLYPH[m]).join('') + k;
}

const rows = [];
const add = (layer, combo, what) => combo && rows.push({ layer, combo, what });

// ── AeroSpace ───────────────────────────────────────────────────────────────
{
  const f = join(ROOT, '.aerospace.toml');
  if (existsSync(f)) {
    let mode = 'main';
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\[mode\.(\w+)\.binding\]/);
      if (m) mode = m[1];
      const b = line.match(/^([a-z0-9-]+)\s*=\s*(.+)$/);
      if (!b || line.trimStart().startsWith('#')) continue;
      const parts = b[1].split('-');
      const key = parts.pop();
      if (!parts.every((p) => ALIAS[p])) continue; // not a binding line
      const action = b[2].replace(/^\[|\]$/g, '').replace(/'/g, '').split(',')[0].trim();
      // Non-main modes are MODAL: they are only live after entering the mode,
      // so they cannot shadow anything. Recorded, but excluded from conflicts.
      rows.push({
        layer: 'aerospace',
        combo: canon(parts, key),
        what: mode === 'main' ? action : `[${mode}] ${action}`,
        scoped: mode !== 'main',
      });
    }
  }
}

// ── Ghostty ─────────────────────────────────────────────────────────────────
{
  const f = join(ROOT, 'ghostty/config');
  if (existsSync(f)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^keybind\s*=\s*([^=]+)=(.+)$/);
      if (!m) continue;
      const parts = m[1].trim().split('+');
      const key = parts.pop();
      add('ghostty', canon(parts, key), m[2].trim());
    }
  }
}

// ── pi ──────────────────────────────────────────────────────────────────────
{
  const f = join(ROOT, 'pi/keybindings.json');
  if (existsSync(f)) {
    const kb = JSON.parse(readFileSync(f, 'utf8'));
    for (const [id, keys] of Object.entries(kb)) {
      for (const spec of [].concat(keys)) {
        const parts = spec.split('+');
        const key = parts.pop();
        add('pi', canon(parts, key), id);
      }
    }
  }
}

// ── VS Code ─────────────────────────────────────────────────────────────────
{
  const f = join(ROOT, 'vscode/keybindings.json');
  if (existsSync(f)) {
    const kb = JSON.parse(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    for (const b of kb) {
      const parts = b.key.split('+');
      const key = parts.pop();
      add('vscode', canon(parts, key), b.command.replace(/^workbench\.action\.|^editor\.action\./, ''));
    }
  }
}

// ── cmux ────────────────────────────────────────────────────────────────────
// Vendored: cmux refuses `cmux shortcuts` from outside itself, so the
// published data file is cached in the repo rather than fetched at build time.
{
  const f = join(ROOT, 'vendor/cmux-shortcuts.ts');
  if (existsSync(f)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(
      /\{\s*id:\s*"([^"]+)",\s*combos:\s*\[\[([^\]]*)\]\][\s\S]{0,80}?en:\s*"([^"]*)"/g,
    )) {
      const keys = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      if (!keys.length) continue;
      const key = keys.pop();
      // "1…9" style entries are ranges, not a single combination.
      if (key.includes('…')) {
        add('cmux', `${canon(keys, '1')}…9`, m[3]);
        continue;
      }
      // Two kinds of cmux binding are view-local rather than global, and
      // neither can shadow anything: those with NO modifier (diff viewer,
      // sidebar rows), and those belonging to a surface that must already be
      // open. ⌃N is "command palette next result" — only live with the palette
      // showing — and flagging it against pi's cursorDown is noise.
      const VIEW_LOCAL = /^(commandPalette|diffViewer|fileExplorer|navigateRightSidebar|simulator)/;
      rows.push({
        layer: 'cmux',
        combo: canon(keys, key),
        what: m[3],
        scoped: keys.length === 0 || VIEW_LOCAL.test(m[1]),
      });
    }
  }
}

// ── Karabiner ───────────────────────────────────────────────────────────────
// Best effort: the complex modifications are a manipulator tree, so only the
// simple `from` shape is read. Anything more nested is listed by description
// without a combination, and marked as such.
const karabinerUnparsed = [];
{
  const f = join(ROOT, 'karabiner/karabiner.json');
  if (existsSync(f)) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    for (const prof of d.profiles ?? []) {
      for (const rule of prof.complex_modifications?.rules ?? []) {
        let got = false;
        for (const man of rule.manipulators ?? []) {
          const from = man.from;
          if (!from?.key_code) continue;
          const mods = from.modifiers?.mandatory ?? [];
          const norm = mods.flatMap((m) =>
            m === 'left_command' || m === 'right_command' || m === 'command' ? ['cmd'] :
            m === 'left_control' || m === 'right_control' || m === 'control' ? ['ctrl'] :
            m === 'left_option' || m === 'right_option' || m === 'option' ? ['alt'] :
            m === 'left_shift' || m === 'right_shift' || m === 'shift' ? ['shift'] : [],
          );
          if (!norm.length) continue;
          rows.push({
            layer: 'karabiner',
            combo: canon(norm, from.key_code),
            what: rule.description ?? '',
            // Vim-mode rules only fire once vim_mode is active.
            scoped: /vim mode/i.test(rule.description ?? ''),
          });
          got = true;
        }
        if (!got && rule.description) karabinerUnparsed.push(rule.description);
      }
    }
  }
}

// ── Conflicts ───────────────────────────────────────────────────────────────
const byCombo = new Map();
for (const r of rows) {
  if (!byCombo.has(r.combo)) byCombo.set(r.combo, []);
  byCombo.get(r.combo).push(r);
}

const conflicts = [];
for (const [combo, list] of byCombo) {
  // Only unscoped bindings compete: a modal or view-local binding is not
  // claiming the key globally, so it neither shadows nor is shadowed.
  const live = list.filter((r) => !r.scoped);
  const layers = [...new Set(live.map((r) => r.layer))];
  if (layers.length < 2) continue;
  for (const a of layers) {
    for (const b of layers) {
      if (DEPTH[a] >= DEPTH[b] || exclusive(a, b)) continue;
      conflicts.push({
        combo,
        winner: a,
        loser: b,
        winnerWhat: live.find((r) => r.layer === a).what,
        loserWhat: live.find((r) => r.layer === b).what,
      });
    }
  }
}

// ── Output ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/\|/g, '\\|');
let md = `# Keymap

<!-- GENERATED by tools/keymap.mjs — do not edit by hand. -->

Every keybinding on this machine, read from the configs themselves.

Keys are delivered top-down through these layers. Whoever claims a combination
first consumes it, so anything below with the same combination never sees the
keystroke:

| # | layer | scope |
|---|---|---|
${LAYERS.map(([n, d], i) => `| ${i + 1} | \`${n}\` | ${d} |`).join('\n')}

\`✦\` below is Hyper — \`⌃⌥⌘\` together, bound to Caps Lock in Karabiner.

`;

if (conflicts.length) {
  md += `## Shadowed bindings\n\nThese are claimed by a layer above and **can never fire**.\n\n`;
  md += `| combination | claimed by | shadowed |\n|---|---|---|\n`;
  for (const c of conflicts) {
    md += `| \`${esc(c.combo)}\` | **${c.winner}** — ${esc(c.winnerWhat)} | ${c.loser} — ${esc(c.loserWhat)} |\n`;
  }
  md += '\n';
} else {
  md += `## Shadowed bindings\n\nNone. No binding is claimed by a layer above the one that defines it.\n\n`;
}

for (const [layer] of LAYERS) {
  const list = rows.filter((r) => r.layer === layer);
  if (!list.length) continue;
  md += `## ${layer} — ${list.length}\n\n| key | action |\n|---|---|\n`;
  const seen = new Set();
  for (const r of list.sort((a, b) => a.combo.localeCompare(b.combo))) {
    const k = r.combo + r.what;
    if (seen.has(k)) continue;
    seen.add(k);
    md += `| \`${esc(r.combo.replace('⌃⌥⌘', '✦'))}\` | ${esc(r.what)} |\n`;
  }
  md += '\n';
}

if (karabinerUnparsed.length) {
  md += `## Karabiner rules without a simple trigger\n\nThese use nested manipulators or variable conditions, so no single combination
could be extracted. Listed for completeness:\n\n`;
  for (const d of karabinerUnparsed) md += `- ${esc(d)}\n`;
  md += '\n';
}

md += `---\n\nRegenerate with \`node tools/keymap.mjs\`. \`--check\` fails if this file is stale
or if a shadowed binding exists.\n`;

const out = join(ROOT, 'docs/KEYMAP.md');
if (CHECK) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  let bad = 0;
  if (current !== md) {
    console.log(' FAIL  docs/KEYMAP.md is stale — run: node tools/keymap.mjs');
    bad++;
  } else {
    console.log(`  ok    docs/KEYMAP.md is current (${rows.length} bindings)`);
  }
  if (conflicts.length) {
    for (const c of conflicts) {
      console.log(` FAIL  ${c.combo}: ${c.loser} "${c.loserWhat}" is shadowed by ${c.winner}`);
    }
    bad++;
  } else {
    console.log('  ok    no binding is shadowed by a higher layer');
  }
  console.log('\n' + '═'.repeat(76));
  console.log(bad === 0 ? 'PASS\n' : `FAIL — ${bad} problem(s)\n`);
  process.exit(bad === 0 ? 0 : 1);
}

writeFileSync(out, md);
console.log(`  wrote docs/KEYMAP.md — ${rows.length} bindings across ${
  new Set(rows.map((r) => r.layer)).size
} layers, ${conflicts.length} shadowed`);
