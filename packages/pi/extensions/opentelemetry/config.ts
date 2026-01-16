import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";

import { expandPath, isRecord, parseJson } from "./utils";

/** Config key in settings.json files */
const CONFIG_KEY = "pi-opentelemetry";

/** Hardcoded project config dir name (not exported from pi) */
const PROJECT_CONFIG_DIR = ".pi";

/** Default telemetry directory - always used as fallback */
const DEFAULT_TELEMETRY_DIR = "~/.pi/agent/telemetry";

/** Default values */
const DEFAULTS = {
	batchSize: 10,
	flushIntervalMs: 5000,
	httpTimeout: 5000,
} as const;

/**
 * File config schema - what goes in settings.json under "pi-opentelemetry"
 *
 * Example:
 * {
 *   "pi-opentelemetry": {
 *     "export": "http://localhost:4318/v1/traces",
 *     "headers": { "Authorization": "Bearer xxx" },
 *     "timeout": 5000,
 *     "batchSize": 10,
 *     "flushIntervalMs": 5000
 *   }
 * }
 */
const FileConfigSchema = Type.Object({
	/** Export destination: file://path, http://url, unix://path, or "none" */
	export: Type.Optional(Type.String()),
	/** HTTP headers (for http:// destinations) */
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	/** HTTP timeout in ms (for http:// destinations) */
	timeout: Type.Optional(Type.Number()),
	/** Number of spans to buffer before flushing */
	batchSize: Type.Optional(Type.Number()),
	/** Flush interval in ms */
	flushIntervalMs: Type.Optional(Type.Number()),
});

type FileConfig = Static<typeof FileConfigSchema>;

/** File destination - writes OTLP JSONL to a directory */
const FileDestination = Type.Object({
	type: Type.Literal("file"),
	dir: Type.String({ default: DEFAULT_TELEMETRY_DIR }),
});

/** HTTP destination - POSTs OTLP JSON to an endpoint */
const HttpDestination = Type.Object({
	type: Type.Literal("http"),
	url: Type.String(),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	timeout: Type.Optional(Type.Number({ default: DEFAULTS.httpTimeout })),
});

/** Unix socket destination - writes OTLP JSON to a socket */
const UnixDestination = Type.Object({
	type: Type.Literal("unix"),
	path: Type.String(),
});

/** Disabled destination - no telemetry collected */
const NoneDestination = Type.Object({
	type: Type.Literal("none"),
});

/** Union of all destination types */
const TelemetryDestination = Type.Union([
	FileDestination,
	HttpDestination,
	UnixDestination,
	NoneDestination,
]);

/** Runtime telemetry configuration (after merging all sources) */
const TelemetryConfigSchema = Type.Object({
	destination: TelemetryDestination,
	batchSize: Type.Number({ default: DEFAULTS.batchSize, minimum: 1 }),
	flushIntervalMs: Type.Number({ default: DEFAULTS.flushIntervalMs, minimum: 100 }),
});

type TelemetryDestination = Static<typeof TelemetryDestination>;
type TelemetryConfig = Static<typeof TelemetryConfigSchema>;

/**
 * Get the default file destination (used as fallback)
 */
function getDefaultFileDestination(): Static<typeof FileDestination> {
	return { type: "file", dir: expandPath(DEFAULT_TELEMETRY_DIR) };
}

/**
 * Parse destination from a string (env var or config file value).
 * Falls back to file destination if parsing fails.
 */
function parseDestination(value: string | undefined): TelemetryDestination {
	// No value or empty - use default file destination
	if (value === undefined || value === "") {
		return getDefaultFileDestination();
	}

	// Explicit disable
	if (value === "none") {
		return { type: "none" };
	}

	// File destination
	if (value.startsWith("file://")) {
		const dir = value.slice(7);
		return { type: "file", dir: expandPath(dir || DEFAULT_TELEMETRY_DIR) };
	}

	// Unix socket destination
	if (value.startsWith("unix://")) {
		const socketPath = value.slice(7);
		if (socketPath === "") {
			// Invalid unix path - fallback to file
			return getDefaultFileDestination();
		}
		return { type: "unix", path: socketPath };
	}

	// HTTP/HTTPS destination
	if (value.startsWith("http://") || value.startsWith("https://")) {
		return { type: "http", url: value };
	}

	// Unknown format - treat as file path (fallback behavior)
	return { type: "file", dir: expandPath(value) };
}

