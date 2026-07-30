// ═══════════════════════════════════════════════════════════════════════════
// IRIS — design tokens (single source of truth)
// ═══════════════════════════════════════════════════════════════════════════
//
// Authored in OKLCH so lightness steps are perceptually even, then resolved to
// sRGB hex. Every token below has ONE semantic job, documented inline. If a
// colour has no semantic job, it does not belong here.
//
// THE CENTRAL RULE
// ────────────────
// The accent is IDENTITY and FOCUS. It is never a STATE.
//   • Accent answers "where am I / what is active / whose thing is this".
//   • Green / amber / crimson / teal answer "what happened".
//
// WHY VIOLET, AND NOT THE PREVIOUS CORAL
// ──────────────────────────────────────
// Coral (#ff7a6b, hue 32°) sat in the red-orange band — the same band as the
// error colour. `check-contrast.mjs` measured only 0.13 ΔE between them, right
// at the floor. An accent that can be misread as a failure state is a bug, not
// a preference: a focused pane border and a failing test should never trade
// places at a glance.
//
// The status hues are effectively reserved — amber 85°, green 150°, teal 195°,
// crimson 355°. That leaves the blue-violet arc as the only region with real
// headroom. Violet at 305° sits ~50° from crimson and ~110° from teal, giving
// 0.17 ΔE against error (vs coral's 0.13) while reading unmistakably as
// "identity", not "status". It is also the one accent that never appears in a
// diff, a test result, or a git status — so it cannot collide with meaning.
//
// WHY VIOLET-TINTED NEUTRALS
// ──────────────────────────
// The previous configs mixed neutrals from Catppuccin, TokyoNight and Kanagawa
// under a single accent. Beyond being inconsistent, a cold blue-grey substrate
// fights a warm accent. The ramp below sits at hue 292° — the same family as
// the accent, at very low chroma. Warm enough nowhere, cold enough nowhere:
// it simply agrees with the accent, so violet looks chosen rather than dropped
// on top.

import { hex } from './color.mjs';

// ── Neutral ramp ────────────────────────────────────────────────────────────
// Chroma tapers as lightness rises: dark surfaces carry the violet cast, text
// resolves to near-neutral so syntax colours stay honest.
const H_INK = 292;

export const ink = {
  0: hex(0.145, 0.012, H_INK), // deepest — terminal bg, app bg, wallpaper floor
  1: hex(0.190, 0.014, H_INK), // raised — sidebar, cards, statusline
  2: hex(0.235, 0.015, H_INK), // panel — tool blocks, floats, popups
  3: hex(0.285, 0.016, H_INK), // selection bg, hover, active row
  4: hex(0.355, 0.016, H_INK), // border muted — subtle dividers, indent guides
  5: hex(0.450, 0.015, H_INK), // border default — pane dividers, inactive edge
  6: hex(0.560, 0.013, H_INK), // dim — comments, timestamps, disabled
  7: hex(0.700, 0.011, H_INK), // muted — secondary text, labels, tool output
  8: hex(0.845, 0.008, H_INK), // body — primary text
  9: hex(0.955, 0.005, H_INK), // emphasis — headings, cursor, high contrast
};

// ── Identity: iris ──────────────────────────────────────────────────────────
// One hue, five stops. `base` is THE accent; everything else exists so hover,
// borders and washes stay in-family instead of reaching for a new colour.
const H_IRIS = 305;

export const accent = {
  // Sits just below ink[3] in lightness with noticeably more chroma, so a
  // selected-and-focused row reads as "same elevation, the accent owns it"
  // while still clearing 3:1 against textDim.
  wash: hex(0.275, 0.070, H_IRIS), //   tinted bg behind selected items
  deep: hex(0.450, 0.130, H_IRIS), //   inactive-but-owned edges, underlines
  dim: hex(0.620, 0.160, H_IRIS), //    secondary accent text, muted borders
  base: hex(0.720, 0.175, H_IRIS), //   THE accent — focus ring, active pane, cursor
  bright: hex(0.835, 0.120, H_IRIS), // hover, headings, emphasis-on-accent
  // Two more stops above `bright`, so an intensity ramp can climb past the
  // accent without leaving its hue. Used by the reasoning-effort scale, which
  // previously jumped to amber at the top — a hue change reads as a change of
  // KIND, not of degree, and it made the one warm pixel in a violet UI.
  pale: hex(0.905, 0.075, H_IRIS),
  lit: hex(0.960, 0.035, H_IRIS),
};

