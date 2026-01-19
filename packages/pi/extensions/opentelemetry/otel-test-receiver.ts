#!/usr/bin/env bun

/**
 * OTLP Test Receiver
 *
 * A simple test harness for verifying the OpenTelemetry extension.
 * Receives spans via HTTP, Unix socket, or file watching and prints them.
 *
 * Usage:
 *   bun otel-test-receiver.ts                           # all modes with defaults
 *   bun otel-test-receiver.ts --http --unix --file      # all modes explicitly
 *   bun otel-test-receiver.ts --http --port 4318        # HTTP only
 *   bun otel-test-receiver.ts --unix --sock /tmp/o.sock # Unix only
 *   bun otel-test-receiver.ts --file --dir ~/telemetry  # File only
 */

import { existsSync, unlinkSync, watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Socket } from "bun";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type OTLPSpan = {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: Array<{
		key: string;
		value: {
			stringValue?: string;
			intValue?: string;
			boolValue?: boolean;
			doubleValue?: number;
		};
	}>;
	status?: { code: number; message?: string };
};

type OTLPExport = {
	resourceSpans: Array<{
		resource: { attributes: Array<{ key: string; value: unknown }> };
		scopeSpans: Array<{
			scope: { name: string; version: string };
			spans: OTLPSpan[];
		}>;
	}>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Colors (ANSI)
// ─────────────────────────────────────────────────────────────────────────────

const c = {
	reset: "\u001B[0m",
	bold: "\u001B[1m",
	dim: "\u001B[2m",
	red: "\u001B[31m",
	green: "\u001B[32m",
	yellow: "\u001B[33m",
	blue: "\u001B[34m",
	magenta: "\u001B[35m",
	cyan: "\u001B[36m",
	gray: "\u001B[90m",
};

// ─────────────────────────────────────────────────────────────────────────────
// Span Formatting
// ─────────────────────────────────────────────────────────────────────────────

function getAttr(span: OTLPSpan, key: string): string | number | boolean | undefined {
	const attr = span.attributes.find((a) => a.key === key);
	if (!attr) {
		return undefined;
	}
	const v = attr.value;
	if (v.stringValue !== undefined) {
		return v.stringValue;
	}
	if (v.intValue !== undefined) {
		return Number(v.intValue);
	}
	if (v.boolValue !== undefined) {
		return v.boolValue;
	}
	if (v.doubleValue !== undefined) {
		return v.doubleValue;
	}
	return undefined;
}

function formatDuration(startNano: string, endNano: string): string {
	const ms = (BigInt(endNano) - BigInt(startNano)) / 1_000_000n;
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(Number(ms) / 1000).toFixed(2)}s`;
}

function formatTimestamp(nanoStr: string): string {
	const ms = Number(BigInt(nanoStr) / 1_000_000n);
	return new Date(ms).toISOString().slice(11, 23);
}

function formatSpan(span: OTLPSpan, indent = 0): void {
	const pad = "  ".repeat(indent);
	const duration = formatDuration(span.startTimeUnixNano, span.endTimeUnixNano);
	const time = formatTimestamp(span.startTimeUnixNano);
	const isMain = getAttr(span, "main") === true;
	const isError = span.status?.code === 2 || getAttr(span, "tool.is_error") === true;
	const toolName = getAttr(span, "tool.name");

	const statusIcon = isError ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;

	if (isMain) {
		// Thread span - prominent header
		console.log();
		console.log(
			`${c.bold}${c.cyan}━━━ THREAD SPAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`,
		);
		console.log(`${c.gray}${time}${c.reset} ${statusIcon} ${c.bold}${duration}${c.reset}`);

		const sessionId = getAttr(span, "session.id");
		const model = getAttr(span, "model.id");
		const turnCount = getAttr(span, "turn.count");
		const toolCount = getAttr(span, "tool.count");
		const cost = getAttr(span, "cost.total");

		if (sessionId) {
			console.log(`${pad}  ${c.dim}session:${c.reset} ${sessionId}`);
		}
		if (model) {
			console.log(`${pad}  ${c.dim}model:${c.reset} ${model}`);
		}
		if (turnCount !== undefined || toolCount !== undefined) {
			console.log(
				`${pad}  ${c.dim}turns:${c.reset} ${turnCount ?? 0} ${c.dim}tools:${c.reset} ${toolCount ?? 0}`,
			);
		}
		if (cost !== undefined) {
			console.log(`${pad}  ${c.dim}cost:${c.reset} $${Number(cost).toFixed(4)}`);
		}
	} else if (span.name === "Input") {
		const inputText = getAttr(span, "input.text");
		const inputSource = getAttr(span, "input.source");
		const imageCount = getAttr(span, "input.image_count");
		const metaParts: string[] = [];

		if (typeof inputSource === "string" && inputSource !== "") {
			metaParts.push(inputSource);
		}
		if (typeof imageCount === "number" && imageCount > 0) {
			metaParts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
		}

		const meta = metaParts.length > 0 ? ` ${c.dim}(${metaParts.join(", ")})${c.reset}` : "";
		let text = "";
		if (inputText) {
			const truncated = String(inputText).slice(0, 60).replace(/\n/g, " ");
			text = ` "${truncated}${String(inputText).length > 60 ? "..." : ""}"`;
		}

		console.log();
		console.log(
			`${pad}${c.cyan}├── INPUT${c.reset}${meta}${text} ${c.dim}(${duration})${c.reset} ${statusIcon}`,
		);
	} else if (span.name === "Turn") {
		// Turn span
		const turnIndex = getAttr(span, "turn.index");
		const stopReason = getAttr(span, "stop_reason");
		const tokensIn = getAttr(span, "tokens.input");
		const tokensOut = getAttr(span, "tokens.output");

		console.log();
		console.log(
			`${pad}${c.yellow}├── TURN ${turnIndex}${c.reset} ${c.dim}(${duration})${c.reset} ${statusIcon}`,
		);
		if (tokensIn !== undefined || tokensOut !== undefined) {
			console.log(
				`${pad}${c.dim}│   tokens: ${tokensIn ?? 0} in / ${tokensOut ?? 0} out${stopReason ? ` | stop: ${stopReason}` : ""}${c.reset}`,
			);
		}
	} else if (toolName !== undefined) {
		// Tool span
		const toolPath = getAttr(span, "tool.path");
		const toolCommand = getAttr(span, "tool.command");

		let detail = "";
		if (toolPath) {
			detail = ` ${toolPath}`;
		} else if (toolCommand) {
			const cmd = String(toolCommand).slice(0, 40);
			detail = `: ${cmd}${String(toolCommand).length > 40 ? "..." : ""}`;
		}

		console.log(
			`${pad}${c.dim}│${c.reset}   ${c.magenta}🔧 ${span.name}${c.reset}${detail} ${c.dim}(${duration})${c.reset} ${statusIcon}`,
		);
	} else {
		// Unknown span type
		console.log(`${pad}${c.blue}[${span.name}]${c.reset} ${duration} ${statusIcon}`);
	}
}

function formatAttributes(span: OTLPSpan, indent = 0): void {
	const pad = "  ".repeat(indent);
	console.log(`${pad}${c.dim}Attributes:${c.reset}`);
	for (const attr of span.attributes) {
		const v = attr.value;
		let val: unknown;
		if (v.stringValue !== undefined) {
			val = `"${v.stringValue.slice(0, 100)}${v.stringValue.length > 100 ? "..." : ""}"`;
		} else if (v.intValue !== undefined) {
			val = v.intValue;
		} else if (v.boolValue !== undefined) {
			val = v.boolValue;
		} else if (v.doubleValue !== undefined) {
			val = v.doubleValue;
		}
		console.log(`${pad}  ${c.cyan}${attr.key}${c.reset}: ${val}`);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// OTLP Processing
// ─────────────────────────────────────────────────────────────────────────────

let verbose = false;

function processOTLP(data: OTLPExport): void {
	const spans: OTLPSpan[] = [];

	for (const rs of data.resourceSpans ?? []) {
		for (const ss of rs.scopeSpans ?? []) {
			spans.push(...(ss.spans ?? []));
		}
	}

	if (spans.length === 0) {
		console.log(`${c.dim}(empty batch)${c.reset}`);
		return;
	}

	// Build parent-child relationships
	const byId = new Map<string, OTLPSpan>();
	const children = new Map<string, OTLPSpan[]>();
	let root: OTLPSpan | undefined;

	for (const span of spans) {
		byId.set(span.spanId, span);
		if (!span.parentSpanId) {
			root = span;
		} else {
			const list = children.get(span.parentSpanId) ?? [];
			list.push(span);
			children.set(span.parentSpanId, list);
		}
	}

	// Print hierarchy
	function printTree(span: OTLPSpan, depth: number): void {
		formatSpan(span, depth);
		if (verbose) {
			formatAttributes(span, depth + 1);
		}
		const kids = children.get(span.spanId) ?? [];
		// Sort by start time
		kids.sort((a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1));
		for (const child of kids) {
			printTree(child, depth + 1);
		}
	}

	if (root) {
		printTree(root, 0);
	} else {
		// No root found, print all spans flat
		for (const span of spans) {
			formatSpan(span, 0);
			if (verbose) {
				formatAttributes(span, 1);
			}
		}
	}

	console.log(`${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
}

function processLine(line: string): void {
	const trimmed = line.trim();
	if (!trimmed) {
		return;
	}
	try {
		const data = JSON.parse(trimmed) as OTLPExport;
		processOTLP(data);
	} catch (e) {
		console.error(`${c.red}Failed to parse OTLP:${c.reset}`, e);
		console.error(`${c.dim}Line: ${trimmed.slice(0, 100)}...${c.reset}`);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────────────────────────────────────

function startHttpServer(port: number): void {
	console.log(`${c.green}Starting HTTP server on port ${port}${c.reset}`);
	console.log(`${c.dim}Expecting POST to /v1/traces${c.reset}`);
	console.log();

	Bun.serve({
		port,
		async fetch(req: Request) {
			const url = new URL(req.url);

			if (req.method === "POST" && url.pathname === "/v1/traces") {
				try {
					const body = (await req.json()) as OTLPExport;
					processOTLP(body);
					return new Response("", { status: 200 });
				} catch (e) {
					console.error(`${c.red}Error processing request:${c.reset}`, e);
					return new Response("Bad Request", { status: 400 });
				}
			}

			// Health check
			if (req.method === "GET" && url.pathname === "/health") {
				return new Response("OK", { status: 200 });
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	console.log(`${c.green}✓ Listening...${c.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unix Socket
// ─────────────────────────────────────────────────────────────────────────────

function startUnixSocket(socketPath: string): void {
	// Remove existing socket file
	if (existsSync(socketPath)) {
		console.log(`${c.yellow}Removing existing socket file${c.reset}`);
		unlinkSync(socketPath);
	}

	console.log(`${c.green}Starting Unix socket at ${socketPath}${c.reset}`);
	console.log();

	let buffer = "";

	Bun.listen({
		unix: socketPath,
		socket: {
			open(_socket: Socket) {
				console.log(`${c.dim}[connection opened]${c.reset}`);
			},
			data(_socket: Socket, data: Uint8Array) {
				buffer += Buffer.from(data).toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? ""; // Keep incomplete line in buffer
				for (const line of lines) {
					processLine(line);
				}
			},
			close(_socket: Socket) {
				// Process any remaining buffer
				if (buffer.trim()) {
					processLine(buffer);
					buffer = "";
				}
				console.log(`${c.dim}[connection closed]${c.reset}`);
			},
			error(_socket: Socket, error: Error) {
				console.error(`${c.red}Socket error:${c.reset}`, error);
			},
		},
	});

	console.log(`${c.green}✓ Listening...${c.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// File Watcher
// ─────────────────────────────────────────────────────────────────────────────

async function startFileWatcher(dirPath: string): Promise<void> {
	const resolvedPath = dirPath.replace(/^~/, process.env["HOME"] ?? "~");

	console.log(`${c.green}Watching directory: ${resolvedPath}${c.reset}`);
	console.log(`${c.dim}Looking for *.otlp.jsonl files${c.reset}`);
	console.log();

	// Track file positions for tailing
	const filePositions = new Map<string, number>();

	async function tailFile(filePath: string): Promise<void> {
		try {
			const content = await readFile(filePath, "utf8");
			const pos = filePositions.get(filePath) ?? 0;
			const newContent = content.slice(pos);

			if (newContent) {
				filePositions.set(filePath, content.length);
				const lines = newContent.split("\n");
				for (const line of lines) {
					processLine(line);
				}
			}
		} catch {
			// File might have been deleted
		}
	}

	async function scanDirectory(): Promise<void> {
		try {
			const entries = await readdir(resolvedPath);
			for (const entry of entries) {
				if (entry.endsWith(".otlp.jsonl")) {
					const filePath = path.join(resolvedPath, entry);
					if (!filePositions.has(filePath)) {
						console.log(`${c.dim}[new file: ${entry}]${c.reset}`);
						filePositions.set(filePath, 0);
					}
					await tailFile(filePath);
				}
			}
		} catch (e) {
			console.error(`${c.red}Error scanning directory:${c.reset}`, e);
		}
	}

	// Initial scan
	await scanDirectory();

	// Watch for changes
	watch(resolvedPath, async (eventType, filename) => {
		void eventType;
		if (filename?.endsWith(".otlp.jsonl")) {
			const filePath = path.join(resolvedPath, filename);
			if (!filePositions.has(filePath)) {
				console.log(`${c.dim}[new file: ${filename}]${c.reset}`);
				filePositions.set(filePath, 0);
			}
			await tailFile(filePath);
		}
	});

	// Also poll periodically (some filesystems don't report all events)
	setInterval(scanDirectory, 1000);

	console.log(`${c.green}✓ Watching...${c.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function printUsage(): void {
	console.log(`
${c.bold}OTLP Test Receiver${c.reset}

${c.dim}Usage:${c.reset}
  bun otel-test-receiver.ts                           # all modes with defaults
  bun otel-test-receiver.ts --http --unix --file      # all modes explicitly
  bun otel-test-receiver.ts --http --port 4318        # HTTP only
  bun otel-test-receiver.ts --unix --sock /tmp/o.sock # Unix only
  bun otel-test-receiver.ts --file --dir ~/telemetry  # File only

${c.dim}Mode flags:${c.reset}
  --http           Enable HTTP server
  --unix           Enable Unix socket
  --file           Enable file watcher

${c.dim}Options:${c.reset}
  --port <n>       HTTP port (default: 4318)
  --sock <path>    Unix socket path (default: /tmp/otel.sock)
  --dir <path>     Directory to watch (default: ~/.pi/agent/telemetry)
  --verbose, -v    Show all span attributes
  --help, -h       Show this help
`);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			http: { type: "boolean", default: false },
			unix: { type: "boolean", default: false },
			file: { type: "boolean", default: false },
			port: { type: "string", default: "4318" },
			sock: { type: "string", default: "/tmp/otel.sock" },
			dir: { type: "string", default: "~/.pi/agent/telemetry" },
			verbose: { type: "boolean", short: "v", default: false },
			help: { type: "boolean", short: "h", default: false },
		},
		allowPositionals: false,
	});

	if (values.help) {
		printUsage();
		process.exit(0);
	}

	verbose = values.verbose ?? false;

	// If no mode specified, enable all
	const enableHttp = values.http || (!values.http && !values.unix && !values.file);
	const enableUnix = values.unix || (!values.http && !values.unix && !values.file);
	const enableFile = values.file || (!values.http && !values.unix && !values.file);

	console.log(`${c.bold}${c.cyan}OTLP Test Receiver${c.reset}`);
	console.log();

	if (enableHttp) {
		startHttpServer(Number(values.port));
	}

	if (enableUnix) {
		startUnixSocket(values.sock);
	}

	if (enableFile) {
		await startFileWatcher(values.dir);
	}

	console.log();
	console.log(`${c.green}Ready to receive spans...${c.reset}`);
	console.log();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
