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
import type { BashOperations } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";

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

function isSandboxError(text: string): boolean {
  return SANDBOX_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * Sandbox configuration - mirrors agent-sandbox CLI options
 */
export interface SandboxConfig {
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
}

export interface SandboxedBashOptions extends SandboxConfig {
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

/**
 * Build agent-sandbox CLI arguments from config
 */
function buildSandboxArgs(cwd: string, config: SandboxConfig): string[] {
  const args: string[] = [];

  args.push("-C", cwd);

  if (config.network === false) {
    args.push("--network=false");
  }

  if (config.docker) {
    args.push("--docker");
  }

  if (config.debug) {
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
  if (!override) return base;

  const merged: SandboxConfig = {
    ro: [...(base.ro ?? []), ...(override.ro ?? [])],
    rw: [...(base.rw ?? []), ...(override.rw ?? [])],
    exclude: [...(base.exclude ?? []), ...(override.exclude ?? [])],
    cmd: { ...(base.cmd ?? {}), ...(override.cmd ?? {}) },
  };

  if (override.network !== undefined) merged.network = override.network;
  else if (base.network !== undefined) merged.network = base.network;

  if (override.docker !== undefined) merged.docker = override.docker;
  else if (base.docker !== undefined) merged.docker = base.docker;

  if (override.debug !== undefined) merged.debug = override.debug;
  else if (base.debug !== undefined) merged.debug = base.debug;

  return merged;
}

/**
 * Create BashOperations that wrap commands in agent-sandbox
 */
function createSandboxedOperations(options: SandboxedBashOptions): BashOperations {
  const { configure, enabled: _, ...baseConfig } = options;

  return {
    exec: (command, cwd, { onData, signal, timeout }) => {
      return new Promise((resolve, reject) => {
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
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });

        const onAbort = () => {
          if (child.pid) killProcessTree(child.pid);
        };

        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (signal) signal.removeEventListener("abort", onAbort);

          if (signal?.aborted) reject(new Error("aborted"));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code });
        });
      });
    },
  };
}

/**
 * Create a sandboxed bash tool with error hints
 *
 * @param cwd - Working directory
 * @param options - Sandbox options (enabled: true by default)
 */
export function createSandboxedBashTool(cwd: string, options: SandboxedBashOptions = {}) {
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
    ) {
      try {
        return await baseTool.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSandboxError(message)) {
          throw new Error(message + SANDBOX_HINT);
        }
        throw err;
      }
    },
  };
}
