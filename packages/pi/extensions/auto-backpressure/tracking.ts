import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { BackpressureConfig } from "./config";
import { log } from "./log";
import type { BackpressureState } from "./state";

function trackFile(cwd: string, state: BackpressureState, filePath: string): void {
	const normalized = isAbsolute(filePath) ? relative(cwd, filePath) : filePath;
	const clean = normalized.replace(/\\/g, "/");
	state.modifiedFiles.add(clean);
	state.touchedFiles.add(clean);
	state.modificationCount++;
	log(
		`trackFile: ${clean} (tracked: ${state.modifiedFiles.size} files, touched: ${state.touchedFiles.size} files, ${state.modificationCount} mods)`,
	);
}

function pruneDeletedFromTracking(
	state: BackpressureState,
	deleted: Set<string>,
	ctx?: ExtensionContext,
): void {
	const removed: string[] = [];
	for (const f of deleted) {
		state.touchedFiles.delete(f);
		if (state.modifiedFiles.delete(f)) {
			removed.push(f);
			log(`removed deleted file from tracking: ${f}`);
		}
	}
	if (removed.length > 0 && ctx?.hasUI === true) {
		ctx.ui.notify(`Removed ${removed.length} deleted file(s) from backpressure tracking`, "info");
	}
}

function pruneMissingFromTracking(
	state: BackpressureState,
	cwd: string,
	ctx?: ExtensionContext,
): void {
	const removed: string[] = [];
	for (const f of state.modifiedFiles) {
		if (!existsSync(join(cwd, f))) {
			state.modifiedFiles.delete(f);
			state.touchedFiles.delete(f);
			removed.push(f);
			log(`removed missing file from tracking: ${f}`);
		}
	}
	if (removed.length > 0 && ctx?.hasUI === true) {
		ctx.ui.notify(`Removed ${removed.length} missing file(s) from backpressure tracking`, "info");
	}
}

function pruneCleanFromTracking(state: BackpressureState, currentDirty: Set<string>): void {
	for (const f of state.modifiedFiles) {
		if (!currentDirty.has(f)) {
			state.modifiedFiles.delete(f);
			state.touchedFiles.delete(f);
			log(`removed clean file from tracking: ${f}`);
		}
	}
}

function shouldTrigger(state: BackpressureState, cfg: BackpressureConfig): boolean {
	return (
		state.modificationCount >= cfg.trigger.modifications ||
		state.touchedFiles.size >= cfg.trigger.files
	);
}

export {
	trackFile,
	pruneDeletedFromTracking,
	pruneMissingFromTracking,
	pruneCleanFromTracking,
	shouldTrigger,
};
