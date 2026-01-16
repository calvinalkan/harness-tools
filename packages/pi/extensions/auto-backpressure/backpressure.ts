import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { loadConfig } from "./config";
import { groupFilesByCommand, runCommands } from "./commands";
import { getGitDirtyFiles } from "./git";
import { log } from "./log";
import { buildSnapshot, snapshotChanged } from "./snapshot";
import type { BackpressureState } from "./state";
import {
	pruneCleanFromTracking,
	pruneDeletedFromTracking,
	pruneMissingFromTracking,
	shouldTrigger,
} from "./tracking";

function scheduleBackpressure(
	pi: ExtensionAPI,
	cwd: string,
	state: BackpressureState,
	ctx: ExtensionContext,
): void {
	state.pendingCtx = ctx;
	if (state.debounceTimer !== null) {
		clearTimeout(state.debounceTimer);
	}
	state.debounceTimer = setTimeout(() => {
		state.debounceTimer = null;
		const latest = state.pendingCtx;
		state.pendingCtx = null;
		if (latest !== null) {
			runBackpressureCheck(pi, cwd, state, latest);
		}
	}, 500);
}

function runBackpressureCheck(
	pi: ExtensionAPI,
	cwd: string,
	state: BackpressureState,
	ctx: ExtensionContext,
): void {
	log(`runBackpressureCheck: ${state.modifiedFiles.size} files, ${state.modificationCount} mods`);

	state.config = loadConfig(cwd, ctx);
	if (state.config === null) {
		log("runBackpressureCheck: no config, skipping");
		return;
	}

	if (state.modifiedFiles.size === 0) {
		log("runBackpressureCheck: no files, skipping");
		return;
	}

	if (!shouldTrigger(state, state.config)) {
		log(
			`runBackpressureCheck: threshold not met (need ${state.config.trigger.modifications} mods or ${state.config.trigger.files} files)`,
		);
		return;
	}

	const { dirty: currentDirty, deleted: currentDeleted } = getGitDirtyFiles(cwd);

	// Keep tracking tidy.
	pruneDeletedFromTracking(state, currentDeleted, ctx);
	pruneMissingFromTracking(state, cwd, ctx);
	pruneCleanFromTracking(state, currentDirty);

	// Candidates are tracked files that are still dirty.
	const candidates = new Set([...state.modifiedFiles].filter((f) => currentDirty.has(f)));
	log(`runBackpressureCheck: ${candidates.size} files still dirty in git`);

	if (candidates.size === 0) {
		log("runBackpressureCheck: no dirty files remain, clearing counters");
		state.modifiedFiles.clear();
		state.modificationCount = 0;
		state.touchedFiles.clear();
		return;
	}

	const groups = groupFilesByCommand(candidates, state.config);
	log(`runBackpressureCheck: ${groups.size} command groups`);
	for (const [, g] of groups) {
		log(`  group "${g.name}": ${g.files.join(", ")}`);
	}

	if (groups.size === 0) {
		log("runBackpressureCheck: no rules matched candidate files, removing them from tracking");
		for (const f of candidates) {
			state.modifiedFiles.delete(f);
		}
		state.modificationCount = 0;
		state.touchedFiles.clear();
		return;
	}

	const commandNames = [...new Set([...groups.values()].map((g) => g.name))].join(", ");
	const fileCount = candidates.size;
	const candidateList = [...candidates];

	if (ctx.hasUI) {
		ctx.ui.setStatus("backpressure", `⏳ ${commandNames}...`);
	}

	const startTime = Date.now();
	const snapshotBefore = buildSnapshot(cwd, candidateList);
	const { passed, errors } = runCommands(cwd, groups);
	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

	if (ctx.hasUI) {
		ctx.ui.setStatus("backpressure", "");
	}

	const snapshotAfter = buildSnapshot(cwd, candidateList);
	if (snapshotChanged(snapshotBefore, snapshotAfter)) {
		log("runBackpressureCheck: snapshot changed during run, discarding results");
		const { dirty: dirtyAfter, deleted: deletedAfter } = getGitDirtyFiles(cwd);
		pruneDeletedFromTracking(state, deletedAfter, ctx);
		pruneMissingFromTracking(state, cwd, ctx);
		pruneCleanFromTracking(state, dirtyAfter);

		if (state.modifiedFiles.size > 0) {
			scheduleBackpressure(pi, cwd, state, ctx);
		}
		return;
	}

	// Always refresh git state after running tools.
	const { dirty: dirtyAfter, deleted: deletedAfter } = getGitDirtyFiles(cwd);
	pruneDeletedFromTracking(state, deletedAfter, ctx);
	pruneMissingFromTracking(state, cwd, ctx);

	if (passed) {
		log(`runBackpressureCheck: PASSED (${fileCount} files, ${elapsed}s)`);

		// Remove checked files from tracking and any that are now clean.
		for (const f of candidates) {
			state.modifiedFiles.delete(f);
		}
		pruneCleanFromTracking(state, dirtyAfter);
		state.modificationCount = 0;
		state.touchedFiles.clear();

		if (ctx.hasUI) {
			ctx.ui.notify(`✓ ${commandNames} passed (${fileCount} files, ${elapsed}s)`, "info");
		}
		return;
	}

	log(`runBackpressureCheck: FAILED (${errors.length} errors)`);
	for (const e of errors) {
		log(`  error: ${e.name} - ${e.output.slice(0, 200)}`);
	}

	// Keep dirty files in buffer for retry, but drop anything that became clean.
	pruneCleanFromTracking(state, dirtyAfter);
	state.modificationCount = 0;
	state.touchedFiles.clear();

	const errorOutput = errors
		.map(
			(e) =>
				`✗ ${e.name} failed\n\nFiles: ${e.files.join(", ")}\n\nReproduce with: ${e.cmd}\n\nOutput: ${e.output}`,
		)
		.join("\n\n---\n\n");

	if (ctx.hasUI) {
		ctx.ui.notify(`✗ ${commandNames} failed (${fileCount} files, ${elapsed}s)`, "error");
	}

	log(`sendMessage content:\n${errorOutput}`);

	pi.sendMessage(
		{ customType: "backpressure", content: errorOutput, display: true },
		{ triggerTurn: true, deliverAs: "steer" },
	);
}

export { scheduleBackpressure, runBackpressureCheck };
