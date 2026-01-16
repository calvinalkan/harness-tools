import { execFileSync } from "node:child_process";

export function getGitDirtyFiles(cwd: string): { dirty: Set<string>; deleted: Set<string> } {
	try {
		// -z gives NUL-delimited, machine-readable output.
		const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
			cwd,
			encoding: "utf8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const dirty = new Set<string>();
		const deleted = new Set<string>();

		const entries = out.split("\0");
		for (let i = 0; i < entries.length; i++) {
			const rec = entries[i];
			if (typeof rec !== "string" || rec.length < 4) {
				continue;
			}

			const status = rec.slice(0, 2);
			const x = status[0];
			const y = status[1];

			let path = rec.slice(3);

			// Renames/Copies: "R  from\0to\0" (and similarly for C)
			if (x === "R" || y === "R" || x === "C" || y === "C") {
				const next = entries[i + 1];
				if (typeof next === "string" && next.length > 0) {
					path = next;
					i++;
				}
			}

			const clean = path.replace(/\\/g, "/");
			if (clean.length === 0) {
				continue;
			}

			if (x === "D" || y === "D") {
				deleted.add(clean);
			} else {
				dirty.add(clean);
			}
		}

		return { dirty, deleted };
	} catch {
		return { dirty: new Set(), deleted: new Set() };
	}
}
