import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_TEXT_LENGTH = 10_000;
const MAX_COMMAND_LENGTH = 2000;
const MAX_OUTPUT_LENGTH = 5000;

type TruncateResult = {
	text: string;
	length: number;
	truncated: boolean;
};

function expandPath(p: string): string {
	if (p.startsWith("~")) {
		return join(homedir(), p.slice(1));
	}
	return p;
}

function truncate(value: string, maxLength: number): TruncateResult {
	const length = value.length;
	const truncated = length > maxLength;
	const text = truncated ? `${value.slice(0, maxLength)}…[truncated]` : value;
	return { text, length, truncated };
}

function extractCommand(cmd: string): string {
	const trimmed = cmd.trim();
	if (trimmed === "") {
		return "n/a";
	}

	const parts = trimmed.split(/\s+/);
	const first = parts[0];
	if (first === undefined || first === "") {
		return "n/a";
	}
	const base = first.replace(/^\.\//, "");
	if (base === "") {
		return "n/a";
	}

	const sub = parts[1];
	if (sub !== undefined && sub !== "" && !sub.startsWith("-")) {
		return `${base}.${sub}`;
	}
	return base;
}

function genId(bytes: number): string {
	return randomBytes(bytes).toString("hex");
}

function genTraceId(): string {
	return genId(16);
}

function genSpanId(): string {
	return genId(8);
}

function nowMs(): number {
	return Date.now();
}

function modelKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function parseJson(text: string): unknown {
	const result: unknown = JSON.parse(text);
	return result;
}

function isRecord(val: unknown): val is Record<string, unknown> {
	return val !== null && typeof val === "object" && !Array.isArray(val);
}

function getString(obj: unknown, key: string): string | undefined {
	if (!isRecord(obj)) {
		return undefined;
	}
	const val = obj[key];
	return typeof val === "string" ? val : undefined;
}

function getNumber(obj: unknown, key: string): number | undefined {
	if (!isRecord(obj)) {
		return undefined;
	}
	const val = obj[key];
	return typeof val === "number" ? val : undefined;
}

function getNestedNumber(obj: unknown, key1: string, key2: string): number | undefined {
	if (!isRecord(obj)) {
		return undefined;
	}
	const nested = obj[key1];
	if (!isRecord(nested)) {
		return undefined;
	}
	const val = nested[key2];
	return typeof val === "number" ? val : undefined;
}

const SESSION_FILE_ID_REGEX = /_([0-9a-f-]+)\.jsonl$/i;

function getSessionIdFromPath(filePath: string | undefined | null): string | undefined {
	if (filePath === undefined || filePath === null || filePath === "") {
		return undefined;
	}
	const expanded = expandPath(filePath);
	const match = expanded.match(SESSION_FILE_ID_REGEX);
	if (match?.[1] !== undefined && match[1] !== "") {
		return match[1];
	}
	if (!existsSync(expanded)) {
		return undefined;
	}
	try {
		const content = readFileSync(expanded, "utf8");
		const newlineIndex = content.indexOf("\n");
		const headerLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
		const parsed = parseJson(headerLine);
		return getString(parsed, "id");
	} catch {
		return undefined;
	}
}

export {
	extractCommand,
	expandPath,
	genSpanId,
	genTraceId,
	getNestedNumber,
	getNumber,
	getSessionIdFromPath,
	getString,
	isRecord,
	MAX_COMMAND_LENGTH,
	MAX_OUTPUT_LENGTH,
	MAX_TEXT_LENGTH,
	modelKey,
	nowMs,
	parseJson,
	truncate,
	TruncateResult,
	ensureDir,
};
