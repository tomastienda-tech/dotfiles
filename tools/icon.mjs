#!/usr/bin/env node
// Draws the ✦ mark as the Chrome extension's icon.
//
//   node tools/icon.mjs
//
// The glyph is not typeset — it is solved. A four-pointed sparkle is the
// superellipse |x/r|^p + |y/r|^p ≤ 1 with p below 1, which makes the sides
// concave and the points sharp. p = 1 would give a diamond, p = 2 a circle.
//
// Drawing it rather than rendering the character avoids depending on a font
// being installed and on a rasteriser that does not work on this machine (see
// tools/png.mjs), and it means the icon is generated from the same tokens as
// everything else instead of being an exported asset that quietly goes stale.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oklch, hexToOklch } from './color.mjs';
import { encodePng } from './png.mjs';
import { semantic, accent } from './tokens.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SIZE = 128;
const POINTINESS = 0.55; // below 1 → concave sides; lower is spikier
const RADIUS = 0.46; // fraction of the canvas half-width
const SS = 4; // supersampling factor per axis

// Everything stays in OKLab until the last step, so the bloom has no muddy
// midpoint — the same reason the wallpaper interpolates there rather than in
// sRGB. Note oklch() returns FLOAT RGB in 0..1, not a hex string: mixing has to
// happen before that conversion, never after it.
const toLab = (h) => {
  const { L, C, H } = hexToOklch(h);
  const r = (H * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
};
const mixLab = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const labToRgb = ([L, a, b]) =>
  oklch(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI);

const BG_LAB = toLab(semantic.bgRaised);
const WASH_LAB = toLab(accent.wash);
const MARK_LAB = toLab(accent.base);

// Precompute the bloom ramp; 64 steps is smooth at this size and saves the
// per-sample trigonometry.
const STEPS = 64;
const ramp = Array.from({ length: STEPS + 1 }, (_, i) =>
  mixLab(BG_LAB, WASH_LAB, i / STEPS),
);

const inStar = (x, y) => {
  const r = RADIUS;
  return (
    Math.pow(Math.abs(x) / r, POINTINESS) + Math.pow(Math.abs(y) / r, POINTINESS) <= 1
  );
};

const rgb = Buffer.alloc(SIZE * SIZE * 3);
const mark = hexToOklch(accent.base);

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    // Supersample: coverage of the star within this pixel, so the points are
    // smooth instead of stair-stepped.
    let hits = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = ((px + (sx + 0.5) / SS) / SIZE) * 2 - 1;
        const y = ((py + (sy + 0.5) / SS) / SIZE) * 2 - 1;
        if (inStar(x, y)) hits++;
      }
    }
    const coverage = hits / (SS * SS);

    // Background: a radial wash toward the centre, echoing the page's bloom.
    const cx = (px / SIZE) * 2 - 1;
    const cy = (py / SIZE) * 2 - 1;
    const d = Math.min(1, Math.hypot(cx, cy));
    const bg = ramp[Math.round((1 - d) * STEPS)];

    // Compose the mark over it by coverage, still in OKLab.
    const lab = coverage === 0 ? bg : mixLab(bg, MARK_LAB, coverage);
    const [r, g, b] = labToRgb(lab);
    const i = (py * SIZE + px) * 3;
    rgb[i] = Math.round(r * 255);
    rgb[i + 1] = Math.round(g * 255);
    rgb[i + 2] = Math.round(b * 255);
  }
}

const out = join(ROOT, 'chrome/keymap/icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(SIZE, SIZE, rgb));
console.log(
  `  wrote chrome/keymap/icon.png — ${SIZE}×${SIZE}, mark ${accent.base} (L ${mark.L.toFixed(
    2,
  )}) on ${semantic.bgRaised}`,
);
