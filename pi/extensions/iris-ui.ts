import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Iris UI — a bordered welcome panel.
 *
 * The header is the FIRST child of pi's layout, before the chat container, so
 * it scrolls away as the conversation grows rather than pinning a box to the
 * top forever. That is what makes a panel this tall acceptable.
 *
 * Nothing here uses setFooter: pi's built-in footer already carries cwd, git
 * branch, session name, the token breakdown, cache hit rate, context
 * percentage and cost, and replacing it would only take information away.
 */

/** Actions pi ships with NO default binding — the reason this panel exists. */
const SESSION_ACTIONS: ReadonlyArray<readonly [string, string]> = [
	["app.session.new", "new session"],
	["app.session.tree", "session tree"],
	["app.session.fork", "fork"],
	["app.session.resume", "resume"],
];

const COMMANDS: ReadonlyArray<readonly [string, string]> = [
	["/side", "fork beside this"],
	["/palette", "theme colours"],
	["/gauge", "context detail"],
	["/review", "review staged"],
];

/**
 * Render key names the way macOS prints them on the keys themselves.
 *
 * "alt+n" is meaningless on a Mac keyboard — the key is labelled ⌥ Option.
 * Showing the glyph is the difference between a hint and a puzzle.
 */
function macKey(spec: string): string {
	const GLYPH: Record<string, string> = {
		alt: "⌥",
		option: "⌥",
		ctrl: "⌃",
		shift: "⇧",
		cmd: "⌘",
		super: "⌘",
		meta: "⌘",
	};
	const parts = spec.split("+");
	const key = parts.pop() ?? "";
	const mods = new Set(parts.map((m) => m.toLowerCase()));

	// ⌃⌥⌘ together is the Hyper key. Spelling it out as four glyphs makes a
	// hint longer than the label it describes, so it collapses to one mark —
	// the same key the Karabiner config calls Hyper.
	let prefix = "";
	if (mods.has("ctrl") && mods.has("alt") && (mods.has("super") || mods.has("cmd"))) {
		prefix = "✦";
		mods.delete("ctrl");
		mods.delete("alt");
		mods.delete("super");
		mods.delete("cmd");
	}
	// Fixed order so two bindings with the same modifiers always look the same.
	for (const m of ["ctrl", "alt", "shift", "super", "cmd", "meta"]) {
		if (mods.has(m)) prefix += GLYPH[m];
	}
	return prefix + (key.length === 1 ? key.toUpperCase() : key);
}

/**
 * Resolve a binding from pi's own keybindings.json.
 *
 * Deliberately tolerant: pi parses that file with a bare JSON.parse inside
 * `catch { return undefined }`, so a malformed file means pi is ALSO running
 * without these bindings. Advertising them then would be a lie, and showing
 * nothing is the honest result.
 */
