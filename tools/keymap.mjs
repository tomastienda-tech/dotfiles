#!/usr/bin/env node
// Builds one reference for every keybinding on this machine, and finds the
// ones that can never fire.
//
//   node tools/keymap.mjs           write docs/KEYMAP.md and chrome/keymap/
//   node tools/keymap.mjs --check   fail if either is out of date, or if a
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
// The HTML page is GENERATED from the same tokens as every other surface, for
// the same reason: a palette that is copied is a palette that drifts.
import {
  accent, semantic, state, surfaceTint, space, radius, stroke, motion, type,
} from './tokens.mjs';
import { contrast } from './color.mjs';

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
  // Karabiner uses HID names, which are longer and differently spelled. An
  // unmapped one shipped as a raw `RETURN_OR_ENTER` keycap wide enough to push
  // the row past the viewport — so KEY_LABELS below now gates on this.
  return_or_enter: '↩',
  delete_or_backspace: '⌫', backspace: '⌫', delete_forward: '⌦',
  spacebar: 'Space', caps_lock: 'Caps',
  open_bracket: '[', close_bracket: ']',
  hyphen: '-', equal_sign: '=', grave_accent_and_tilde: '`',
  quote_single: "'", backslash: '\\', non_us_backslash: '\\',
  left_arrow: '←', right_arrow: '→', up_arrow: '↑', down_arrow: '↓',
  page_up: 'PgUp', page_down: 'PgDn', home: 'Home', end: 'End',
};

// Every key label that is allowed to be more than one character. Anything else
// long is an unmapped source keycode leaking through, which is both ugly and a
// layout hazard. --check enforces it.
const KEY_LABELS = new Set([
  'Tab', 'Space', 'Esc', 'Caps', 'PgUp', 'PgDn', 'Home', 'End', '1…9',
]);

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
    // Track the section, not just the mode. Without this the parser ingested
    // ANY bare `key = value` line in the file, so `preset = 'qwerty'` from
    // [key-mapping] shipped as a keybinding called PRESET. A config parser that
    // does not know where it is will invent bindings.
    let mode = null;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const section = line.match(/^\[([^\]]+)\]/);
      if (section) {
        const m = section[1].match(/^mode\.(\w+)\.binding$/);
        mode = m ? m[1] : null;
        continue;
      }
      if (mode === null) continue;
      const b = line.match(/^([a-z0-9-]+)\s*=\s*(.+)$/);
      if (!b || line.trimStart().startsWith('#')) continue;
      const parts = b[1].split('-');
      const key = parts.pop();
      if (!parts.every((p) => ALIAS[p])) continue; // not a binding line
      // TOML allows either quote style, and the launchers use double quotes so
      // they can contain the single-quoted app name. Strip the array brackets,
      // take the first command, then strip whichever quotes wrap it — doing it
      // in the other order left a trailing `"` that defeated the match below.
      let action = b[2]
        .replace(/^\[|\]$/g, '')
        .split(',')[0]
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/'/g, '');
      // The launcher bindings are a shell invocation. Printing the raw
      // `exec-and-forget $HOME/.config/aerospace/launch.sh Google Chrome B`
      // buries the only two things a reader wants: which app, which workspace.
      const launcher = action.match(/launch\.sh\s+(.+?)\s+([A-Z])$/);
      if (launcher) action = `abrir ${launcher[1]} · workspace ${launcher[2]}`;
      else action = action.replace(/^exec-and-forget\s+/, '');
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

// ── Keycaps ─────────────────────────────────────────────────────────────────
// canon() emits modifiers in a fixed order then the key, so the string can be
// split back apart deterministically — no need to thread a second
// representation through all six parsers.
const MOD_GLYPHS = ['⌃', '⌥', '⇧', '⌘'];

function splitCombo(combo) {
  let i = 0;
  const mods = [];
  while (i < combo.length && MOD_GLYPHS.includes(combo[i])) mods.push(combo[i++]);
  return { mods, key: combo.slice(i) };
}

