/**
 * Sandbox Status Extension
 *
 * Shows sandbox status inline in a custom footer that replicates
 * the default footer layout with pwd, tokens, context %, and model.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { isSandboxed } from "./lib/sandbox.ts";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const inSandbox = isSandboxed();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // Calculate cumulative usage from ALL session entries
          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;

          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const m = entry.message as AssistantMessage;
              totalInput += m.usage.input;
              totalOutput += m.usage.output;
              totalCacheRead += m.usage.cacheRead;
              totalCacheWrite += m.usage.cacheWrite;
              totalCost += m.usage.cost.total;
            }
          }

          // Get last assistant message for context percentage
          const messages = ctx.sessionManager
            .getBranch()
            .filter((e): e is typeof e & { type: "message" } => e.type === "message")
            .map((e) => e.message);

          const lastAssistantMessage = messages
            .slice()
            .reverse()
            .find(
              (m): m is AssistantMessage => m.role === "assistant" && m.stopReason !== "aborted",
            );

          const contextTokens = lastAssistantMessage
            ? lastAssistantMessage.usage.input +
              lastAssistantMessage.usage.output +
              lastAssistantMessage.usage.cacheRead +
              lastAssistantMessage.usage.cacheWrite
            : 0;
          const contextWindow = ctx.model?.contextWindow || 0;
          const contextPercentValue = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
          const contextPercent = contextPercentValue.toFixed(1);

          // Build pwd line with git branch
          let pwd = ctx.cwd;
          const home = process.env["HOME"] || process.env["USERPROFILE"];
          if (home && pwd.startsWith(home)) {
            pwd = `~${pwd.slice(home.length)}`;
          }
          const branch = footerData.getGitBranch();
          if (branch) {
            pwd = `${pwd} (${branch})`;
          }

          // Sandbox status at the start
          const sandboxStatus = inSandbox
            ? theme.fg("dim", "✓ sandboxed") + " "
            : theme.fg("error", "✗ no sandbox") + " ";

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
          if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);

          // Cost with subscription indicator
          const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
          if (totalCost || usingSubscription) {
            statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
          }

          // Context percentage with color - only show if > 40%
          if (contextPercentValue > 70) {
            const contextDisplay = `${contextPercent}%/${formatTokens(contextWindow)}`;
            statsParts.push(theme.fg("error", contextDisplay));
          } else if (contextPercentValue > 40) {
            const contextDisplay = `${contextPercent}%/${formatTokens(contextWindow)}`;
            statsParts.push(theme.fg("warning", contextDisplay));
          }

          const statsLeft = statsParts.join(" ");

          // Model name + thinking level on right
          const modelName = ctx.model?.id || "no-model";
          let rightSide = modelName;
          if (ctx.model?.reasoning) {
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
}
