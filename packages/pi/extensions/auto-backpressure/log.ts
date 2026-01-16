import { appendFileSync } from "node:fs";

// Debug logging - enable with BACKPRESSURE_DEBUG=1 or BACKPRESSURE_DEBUG=/path/to/log
const DEBUG = process.env["BACKPRESSURE_DEBUG"] ?? "";
const LOG_FILE = DEBUG === "1" ? "/tmp/backpressure.log" : DEBUG !== "" ? DEBUG : null;

export function log(msg: string): void {
	if (LOG_FILE === null) {
		return;
	}
	const ts = new Date().toISOString();
	try {
		appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
	} catch {
		// Ignore write errors
	}
}