/** Modifiers as they should READ: ⌃⌥⌘ collapses to the single Hyper glyph. */
function caps(combo) {
  const { mods, key } = splitCombo(combo);
  const set = new Set(mods);
  const out = [];
  if (set.has('⌃') && set.has('⌥') && set.has('⌘')) {
    out.push({ k: '✦', hyper: true });
    for (const m of ['⌃', '⌥', '⌘']) set.delete(m);
  }
  // Shift last, so Hyper+Shift reads ✦⇧ rather than ⇧✦.
  for (const m of MOD_GLYPHS) if (set.has(m) && m !== '⇧') out.push({ k: m });
  if (set.has('⇧')) out.push({ k: '⇧' });
  if (key) out.push({ k: key, wide: key.length > 1 });
  return out;
}

// ── HTML ────────────────────────────────────────────────────────────────────
const H = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderHtml() {
  // Layer depth is shown as a NUMBER, not a colour.
  //
  // The first attempt gave each layer a stop from the accent ramp. Two things
  // were wrong with it. The gate caught the smaller one: accent.deep is 2.50:1
  // on bgBase, under the 3:1 floor for non-text information. The bigger one is
  // that it broke the rule the whole palette is built on — the accent means
  // IDENTITY and FOCUS, never status or metadata. Which layer owns a key is
  // metadata. And six lightness steps of one hue are barely tellable apart
  // anyway, so the colour was carrying almost no information for the cost.
  //
  // A digit carries it exactly: layer 1 is furthest from you, layer 6 closest.
  const capHtml = (combo) =>
    caps(combo)
      .map(
        (c) =>
          `<kbd class="${c.hyper ? 'cap hyper' : c.wide ? 'cap wide' : 'cap'}">${H(c.k)}</kbd>`,
      )
      .join('');

  // Nobody types ⌘ into a search box. Measured on the finished page: `hyper 2`
  // returned nothing, and so did `cmd t` — which the placeholder suggests —
  // because the index held only the glyphs. Every modifier therefore gets its
  // spoken names alongside its glyph.
  const MOD_WORDS = {
    '⌃': 'ctrl control',
    '⌥': 'alt opt option',
    '⇧': 'shift',
    '⌘': 'cmd command super',
  };

  const searchIndex = (combo, ...text) => {
    const { mods, key } = splitCombo(combo);
    const words = mods.map((m) => MOD_WORDS[m]);
    if (mods.includes('⌃') && mods.includes('⌥') && mods.includes('⌘')) words.push('hyper ✦');
    return [combo, combo.replace('⌃⌥⌘', '✦'), key, ...words, ...text].join(' ').toLowerCase();
  };

  const rowHtml = (r, dup) => {
    const idx = searchIndex(r.combo, r.what, r.layer);
    return `<div class="row" data-s="${H(idx)}" data-l="${H(r.layer)}"${dup ? ' data-dup' : ''}>
<span class="keys">${capHtml(r.combo)}</span>
<span class="what">${H(r.what)}${r.scoped ? '<em class="scoped">local</em>' : ''}</span>
</div>`;
  };

  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => {
      const k = r.combo + r.what;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  // ── Spine: the launchers ──────────────────────────────────────────────────
  // What you actually reach for. Derived from the bindings, not retyped, so it
  // cannot describe a launcher that no longer exists.
  const spine = dedupe(rows.filter((r) => /^abrir /.test(r.what))).sort((a, b) =>
    a.combo.localeCompare(b.combo, undefined, { numeric: true }),
  );

  const sections = LAYERS.map(([layer, scope]) => {
    const list = dedupe(rows.filter((r) => r.layer === layer)).sort((a, b) =>
      a.combo.localeCompare(b.combo, undefined, { numeric: true }),
    );
    if (!list.length) return '';
    return `<section data-layer="${H(layer)}">
<h2><span class="depth" title="capa ${DEPTH[layer] + 1} de ${LAYERS.length}">${
      DEPTH[layer] + 1
    }</span>${H(layer)}<span class="n">${list.length}</span></h2>
<p class="scope">${H(scope)}</p>
<div class="grid">${list.map((r) => rowHtml(r)).join('\n')}</div>
</section>`;
  }).join('\n');

  const conflictHtml = conflicts.length
    ? `<section class="alert" data-layer="__conflicts">
<h2>${conflicts.length === 1 ? 'Un binding muerto' : `${conflicts.length} bindings muertos`}</h2>
<p class="scope">Una capa de más arriba se queda la combinación, así que esto no puede dispararse nunca.</p>
${conflicts
  .map(
    (c) => `<div class="row conflict" data-s="${H(
      searchIndex(c.combo, c.loserWhat, c.winnerWhat, c.loser, c.winner, 'conflicto muerto'),
    )}" data-l="${H(c.loser)}">
