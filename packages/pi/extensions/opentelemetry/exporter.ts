import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

import type { TelemetryConfig } from "./config";
import type { OTLPExport, OTLPSpan, Span } from "./types";
import { ensureDir } from "./utils";

type SpanExporter = {
	bufferSpan: (span: Span) => void;
	flush: () => void;
	flushSync: () => void;
};

type ExporterOptions = {
	getConfig: () => TelemetryConfig;
	getSessionId: () => string | null;
};

function createSpanExporter({ getConfig, getSessionId }: ExporterOptions): SpanExporter {
	const spanBuffer: OTLPSpan[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;

	const bufferSpan = (span: Span): void => {
		spanBuffer.push(spanToOTLP(span));
		const config = getConfig();
		if (spanBuffer.length >= config.batchSize) {
			flush();
		} else {
			scheduleFlush();
		}
	};

	const scheduleFlush = (): void => {
		if (flushTimer !== null) {
			return;
		}
		const config = getConfig();
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flush();
		}, config.flushIntervalMs);
	};

	const flush = (): void => {
		if (flushTimer !== null) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (spanBuffer.length === 0) {
			return;
		}

		const batch = spanBuffer.splice(0);
		exportBatch(batch).catch(() => {
			// Silent fail - telemetry should never crash pi
		});
	};

	const flushSync = (): void => {
		if (flushTimer !== null) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (spanBuffer.length === 0) {
			return;
		}

		const batch = spanBuffer.splice(0);
		exportBatchSync(batch);
	};

	const exportBatch = async (batch: OTLPSpan[]): Promise<void> => {
		const config = getConfig();
		const dest = config.destination;
		if (dest.type === "none") {
			return;
		}

		const payload = createOTLPExport(batch);
		const json = JSON.stringify(payload);

		if (dest.type === "file") {
			ensureDir(dest.dir);
			const filename = `${getSessionId() ?? "unknown"}_${String(Date.now())}.otlp.jsonl`;
			const filepath = join(dest.dir, filename);
			appendFileSync(filepath, `${json}\n`);
		} else if (dest.type === "http") {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, dest.timeout ?? 5000);
			try {
				await fetch(dest.url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...dest.headers,
					},
					body: json,
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timeoutId);
			}
		} else if (dest.type === "unix") {
			const net = await import("node:net");
			const client = net.createConnection(dest.path);
			client.write(`${json}\n`);
			client.end();
		}
	};

	const exportBatchSync = (batch: OTLPSpan[]): void => {
		try {
			const config = getConfig();
			const dest = config.destination;
			if (dest.type === "none") {
				return;
			}

			const payload = createOTLPExport(batch);
			const json = JSON.stringify(payload);

			if (dest.type === "file") {
				ensureDir(dest.dir);
				const filename = `${getSessionId() ?? "unknown"}_${String(Date.now())}.otlp.jsonl`;
				const filepath = join(dest.dir, filename);
				appendFileSync(filepath, `${json}\n`);
			} else if (dest.type === "http") {
				try {
					const headers =
						dest.headers !== undefined
							? Object.entries(dest.headers)
									.map(([k, v]) => `-H "${k}: ${v}"`)
									.join(" ")
							: "";
					const escaped = json.replace(/'/g, String.raw`\'`);
					execSync(
						`curl -s -X POST ${headers} -H "Content-Type: application/json" -d '${escaped}' "${dest.url}"`,
						{ timeout: dest.timeout ?? 5000 },
					);
				} catch {
					// Ignore curl errors
				}
			} else if (dest.type === "unix") {
				try {
					const escaped = json.replace(/'/g, String.raw`\'`);
					execSync(`echo '${escaped}' | nc -U -q0 "${dest.path}"`, {
						timeout: 5000,
					});
				} catch {
					// Ignore socket errors
				}
			}
		} catch {
			// Silent fail
		}
	};

	return {
		bufferSpan,
		flush,
		flushSync,
	};
}

function spanToOTLP(span: Span): OTLPSpan {
	const kindMap = { internal: 1, server: 2, client: 3 };
	const statusMap = { unset: 0, ok: 1, error: 2 };

	const toAttributes = (
		attrs: Record<string, string | number | boolean>,
	): Array<{
		key: string;
		value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
	}> =>
		Object.entries(attrs).map(([key, value]) => {
			if (typeof value === "string") {
				return { key, value: { stringValue: value } };
			} else if (typeof value === "boolean") {
				return { key, value: { boolValue: value } };
			} else if (Number.isInteger(value)) {
				return { key, value: { intValue: String(value) } };
			} else {
				return { key, value: { doubleValue: value } };
			}
		});

	const attributes = toAttributes(span.attributes);

	const otlpSpan: OTLPSpan = {
		traceId: span.traceId,
		spanId: span.spanId,
		name: span.name,
		kind: kindMap[span.kind],
		startTimeUnixNano: String(span.startTimeMs * 1_000_000),
		endTimeUnixNano: String((span.endTimeMs ?? span.startTimeMs) * 1_000_000),
		status: { code: statusMap[span.status] },
		attributes,
	};
	if (span.parentSpanId !== undefined) {
		otlpSpan.parentSpanId = span.parentSpanId;
	}
	if (span.links && span.links.length > 0) {
		otlpSpan.links = span.links.map((link) => {
			const otlpLink: {
				traceId: string;
				spanId: string;
				attributes?: Array<{
					key: string;
					value: {
						stringValue?: string;
						intValue?: string;
						doubleValue?: number;
						boolValue?: boolean;
					};
				}>;
			} = {
				traceId: link.traceId,
				spanId: link.spanId,
			};
			if (link.attributes) {
				otlpLink.attributes = toAttributes(link.attributes);
			}
			return otlpLink;
		});
	}
	return otlpSpan;
}

function createOTLPExport(spans: OTLPSpan[]): OTLPExport {
	return {
		resourceSpans: [
			{
				resource: {
					attributes: [{ key: "service.name", value: { stringValue: "pi-coding-agent" } }],
				},
				scopeSpans: [
					{
						scope: { name: "pi-telemetry", version: "0.1.0" },
						spans,
					},
				],
			},
		],
	};
}

export { createSpanExporter, SpanExporter };
