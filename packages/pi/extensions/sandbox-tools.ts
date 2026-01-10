/**
 * Sandbox Tools Extension
 *
 * Overrides write, edit, and bash tools to provide helpful error messages when
 * operations fail due to sandbox restrictions.
 */

import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteTool, createEditTool, createBashTool } from "@mariozechner/pi-coding-agent";
import { isSandboxed } from "./lib/sandbox.ts";

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

// Patterns that indicate sandbox/permission restrictions in bash output
// These are checked when a command fails (non-zero exit code)
const SANDBOX_BASH_ERROR_PATTERNS = [
  // Read-only filesystem
  "EROFS",
  "Read-only file system",
  "read-only file system",
  // Permission denied
  "Permission denied",
  "EACCES",
  "Operation not permitted",
  "EPERM",
  // Device/resource busy (common with sandbox mounts)
  "Device or resource busy",
  "EBUSY",
  "Text file busy",
  "ETXTBSY",
];

function isSandboxWriteError(text: string): boolean {
  return SANDBOX_WRITE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function isSandboxBashError(text: string): boolean {
  return SANDBOX_BASH_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function isFileNotFoundError(text: string): boolean {
  return text.includes("File not found");
}

const SANDBOX_HINT = `

Note: You are in a sandbox. This may have failed due to sandbox restrictions. Workarounds won't help - just let the user know and move on.`;

const SANDBOX_EDIT_HINT = `

Note: You are in a sandbox. The file exists but cannot be edited due to sandbox restrictions. Workarounds won't help - just let the user know and move on.`;

const SANDBOX_BASH_HINT = `

Note: You are in a sandbox. This command may have failed due to sandbox restrictions (e.g., read-only filesystem, permission denied). Workarounds won't help - just let the user know and move on.`;

export default function (pi: ExtensionAPI) {
  // Only override tools if we're in a sandbox
  if (!isSandboxed()) return;

  const cwd = process.cwd();

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
            // File exists but edit failed - definitely sandbox
            ctx.ui.notify("─── Edit blocked by sandbox ───", "error");
            throw new Error(
              `Cannot edit file: ${path} (file exists but is protected by sandbox)` +
                SANDBOX_EDIT_HINT,
            );
          }
          // File genuinely doesn't exist - let the original error through
          throw err;
        }
        throw err;
      }
    },
  });

  // Override bash tool
  const originalBash = createBashTool(cwd);
  pi.registerTool({
    ...originalBash,
    name: "bash",
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      try {
        return await originalBash.execute(toolCallId, params, signal, onUpdate);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSandboxBashError(message)) {
          ctx.ui.notify("─── Bash command may be blocked by sandbox ───", "error");
          throw new Error(message + SANDBOX_BASH_HINT);
        }
        throw err;
      }
    },
  });
}