<span class="keys">${capHtml(c.combo)}</span>
<span class="what"><b>${H(c.winner)}</b> se la queda para ${H(c.winnerWhat)} — <s>${H(c.loser)}: ${H(c.loserWhat)}</s></span>
</div>`,
  )
  .join('\n')}
</section>`
    : '';

  const chips = LAYERS.map(
    ([l]) =>
      `<button class="chip" data-chip="${H(l)}" aria-pressed="false"><span class="depth">${
        DEPTH[l] + 1
      }</span>${H(l)}</button>`,
  ).join('');

  const total = dedupe(rows).length;

  const js = `var q = document.getElementById('q');
var count = document.getElementById('count');
var empty = document.getElementById('empty');
var rows = [].slice.call(document.querySelectorAll('.row'));
var sections = [].slice.call(document.querySelectorAll('section[data-layer]'));
var chipEls = [].slice.call(document.querySelectorAll('.chip'));
var layer = null;

function paintChips() {
  chipEls.forEach(function (c) {
    c.setAttribute('aria-pressed', String(layer === c.dataset.chip));
  });
}

// Tokenise once, not per keystroke.
rows.forEach(function (r) { r._t = r.dataset.s.split(/[\\s·]+/).filter(Boolean); });

/**
 * A term matches if some token STARTS WITH it, or — for terms of three
 * characters or more — if it appears anywhere in the row.
 *
 * Plain substring matching was measured on the finished page and it was far too
 * loose: "cmd t" returned 160 of 225 rows, because a bare "t" matches inside
 * "ctrl", "option" and "shift". Prefix-on-token makes one- and two-character
 * terms behave like the key they obviously mean, while longer terms stay
 * forgiving enough that "config" still finds "reload-config".
 */
function matches(r, term) {
  for (var i = 0; i < r._t.length; i++) {
    if (r._t[i].lastIndexOf(term, 0) === 0) return true;
  }
  return term.length >= 3 && r.dataset.s.indexOf(term) !== -1;
}

function apply() {
  var terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
  var n = 0;
  rows.forEach(function (r) {
    // A layer filter must not hide the dead-binding warnings for that layer,
    // so conflicts match on their loser layer and stay visible.
    var okLayer = !layer || r.dataset.l === layer;
    var okTerms = terms.every(function (t) { return matches(r, t); });
    var show = okLayer && okTerms;
    r.hidden = !show;
    // The "lo esencial" strip re-shows nine aerospace bindings, so counting
    // every .row read "234 de 225" — more shown than exist. Only rows that are
    // the canonical listing of a binding are counted.
    if (show && !('dup' in r.dataset)) n++;
  });
  sections.forEach(function (s) {
    s.hidden = !s.querySelector('.row:not([hidden])');
  });
  count.textContent = n;
  empty.hidden = n !== 0;
}

q.addEventListener('input', apply);
chipEls.forEach(function (c) {
  c.addEventListener('click', function () {
    layer = layer === c.dataset.chip ? null : c.dataset.chip;
    paintChips();
    apply();
  });
});
document.addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && document.activeElement !== q) {
    e.preventDefault();
    q.focus();
    q.select();
  } else if (e.key === 'Escape') {
    q.value = '';
    layer = null;
    paintChips();
    apply();
  }
});
apply();
`;

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Tells the browser to paint its own chrome dark, so opening a new tab does
     not flash white before the stylesheet lands. -->
<meta name="color-scheme" content="dark">
<title>✦ keymap</title>
<style>
/* GENERATED by tools/keymap.mjs from tools/tokens.mjs — every colour below is
   a token value. Editing this file by hand will be overwritten. */
