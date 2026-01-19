/**
 * Environment Variables Extension
 *
 * Sets environment variables on session start that are inherited
 * by all spawned bash processes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function envVarsExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		// Set session ID so bash processes know which Pi session they're in
		process.env["PI_SESSION_ID"] = ctx.sessionManager.getSessionId();

		// Set agent flag so scripts can detect they're running inside Pi
		process.env["AGENT"] = "1";
	});
}
