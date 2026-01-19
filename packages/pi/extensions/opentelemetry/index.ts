/**
 * OpenTelemetry Extension
 *
 * Telemetry design for pi coding agent following the Wide Events pattern.
 * See SPEC.md for full specification.
 *
 * Hierarchy:
 *   Thread Span (Thread) [main=true]
 *     ├─ Input Span (Input)
 *     └─ Turn Span (Turn)
 *          └─ Tool Span (Bash/Read/Edit/...)
 *
 * Configuration (in order of priority, highest first):
 *
 *   1. Environment Variables (override everything):
 *      PI_TELEMETRY_EXPORT         - Destination URL or "none"
 *      PI_TELEMETRY_HEADERS        - HTTP headers: "Key=Value,Key2=Value2"
 *      PI_TELEMETRY_TIMEOUT        - HTTP timeout in ms
 *      PI_TELEMETRY_BATCH_SIZE     - Spans before auto-flush
 *      PI_TELEMETRY_FLUSH_INTERVAL - Flush interval in ms
 *
 *   2. Project Config (<cwd>/.pi/settings.json):
 *      {
 *        "pi-opentelemetry": {
 *          "export": "http://localhost:4318/v1/traces",
 *          "headers": { "Authorization": "Bearer xxx" },
 *          "timeout": 5000,
 *          "batchSize": 10,
 *          "flushIntervalMs": 5000
 *        }
 *      }
 *
 *   3. Global Config (~/.pi/agent/settings.json):
 *      Same format as project config
 *
 *   4. Defaults:
 *      export: file://~/.pi/agent/telemetry
 *      batchSize: 10
 *      flushIntervalMs: 5000
 */

import type { Api, Model } from "@mariozechner/pi-ai";
import { type ExtensionAPI, type ExtensionContext, VERSION } from "@mariozechner/pi-coding-agent";

import { createConfigManager } from "./config";
import { createSpanExporter } from "./exporter";
import { getGitInfoCached } from "./git";
import {
	applyPromptRollupToSpan,
	applyTurnRollupToSpan,
	createPromptRollup,
	createTurnRollup,
	incrementMap,
	type PromptRollup,
	type TurnRollup,
} from "./rollups";
import { addToolSpanAttributes, processToolResult } from "./tool-processing";
import type { Span } from "./types";
import {
	genSpanId,
	genTraceId,
	getNestedNumber,
	getNumber,
	getSessionIdFromPath,
	MAX_TEXT_LENGTH,
	modelKey,
	nowMs,
	truncate,
} from "./utils";

// =============================================================================
// State
// =============================================================================

const configManager = createConfigManager();

let sessionId: string | null = null;
let currentThreadSpan: Span | null = null;
let currentThreadRollup: PromptRollup | null = null;
const openTurns: Array<{ span: Span; rollup: TurnRollup }> = [];
let currentModel: { provider: string; id: string } | null = null;
let lastModel: { provider: string; id: string } | null = null;

let capturedInput: { text: string; images: unknown[] | undefined; source: string } | null = null;
let capturedSystemPrompt: string | null = null;

const openToolSpans = new Map<
	string,
	{ span: Span; startTime: number; turnRollup: TurnRollup | null }
>();

const exporter = createSpanExporter({
	getConfig: configManager.getConfig,
	getSessionId: () => sessionId,
});

// =============================================================================
// Span Creation & Management
// =============================================================================

function createSpan(name: string, parentSpanId?: string, traceId?: string): Span {
	const span: Span = {
		traceId: traceId ?? currentThreadSpan?.traceId ?? genTraceId(),
		spanId: genSpanId(),
		name,
		kind: "internal",
		startTimeMs: nowMs(),
		status: "unset",
		attributes: {},
	};
	if (parentSpanId !== undefined) {
		span.parentSpanId = parentSpanId;
	}
	return span;
}