:root {
  --bg: ${semantic.bgBase};
  --raised: ${semantic.bgRaised};
  --panel: ${semantic.bgPanel};
  --selected: ${semantic.bgSelected};
  --accent-wash: ${semantic.bgAccent};
  --border-muted: ${semantic.borderMuted};
  --border: ${semantic.border};
  /* Boundary of an interactive control at rest. The only edge on this page
     that has to clear 3:1 — see the comment on the token. */
  --border-strong: ${semantic.borderStrong};
  --focus: ${semantic.borderFocus};
  --muted: ${semantic.textMuted};
  --text: ${semantic.text};
  --bright: ${semantic.textBright};
  --accent: ${semantic.textAccent};
  --error: ${state.error};
  --error-wash: ${surfaceTint.error};
  --mono: "JetBrainsMono Nerd Font", "JetBrainsMono NF", ui-monospace, Menlo, monospace;
  --ui: -apple-system, BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif;
}
* { box-sizing: border-box; min-width: 0; }
html { background: var(--bg); }
body {
  margin: 0;
  padding: 0 ${space.xxl}px ${space.xxl * 3}px;
  font: 14px/1.5 var(--ui);
  color: var(--text);
  /* Echoes the wallpaper's bloom so the page belongs to the same system
     instead of being a flat slab of the darkest token. */
  background:
    radial-gradient(90ch 50ch at 50% -18ch, ${accent.wash}66, transparent 70%),
    var(--bg);
  background-attachment: fixed;
}
.wrap { max-width: 1180px; margin: 0 auto; }

/* ── Header ─────────────────────────────────────────────────────────────── */
header {
  position: sticky; top: 0; z-index: 5;
  padding: ${space.xxl}px 0 ${space.lg}px;
  background: linear-gradient(var(--bg) 55%, transparent);
}
h1 {
  margin: 0 0 ${space.xs}px;
  font: 600 ${type.heading}px/1.2 var(--ui);
  letter-spacing: -0.01em;
  color: var(--bright);
}
h1 .mark { color: var(--accent); margin-right: ${space.md}px; }
.tally { color: var(--muted); font-family: var(--mono); font-size: 12px; }
.tally b { color: var(--muted); font-weight: 500; }

.search {
  display: flex; align-items: center; gap: ${space.md}px;
  margin: ${space.lg}px 0 ${space.md}px;
  padding: 0 ${space.lg}px;
  background: var(--raised);
  border: ${stroke.hairline}px solid var(--border-strong);
  border-radius: ${radius.round}px;
  transition: border-color ${motion.fast}ms, box-shadow ${motion.fast}ms;
}
.search:focus-within {
  border-color: var(--focus);
  box-shadow: 0 0 0 ${stroke.regular}px ${accent.wash};
}
.search svg { flex: none; color: var(--muted); }
#q {
  flex: 1; min-width: 0;
  padding: ${space.lg}px 0;
  border: 0; outline: 0; background: none;
  font: 15px var(--mono); color: var(--text);
}
#q::placeholder { color: var(--muted); }
kbd.hint {
  flex: none; padding: 1px ${space.sm + 1}px;
  border: ${stroke.hairline}px solid var(--border); border-radius: ${radius.tight}px;
  font: 11px var(--mono); color: var(--muted);
}

.chips { display: flex; flex-wrap: wrap; gap: ${space.sm + 2}px; }
.chip {
  display: inline-flex; align-items: center; gap: ${space.sm + 2}px;
  padding: ${space.sm + 1}px ${space.lg}px;
  background: var(--raised);
  border: ${stroke.hairline}px solid var(--border-strong);
  border-radius: ${radius.pill}px;
  font: 12px var(--mono); color: var(--muted);
  cursor: pointer;
  transition: color ${motion.fast}ms, border-color ${motion.fast}ms, background ${motion.fast}ms;
}
.chip:hover { color: var(--text); border-color: var(--border); }
.chip[aria-pressed="true"] {
  color: var(--bright); background: var(--selected); border-color: var(--focus);
}
.depth {
  display: inline-grid; place-items: center;
  width: 16px; height: 16px; flex: none;
  border-radius: ${radius.tight}px;
  background: var(--panel);
  font: 500 10px var(--mono); color: var(--muted);
}
.depth.accent { background: var(--accent-wash); color: var(--accent); }

