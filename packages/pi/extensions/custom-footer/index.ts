/**
 * Sandbox Status Extension
 *
 * Shows sandbox status inline in a custom footer that replicates
 * the default footer layout with pwd, tokens, context %, and model.
 */

import { isSandboxed } from "@harness-tools/pi-agent-sandbox/lib/sandbox.ts";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function customFooterExtension(pi: ExtensionAPI): void {
	// Keep a reference to the latest context - updated on every event
	let latestCtx: ExtensionContext | null = null;

	// Update latestCtx on various events to keep model info fresh
	const updateCtx = (_event: unknown, ctx: ExtensionContext) => {
		latestCtx = ctx;
	};

	pi.on("session_start", (event, ctx) => {
		updateCtx(event, ctx);
		const inSandbox = isSandboxed();

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => {
				tui.requestRender();
			});

			return {
				dispose: unsub,
				invalidate() {
					// noop
				},
				render(width: number): string[] {
					// Use latestCtx for fresh model info, fall back to captured ctx
					const currentCtx = latestCtx || ctx;

					// Get current model - check session entries for model changes
					// (ctx.model may be stale after /model or Ctrl+P)
					let currentModel = currentCtx.model;
					const entries = currentCtx.sessionManager.getEntries();
					for (let i = entries.length - 1; i >= 0; i--) {
						const entry = entries[i];
						if (entry && entry.type === "model_change") {
							const modelEntry = entry as { provider: string; modelId: string };
							const findModel = currentCtx.modelRegistry.find.bind(currentCtx.modelRegistry);
							const resolved = findModel(modelEntry.provider, modelEntry.modelId);
							if (resolved) {
								currentModel = resolved;
							}
							break;
						}
					}

					// Calculate cumulative usage from ALL session entries
					let totalInput = 0;
					let totalOutput = 0;
					let totalCost = 0;

					for (const entry of entries) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message;
							totalInput += m.usage.input;
							totalOutput += m.usage.output;
							totalCost += m.usage.cost.total;
						}
					}

					// Get last assistant message for context percentage
					const messages = currentCtx.sessionManager
						.getBranch()
						.filter((e): e is typeof e & { type: "message" } => e.type === "message")
						.map((e) => e.message);

					const lastAssistantMessage = [...messages]
						.toReversed()
						.find(
							(m): m is AssistantMessage => m.role === "assistant" && m.stopReason !== "aborted",
						);

					const contextTokens = lastAssistantMessage
						? lastAssistantMessage.usage.input +
							lastAssistantMessage.usage.output +
							lastAssistantMessage.usage.cacheRead +
							lastAssistantMessage.usage.cacheWrite
						: 0;
					const contextWindow = currentModel?.contextWindow ?? 0;
					const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
					const contextPercent = contextPercentValue.toFixed(1);

					// Build pwd line with git branch
					let pwd = currentCtx.cwd;
					const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
					if (home !== "" && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}
					const branch = footerData.getGitBranch() ?? "";
					if (branch !== "") {
						pwd = `${pwd} (${branch})`;
					}

					// Sandbox status at the start
					const sandboxStatus = inSandbox
						? `${theme.fg("dim", "✓ sandboxed")} `
						: `${theme.fg("error", "✗ no sandbox")} `;

					// Truncate path if too long
					const pwdMaxWidth = width - visibleWidth(sandboxStatus);
					if (pwd.length > pwdMaxWidth) {
						const half = Math.floor(pwdMaxWidth / 2) - 2;
						if (half > 0) {
							pwd = `${pwd.slice(0, half)}...${pwd.slice(-(half - 1))}`;
						}
					}

					// Build stats parts
					const statsParts: string[] = [];
					if (totalInput) {
						statsParts.push(`↑${formatTokens(totalInput)}`);
					}
					if (totalOutput) {
						statsParts.push(`↓${formatTokens(totalOutput)}`);
					}

					// Cost display
					if (totalCost > 0) {
						statsParts.push(`$${totalCost.toFixed(3)}`);
					}

					// Context percentage with color based on usage level
					if (contextWindow > 0) {
						const contextDisplay = `${contextPercent}%/${formatTokens(contextWindow)}`;
						if (contextPercentValue > 70) {
							statsParts.push(theme.fg("error", contextDisplay));
						} else if (contextPercentValue > 40) {
							statsParts.push(theme.fg("warning", contextDisplay));
						} else {
							statsParts.push(contextDisplay);
						}
					} else {
						statsParts.push(theme.fg("warning", "No context window info"));
					}

					const statsLeft = statsParts.join(" ");

					// Model name + thinking level on right
					const modelName = currentModel?.id ?? "no-model";
					let rightSide = modelName;
					if (currentModel?.reasoning === true) {
						const thinkingLevel = pi.getThinkingLevel();
						if (thinkingLevel !== "off") {
							rightSide = `${modelName} • ${thinkingLevel}`;
						}
					}

					// Build stats line with padding
					const statsLeftWidth = visibleWidth(statsLeft);
					const rightSideWidth = visibleWidth(rightSide);
					const minPadding = 2;
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
						statsLine = statsLeft + padding + rightSide;
					} else {
						statsLine = statsLeft;
					}

					// Apply dim styling
					const dimPwd = sandboxStatus + theme.fg("dim", pwd);
					const dimStatsLeft = theme.fg("dim", statsLeft);
					const remainder = statsLine.slice(statsLeft.length);
					const dimRemainder = theme.fg("dim", remainder);

					return [
						truncateToWidth(dimPwd, width),
						truncateToWidth(dimStatsLeft + dimRemainder, width),
					];
				},
			};
		});
	});

	// Update context on events that fire after model changes
	pi.on("turn_start", updateCtx);
	pi.on("turn_end", updateCtx);
	pi.on("agent_start", updateCtx);
	pi.on("agent_end", updateCtx);
}

function formatTokens(count: number): string {
	if (count < 1000) {
		return count.toString();
	}
	if (count < 10_000) {
		return `${(count / 1000).toFixed(1)}k`;
	}
	if (count < 1_000_000) {
		return `${Math.round(count / 1000)}k`;
	}
	if (count < 10_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	return `${Math.round(count / 1_000_000)}M`;
}