// ── States ──────────────────────────────────────────────────────────────────
// Each answers "what happened". None may be confused with the accent, and the
// ΔE gates in check-contrast.mjs enforce that mechanically.
export const state = {
  success: hex(0.780, 0.150, 150), // green   — added lines, passing, connected
  info: hex(0.780, 0.110, 195), //    teal    — links, bash mode, ports, neutral info
  warning: hex(0.830, 0.140, 85), //  amber   — modified, pending, degraded
  // A true red (22°), not the rose-red the old coral accent forced it into.
  // With a violet accent there is no longer anything to hide from, so error
  // gets to look like an error. Lightness is held high enough for 4.5:1 on
  // bgPanel.
  error: hex(0.655, 0.200, 22), //    red     — removed lines, failing, errors
  special: hex(0.760, 0.130, 265), // blue    — meta, keywords, untracked
};

// ── Tinted surfaces ─────────────────────────────────────────────────────────
// A block background that carries state (a failed tool call, a pending diff).
// Same lightness as bgPanel so blocks sit at one elevation; only the hue moves.
// Low enough chroma that body text still clears AAA on top.
export const tint = (hue) => hex(0.235, 0.032, hue);

export const surfaceTint = {
  pending: tint(85), //   amber   — running / queued
  success: tint(150), //  green   — completed
  error: tint(22), //     red     — failed
  special: tint(265), //  blue    — injected / meta
};

// ── Chrome surface ──────────────────────────────────────────────────────────
// The system bar and the notch island. Deliberately LIGHTER than the border
// tone (ink[4], what JankyBorders draws for an inactive window) so the desktop
// furniture reads as a distinct layer sitting above the windows, rather than
// as another near-black slab merging into them.
//
// The relationship is the point, not the value: check-contrast.mjs asserts
// bgChrome is lighter than borderMuted, so nudging the ramp cannot silently
// invert it.
export const bgChrome = hex(0.375, 0.014, 292);

// Status colours for use ON bgChrome.
//
// The normal set is tuned for a near-black terminal; on a surface this light
// the darkest of them (error, L 0.65) falls to 2.6:1, under the 3:1 WCAG
// non-text minimum. A low-battery icon or an error dot on the bar has to be
// *seen*, so the chrome surface gets lifted variants rather than the surface
// being darkened back down to accommodate them.
//
// Same hues, same meanings — only lightness moves.
export const stateOnChrome = {
  success: hex(0.860, 0.140, 150),
  info: hex(0.860, 0.095, 195),
  warning: hex(0.900, 0.120, 85),
  error: hex(0.780, 0.170, 22),
  special: hex(0.850, 0.110, 265),
};

// ── Semantic surface / text assignments ─────────────────────────────────────
// Apps consume THESE, not the raw ramp. One name, one job.
export const semantic = {
  bgBase: ink[0], //      window / terminal background
  bgRaised: ink[1], //    sidebar, statusline, tab bar
  bgPanel: ink[2], //     floating windows, tool call blocks, completion menu
  bgSelected: ink[3], //  selected row, visual selection, current line
  bgAccent: accent.wash, //selected-and-focused row

  borderMuted: ink[4], // indent guides, table rules, inactive dividers
  border: ink[5], //      pane dividers, float borders, inactive window edge
  borderFocus: accent.base, // focused pane, active window, focus ring

  // The boundary of an INTERACTIVE component at rest — a text field, a button.
  //
  // Measured, because this was a surprise: on these dark surfaces neither
  // `border` nor `borderMuted` can satisfy WCAG 1.4.11's 3:1 for non-text
  // contrast. Against bgRaised they land at 2.47:1 and 1.65:1. ink[6] is the
  // FIRST stop on the ramp that clears it (3.94:1), so that is what this is —
  // not a value picked to look right.
  //
  // Quiet borders are correct in a terminal, where every edge competes with
  // text you are reading and nothing on screen is a form control. They are not
  // correct for a control the user has to find. So the two cases get two
  // tokens instead of one token and a compromise.
  //
  // Decorative edges — section rules, the outline of a keycap — keep using
  // `border`/`borderMuted`. 1.4.11 covers information needed to IDENTIFY a
  // component or its state; the outline of a glyph-shaped ornament is neither,
  // and the keycap's own text carries 10.36:1.
  borderStrong: ink[6],

  textDim: ink[6], //     comments, timestamps, disabled, line numbers
  textMuted: ink[7], //   secondary text, labels, tool output, paths
  text: ink[8], //        body text
  textBright: ink[9], //  headings, cursor, emphasised text
  textAccent: accent.bright, // headings that carry identity, active labels
};

