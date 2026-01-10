/**
 * Webfetch Tool Extension
 *
 * Fetches web pages and converts HTML to markdown, text, or raw HTML.
 * Useful for reading documentation, articles, or any web content.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import TurndownService from "turndown";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 10_000; // 10 seconds

type Format = "text" | "markdown" | "html";

async function fetchPage(url: string, timeout: number, signal?: AbortSignal): Promise<string> {
  // Combine user abort signal with timeout
  const timeoutSignal = AbortSignal.timeout(timeout);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const response = await fetch(url, {
    signal: combinedSignal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  if (html.length > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)");
  }

  return html;
}

function convertHtmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndownService.remove(["script", "style", "meta", "link", "noscript"]);
  return turndownService.turndown(html);
}

function extractTextFromHtml(html: string): string {
  // Simple regex-based text extraction
  return (
    html
      // Remove script and style content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, " ")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webfetch",
    label: "Web Fetch",
    description:
      "Fetch a web page and convert the HTML content to markdown, plain text, or raw HTML. Useful for reading documentation, articles, or any web content. Uses browser-like headers to avoid blocks. Max 5MB response size.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (http:// or https://)" }),
      format: Type.Optional(
        StringEnum(["markdown", "text", "html"] as const, {
          description: "Output format: markdown (default), text, or html",
        }),
      ),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in milliseconds (default: 10000)" }),
      ),
    }),

    async execute(_toolCallId, params, onUpdate, _ctx, signal) {
      let url = params.url;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }

      const format: Format = params.format ?? "markdown";
      const timeout = params.timeout ?? DEFAULT_TIMEOUT;

      // Stream progress
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${url}...` }],
        details: { url, format, contentLength: 0 },
      });

      try {
        const html = await fetchPage(url, timeout, signal);

        let output: string;
        switch (format) {
          case "html":
            output = html;
            break;
          case "text":
            output = extractTextFromHtml(html);
            break;
          default:
            output = convertHtmlToMarkdown(html);
            break;
        }

        return {
          content: [{ type: "text", text: output }],
          details: { url, format, contentLength: output.length },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Error fetching ${url}: ${errorMessage}` }],
          details: { url, format, contentLength: 0, error: errorMessage },
          isError: true,
        };
      }
    },
  });
}
