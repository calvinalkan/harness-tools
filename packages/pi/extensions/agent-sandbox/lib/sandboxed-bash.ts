/**
 * Sandboxed Bash Tool
 *
 * Wraps bash commands in agent-sandbox for filesystem/network isolation,
 * with helpful error messages for sandbox-related failures.
 *
 * Usage:
 *   import { createSandboxedBashTool } from "./lib/sandboxed-bash.ts";
 *
 *   // Default: sandboxing enabled
 *   const tool = createSandboxedBashTool(cwd, { network: false });
 *
 *   // Disable sandboxing (just error hints, e.g., when already sandboxed)
 *   const tool = createSandboxedBashTool(cwd, { enabled: false });
 *
 *   // Dynamic config per command
 *   const tool = createSandboxedBashTool(cwd, {
 *     configure: (command) => ({ network: command.startsWith("npm ") })
 *   });
 */
import { spawn } from "node:child_process";

import { type BashOperations, createBashTool } from "@mariozechner/pi-coding-agent";

// Error patterns that indicate sandbox restrictions
const SANDBOX_ERROR_PATTERNS = [
	"EROFS",
	"Read-only file system",
	"read-only file system",
	"Permission denied",
	"EACCES",
	"Operation not permitted",
	"EPERM",
	"Device or resource busy",
	"EBUSY",
	"Text file busy",
	"ETXTBSY",
];

const SANDBOX_HINT = `

Note: This may have failed due to sandbox restrictions. Workarounds won't help - just let the user know and move on.`;

/**
 * Sandbox configuration - mirrors agent-sandbox CLI options
 */
type SandboxConfig = {
	/** Enable network access (default: true) */
	network?: boolean;
	/** Enable docker socket access */
	docker?: boolean;
	/** Read-only paths */
	ro?: string[];
	/** Read-write paths */
	rw?: string[];
	/** Excluded paths */
	exclude?: string[];
	/**
	 * Command rules:
	 * - false: block command
	 * - true: explicitly allow (raw)
	 * - "@preset": use preset (e.g., "@git")
	 * - "/path": wrap with script
	 */
	cmd?: Record<string, boolean | string>;
	/** Print debug info to stderr */
	debug?: boolean;
};

type SandboxedBashOptions = {
	/**
	 * Enable sandbox wrapping (default: true)
	 * Set to false to skip sandboxing (e.g., when already inside a sandbox)
	 * Error hints are always provided regardless of this setting.
	 */
	enabled?: boolean;

	/**
	 * Per-command configuration function.
	 * Called for each command to get sandbox config.
	 * Returned config is merged with base options.
	 */
	configure?: (command: string) => SandboxConfig | null;
} & SandboxConfig;

export { type SandboxConfig, type SandboxedBashOptions, createSandboxedBashTool };

/**
 * Create a sandboxed bash tool with error hints
 *
 * @param cwd - Working directory
 * @param options - Sandbox options (enabled: true by default)
 */
function createSandboxedBashTool(
	cwd: string,
	options: SandboxedBashOptions = {},
): ReturnType<typeof createBashTool> & {
	execute: (
		toolCallId: string,
		params: { command: string; timeout?: number },
		signal?: AbortSignal,
		onUpdate?: Parameters<ReturnType<typeof createBashTool>["execute"]>[3],
	) => Promise<Awaited<ReturnType<ReturnType<typeof createBashTool>["execute"]>>>;
} {
	const enabled = options.enabled !== false; // Default: true

	// Create base tool - with or without sandbox operations
	const baseTool = enabled
		? createBashTool(cwd, { operations: createSandboxedOperations(options) })
		: createBashTool(cwd);

	// Wrap to add error hints
	return {
		...baseTool,
		async execute(
			toolCallId: string,
			params: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?: Parameters<typeof baseTool.execute>[3],
		): Promise<Awaited<ReturnType<typeof baseTool.execute>>> {
			try {
				return await baseTool.execute(toolCallId, params, signal, onUpdate);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				if (isSandboxError(message)) {
					throw new Error(`${message}${SANDBOX_HINT}`, { cause: err });
				}
				throw err;
			}
		},
	};
}