// ── ANSI 16 ─────────────────────────────────────────────────────────────────
// Terminal palette. Normal = readable on bgBase; bright = emphasis, not noise.
// black/white slots come from the ramp so terminal apps blend with the chrome.
export const ansi = {
  // ink[3] rather than ink[2]: apps that print ANSI black as *foreground* need
  // it to be visible against the terminal background at all.
  black: ink[3],
  red: state.error,
  green: state.success,
  yellow: state.warning,
  blue: state.special, //    true blue 265°
  magenta: accent.base, //   the iris accent owns the magenta slot
  cyan: state.info, //       teal 195°
  white: ink[7],
  brightBlack: ink[5],
  brightRed: hex(0.750, 0.175, 22),
  brightGreen: hex(0.860, 0.140, 150),
  brightYellow: hex(0.900, 0.120, 85),
  brightBlue: hex(0.850, 0.110, 265),
  brightMagenta: accent.bright,
  brightCyan: hex(0.860, 0.095, 195),
  brightWhite: ink[9],
};

// ── Categorical palette ─────────────────────────────────────────────────────
// For labelling things that are merely DIFFERENT, not better or worse — cmux
// workspaces, and nothing else. Even hue spacing at fixed L and C means no
// entry is louder than its neighbours, so a workspace never looks more urgent
// than another just because of the colour it drew.
// Iris leads the list: it is the accent, so it reads as "the default one".
const CATEGORICAL_L = 0.72;
const CATEGORICAL_C = 0.145;

export const categorical = Object.fromEntries(
  [
    ['Iris', 305],
    ['Rose', 340],
    ['Red', 22],
    ['Ember', 55],
    ['Amber', 85],
    ['Lime', 120],
    ['Green', 150],
    ['Jade', 175],
    ['Teal', 198],
    ['Sky', 225],
    ['Blue', 262],
  ].map(([name, hue]) => [name, hex(CATEGORICAL_L, CATEGORICAL_C, hue)]),
);
// One deliberately colourless entry, for workspaces that should not shout.
categorical.Slate = ink[5];

// ── Non-colour scales ───────────────────────────────────────────────────────
// Spacing is a 4px base with a 2px half-step for dense terminal chrome.
export const space = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24 };

// Radius: one soft value for large surfaces, one tight value for chips/pills.
// Anything smaller than 4px reads as an artefact at HiDPI, so there is no 2px.
export const radius = { tight: 4, soft: 8, round: 12, pill: 999 };

// Border widths. Only ONE surface may use `focus` at a time — see
// docs/DESIGN.md "focus hierarchy".
export const stroke = { hairline: 1, regular: 2, focus: 3, window: 4 };

// Motion: terminal chrome should feel instant. Anything above 180ms reads as
// lag when it sits next to text you are actively reading.
export const motion = {
  instant: 0,
  fast: 90, // hover, selection change
  base: 140, // pane focus change, notification in
  slow: 180, // window/workspace transitions
  easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
};

// Type scale for GUI surfaces (cmux markdown, sketchybar). Terminal type size
// is owned by Ghostty's font-size and is deliberately not duplicated here.
export const type = {
  micro: 10, // sketchybar secondary labels
  small: 11, // sketchybar primary labels
  body: 13, // cmux sidebar, UI body
  reading: 15, // cmux markdown body — long-form reading
  heading: 18,
};

export const meta = {
  name: 'Iris',
  slug: 'iris',
  accent: accent.base,
  appearance: 'dark',
};
