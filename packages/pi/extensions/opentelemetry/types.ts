type SpanLink = {
	traceId: string;
	spanId: string;
	attributes?: Record<string, string | number | boolean>;
};

type Span = {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: "internal" | "client" | "server";
	startTimeMs: number;
	endTimeMs?: number;
	durationMs?: number;
	status: "ok" | "error" | "unset";
	attributes: Record<string, string | number | boolean>;
	links?: SpanLink[];
};

type OTLPSpan = {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	status: { code: number };
	attributes: Array<{
		key: string;
		value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
	}>;
	links?: Array<{
		traceId: string;
		spanId: string;
		attributes?: Array<{
			key: string;
			value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
		}>;
	}>;
};

type OTLPExport = {
	resourceSpans: Array<{
		resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
		scopeSpans: Array<{
			scope: { name: string; version: string };
			spans: OTLPSpan[];
		}>;
	}>;
};

export { OTLPExport, OTLPSpan, Span, SpanLink };
