/**
 * Sandbox detection utility
 *
 * Checks if we're running inside agent-sandbox and caches the result.
 */

import { execSync } from "node:child_process";

let sandboxed: boolean | null = null;

export function isSandboxed(): boolean {
	if (sandboxed === null) {
		try {
			execSync("agent-sandbox --check", { stdio: "ignore" });
			sandboxed = true;
		} catch {
			sandboxed = false;
		}
	}
	return sandboxed;
}