/* ── Sections ───────────────────────────────────────────────────────────── */
section { margin: ${space.xxl * 1.5}px 0 0; }
section[hidden] { display: none; }
h2 {
  display: flex; align-items: center; gap: ${space.md}px;
  margin: 0 0 ${space.xs}px;
  font: 600 13px var(--mono); color: var(--bright);
  text-transform: lowercase; letter-spacing: 0.04em;
}
h2 .n {
  padding: 0 ${space.sm + 2}px;
  border-radius: ${radius.pill}px; background: var(--panel);
  font-weight: 400; font-size: 11px; color: var(--muted);
}
.scope { margin: 0 0 ${space.lg}px; color: var(--muted); font-size: 12.5px; max-width: 74ch; }

.grid {
  display: grid; gap: ${space.xs}px;
  grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr));
}
.row {
  display: grid; grid-template-columns: minmax(96px, 38%) 1fr;
  align-items: baseline; gap: ${space.lg}px;
  padding: ${space.sm + 2}px ${space.md}px;
  border-radius: ${radius.tight}px;
  border-left: ${stroke.regular}px solid transparent;
}
.row[hidden] { display: none; }
.row:hover { background: var(--raised); border-left-color: var(--focus); }
.keys { display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
.what { color: var(--muted); overflow-wrap: anywhere; }
.row:hover .what { color: var(--text); }
.scoped {
  margin-left: ${space.md}px; padding: 0 ${space.sm + 1}px;
  border: ${stroke.hairline}px solid var(--border-muted); border-radius: ${radius.tight}px;
  font: normal 10px var(--mono); color: var(--muted); vertical-align: 1px;
}

/* ── Keycaps ────────────────────────────────────────────────────────────── */
.cap {
  min-width: 22px; padding: 2px ${space.sm + 1}px;
  background: var(--panel);
  border: ${stroke.hairline}px solid var(--border);
  border-bottom-width: ${stroke.regular}px;
  border-radius: ${radius.tight}px;
  font: 12px/1.35 var(--mono); color: var(--text);
  text-align: center;
}
.cap.wide { min-width: 0; }
/* Hyper is the identity key of this setup, so it is the one cap that carries
   the accent. Nothing else does — the accent means identity and focus. */
.cap.hyper {
  background: var(--accent-wash);
  border-color: var(--focus);
  color: var(--accent);
}

/* ── Dead bindings ──────────────────────────────────────────────────────── */
.alert {
  padding: ${space.lg}px ${space.xl}px ${space.xl}px;
  background: var(--error-wash);
  border: ${stroke.hairline}px solid var(--error);
  border-radius: ${radius.soft}px;
}
.alert h2 { color: var(--error); text-transform: none; letter-spacing: 0; }
.row.conflict { grid-template-columns: minmax(96px, 38%) 1fr; }
.row.conflict s { color: var(--muted); }
.row.conflict b { color: var(--text); font-weight: 600; }

.empty { color: var(--muted); font-family: var(--mono); padding: ${space.xxl}px 0; }
.empty[hidden] { display: none; }

footer {
  margin-top: ${space.xxl * 2}px; padding-top: ${space.lg}px;
  border-top: ${stroke.hairline}px solid var(--border-muted);
  color: var(--muted); font-size: 12px;
}
footer code { font-family: var(--mono); color: var(--muted); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>

<div class="wrap">
<header>
  <h1><span class="mark">✦</span>keymap</h1>
  <div class="tally"><b id="count">${total}</b> de ${total} atajos · ${
    LAYERS.length
  } capas · <b>✦</b> es Hyper (⌃⌥⌘, en Caps Lock)</div>
  <label class="search">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 10l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <input id="q" type="search" autofocus autocomplete="off" spellcheck="false"
           placeholder="busca una tecla o una acción — hyper 2, cmd t, workspace, chrome…">
    <kbd class="hint">/</kbd>
  </label>
  <div class="chips">${chips}</div>
</header>

${conflictHtml}

<section data-layer="__spine">
  <h2><span class="depth accent">✦</span>lo esencial<span class="n">${spine.length}</span></h2>
  <p class="scope">Hyper + número. Enfoca la ventana donde esté; solo lanza la app si no hay ninguna.</p>
  <div class="grid">${spine.map((r) => rowHtml(r, true)).join('\n')}</div>
</section>

${sections}

<p class="empty" id="empty" hidden>Nada coincide.</p>

<footer>
  Generado por <code>tools/keymap.mjs</code> leyendo los configs de verdad —
  ${total} atajos en ${LAYERS.length} capas.
  Las capas están en orden de entrega: la de arriba se queda la tecla primero.
  <code>/</code> para buscar, <code>Esc</code> para limpiar.
</footer>
</div>

<script src="keymap.js"></script>
`;

  return { html, js };
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

md += `---\n\nRegenerate with \`node tools/keymap.mjs\`. \`--check\` fails if either output is
stale or if a shadowed binding exists.

\`chrome/keymap/\` is the same data as a Chrome extension that overrides the New
Tab page. It must work with no network at all.\n`;

// ── Emit ────────────────────────────────────────────────────────────────────
const page = renderHtml();
const OUTPUTS = [
  ['docs/KEYMAP.md', md],
  // The page lives in the extension directory rather than in docs/ so there is
  // exactly one copy of it. Two copies of a generated file is just drift with
  // extra steps.
  ['chrome/keymap/index.html', page.html],
  ['chrome/keymap/keymap.js', page.js],
];

/**
 * Assertions that belong to the page rather than to the data.
 *
 * The generated configs cannot drift from the tokens because they are
 * generated — but "generated" only guarantees the value came from tokens.mjs,
 * not that the PAIRING is legible. These two checks cover the gap.
 */
function auditHtml(html) {
  const problems = [];

  // 0. Exactly the spine rows may be marked as duplicates.
  //
  //    `list.map(rowHtml)` passes Array.map's INDEX as the second argument, so
  //    the duplicate flag was set on every row except the first of each
  //    section. The page then reported "6 de 225 atajos". Nothing threw, the
  //    layout was fine, and only the number was wrong — so the number is what
  //    gets asserted.
  const marked = (html.match(/ data-dup>/g) ?? []).length;
  const spineCount = rows.filter((r) => /^abrir /.test(r.what)).length;
  if (marked !== spineCount) {
    problems.push(
      `${marked} rows are flagged as duplicates but the spine has ${spineCount} — the tally will be wrong`,
    );
  }

  // 1. Every colour in the page must be a token value. A hand-tweaked hex here
  //    would be invisible: the page would still look fine, and it would stop
  //    following the palette the next time the accent changes.
  const known = new Set(
    [
      ...Object.values(semantic), ...Object.values(accent), ...Object.values(state),
      ...Object.values(surfaceTint),
    ].map((h) => h.toLowerCase()),
  );
  for (const [, hex] of html.matchAll(/(#[0-9a-fA-F]{6})[0-9a-fA-F]{0,2}/g)) {
    if (!known.has(hex.toLowerCase())) problems.push(`${hex} in keymap.html is not a token value`);
  }

  // 2. Every foreground/background PAIRING the page actually uses, at the
  //    threshold that applies to it. "Generated from tokens" only guarantees
  //    the value came from tokens.mjs — it says nothing about whether the two
  //    tokens are legible together. This table is what caught textDim being
  //    used for the section descriptions at 4.24:1.
  //
  //    Thresholds: AAA 7:1 for body text, AA 4.5:1 for secondary text, and
  //    WCAG 1.4.11's 3:1 for non-text information — which here means the
  //    boundary of an interactive control and the focus ring, and nothing else.
  const S = semantic;
  const PAIRS = [
    ['text', 'bgBase', S.text, S.bgBase, 7, 'body copy'],
    ['textBright', 'bgBase', S.textBright, S.bgBase, 7, 'h1, h2'],
    ['textMuted', 'bgBase', S.textMuted, S.bgBase, 4.5, 'actions, scope, tally'],
    ['textMuted', 'bgRaised', S.textMuted, S.bgRaised, 4.5, 'hovered action, placeholder'],
    ['textMuted', 'bgPanel', S.textMuted, S.bgPanel, 4.5, 'depth badge, count pill'],
    ['textAccent', 'bgBase', S.textAccent, S.bgBase, 4.5, 'the ✦ mark'],
    ['textAccent', 'bgAccent', S.textAccent, S.bgAccent, 4.5, 'Hyper keycap'],
    ['text', 'bgPanel', S.text, S.bgPanel, 7, 'keycap legend'],
    ['error', 'surfaceTint.error', state.error, surfaceTint.error, 4.5, 'dead-binding card'],
    ['borderStrong', 'bgRaised', S.borderStrong, S.bgRaised, 3, 'search field, chips'],
    ['borderFocus', 'bgBase', S.borderFocus, S.bgBase, 3, 'focus ring, active chip'],
  ];
  // 3. No unmapped source keycode may ship as a keycap.
  for (const r of rows) {
    const { key } = splitCombo(r.combo);
    if (key.length > 1 && !KEY_LABELS.has(key)) {
      problems.push(
        `${r.layer}: key label "${key}" is a raw source keycode — add it to KEYNAME`,
      );
    }
  }

  for (const [fg, bg, fgHex, bgHex, min, use] of PAIRS) {
    const r = contrast(fgHex, bgHex);
    if (r < min) {
      problems.push(
        `${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1 — used for ${use}`,
      );
    }
  }
  return problems;
}

/**
 * The Chrome extension half.
 *
 * Manifest V3 enforces `script-src 'self'` on extension pages, so an inline
 * <script> does not error — it is simply never executed. The page would render
 * perfectly and the search box would do nothing, with no message anywhere. That
 * is the same silent-failure shape as sketchybar's missing font and pi's
 * discarded keybindings.json, so it gets a gate.
 */
function auditExtension() {
  const problems = [];
  const dir = join(ROOT, 'chrome/keymap');
  const manifestPath = join(dir, 'manifest.json');

  if (!existsSync(manifestPath)) return ['chrome/keymap/manifest.json is missing'];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return [`chrome/keymap/manifest.json does not parse: ${e.message}`];
  }

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
  }

  // Every path the manifest names must exist. A missing icon makes Chrome
  // refuse to load the extension outright.
  const referenced = [
    manifest.chrome_url_overrides?.newtab,
    ...Object.values(manifest.icons ?? {}),
  ].filter(Boolean);
  if (!manifest.chrome_url_overrides?.newtab) {
    problems.push('manifest declares no chrome_url_overrides.newtab — nothing would override the New Tab');
  }
  for (const rel of referenced) {
    if (!existsSync(join(dir, rel))) {
      problems.push(`manifest references chrome/keymap/${rel}, which does not exist`);
    }
  }

  const htmlPath = join(dir, 'index.html');
  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, 'utf8');
    // An opening <script> with no src attribute before its closing bracket.
    for (const [tag] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)) {
      problems.push(`index.html has an inline ${tag} — Manifest V3 blocks it silently`);
    }
    for (const [, src] of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
      if (/^https?:/.test(src)) problems.push(`index.html loads ${src} over the network`);
      else if (!existsSync(join(dir, src))) problems.push(`index.html loads missing ${src}`);
    }
    if (/<link[^>]*\bhref="https?:/.test(html)) {
      problems.push('index.html pulls a stylesheet over the network — it must work offline');
    }
  }
  return problems;
}

if (CHECK) {
  let bad = 0;
  for (const [rel, content] of OUTPUTS) {
    const p = join(ROOT, rel);
    const current = existsSync(p) ? readFileSync(p, 'utf8') : '';
    if (current !== content) {
      console.log(` FAIL  ${rel} is stale — run: node tools/keymap.mjs`);
      bad++;
    } else {
      console.log(`  ok    ${rel} is current`);
    }
  }
  for (const p of [...auditHtml(page.html), ...auditExtension()]) {
    console.log(` FAIL  ${p}`);
    bad++;
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

for (const [rel, content] of OUTPUTS) writeFileSync(join(ROOT, rel), content);
for (const p of [...auditHtml(page.html), ...auditExtension()]) {
  console.log(` WARN  ${p}`);
}
console.log(
  `  wrote docs/KEYMAP.md + chrome/keymap/ — ${rows.length} bindings across ${
    new Set(rows.map((r) => r.layer)).size
  } layers, ${conflicts.length} shadowed`,
);
