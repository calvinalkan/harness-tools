import type { Span } from "./types";

type PromptRollup = {
	turnCount: number;
	turnDurations: number[];
	stopReasons: Set<string>;
	tokensInput: number;
	tokensOutput: number;
	tokensCacheRead: number;
	tokensCacheWrite: number;
	costTotal: number;
	models: Set<string>;
	modelSwitchCount: number;
	toolCount: number;
	toolErrorCount: number;
	toolTotalDurationMs: number;
	toolTruncationCount: number;
	toolCounts: Map<string, number>;
	toolDurations: Map<string, number>;
	toolErrors: Map<string, number>;
	toolBytes: Map<string, number>;
	bashCommands: Map<string, number>;
	fileOperations: Map<string, number>;
	filesByTool: Map<string, Map<string, number>>;
	compactionOccurred: boolean;
	compactionTokensBefore: number;
	compactionFromExtension: boolean;
};

type TurnRollup = {
	toolCount: number;
	toolErrorCount: number;
	toolCounts: Map<string, number>;
	bashCommands: Map<string, number>;
	fileOperations: Map<string, number>;
};

function createPromptRollup(): PromptRollup {
	return {
		turnCount: 0,
		turnDurations: [],
		stopReasons: new Set(),
		tokensInput: 0,
		tokensOutput: 0,
		tokensCacheRead: 0,
		tokensCacheWrite: 0,
		costTotal: 0,
		models: new Set(),
		modelSwitchCount: 0,
		toolCount: 0,
		toolErrorCount: 0,
		toolTotalDurationMs: 0,
		toolTruncationCount: 0,
		toolCounts: new Map(),
		toolDurations: new Map(),
		toolErrors: new Map(),
		toolBytes: new Map(),
		bashCommands: new Map(),
		fileOperations: new Map(),
		filesByTool: new Map(),
		compactionOccurred: false,
		compactionTokensBefore: 0,
		compactionFromExtension: false,
	};
}

function createTurnRollup(): TurnRollup {
	return {
		toolCount: 0,
		toolErrorCount: 0,
		toolCounts: new Map(),
		bashCommands: new Map(),
		fileOperations: new Map(),
	};
}

function incrementMap(map: Map<string, number>, key: string, amount = 1): void {
	map.set(key, (map.get(key) ?? 0) + amount);
}

function applyPromptRollupToSpan(span: Span, rollup: PromptRollup): void {
	span.attributes["turn.count"] = rollup.turnCount;
	if (rollup.turnDurations.length > 0) {
		const total = rollup.turnDurations.reduce((a, b) => a + b, 0);
		span.attributes["turn.total_duration_ms"] = total;
		span.attributes["turn.avg_duration_ms"] = Math.round(total / rollup.turnDurations.length);
		span.attributes["turn.max_duration_ms"] = Math.max(...rollup.turnDurations);
	}
	if (rollup.stopReasons.size > 0) {
		span.attributes["stop_reasons"] = [...rollup.stopReasons].join(",");
	}

	span.attributes["tokens.input"] = rollup.tokensInput;
	span.attributes["tokens.output"] = rollup.tokensOutput;
	span.attributes["tokens.cache_read"] = rollup.tokensCacheRead;
	span.attributes["tokens.cache_write"] = rollup.tokensCacheWrite;
	span.attributes["tokens.total"] =
		rollup.tokensInput + rollup.tokensOutput + rollup.tokensCacheRead + rollup.tokensCacheWrite;
	span.attributes["cost.total"] = rollup.costTotal;

	if (rollup.models.size > 0) {
		span.attributes["models"] = [...rollup.models].join(",");
	}
	span.attributes["model.switch_count"] = rollup.modelSwitchCount;

	span.attributes["tool.count"] = rollup.toolCount;
	span.attributes["tool.error_count"] = rollup.toolErrorCount;
	span.attributes["tool.total_duration_ms"] = rollup.toolTotalDurationMs;
	span.attributes["tool.unique_count"] = rollup.toolCounts.size;
	span.attributes["tool.truncation_count"] = rollup.toolTruncationCount;

	for (const [tool, count] of rollup.toolCounts) {
		span.attributes[`tool.${tool}.count`] = count;
	}
	for (const [tool, duration] of rollup.toolDurations) {
		span.attributes[`tool.${tool}.duration_ms`] = duration;
	}
	for (const [tool, errors] of rollup.toolErrors) {
		span.attributes[`tool.${tool}.error_count`] = errors;
	}
	for (const [tool, bytes] of rollup.toolBytes) {
		span.attributes[`tool.${tool}.bytes_total`] = bytes;
	}

	for (const [cmd, count] of rollup.bashCommands) {
		span.attributes[`bash.cmd.${cmd}`] = count;
	}
	span.attributes["bash.unique_commands"] = rollup.bashCommands.size;

	for (const [file, count] of rollup.fileOperations) {
		span.attributes[`file.${file}`] = count;
	}
	span.attributes["files.unique_count"] = rollup.fileOperations.size;
	let totalOps = 0;
	for (const count of rollup.fileOperations.values()) {
		totalOps += count;
	}
	span.attributes["files.total_operations"] = totalOps;

	for (const [tool, files] of rollup.filesByTool) {
		for (const [file, count] of files) {
			span.attributes[`tool.${tool}.file.${file}`] = count;
		}
		span.attributes[`tool.${tool}.unique_files`] = files.size;
	}

	span.attributes["compaction.occurred"] = rollup.compactionOccurred;
	if (rollup.compactionOccurred) {
		span.attributes["compaction.tokens_before"] = rollup.compactionTokensBefore;
		span.attributes["compaction.from_extension"] = rollup.compactionFromExtension;
	}
}

function applyTurnRollupToSpan(span: Span, rollup: TurnRollup): void {
	span.attributes["turn.tool.count"] = rollup.toolCount;
	span.attributes["turn.tool.error_count"] = rollup.toolErrorCount;

	for (const [tool, count] of rollup.toolCounts) {
		span.attributes[`turn.tool.${tool}.count`] = count;
	}
	for (const [cmd, count] of rollup.bashCommands) {
		span.attributes[`turn.bash.cmd.${cmd}`] = count;
	}
	for (const [file, count] of rollup.fileOperations) {
		span.attributes[`turn.file.${file}`] = count;
	}
	span.attributes["turn.files.unique_count"] = rollup.fileOperations.size;
}

export {
	applyPromptRollupToSpan,
	applyTurnRollupToSpan,
	createPromptRollup,
	createTurnRollup,
	incrementMap,
	PromptRollup,
	TurnRollup,
};