function createSessionEventSpan(name: string, ctx: ExtensionContext): Span {
	const span = createSpan(name, undefined, genTraceId());
	const header = ctx.sessionManager.getHeader();
	span.attributes["session.id"] = header?.id ?? "";
	span.attributes["session.name"] = ctx.sessionManager.getSessionName() ?? "";
	const parentSessionId = getSessionIdFromPath(header?.parentSession);
	if (parentSessionId !== undefined) {
		span.attributes["session.parent_id"] = parentSessionId;
	}
	span.attributes["cwd"] = ctx.cwd;
	span.attributes["service.name"] = "pi-coding-agent";
	return span;
}

function endSpan(span: Span, status: "ok" | "error" = "ok"): void {
	span.endTimeMs = nowMs();
	span.durationMs = span.endTimeMs - span.startTimeMs;
	span.status = status;
	if (status === "error") {
		span.attributes["error"] = true;
	}
	exporter.bufferSpan(span);
}

function formatToolSpanName(toolName: string): string {
	if (toolName.length === 0) {
		return "Tool";
	}
	return `${toolName[0]?.toUpperCase() ?? ""}${toolName.slice(1)}`;
}

type ThreadSpanContext = { traceId: string; spanId: string };

type ThreadLinkInfo = ThreadSpanContext & { relation: string };

function startThread(ctx: ExtensionContext, link?: ThreadLinkInfo): void {
	const traceId = genTraceId();
	const span = createSpan("Thread", undefined, traceId);
	if (link) {
		span.links = [
			{
				traceId: link.traceId,
				spanId: link.spanId,
				attributes: { "link.relation": link.relation },
			},
		];
	}

	currentThreadSpan = span;
	currentThreadRollup = createPromptRollup();
	currentModel = null;
	lastModel = null;
	openTurns.length = 0;

	const header = ctx.sessionManager.getHeader();
	sessionId = header?.id ?? null;

	span.attributes["main"] = true;
	span.attributes["session.id"] = sessionId ?? "";
	span.attributes["session.name"] = ctx.sessionManager.getSessionName() ?? "";
	const parentSessionId = getSessionIdFromPath(header?.parentSession);
	if (parentSessionId !== undefined) {
		span.attributes["session.parent_id"] = parentSessionId;
	}
	span.attributes["service.name"] = "pi-coding-agent";

	span.attributes["pi.version"] = VERSION;
	span.attributes["cwd"] = ctx.cwd;
	span.attributes["has_ui"] = ctx.hasUI;
	span.attributes["os.platform"] = process.platform;
	span.attributes["os.arch"] = process.arch;
	const bunVersion = process.versions["bun"];
	span.attributes["runtime.name"] = typeof bunVersion === "string" ? "bun" : "node";
	span.attributes["runtime.version"] =
		typeof bunVersion === "string" ? bunVersion : process.version;

	const { info: git, cacheHit } = getGitInfoCached(ctx.cwd);
	span.attributes["git.cache_hit"] = cacheHit;
	if (git.branch !== undefined && git.branch !== "") {
		span.attributes["git.branch"] = git.branch;
	}
	if (git.commit !== undefined && git.commit !== "") {
		span.attributes["git.commit"] = git.commit;
	}
	if (git.commitShort !== undefined && git.commitShort !== "") {
		span.attributes["git.commit_short"] = git.commitShort;
	}
	if (git.worktree !== undefined && git.worktree !== "") {
		span.attributes["git.worktree"] = git.worktree;
	}
	if (git.commonDir !== undefined && git.commonDir !== "") {
		span.attributes["git.common_dir"] = git.commonDir;
	}
	if (git.remoteUrl !== undefined && git.remoteUrl !== "") {
		span.attributes["git.remote_url"] = git.remoteUrl;
	}
	if (git.repoName !== undefined && git.repoName !== "") {
		span.attributes["git.repo_name"] = git.repoName;
	}
	if (git.userName !== undefined && git.userName !== "") {
		span.attributes["git.user.name"] = git.userName;
	}
	if (git.userEmail !== undefined && git.userEmail !== "") {
		span.attributes["git.user.email"] = git.userEmail;
	}

	if (ctx.model !== undefined) {
		currentModel = { provider: ctx.model.provider, id: ctx.model.id };
		lastModel = currentModel;
		span.attributes["model.provider"] = ctx.model.provider;
		span.attributes["model.id"] = ctx.model.id;
		span.attributes["model.name"] = ctx.model.name ?? ctx.model.id;
		span.attributes["model.reasoning"] = ctx.model.reasoning ?? false;
		span.attributes["model.context_window"] = ctx.model.contextWindow ?? 0;
		span.attributes["model.max_tokens"] = ctx.model.maxTokens ?? 0;
		const modelForOAuth = ctx.model as Model<Api> | undefined;
		if (isApiModel(modelForOAuth)) {
			span.attributes["model.using_oauth"] = ctx.modelRegistry.isUsingOAuth(modelForOAuth);
		}
		span.attributes["model.supports_images"] = ctx.model.input?.includes("image") ?? false;
		const cost = ctx.model.cost;
		if (cost !== undefined) {
			span.attributes["model.cost.input"] = cost.input ?? 0;
			span.attributes["model.cost.output"] = cost.output ?? 0;
		}
		currentThreadRollup.models.add(modelKey(ctx.model.provider, ctx.model.id));
	}
}

