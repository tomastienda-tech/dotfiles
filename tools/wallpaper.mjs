#!/usr/bin/env node
// Renders the Iris wallpapers straight to PNG.
//
//   node tools/wallpaper.mjs
//
// Written as a pixel renderer rather than an SVG because this machine has no
// working SVG rasteriser (ImageMagick's `svg` delegate points at rsvg-convert,
// which is not installed, so filters and gradients silently render black).
// Doing it directly also buys two things that matter here:
//   • gradients interpolated in OKLab, so the bloom has no muddy midpoint
//   • per-pixel dithering, without which a gradient this dark and this large
//     bands visibly on a 10-bit XDR panel

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oklch, hexToOklch } from './color.mjs';
import { encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Composition ─────────────────────────────────────────────────────────────

const toLab = (h) => {
  const { L, C, H } = hexToOklch(h);
  const r = (H * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
};
const fromLab = (L, a, b) => {
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return oklch(L, C, H);
};

// Deterministic value noise. Math.random() would make every rebuild produce a
// different file, which turns the wallpaper into permanent git churn.
function noise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) - 0.5;
}

const smooth = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c); // smoothstep — no visible edge where the bloom ends
};

function render(width, height, opts) {
  const field = toLab(opts.field);
  const bloomA = toLab(opts.bloomA);
  const bloomB = toLab(opts.bloomB);
  const diag = Math.hypot(width, height);

  const ax = 0.27 * width;
  const ay = 0.33 * height;
  const ar = 0.62 * diag;
  const bx = 0.83 * width;
  const by = 0.87 * height;
  const br = 0.45 * diag;

  const buf = Buffer.alloc(width * height * 3);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wA = smooth(1 - Math.hypot(x - ax, y - ay) / ar);
      const wB = smooth(1 - Math.hypot(x - bx, y - by) / br) * 0.55;

      let L = field[0] + (bloomA[0] - field[0]) * wA;
      let a = field[1] + (bloomA[1] - field[1]) * wA;
      let b = field[2] + (bloomA[2] - field[2]) * wA;
      L += (bloomB[0] - L) * wB;
      a += (bloomB[1] - a) * wB;
      b += (bloomB[2] - b) * wB;

      // Grain, applied in lightness only so it stays colourless.
      L += noise(x, y) * opts.grain;

      const rgb = fromLab(L, a, b);
      for (let c = 0; c < 3; c++) {
        // ±0.5 LSB dither breaks up banding in the smooth regions.
        const v = rgb[c] * 255 + noise(x + c * 7919, y + c * 104729);
        buf[i++] = Math.min(255, Math.max(0, Math.round(v)));
      }
    }
  }
  return buf;
}

// ── Variants ────────────────────────────────────────────────────────────────
// Calibrated against ink[0] (#0a090f), the app background. The bloom peaks
// slightly ABOVE it (~25,17,40) and the far corners fall slightly below it
// (~10,11,20). That is the point: app windows are almost black, so a desktop
// that were uniformly darker still would leave window edges invisible without
// a border. A gentle violet field gives every window a legible edge on the
// bloom side while the corners stay deep enough that the screen never reads
// as bright.
// Amplitude is deliberately tiny. At the bloom's brightest the lift over the
// field is ~13/255 — enough to give the screen depth, not enough for any point
// on the desktop to out-brighten a terminal window sitting on top of it.
const DARK = { field: '#08070d', bloomA: '#191128', bloomB: '#0c1020', grain: 0.0045 };
const LIGHT = { field: '#f5f3f8', bloomA: '#e9dff6', bloomB: '#e2e7f3', grain: 0.003 };

const TARGETS = [
  ['dark', DARK, 3024, 1964], // built-in XDR panel
  ['dark', DARK, 5120, 2880], // 5K external
  ['dark', DARK, 3840, 2160], // 4K external
  ['dark', DARK, 2560, 1440], // 1440p external
  ['light', LIGHT, 3024, 1964],
];

mkdirSync(join(ROOT, 'wallpapers'), { recursive: true });
for (const [variant, opts, w, h] of TARGETS) {
  const png = encodePng(w, h, render(w, h, opts));
  const rel = `wallpapers/iris-${variant}-${w}x${h}.png`;
  writeFileSync(join(ROOT, rel), png);
  console.log(`  wrote  ${rel.padEnd(42)} ${(png.length / 1024).toFixed(0)} KB`);
}