let cachedBindings: Record<string, string | string[]> | null | undefined;
function boundKey(id: string): string | undefined {
	if (cachedBindings === undefined) {
		try {
			cachedBindings = JSON.parse(
				readFileSync(join(homedir(), ".pi/agent/keybindings.json"), "utf8"),
			) as Record<string, string | string[]>;
		} catch {
			cachedBindings = null;
		}
	}
	const raw = cachedBindings?.[id];
	const key = Array.isArray(raw) ? raw[0] : raw;
	return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * Context pressure. Grey until it matters — colour is a signal, and a gauge
 * that is always coloured has spent it before there is anything to say.
 */
function pressure(pct: number): { colour: ThemeColor; note: string } {
	if (pct >= 90) return { colour: "error", note: "compacting soon" };
	if (pct >= 75) return { colour: "warning", note: "" };
	return { colour: "dim", note: "" };
}

/**
 * Fade a run of border characters from the accent into the neutral border.
 *
 * The panel is an IDENTITY element, so accent on its frame is on-system —
 * unlike the context gauge, which reports STATUS and must never use it. The
 * fade puts the brightest edge next to the title and lets the frame dissolve
 * away from it, which is the reading order.
 *
 * Only theme keys are available (no arbitrary hex), so the ramp is the three
 * stops the theme actually exposes.
 */
const BORDER_FADE: ThemeColor[] = ["accent", "border", "borderMuted"];

function fadedRule(t: { fg(c: ThemeColor, s: string): string }, char: string, len: number): string {
	if (len <= 0) return "";
	// Weighted so the accent segment is short and the tail is long: a fade that
	// spends half the line on the bright stop reads as a coloured rule, not a fade.
	const weights = [0.18, 0.28, 0.54];
	let out = "";
	let used = 0;
	for (let i = 0; i < BORDER_FADE.length; i++) {
		const n = i === BORDER_FADE.length - 1 ? len - used : Math.round(len * weights[i]);
		if (n > 0) out += t.fg(BORDER_FADE[i], char.repeat(n));
		used += n;
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		const project = () => basename(ctx.cwd) || ctx.cwd;

		ctx.ui.setTitle(`pi · ${project()}`);
		ctx.ui.setHiddenThinkingLabel("✦ reasoning");

		// ── Above the input: state, right-aligned ──────────────────────────
		// Everything here is "what am I about to talk to", which is exactly the
		// question you ask in the moment before typing. Right-aligned so it sits
		// out of the way of the prompt itself.
		const THINKING_DOT: Record<string, ThemeColor> = {
			off: "thinkingOff",
			minimal: "thinkingMinimal",
			low: "thinkingLow",
			medium: "thinkingMedium",
			high: "thinkingHigh",
			xhigh: "thinkingXhigh",
			max: "thinkingMax",
		};

		ctx.ui.setWidget(
			"iris.state",
			(_tui, t) => ({
				invalidate() {},
				render(width: number): string[] {
					const level = ctx.thinkingLevel;
					const parts: string[] = [];
					if (level) {
						// The dot carries the effort level as colour, so the ramp is
						// readable without reading.
						parts.push(`${t.fg(THINKING_DOT[level] ?? "dim", "●")} ${t.fg("muted", level)}`);
					}
					if (ctx.model?.id) parts.push(t.fg("dim", ctx.model.id));
					const name = pi.getSessionName();
					if (name) parts.push(t.fg("accent", name));
					if (parts.length === 0) return [];

					const line = parts.join(t.fg("borderMuted", " · "));
					const pad = Math.max(0, width - visibleWidth(line) - 2);
					return [" ".repeat(pad) + line];
				},
			}),
			{ placement: "aboveEditor" },
		);

		// ── Below the input: context on the left, how-to on the right ──────
		ctx.ui.setWidget(
			"iris.rail",
			(_tui, t) => ({
				invalidate() {},
				render(width: number): string[] {
					const usage = ctx.getContextUsage();
					const pct = usage?.percent ?? null;
					const cells = 14;

					let gauge: string;
					if (pct === null) {
						// Unknown is a real state, not zero: before the first response
						// and right after a compaction pi does not know the count. An
						// empty bar would claim the context is empty instead.
						gauge = t.fg("borderMuted", "┈".repeat(cells) + "  —");
					} else {
						const { colour, note } = pressure(pct);
						const filled = Math.round((pct / 100) * cells);
						gauge =
							t.fg(colour, "━".repeat(filled)) +
							t.fg("borderMuted", "┈".repeat(Math.max(0, cells - filled))) +
							t.fg(pct >= 75 ? colour : "borderMuted", `  ${pct.toFixed(0)}%`) +
							(note ? t.fg(colour, `  ${note}`) : "");
					}

					const hints = [
						["/", "commands"],
						["!", "bash"],
					]
						.map(([k, l]) => `${t.fg("muted", k)} ${t.fg("dim", l)}`)
						.join(t.fg("borderMuted", " · "));

					const gap = width - visibleWidth(gauge) - visibleWidth(hints) - 4;
					// Drop the hints rather than wrapping or overlapping them.
					if (gap < 3) return ["  " + gauge];
					return ["  " + gauge + " ".repeat(gap) + hints];
				},
			}),
			{ placement: "belowEditor" },
		);

		pi.on("session_shutdown", () => {
			ctx.ui.setWidget("iris.state", undefined);
			ctx.ui.setWidget("iris.rail", undefined);
		});

		ctx.ui.setHeader((_tui, theme) => ({
			// render() reads the theme live rather than pre-baking colours, so
			// there is nothing cached to throw away on invalidate.
			invalidate() {},
			render(width: number): string[] {
				// Cap the panel: a border stretched across an ultrawide terminal
				// reads as a table, not a card.
				const w = Math.min(width - 2, 92);

				// Too narrow for a frame — degrade to one line rather than drawing
				// a broken box.
				if (w < 34) {
					return [
						"",
						truncateToWidth(
							`  ${theme.fg("accent", "✦ pi")} ${theme.fg("dim", "·")} ${theme.fg("text", project())}`,
							width,
						),
						"",
					];
				}

				const B = (s: string) => theme.fg("borderMuted", s);
				const inner = w - 2;

				/** Pad by VISIBLE width — ANSI escapes break String.length. */
				const row = (content: string): string => {
					const pad = Math.max(0, inner - visibleWidth(content));
					return ` ${B("│")}${content}${" ".repeat(pad)}${B("│")}`;
				};

				const title = ` ${theme.fg("accent", theme.bold("✦ pi"))} ${theme.fg("borderMuted", "·")} ${theme.fg("text", project())} `;
				const top =
					` ${theme.fg("accent", "╭─")}${title}` +
					`${fadedRule(theme, "─", Math.max(0, inner - visibleWidth(title) - 2))}${B("╮")}`;
				// Bottom stays uniformly quiet: two lit edges would fight, and the
				// eye should land on the title, not the frame.
				const bottom = ` ${B(`╰${"─".repeat(inner)}╯`)}`;

				// ── Left column: what this session IS ──────────────────────────
				// Labelled rows rather than a bare list: the values line up, and a
				// glance can find the one it wants instead of parsing all three.
				// padEnd must exceed the longest label, or the longest one ends up
				// with no gap at all — "effort" is exactly 6 characters.
				const LABEL_W = 8;
				const field = (label: string, value: string, colour: ThemeColor = "text") =>
					`${theme.fg("borderMuted", label.padEnd(LABEL_W))}${theme.fg(colour, value)}`;
				const left: string[] = [field("model", ctx.model?.id ?? "no model")];
				if (ctx.thinkingLevel) left.push(field("effort", ctx.thinkingLevel, "muted"));
				left.push(field("cwd", ctx.cwd.replace(homedir(), "~"), "dim"));

				// ── Right column: how to drive it ──────────────────────────────
				const right: Array<[string, string]> = [];
				for (const [id, label] of SESSION_ACTIONS) {
					const key = boundKey(id);
					if (key) right.push([macKey(key), label]);
				}
				for (const [cmd, label] of COMMANDS) right.push([cmd, label]);

				const keyW = right.reduce((m, [k]) => Math.max(m, visibleWidth(k)), 0);
				const labelW = right.reduce((m, [, l]) => Math.max(m, l.length), 0);
				const leftW = left.reduce((m, l) => Math.max(m, visibleWidth(l)), 0);

				// Two columns only when both fit with a real gutter; otherwise the
				// hints stack under the identity block.
				const gutter = 4;
				const twoCol = leftW + gutter + keyW + 2 + labelW + 4 <= inner;

				const hint = ([k, label]: [string, string]) =>
					theme.fg("accent", k) +
					" ".repeat(Math.max(1, keyW - visibleWidth(k) + 2)) +
					theme.fg("dim", label);

				const lines: string[] = [row("")];

				if (twoCol) {
					const rows = Math.max(left.length, right.length + 1);
					for (let i = 0; i < rows; i++) {
						const l = left[i] ?? "";
						const lPad = " ".repeat(Math.max(0, leftW - visibleWidth(l)));
						const r =
							i === 0
								? theme.fg("accent", theme.bold("getting started"))
								: right[i - 1]
									? hint(right[i - 1])
									: "";
						lines.push(row(`  ${l}${lPad}${" ".repeat(gutter)}${r}`));
					}
				} else {
					for (const l of left) lines.push(row(`  ${l}`));
					lines.push(row(""));
					for (const r of right) lines.push(row(`  ${hint(r)}`));
				}

				lines.push(row(""));
				// truncateToWidth is the backstop: render() must never return a
				// line wider than `width`.
				return ["", top, ...lines, bottom, ""].map((l) => truncateToWidth(l, width));
			},
		}));
	});
}
