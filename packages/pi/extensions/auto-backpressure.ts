/**
 * Auto-Backpressure Extension
 *
 * Automatically runs validation commands on modified files and injects results back to the agent.
 * Use this to keep the agent on track with type checking, linting, tests, or any custom validation.
 *
 * Config via .pi/backpressure.json in project root:
 * {
 *   "commands": {
 *     "**\/*.{ts,tsx}": {
 *       "name": "typecheck",
 *       "run": "bash -c '! (bun tsgo 2>&1 | rg \"{files_pattern}\")'"
 *     },
 *     "**\/*.py": {
 *       "name": "ruff",
 *       "run": "ruff check {files}"
 *     }
 *   },
 *   "trigger": {
 *     "modifications": 5,
 *     "files": 3
 *   }
 * }
 *
 * Placeholders:
 *   {files} - Space-separated quoted file paths: "file1" "file2"
 *   {files_pattern} - Regex pattern for grep/rg: (file1|file2)
 *
 * Triggers when EITHER threshold is hit (whichever comes first).
 * On pass: clears file buffer
 * On fail: keeps files in buffer, injects errors to agent
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Glob matching - use Bun.Glob if available, else minimatch
declare const Bun: { Glob: new (pattern: string) => { match: (path: string) => boolean } } | undefined;
const globMatch: (path: string, pattern: string) => boolean = (() => {
	if (typeof Bun !== "undefined" && Bun?.Glob) {
		return (path: string, pattern: string) => new Bun.Glob(pattern).match(path);
	}
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { minimatch } = require("minimatch") as { minimatch: (p: string, pat: string) => boolean };
	return minimatch;
})();

interface CommandConfig {
	name: string;
	run: string;
}

interface BackpressureConfig {
	commands: Record<string, CommandConfig | string>; // glob -> {name, run} or just run string
	trigger: {
		modifications?: number;
		files?: number;
	};
}

const DEFAULT_TRIGGER = {
	modifications: 5,
	files: 3,
};

const DEFAULT_CONFIG: BackpressureConfig = {
	commands: {},
	trigger: DEFAULT_TRIGGER,
};

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// State
	let config: BackpressureConfig = DEFAULT_CONFIG;
	let modifiedFiles: Set<string> = new Set();
	let modificationCount = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Load config from .pi/backpressure.json
	function loadConfig(): BackpressureConfig {
		const configPath = join(cwd, ".pi", "backpressure.json");
		if (existsSync(configPath)) {
			try {
				const raw = readFileSync(configPath, "utf-8");
				const parsed = JSON.parse(raw) as Partial<BackpressureConfig>;

				return {
					commands: parsed.commands ?? {},
					trigger: {
						modifications: parsed.trigger?.modifications ?? DEFAULT_TRIGGER.modifications,
						files: parsed.trigger?.files ?? DEFAULT_TRIGGER.files,
					},
				};
			} catch (err) {
				console.error("Failed to parse .pi/backpressure.json:", err);
			}
		}
		return DEFAULT_CONFIG;
	}

	// Normalize command config to {name, run}
	function normalizeCommand(cmd: CommandConfig | string): CommandConfig {
		if (typeof cmd === "string") {
			// Extract name from command (first word)
			const name = (cmd.split(" ")[0] ?? "check").replace(/^.*\//, ""); // basename
			return { name, run: cmd };
		}
		return cmd;
	}

	// Find command for a file (using glob patterns)
	function findCommand(filePath: string): CommandConfig | undefined {
		for (const [pattern, cmd] of Object.entries(config.commands)) {
			if (globMatch(filePath, pattern)) {
				return normalizeCommand(cmd);
			}
		}
		return undefined;
	}

	// Group files by their command
	function groupFilesByCommand(files: Set<string>): Map<CommandConfig, string[]> {
		const groups = new Map<CommandConfig, string[]>();
		for (const file of files) {
			const cmd = findCommand(file);
			if (cmd) {
				// Find existing group with same run command
				let existingKey: CommandConfig | undefined;
				for (const key of groups.keys()) {
					if (key.run === cmd.run) {
						existingKey = key;
						break;
					}
				}
				if (existingKey) {
					const list = groups.get(existingKey);
					if (list) list.push(file);
				} else {
					groups.set(cmd, [file]);
				}
			}
		}
		return groups;
	}

	// Escape string for use in regex
	function escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	// Run commands and return results
	function runCommands(fileGroups: Map<CommandConfig, string[]>): {
		passed: boolean;
		errors: { name: string; files: string[]; cmd: string; output: string }[];
		fileCount: number;
	} {
		const errors: { name: string; files: string[]; cmd: string; output: string }[] = [];
		let fileCount = 0;

		for (const [cmdConfig, files] of fileGroups) {
			fileCount += files.length;
			const filesArg = files.map((f) => `"${f}"`).join(" ");
			const filesPattern = `(${files.map((f) => escapeRegex(f)).join("|")})`;
			const cmd = cmdConfig.run.replace("{files}", filesArg).replace("{files_pattern}", filesPattern);

			try {
				execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
			} catch (err: unknown) {
				const execErr = err as { stdout?: string; stderr?: string };
				const output = `${execErr.stdout ?? ""}${execErr.stderr ?? ""}`.trim();
				if (output) {
					errors.push({ name: cmdConfig.name, files, cmd, output });
				}
			}
		}

		return { passed: errors.length === 0, errors, fileCount };
	}

	// Check if we should trigger
	function shouldTrigger(): boolean {
		const { modifications, files } = config.trigger;
		if (modifications && modificationCount >= modifications) return true;
		if (files && modifiedFiles.size >= files) return true;
		return false;
	}

	// Schedule backpressure check with debounce
	function scheduleBackpressure(ctx: ExtensionContext) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			checkBackpressure(ctx);
		}, 500);
	}

	// Run backpressure check and inject results
	async function checkBackpressure(ctx: ExtensionContext) {
		if (modifiedFiles.size === 0) return;
		if (Object.keys(config.commands).length === 0) return;
		if (!shouldTrigger()) return;

		const fileGroups = groupFilesByCommand(modifiedFiles);
		if (fileGroups.size === 0) {
			modifiedFiles.clear();
			modificationCount = 0;
			return;
		}

		const commandNames = Array.from(fileGroups.keys()).map((c) => c.name).join(", ");
		const fileCount = modifiedFiles.size;

		// Show status in footer while running
		if (ctx.hasUI) {
			ctx.ui.setStatus("backpressure", `⏳ ${commandNames}...`);
		}

		const startTime = Date.now();
		const { passed, errors } = runCommands(fileGroups);
		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

		// Clear status
		if (ctx.hasUI) {
			ctx.ui.setStatus("backpressure", undefined);
		}

		if (passed) {
			modifiedFiles.clear();
			modificationCount = 0;
			if (ctx.hasUI) {
				ctx.ui.notify(`✓ ${commandNames} passed (${fileCount} files, ${elapsed}s)`, "info");
			}
		} else {
			modificationCount = 0;
			const errorOutput = errors
				.map((e) => `✗ ${e.name} failed\n\nFiles: ${e.files.join(", ")}\n\n${e.output}\n\nRun: ${e.cmd}`)
				.join("\n\n---\n\n");

			if (ctx.hasUI) {
				ctx.ui.notify(`✗ ${commandNames} failed (${fileCount} files, ${elapsed}s)`, "error");
			}

			pi.sendMessage(
				{
					customType: "backpressure",
					content: errorOutput,
					display: true,
				},
				{
					triggerTurn: true,
					deliverAs: ctx.isIdle() ? "steer" : "followUp",
				},
			);
		}
	}

	// Track file modifications
	function trackFile(filePath: string) {
		const normalized = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
		modifiedFiles.add(normalized);
		modificationCount++;
	}

	// Get git dirty files (modified + untracked)
	function getGitDirtyFiles(): Set<string> {
		try {
			// Get both modified and untracked files
			const out = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
			const files = out
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => line.slice(3)); // Remove status prefix (e.g., " M ", "?? ")
			return new Set(files);
		} catch {
			return new Set();
		}
	}

	// State for bash file tracking
	let bashFilesBefore: Set<string> = new Set();

	// Load config on start
	pi.on("session_start", async () => {
		config = loadConfig();
	});

	// Track git state before bash execution
	pi.on("tool_call", async (event) => {
		if (event.toolName.toLowerCase() === "bash") {
			bashFilesBefore = getGitDirtyFiles();
		}
	});

	// Hook into tool results to track modifications
	pi.on("tool_result", async (event, ctx) => {
		const toolName = event.toolName.toLowerCase();

		if (toolName === "write" || toolName === "edit") {
			const path = event.input?.["path"] as string | undefined;
			if (path) {
				trackFile(path);
				scheduleBackpressure(ctx);
			}
		} else if (toolName === "bash") {
			// Check what files changed during bash execution
			const filesAfter = getGitDirtyFiles();
			for (const f of filesAfter) {
				if (!bashFilesBefore.has(f)) {
					trackFile(f);
				}
			}
			bashFilesBefore.clear();
			scheduleBackpressure(ctx);
		}
	});

	// Status command
	pi.registerCommand("bp-status", {
		description: "Show backpressure buffer & config",
		handler: async (_args, ctx) => {
			const fileList = Array.from(modifiedFiles).map((f) => `  ${f}`).join("\n");
			const commands = Object.entries(config.commands)
				.map(([glob, cmd]) => {
					const c = normalizeCommand(cmd);
					return `  ${glob}: ${c.name}`;
				})
				.join("\n") || "  (none)";
			ctx.ui.notify(
				`Buffer: ${modifiedFiles.size} file(s), ${modificationCount} mod(s)\n` +
					`Trigger: ${config.trigger.modifications} mods OR ${config.trigger.files} files\n` +
					`Commands:\n${commands}` +
					(fileList ? `\nFiles:\n${fileList}` : ""),
				"info",
			);
		},
	});

	// Manual run command
	pi.registerCommand("bp", {
		description: "Run backpressure checks on buffered files",
		handler: async (_args, ctx) => {
			if (modifiedFiles.size === 0) {
				ctx.ui.notify("No modified files to check", "info");
				return;
			}

			const fileGroups = groupFilesByCommand(modifiedFiles);
			if (fileGroups.size === 0) {
				ctx.ui.notify("No commands configured for modified file types", "warning");
				return;
			}

			const commandNames = Array.from(fileGroups.keys()).map((c) => c.name).join(", ");
			const fileCount = modifiedFiles.size;

			// Show status in footer while running
			if (ctx.hasUI) {
				ctx.ui.setStatus("backpressure", `⏳ ${commandNames}...`);
			}

			const startTime = Date.now();
			const { passed, errors } = runCommands(fileGroups);
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

			// Clear status
			if (ctx.hasUI) {
				ctx.ui.setStatus("backpressure", undefined);
			}

			if (passed) {
				modifiedFiles.clear();
				modificationCount = 0;
				ctx.ui.notify(`✓ ${commandNames} passed (${fileCount} files, ${elapsed}s)`, "info");
			} else {
				modificationCount = 0;
				const errorOutput = errors
					.map((e) => `✗ ${e.name} failed\n\nFiles: ${e.files.join(", ")}\n\n${e.output}\n\nRun: ${e.cmd}`)
					.join("\n\n---\n\n");
				ctx.ui.notify(`✗ ${commandNames} failed (${fileCount} files, ${elapsed}s)`, "error");

				pi.sendMessage(
					{
						customType: "backpressure",
						content: errorOutput,
						display: true,
					},
					{
						triggerTurn: true,
						deliverAs: ctx.isIdle() ? "steer" : "followUp",
					},
				);
			}
		},
	});
}
