/**
 * Sandbox Tools Extension
 *
 * Provides sandboxed bash with helpful error messages.
 *
 * - If already sandboxed: disables sandbox wrapping (avoids nesting issues),
 *   but still provides helpful error hints for sandbox failures.
 * - If not sandboxed: wraps bash commands in agent-sandbox for protection.
 */

import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool, createEditTool } from "@mariozechner/pi-coding-agent";
import { isSandboxed } from "./lib/sandbox.ts";
import { createSandboxedBashTool } from "./lib/sandboxed-bash.ts";

function expandPath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    const home = process.env["HOME"] ?? "";
    return home + filePath.slice(1);
  }
  return filePath;
}

function fileExists(filePath: string, cwd: string): boolean {
  try {
    const expanded = expandPath(filePath);
    const resolved = expanded.startsWith("/") ? expanded : resolve(cwd, expanded);
    accessSync(resolved, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const SANDBOX_WRITE_ERROR_PATTERNS = ["EROFS", "read-only file system", "Read-only file system"];

function isSandboxWriteError(text: string): boolean {
  return SANDBOX_WRITE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function isFileNotFoundError(text: string): boolean {
  return text.includes("File not found");
}

const SANDBOX_HINT = `

Note: You are in a sandbox. This may have failed due to sandbox restrictions. Workarounds won't help - just let the user know and move on.`;

const SANDBOX_EDIT_HINT = `

Note: You are in a sandbox. The file exists but cannot be edited due to sandbox restrictions. Workarounds won't help - just let the user know and move on.`;

export default function (pi: ExtensionAPI) {
  // Only activate if running inside a sandbox
  if (!isSandboxed()) return;

  const cwd = process.cwd();

  // Register bash tool with error hints (no nesting, just hints)
  // Sandboxing (enabled: true) is only for custom dynamic configs in other extensions
  const sandboxedBash = createSandboxedBashTool(cwd, {
    enabled: false,
  });

  pi.registerTool({
    ...sandboxedBash,
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      try {
        return await sandboxedBash.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSandboxWriteError(message)) {
          ctx.ui.notify("─── Bash command blocked by sandbox ───", "error");
        }
        throw err;
      }
    },
  });

  // Register write/edit with error hints
  registerWriteEditHandlers(pi, cwd);
}

/**
 * Register error-handling wrappers for write/edit tools
 */
function registerWriteEditHandlers(pi: ExtensionAPI, cwd: string) {
  // Override write tool
  const originalWrite = createWriteTool(cwd);
  pi.registerTool({
    ...originalWrite,
    name: "write",
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      try {
        return await originalWrite.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSandboxWriteError(message)) {
          ctx.ui.notify("─── Write blocked by sandbox ───", "error");
          throw new Error(message + SANDBOX_HINT);
        }
        throw err;
      }
    },
  });

  // Override edit tool
  const originalEdit = createEditTool(cwd);
  pi.registerTool({
    ...originalEdit,
    name: "edit",
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      try {
        return await originalEdit.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSandboxWriteError(message)) {
          ctx.ui.notify("─── Edit blocked by sandbox ───", "error");
          throw new Error(message + SANDBOX_HINT);
        }
        if (isFileNotFoundError(message)) {
          const path = (params as { path?: string }).path ?? "";
          if (fileExists(path, cwd)) {
            ctx.ui.notify("─── Edit blocked by sandbox ───", "error");
            throw new Error(
              `Cannot edit file: ${path} (file exists but is protected by sandbox)` +
                SANDBOX_EDIT_HINT,
            );
          }
          throw err;
        }
        throw err;
      }
    },
  });
}
