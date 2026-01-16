import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { BackpressureConfig } from "./config";

type BackpressureState = {
	config: BackpressureConfig | null;
	modifiedFiles: Set<string>;
	touchedFiles: Set<string>;
	modificationCount: number;
	bashStateByCallId: Map<string, Set<string>>;
	debounceTimer: ReturnType<typeof setTimeout> | null;
	pendingCtx: ExtensionContext | null;
};

function createBackpressureState(): BackpressureState {
	return {
		config: null,
		modifiedFiles: new Set<string>(),
		touchedFiles: new Set<string>(),
		modificationCount: 0,
		bashStateByCallId: new Map<string, Set<string>>(),
		debounceTimer: null,
		pendingCtx: null,
	};
}

export { type BackpressureState, createBackpressureState };