// --- Helper functions ---

function isSandboxError(text: string): boolean {
	return SANDBOX_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * Build agent-sandbox CLI arguments from config
 */
function buildSandboxArgs(cwd: string, config: SandboxConfig): string[] {
	const args: string[] = [];

	args.push("-C", cwd);

	if (config.network === false) {
		args.push("--network=false");
	}

	if (config.docker === true) {
		args.push("--docker");
	}

	if (config.debug === true) {
		args.push("--debug");
	}

	if (config.ro) {
		for (const path of config.ro) {
			args.push("--ro", path);
		}
	}

	if (config.rw) {
		for (const path of config.rw) {
			args.push("--rw", path);
		}
	}

	if (config.exclude) {
		for (const path of config.exclude) {
			args.push("--exclude", path);
		}
	}

	if (config.cmd) {
		for (const [cmdName, rule] of Object.entries(config.cmd)) {
			args.push("--cmd", `${cmdName}=${rule}`);
		}
	}

	return args;
}

/**
 * Merge two sandbox configs (later values override)
 */
function mergeConfigs(base: SandboxConfig, override: SandboxConfig | null): SandboxConfig {
	if (override === null) {
		return base;
	}

	const merged: SandboxConfig = {
		ro: [...(base.ro ?? []), ...(override.ro ?? [])],
		rw: [...(base.rw ?? []), ...(override.rw ?? [])],
		exclude: [...(base.exclude ?? []), ...(override.exclude ?? [])],
		cmd: { ...base.cmd, ...override.cmd },
	};

	const network = override.network ?? base.network;
	if (typeof network === "boolean") {
		merged.network = network;
	}

	const docker = override.docker ?? base.docker;
	if (typeof docker === "boolean") {
		merged.docker = docker;
	}

	const debug = override.debug ?? base.debug;
	if (typeof debug === "boolean") {
		merged.debug = debug;
	}

	return merged;
}

/**
 * Create BashOperations that wrap commands in agent-sandbox
 */
function createSandboxedOperations(options: SandboxedBashOptions): BashOperations {
	const { configure, enabled: _, ...baseConfig } = options;

	return {
		exec: async (command, cwd, { onData, signal, timeout }) => {
			const result = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
				const commandConfig = configure ? configure(command) : null;
				const finalConfig = mergeConfigs(baseConfig, commandConfig);
				const sandboxArgs = buildSandboxArgs(cwd, finalConfig);

				sandboxArgs.push("bash", "-c", command);

				const child = spawn("agent-sandbox", sandboxArgs, {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | null = null;
				const timeoutMs = timeout ?? 0;

				if (timeoutMs > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						const pid = child.pid;
						if (pid !== null && typeof pid === "number") {
							killProcessTree(pid);
						}
					}, timeoutMs * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				const onAbort = (): void => {
					const pid = child.pid;
					if (pid !== null && typeof pid === "number") {
						killProcessTree(pid);
					}
				};

				child.on("error", (err) => {
					if (timeoutHandle !== null) {
						clearTimeout(timeoutHandle);
					}
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}
					reject(err);
				});

				if (signal) {
					if (signal.aborted) {
						onAbort();
					} else {
						signal.addEventListener("abort", onAbort, { once: true });
					}
				}

				child.on("close", (code) => {
					if (timeoutHandle !== null) {
						clearTimeout(timeoutHandle);
					}
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (signal?.aborted === true) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeoutMs}`));
					} else {
						resolve({ exitCode: code });
					}
				});
			});
			return result;
		},
	};
}

/**
 * Kill a process and all its children
 */
function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch {
			// Ignore errors
		}
	} else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead
			}
		}
	}
}
