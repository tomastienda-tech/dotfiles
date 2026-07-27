import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * /side — fork this session into a cmux pane beside it.
 *
 * For the "hold on, let me check something" conversation: same context, a
 * separate thread, without losing the place in this one.
 *
 * THREE STEPS, because no single command does it:
 *   1. pi   — sessionManager.getSessionFile() gives the file on disk
 *   2. cmux — `new-pane` creates the split, but takes NO command
 *   3. cmux — `send` types `pi --fork <file>` into the new surface
 *
 * The socket is reachable because this runs inside a cmux surface, which is
 * the only context cmux accepts connections from under socketControlMode:
 * cmuxOnly. Outside cmux the command refuses rather than half-working.
 */

const CMUX = process.env.CMUX_BUNDLED_CLI_PATH ?? "/Applications/cmux.app/Contents/MacOS/cmux";

/** cmux prints refs like `surface:3`, or UUIDs with --id-format. Take either. */
function parseSurfaceId(stdout: string): string | undefined {
	const ref = stdout.match(/\bsurface:(\d+)\b/);
	if (ref) return ref[0];
	const uuid = stdout.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
	return uuid?.[0];
}

async function cmux(args: string[]): Promise<string> {
	const env = { ...process.env, CMUX_QUIET: "1" };
	// --socket is how cmux's own generated hooks authenticate; without it the
	// call is refused even from inside.
	const sock = process.env.CMUX_SOCKET_PATH;
	const full = sock ? ["--socket", sock, ...args] : args;
	const { stdout } = await run(CMUX, full, { env, timeout: 10_000 });
	return stdout;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		pi.registerCommand("side", {
			description: "Fork this session into a cmux pane beside this one",
			async handler(args: string, cmdCtx: ExtensionContext) {
				// Refuse clearly rather than producing a half-broken pane.
				if (!process.env.CMUX_SURFACE_ID) {
					cmdCtx.ui.notify("/side needs to run inside cmux", "error");
					return;
				}

				const file = cmdCtx.sessionManager.getSessionFile();
				if (!file) {
					// --no-session, or nothing written yet. Forking a session that
					// does not exist on disk would silently open an empty one.
					cmdCtx.ui.notify("This session has no file to fork from", "error");
					return;
				}

				const label = args.trim();

				try {
					// --focus false: the point is to keep working here while the
					// fork boots. Focusing would defeat the whole command.
					const out = await cmux(["new-pane", "--direction", "right", "--focus", "false"]);
					const surface = parseSurfaceId(out);
					if (!surface) {
						cmdCtx.ui.notify(`Pane created but its id could not be read: ${out.trim()}`, "error");
						return;
					}

					// The new pane starts a login shell; typing before the prompt
					// exists loses the input. There is no readiness signal to wait
					// on, so this polls read-screen for a prompt-ish line instead of
					// guessing a delay.
					for (let i = 0; i < 20; i++) {
						await new Promise((r) => setTimeout(r, 150));
						try {
							const screen = await cmux(["read-screen", "--surface", surface, "--lines", "4"]);
							if (/[$%>❯]\s*$|\n\s*$/.test(screen)) break;
						} catch {
							// read-screen can race the surface being registered.
						}
					}

					const cmd = [
						"pi",
						"--fork",
						JSON.stringify(file),
						...(label ? ["--name", JSON.stringify(`side: ${label}`)] : []),
					].join(" ");
					await cmux(["send", "--surface", surface, `${cmd}\n`]);

					// If a prompt was given, send it once pi is up so the fork starts
					// on the question rather than on an empty editor.
					if (label) {
						await new Promise((r) => setTimeout(r, 1200));
						await cmux(["send", "--surface", surface, `${label}\n`]);
					}

					cmdCtx.ui.notify(`Forked into ${surface}`, "info");
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					cmdCtx.ui.notify(`/side failed: ${msg}`, "error");
				}
			},
		});
	});
}
