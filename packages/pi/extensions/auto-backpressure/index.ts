/**
 * Auto-Backpressure Extension
 *
 * Automatically runs validation commands on modified files and injects results back to the agent.
 *
 * Config via .pi/backpressure.json:
 *
 *   {
 *     "trigger": { "modifications": 5, "files": 3 },
 *     "rules": [
 *       {
 *         "glob": "**" + "/*.ts",
 *         "commands": [
 *           { "name": "typecheck", "run": ["tsc", "--noEmit", "--pretty", "false"] },
 *           { "name": "lint", "run": ["eslint", "--max-warnings=0", "--"] }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Semantics:
 * - Rules are evaluated in order; for each file, only the first matching glob applies.
 * - For that matching rule, all commands are run.
 * - Commands are executed without a shell (argv array). The extension appends file paths to argv.
 * - If you need "--" end-of-options, include it in the command's run array.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { scheduleBackpressure } from "./backpressure";
import { loadConfig } from "./config";
import { getGitDirtyFiles } from "./git";
import { log } from "./log";
import { createBackpressureState } from "./state";
import { pruneDeletedFromTracking, trackFile } from "./tracking";

export default function autoBackpressureExtension(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const state = createBackpressureState();

	pi.on("session_start", (_event, ctx) => {
		log("session_start");
		state.config = loadConfig(cwd, ctx);
		log(`config loaded: ${state.config ? JSON.stringify(state.config) : "(none)"}`);
	});

	pi.on("tool_call", (event) => {
		log(`tool_call: ${event.toolName} (${event.toolCallId})`);
		if (event.toolName.toLowerCase() === "bash") {
			// Snapshot git state BEFORE this specific bash call (only dirty)
			const { dirty } = getGitDirtyFiles(cwd);
			state.bashStateByCallId.set(event.toolCallId, dirty);
			log(`bash pre-state: ${[...dirty].join(", ") || "(none)"}`);
		}
	});

	pi.on("tool_result", (event, ctx) => {
		const toolName = event.toolName.toLowerCase();
		log(`tool_result: ${toolName} (${event.toolCallId})`);

		if (toolName === "write" || toolName === "edit") {
			const path = event.input?.["path"];
			if (typeof path === "string" && path.length > 0) {
				log(`${toolName} detected file: ${path}`);
				trackFile(cwd, state, path);

				const { deleted } = getGitDirtyFiles(cwd);
				pruneDeletedFromTracking(state, deleted, ctx);
				scheduleBackpressure(pi, cwd, state, ctx);
			}
			return;
		}

		if (toolName !== "bash") {
			return;
		}

		// Compare git state for THIS specific bash call
		const before = state.bashStateByCallId.get(event.toolCallId) ?? new Set<string>();
		state.bashStateByCallId.delete(event.toolCallId);

		const { dirty: after, deleted } = getGitDirtyFiles(cwd);
		log(
			`bash post-state: dirty=${[...after].join(", ") || "(none)"}, deleted=${[...deleted].join(", ") || "(none)"}`,
		);

		pruneDeletedFromTracking(state, deleted, ctx);

		const newFiles: string[] = [];
		for (const f of after) {
			if (!before.has(f)) {
				trackFile(cwd, state, f);
				newFiles.push(f);
			}
		}
		log(`bash new files: ${newFiles.join(", ") || "(none)"}`);

		if (newFiles.length > 0) {
			scheduleBackpressure(pi, cwd, state, ctx);
		}
	});
}
