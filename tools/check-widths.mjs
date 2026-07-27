#!/usr/bin/env node
// Renders every pi widget at hostile widths and asserts no line overflows.
//
//   node tools/check-widths.mjs
//
// pi does not clip: TUI.doRender throws and takes the whole session down with
// "Rendered line N exceeds terminal width". It happened for real — an imported
// chat had been auto-named from its first sentence, and the state widget
// concatenated that name unclamped:
//
//   [597] (w=84) ● xhigh · gpt-5.6-sol · The following is the Codex agent…
//
// on a 71-column terminal. docs/DESIGN.md already said "render() must never
// return a line wider than width"; the rule existed and the widget broke it.
// So this measures instead of trusting.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  failures++;
  console.log(` FAIL  ${m}`);
};

// Widths worth testing: a split cmux pane, the width that actually crashed,
// something tiny, and something wide.
const WIDTHS = [20, 34, 40, 71, 88, 120];

// The real name from the crash, plus something worse.
const NAMES = [
  undefined,
  'iris',
  'The following is the Codex agent history whose request activity spans several days',
  'x'.repeat(400),
];

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const visible = (s) => [...strip(s)].length;

const theme = {
  fg: (_c, s) => s,
  bold: (s) => s,
};

async function loadExtension(file) {
  const path = join(ROOT, 'pi/extensions', file);
  if (!existsSync(path)) return null;
  // The extensions are TypeScript; Node strips types natively.
  return (await import(path)).default;
}

async function collectWidgets(file, sessionName) {
  const mod = await loadExtension(file);
  if (!mod) return {};

  const widgets = {};
  let header;
  const handlers = {};
  const pi = {
    on: (e, h) => {
      handlers[e] = h;
    },
    getSessionName: () => sessionName,
    registerCommand: () => {},
    registerShortcut: () => {},
  };
  mod(pi);

  const ctx = {
    mode: 'tui',
    cwd: '/Users/someone/Documents/a/deeply/nested/project/path/that/keeps/going',
    model: { id: 'gpt-5.6-sol' },
    thinkingLevel: 'xhigh',
    getContextUsage: () => ({ percent: 93.4, tokens: 254000, contextWindow: 272000 }),
    sessionManager: { getSessionFile: () => '/tmp/x.jsonl' },
    ui: {
      theme,
      setTitle() {},
      setHiddenThinkingLabel() {},
      setWorkingIndicator() {},
      setStatus() {},
      setWorkingMessage() {},
      notify() {},
      onTerminalInput: () => () => {},
      setHeader: (f) => {
        header = f;
      },
      setWidget: (k, f) => {
        if (typeof f === 'function') widgets[k] = f;
        else if (Array.isArray(f)) widgets[k] = () => ({ render: () => f });
      },
    },
  };
  await handlers.session_start?.({}, ctx);
  if (header) widgets['__header'] = header;
  return widgets;
}

const FILES = ['iris-ui.ts', 'iris-toys.ts', 'iris-keys.ts', 'iris-fx.ts', 'iris-side.ts'];

let checked = 0;
for (const file of FILES) {
  for (const name of NAMES) {
    let widgets;
    try {
      widgets = await collectWidgets(file, name);
    } catch (e) {
      bad(`${file} threw while registering: ${e.message}`);
      continue;
    }
    for (const [key, factory] of Object.entries(widgets)) {
      for (const width of WIDTHS) {
        let lines;
        try {
          lines = factory(null, theme).render(width) ?? [];
        } catch (e) {
          bad(`${file} ${key} threw at width ${width}: ${e.message}`);
          continue;
        }
        checked++;
        for (const [i, line] of lines.entries()) {
          const w = visible(line);
          if (w > width) {
            bad(
              `${file} ${key} line ${i} is ${w} wide at width ${width}` +
                `${name ? ` (session name ${name.length} chars)` : ''} — pi would crash`,
            );
          }
        }
      }
    }
  }
}

if (failures === 0) {
  ok(`${checked} renders across ${WIDTHS.length} widths and ${NAMES.length} session names, none overflow`);
}

console.log('\n' + '═'.repeat(76));
console.log(failures === 0 ? 'PASS\n' : `FAIL — ${failures} overflow(s)\n`);
process.exit(failures === 0 ? 0 : 1);
