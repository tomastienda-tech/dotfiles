import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

/**
 * /keys — show the raw bytes of whatever key you press.
 *
 * Three layers eat keystrokes before pi sees them: cmux (a GUI app, so it owns
 * every ⌘ combination via the menu bar), then the Ghostty surface, then pi's
 * own bindings. Guessing which layer swallowed a key is how bad keymaps get
 * written, so this measures it instead.
 *
 * If a key produces no line here, something upstream consumed it and no pi
 * keybinding will ever fire for it.
 */

/**
 * Turn a raw escape sequence into something a human can act on.
 *
 * Exported so the decoding can be unit-tested against real sequences rather
 * than only being exercised by pressing keys.
 */
export function describe(data: string): string {
	const bytes = [...data].map((c) => c.charCodeAt(0));

	// ESC + single char is how a terminal transmits Alt/Option+key — which on
	// macOS only happens when macos-option-as-alt is set.
	if (bytes.length === 2 && bytes[0] === 27) {
		const c = data[1];
		if (c >= " " && c <= "~") return `⌥${c.toUpperCase()}   (alt+${c.toLowerCase()})`;
	}
	if (bytes.length === 1) {
		const b = bytes[0];
		if (b === 27) return "esc";
		if (b === 13) return "enter";
		if (b === 9) return "tab";
		if (b === 127) return "backspace";
		// C0 control codes are ctrl+letter: 1 = ctrl+a, 26 = ctrl+z.
		if (b >= 1 && b <= 26) return `⌃${String.fromCharCode(64 + b)}   (ctrl+${String.fromCharCode(96 + b)})`;
		if (b >= 32 && b <= 126) return `${data}   (plain)`;
	}
	// CSI sequences: arrows, function keys, and modified keys under the Kitty
	// protocol. The parameters carry the modifier mask.
	if (data.startsWith("\x1b[")) return `CSI  ${JSON.stringify(data.slice(1))}`;
	return JSON.stringify(data);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		let stop: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const end = (cmdCtx: ExtensionContext) => {
			stop?.();
			stop = undefined;
			if (timer) clearTimeout(timer);
			cmdCtx.ui.setWidget("iris.keys", undefined);
		};

		pi.registerCommand("keys", {
			description: "Probe which keys actually reach pi through cmux and the terminal",
			async handler(_args: string, cmdCtx: ExtensionContext) {
				if (stop) {
					end(cmdCtx);
					return;
				}

				const seen: string[] = [];
				const draw = () => {
					// A factory, not a plain string[]: a static array cannot know the
					// terminal width, and pi hard-crashes on any line wider than it.
					const lines = [
							"",
							`  ${cmdCtx.ui.theme.fg("accent", "⌨  key probe")}  ${cmdCtx.ui.theme.fg("dim", "press keys · esc to finish · auto-stops in 30s")}`,
							...(seen.length === 0
								? [`  ${cmdCtx.ui.theme.fg("borderMuted", "nothing captured yet")}`]
								: seen.slice(-8).map((s) => `  ${s}`)),
							"",
					];
					cmdCtx.ui.setWidget(
						"iris.keys",
						() => ({
							invalidate() {},
							render: (w: number) => lines.map((l) => truncateToWidth(l, w)),
						}),
						{ placement: "aboveEditor" },
					);
				};
				draw();

				stop = cmdCtx.ui.onTerminalInput((data) => {
					// Always let Esc through as the exit, so the probe can never
					// trap the terminal in a state the user cannot leave.
					if (data === "\x1b") {
						end(cmdCtx);
						return { consume: true };
					}
					const t = cmdCtx.ui.theme;
					const hex = [...data].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
					seen.push(`${t.fg("text", describe(data).padEnd(26))}${t.fg("dim", hex)}`);
					draw();
					// Swallow it: this is a probe, not typing.
					return { consume: true };
				});

				// A handler that consumes every keystroke is a trap if anything
				// goes wrong, so it expires on its own regardless.
				timer = setTimeout(() => end(cmdCtx), 30_000);
			},
		});

		pi.on("session_shutdown", () => {
			stop?.();
			if (timer) clearTimeout(timer);
		});
	});
}