/**
 * Parse HTTP headers from comma-separated key=value pairs (env var format)
 */
function parseHeadersFromEnv(value: string | undefined): Record<string, string> | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const headers: Record<string, string> = {};
	for (const pair of value.split(",")) {
		const [key, val] = pair.split("=", 2);
		if (key !== undefined && key !== "" && val !== undefined && val !== "") {
			headers[key.trim()] = val.trim();
		}
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Load config from a settings.json file.
 * Returns undefined if file doesn't exist or has no pi-opentelemetry section.
 */
function loadFileConfig(settingsPath: string): FileConfig | undefined {
	if (!existsSync(settingsPath)) {
		return undefined;
	}

	try {
		const content = readFileSync(settingsPath, "utf8");
		const parsed = parseJson(content);

		// Type guard for settings object
		if (!isRecord(parsed)) {
			return undefined;
		}

		const config = parsed[CONFIG_KEY];

		// Type guard for config object
		if (!isRecord(config)) {
			return undefined;
		}

		// Build FileConfig with validated fields
		const result: FileConfig = {};

		const exportVal = config["export"];
		if (exportVal !== undefined) {
			if (typeof exportVal !== "string") {
				return undefined;
			}
			result.export = exportVal;
		}

		const headersVal = config["headers"];
		if (headersVal !== undefined) {
			if (!isRecord(headersVal)) {
				return undefined;
			}
			// Validate all header values are strings
			const headers: Record<string, string> = {};
			for (const [key, val] of Object.entries(headersVal)) {
				if (typeof val !== "string") {
					return undefined;
				}
				headers[key] = val;
			}
			result.headers = headers;
		}

		const timeoutVal = config["timeout"];
		if (timeoutVal !== undefined) {
			if (typeof timeoutVal !== "number") {
				return undefined;
			}
			result.timeout = timeoutVal;
		}

		const batchSizeVal = config["batchSize"];
		if (batchSizeVal !== undefined) {
			if (typeof batchSizeVal !== "number") {
				return undefined;
			}
			result.batchSize = batchSizeVal;
		}

		const flushIntervalVal = config["flushIntervalMs"];
		if (flushIntervalVal !== undefined) {
			if (typeof flushIntervalVal !== "number") {
				return undefined;
			}
			result.flushIntervalMs = flushIntervalVal;
		}

		return result;
	} catch {
		// Invalid JSON or read error - ignore
		return undefined;
	}
}

/**
 * Get the global settings.json path
 */
function getGlobalSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/**
 * Get the project settings.json path
 */
function getProjectSettingsPath(cwd: string): string {
	return join(cwd, PROJECT_CONFIG_DIR, "settings.json");
}

/**
 * Merge file config into a TelemetryConfig.
 * File config values override existing config values.
 */
function mergeFileConfig(base: TelemetryConfig, fileConfig: FileConfig): TelemetryConfig {
	const result = { ...base };

	// Override destination if specified
	if (fileConfig.export !== undefined) {
		result.destination = parseDestination(fileConfig.export);
	}

	// Add HTTP-specific config from file
	if (result.destination.type === "http") {
		if (fileConfig.headers !== undefined) {
			result.destination.headers = fileConfig.headers;
		}
		if (fileConfig.timeout !== undefined && fileConfig.timeout > 0) {
			result.destination.timeout = fileConfig.timeout;
		}
	}

	// Override batch settings if specified
	if (fileConfig.batchSize !== undefined && fileConfig.batchSize > 0) {
		result.batchSize = fileConfig.batchSize;
	}
	if (fileConfig.flushIntervalMs !== undefined && fileConfig.flushIntervalMs > 0) {
		result.flushIntervalMs = fileConfig.flushIntervalMs;
	}

	return result;
}

/**
 * Apply environment variable overrides to config.
 * Env vars have highest priority.
 */
function applyEnvOverrides(base: TelemetryConfig): TelemetryConfig {
	const result = { ...base };

	// Override destination from env
	const exportEnv = process.env["PI_TELEMETRY_EXPORT"];
	if (exportEnv !== undefined && exportEnv !== "") {
		result.destination = parseDestination(exportEnv);
	}

	// Add HTTP-specific config from env
	if (result.destination.type === "http") {
		const headersEnv = parseHeadersFromEnv(process.env["PI_TELEMETRY_HEADERS"]);
		if (headersEnv !== undefined) {
			result.destination.headers = headersEnv;
		}
		const timeoutEnv = Number(process.env["PI_TELEMETRY_TIMEOUT"]);
		if (timeoutEnv > 0) {
			result.destination.timeout = timeoutEnv;
		}
	}

	// Override batch settings from env
	const batchSizeEnv = Number(process.env["PI_TELEMETRY_BATCH_SIZE"]);
	if (batchSizeEnv > 0) {
		result.batchSize = batchSizeEnv;
	}
	const flushIntervalEnv = Number(process.env["PI_TELEMETRY_FLUSH_INTERVAL"]);
	if (flushIntervalEnv > 0) {
		result.flushIntervalMs = flushIntervalEnv;
	}

	return result;
}

/**
 * Load initial configuration.
 * Priority: env vars > global config > defaults
 *
 * Project config is applied later in session_start when cwd is available.
 */
function loadInitialConfig(): TelemetryConfig {
	// Start with defaults
	let config: TelemetryConfig = {
		destination: getDefaultFileDestination(),
		batchSize: DEFAULTS.batchSize,
		flushIntervalMs: DEFAULTS.flushIntervalMs,
	};

	// Apply global config file
	const globalConfig = loadFileConfig(getGlobalSettingsPath());
	if (globalConfig !== undefined) {
		config = mergeFileConfig(config, globalConfig);
	}

	// Apply env var overrides (highest priority at this stage)
	config = applyEnvOverrides(config);

	return config;
}

type ConfigManager = {
	getConfig: () => TelemetryConfig;
	applyProjectConfig: (cwd: string) => void;
	resetProjectConfig: () => void;
};

function createConfigManager(): ConfigManager {
	let config = loadInitialConfig();
	let projectConfigApplied = false;

	const applyProjectConfig = (cwd: string): void => {
		if (projectConfigApplied) {
			return;
		}

		const projectConfig = loadFileConfig(getProjectSettingsPath(cwd));
		if (projectConfig !== undefined) {
			// Rebuild config: defaults -> global -> project -> env
			let newConfig: TelemetryConfig = {
				destination: getDefaultFileDestination(),
				batchSize: DEFAULTS.batchSize,
				flushIntervalMs: DEFAULTS.flushIntervalMs,
			};

			// Apply global config
			const globalConfig = loadFileConfig(getGlobalSettingsPath());
			if (globalConfig !== undefined) {
				newConfig = mergeFileConfig(newConfig, globalConfig);
			}

			// Apply project config
			newConfig = mergeFileConfig(newConfig, projectConfig);

			// Apply env var overrides (always highest priority)
			newConfig = applyEnvOverrides(newConfig);

			config = newConfig;
		}

		projectConfigApplied = true;
	};

	const resetProjectConfig = (): void => {
		projectConfigApplied = false;
	};

	return {
		getConfig: () => config,
		applyProjectConfig,
		resetProjectConfig,
	};
}

export { createConfigManager, ConfigManager, TelemetryConfig, TelemetryDestination };