function endThread(status: "ok" | "error"): ThreadSpanContext | null {
	if (currentThreadSpan === null || currentThreadRollup === null) {
		currentModel = null;
		lastModel = null;
		openTurns.length = 0;
		openToolSpans.clear();
		capturedInput = null;
		capturedSystemPrompt = null;
		return null;
	}

	for (const { span, rollup } of openTurns) {
		applyTurnRollupToSpan(span, rollup);
		endSpan(span, "error");
	}
	openTurns.length = 0;

	for (const { span } of openToolSpans.values()) {
		endSpan(span, "error");
	}
	openToolSpans.clear();

	const span = currentThreadSpan;
	const rollup = currentThreadRollup;
	applyPromptRollupToSpan(span, rollup);
	span.attributes["status"] = status;
	endSpan(span, status);

	const context: ThreadSpanContext = { traceId: span.traceId, spanId: span.spanId };
	currentThreadSpan = null;
	currentThreadRollup = null;
	currentModel = null;
	lastModel = null;
	capturedInput = null;
	capturedSystemPrompt = null;
	return context;
}

// Type guard to satisfy strict lint rules for Model<any> -> Model<Api>
function isApiModel(model: Model<Api> | undefined): model is Model<Api> {
	return model !== undefined;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function opentelemetryExtension(pi: ExtensionAPI): void {
	if (configManager.getConfig().destination.type === "none") {
		return;
	}

	pi.on("session_start", (_event, ctx) => {
		// Apply project-level config now that we have cwd
		configManager.applyProjectConfig(ctx.cwd);

		startThread(ctx);
	});

	pi.on("session_switch", (event, ctx) => {
		const previousThread = endThread("ok");
		const link =
			event.reason === "resume" && previousThread
				? { ...previousThread, relation: "resume" }
				: undefined;
		startThread(ctx, link);
	});

	pi.on("session_fork", (event, ctx) => {
		const previousThread = endThread("ok");
		const link = previousThread ? { ...previousThread, relation: "fork" } : undefined;
		startThread(ctx, link);

		const span = createSessionEventSpan("session.fork", ctx);
		const previousSessionId = getSessionIdFromPath(event.previousSessionFile);
		if (previousSessionId !== undefined) {
			span.attributes["session.previous_id"] = previousSessionId;
		}
		endSpan(span, "ok");
	});

	pi.on("session_tree", (event, ctx) => {
		const previousThread = endThread("ok");
		const link = previousThread ? { ...previousThread, relation: "tree" } : undefined;
		startThread(ctx, link);

		if (currentThreadSpan !== null) {
			if (event.oldLeafId !== null) {
				currentThreadSpan.attributes["thread.branch.old_leaf_id"] = event.oldLeafId;
			}
			if (event.newLeafId !== null) {
				currentThreadSpan.attributes["thread.branch.new_leaf_id"] = event.newLeafId;
			}
			if (event.summaryEntry !== undefined) {
				currentThreadSpan.attributes["thread.branch.summary_entry_id"] = event.summaryEntry.id;
				currentThreadSpan.attributes["thread.branch.summary_from_id"] = event.summaryEntry.fromId;
			}
			if (event.fromExtension !== undefined) {
				currentThreadSpan.attributes["thread.branch.from_extension"] = event.fromExtension;
			}
		}

		const span = createSessionEventSpan("session.tree", ctx);
		if (event.oldLeafId !== null) {
			span.attributes["session.tree.old_leaf_id"] = event.oldLeafId;
		}
		if (event.newLeafId !== null) {
			span.attributes["session.tree.new_leaf_id"] = event.newLeafId;
		}
		if (event.summaryEntry !== undefined) {
			span.attributes["session.tree.summary_entry_id"] = event.summaryEntry.id;
			span.attributes["session.tree.summary_from_id"] = event.summaryEntry.fromId;
		}
		if (event.fromExtension !== undefined) {
			span.attributes["session.tree.from_extension"] = event.fromExtension;
		}
		endSpan(span, "ok");
	});

	pi.on("input", (event) => {
		capturedInput = {
			text: event.text,
			images: event.images as unknown[] | undefined,
			source: event.source,
		};
	});

	pi.on("before_agent_start", (event) => {
		capturedSystemPrompt = event.systemPrompt;
		if (currentThreadSpan !== null && currentThreadSpan.attributes["system_prompt"] === undefined) {
			const { text, length } = truncate(event.systemPrompt, MAX_TEXT_LENGTH);
			currentThreadSpan.attributes["system_prompt"] = text;
			currentThreadSpan.attributes["system_prompt_length"] = length;
			capturedSystemPrompt = null;
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		if (currentThreadSpan === null || currentThreadRollup === null) {
			startThread(ctx);
		}
		if (currentThreadSpan === null || currentThreadRollup === null) {
			return;
		}

		if (
			capturedSystemPrompt !== null &&
			currentThreadSpan.attributes["system_prompt"] === undefined
		) {
			const { text, length } = truncate(capturedSystemPrompt, MAX_TEXT_LENGTH);
			currentThreadSpan.attributes["system_prompt"] = text;
			currentThreadSpan.attributes["system_prompt_length"] = length;
			capturedSystemPrompt = null;
		}

		if (ctx.model !== undefined && currentThreadSpan.attributes["model.provider"] === undefined) {
			currentModel = { provider: ctx.model.provider, id: ctx.model.id };
			lastModel = currentModel;
			currentThreadSpan.attributes["model.provider"] = ctx.model.provider;
			currentThreadSpan.attributes["model.id"] = ctx.model.id;
			currentThreadSpan.attributes["model.name"] = ctx.model.name ?? ctx.model.id;
			currentThreadSpan.attributes["model.reasoning"] = ctx.model.reasoning ?? false;
			currentThreadSpan.attributes["model.context_window"] = ctx.model.contextWindow ?? 0;
			currentThreadSpan.attributes["model.max_tokens"] = ctx.model.maxTokens ?? 0;
			const modelForOAuth = ctx.model as Model<Api> | undefined;
			if (isApiModel(modelForOAuth)) {
				currentThreadSpan.attributes["model.using_oauth"] =
					ctx.modelRegistry.isUsingOAuth(modelForOAuth);
			}
			currentThreadSpan.attributes["model.supports_images"] =
				ctx.model.input?.includes("image") ?? false;
			const cost = ctx.model.cost;
			if (cost !== undefined) {
				currentThreadSpan.attributes["model.cost.input"] = cost.input ?? 0;
				currentThreadSpan.attributes["model.cost.output"] = cost.output ?? 0;
			}
			currentThreadRollup.models.add(modelKey(ctx.model.provider, ctx.model.id));
		}

		if (capturedInput !== null) {
			const inputSpan = createSpan("Input", currentThreadSpan.spanId, currentThreadSpan.traceId);
			inputSpan.attributes["input.source"] = capturedInput.source;
			const { text, length } = truncate(capturedInput.text, MAX_TEXT_LENGTH);
			inputSpan.attributes["input.text"] = text;
			inputSpan.attributes["input.text_length"] = length;
			const imageCount = capturedInput.images?.length ?? 0;
			inputSpan.attributes["input.has_images"] = imageCount > 0;
			inputSpan.attributes["input.image_count"] = imageCount;
			endSpan(inputSpan, "ok");
			capturedInput = null;
		}

		if (currentThreadSpan.attributes["tools.active.count"] === undefined) {
			const activeTools = new Set(pi.getActiveTools());
			currentThreadSpan.attributes["tools.active.count"] = activeTools.size;
			for (const toolName of activeTools) {
				currentThreadSpan.attributes[`tools.active.${toolName}`] = true;
			}
		}

		currentThreadSpan.attributes["thinking.level"] = pi.getThinkingLevel();
	});

	pi.on("agent_end", (event, ctx) => {
		if (currentThreadSpan === null || currentThreadRollup === null) {
			return;
		}

		const span = currentThreadSpan;
		const rollup = currentThreadRollup;

		let finalStopReason: string | undefined;
		if (event.messages !== undefined) {
			for (const msg of event.messages) {
				if (msg.role === "assistant" && "stopReason" in msg) {
					finalStopReason = msg.stopReason as string;
				}
				if (msg.role === "assistant" && "usage" in msg) {
					const usage = msg.usage;
					rollup.tokensInput += getNumber(usage, "input") ?? 0;
					rollup.tokensOutput += getNumber(usage, "output") ?? 0;
					rollup.tokensCacheRead += getNumber(usage, "cacheRead") ?? 0;
					rollup.tokensCacheWrite += getNumber(usage, "cacheWrite") ?? 0;
					rollup.costTotal += getNestedNumber(usage, "cost", "total") ?? 0;
				}
			}
		}

		const contextUsage = ctx.getContextUsage();
		if (contextUsage !== undefined) {
			span.attributes["context.tokens"] = contextUsage.tokens;
			span.attributes["context.percent"] = contextUsage.percent;
			span.attributes["context.window"] = contextUsage.contextWindow;
			span.attributes["context.usage_tokens"] = contextUsage.usageTokens;
			span.attributes["context.trailing_tokens"] = contextUsage.trailingTokens;
			if (contextUsage.lastUsageIndex !== null) {
				span.attributes["context.last_usage_index"] = contextUsage.lastUsageIndex;
			}
		}

		const aborted = finalStopReason === "aborted";
		span.attributes["final_stop_reason"] = finalStopReason ?? "unknown";
		span.attributes["aborted"] = aborted;

		applyPromptRollupToSpan(span, rollup);

		const status = aborted ? "error" : "ok";
		span.attributes["status"] = status;

		capturedInput = null;
		capturedSystemPrompt = null;

		exporter.flush();
	});

	pi.on("turn_start", (event, ctx) => {
		if (currentThreadSpan === null || currentThreadRollup === null) {
			return;
		}

		if (ctx.model !== undefined) {
			const newModel = { provider: ctx.model.provider, id: ctx.model.id };
			if (
				lastModel !== null &&
				(lastModel.provider !== newModel.provider || lastModel.id !== newModel.id)
			) {
				currentThreadRollup.modelSwitchCount++;
			}
			currentModel = newModel;
			lastModel = newModel;
			currentThreadRollup.models.add(modelKey(newModel.provider, newModel.id));
		}

		const turnSpan = createSpan("Turn", currentThreadSpan.spanId, currentThreadSpan.traceId);
		const turnRollup = createTurnRollup();
		openTurns.push({ span: turnSpan, rollup: turnRollup });

		const span = turnSpan;
		span.attributes["turn.index"] = event.turnIndex;
		span.attributes["turn.timestamp"] = event.timestamp;
		span.attributes["cwd"] = ctx.cwd;

		if (currentModel !== null) {
			span.attributes["model.provider"] = currentModel.provider;
			span.attributes["model.id"] = currentModel.id;
		}

		span.attributes["thinking.level"] = pi.getThinkingLevel();

		currentThreadRollup.turnCount++;
	});

	pi.on("turn_end", (event) => {
		if (openTurns.length === 0 || currentThreadRollup === null) {
			return;
		}

		const turnEntry = openTurns.pop();
		if (turnEntry === undefined) {
			return;
		}

		const span = turnEntry.span;
		const rollup = currentThreadRollup;
		const turnRollup = turnEntry.rollup;

		if (event.message.role === "assistant" && "usage" in event.message) {
			const usage = event.message.usage;
			span.attributes["tokens.input"] = getNumber(usage, "input") ?? 0;
			span.attributes["tokens.output"] = getNumber(usage, "output") ?? 0;
			span.attributes["tokens.cache_read"] = getNumber(usage, "cacheRead") ?? 0;
			span.attributes["tokens.cache_write"] = getNumber(usage, "cacheWrite") ?? 0;
			span.attributes["cost.total"] = getNestedNumber(usage, "cost", "total") ?? 0;
		}

		if (event.message.role === "assistant" && "stopReason" in event.message) {
			const stopReason = event.message.stopReason as string;
			span.attributes["stop_reason"] = stopReason;
			rollup.stopReasons.add(stopReason);
		}

		if (event.message.role === "assistant" && "content" in event.message) {
			const content = event.message.content as Array<{
				type: string;
				text?: string;
				thinking?: string;
			}>;

			const textParts = content.filter((c) => c.type === "text" && typeof c.text === "string");
			if (textParts.length > 0) {
				const fullText = textParts.map((c) => c.text ?? "").join("");
				const { text, length } = truncate(fullText, MAX_TEXT_LENGTH);
				span.attributes["response.text"] = text;
				span.attributes["response.text_length"] = length;
			}

			const thinkingParts = content.filter(
				(c) => c.type === "thinking" && typeof c.thinking === "string",
			);
			if (thinkingParts.length > 0) {
				const fullThinking = thinkingParts.map((c) => c.thinking ?? "").join("");
				const { text, length } = truncate(fullThinking, MAX_TEXT_LENGTH);
				span.attributes["thinking.present"] = true;
				span.attributes["thinking.block_count"] = thinkingParts.length;
				span.attributes["thinking.text"] = text;
				span.attributes["thinking.text_length"] = length;

				rollup.thinkingTurnsWithThinking++;
				rollup.thinkingBlockCount += thinkingParts.length;
				rollup.thinkingTotalLength += length;
			}
		}

		span.attributes["tool_results.count"] = event.toolResults.length;

		applyTurnRollupToSpan(span, turnRollup);

		const duration = nowMs() - span.startTimeMs;
		rollup.turnDurations.push(duration);

		endSpan(span, "ok");
	});

	pi.on("model_select", (event) => {
		if (currentThreadRollup === null) {
			return;
		}

		const newKey = modelKey(event.model.provider, event.model.id);
		currentThreadRollup.models.add(newKey);

		if (event.previousModel !== undefined) {
			const oldKey = modelKey(event.previousModel.provider, event.previousModel.id);
			if (oldKey !== newKey) {
				currentThreadRollup.modelSwitchCount++;
			}
		}

		currentModel = { provider: event.model.provider, id: event.model.id };
		lastModel = currentModel;

		if (currentThreadSpan !== null) {
			currentThreadSpan.attributes["model.provider"] = event.model.provider;
			currentThreadSpan.attributes["model.id"] = event.model.id;
			currentThreadSpan.attributes["model.name"] = event.model.name ?? event.model.id;
			currentThreadSpan.attributes["model.reasoning"] = event.model.reasoning ?? false;
			currentThreadSpan.attributes["model.context_window"] = event.model.contextWindow ?? 0;
			currentThreadSpan.attributes["model.max_tokens"] = event.model.maxTokens ?? 0;
			currentThreadSpan.attributes["model.supports_images"] =
				event.model.input?.includes("image") ?? false;
			const cost = event.model.cost;
			if (cost !== undefined) {
				currentThreadSpan.attributes["model.cost.input"] = cost.input ?? 0;
				currentThreadSpan.attributes["model.cost.output"] = cost.output ?? 0;
			}
		}
	});

	pi.on("tool_call", (event, ctx) => {
		const activeTurn = openTurns.at(-1);
		if (activeTurn === undefined) {
			return;
		}

		const { span: turnSpan, rollup: turnRollup } = activeTurn;

		const toolSpan = createSpan(
			formatToolSpanName(event.toolName),
			turnSpan.spanId,
			turnSpan.traceId,
		);
		toolSpan.attributes["tool.name"] = event.toolName;
		toolSpan.attributes["tool.call_id"] = event.toolCallId;
		toolSpan.attributes["cwd"] = ctx.cwd;

		if (currentModel !== null) {
			toolSpan.attributes["tool.model.provider"] = currentModel.provider;
			toolSpan.attributes["tool.model.id"] = currentModel.id;
		}

		toolSpan.attributes["thinking.level"] = pi.getThinkingLevel();

		openToolSpans.set(event.toolCallId, {
			span: toolSpan,
			startTime: nowMs(),
			turnRollup,
		});

		if (currentThreadRollup !== null) {
			currentThreadRollup.toolCount++;
			incrementMap(currentThreadRollup.toolCounts, event.toolName);
		}
		turnRollup.toolCount++;
		incrementMap(turnRollup.toolCounts, event.toolName);
	});

	pi.on("tool_result", (event) => {
		const entry = openToolSpans.get(event.toolCallId);
		if (entry === undefined) {
			return;
		}

		const { span, startTime, turnRollup } = entry;
		openToolSpans.delete(event.toolCallId);

		const duration = nowMs() - startTime;
		span.attributes["tool.duration_ms"] = duration;

		addToolSpanAttributes(span, event);

		const isError = event.isError;
		if (currentThreadRollup !== null) {
			if (isError) {
				currentThreadRollup.toolErrorCount++;
				incrementMap(currentThreadRollup.toolErrors, event.toolName);
			}
			currentThreadRollup.toolTotalDurationMs += duration;
			incrementMap(currentThreadRollup.toolDurations, event.toolName, duration);
			processToolResult(event, currentThreadRollup, turnRollup);
		}
		if (turnRollup !== null && isError) {
			turnRollup.toolErrorCount++;
		}

		endSpan(span, isError ? "error" : "ok");
	});

	pi.on("session_compact", (event, ctx) => {
		if (currentThreadRollup === null) {
			return;
		}

		currentThreadRollup.compactionOccurred = true;
		currentThreadRollup.compactionFromExtension = event.fromExtension;
		const contextUsage = ctx.getContextUsage();
		if (contextUsage !== undefined) {
			currentThreadRollup.compactionTokensBefore = contextUsage.tokens;
		}
	});

	pi.on("session_shutdown", () => {
		// Reset project config flag for next session
		configManager.resetProjectConfig();

		if (currentThreadSpan !== null) {
			currentThreadSpan.attributes["status"] = "error";
			currentThreadSpan.attributes["aborted"] = true;
		}
		endThread("error");

		exporter.flushSync();
	});

	const handleSignal = (): void => {
		exporter.flushSync();
	};
	process.on("SIGTERM", handleSignal);
	process.on("SIGINT", handleSignal);
	process.on("beforeExit", handleSignal);
}
