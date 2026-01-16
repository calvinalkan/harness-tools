import { statSync } from "node:fs";
import { join } from "node:path";

type SnapshotEntry = {
	path: string;
	mtimeMs: number;
	size: number;
	missing: boolean;
};

type Snapshot = {
	id: string;
	files: SnapshotEntry[];
};

function buildSnapshot(cwd: string, files: string[]): Snapshot {
	const entries: SnapshotEntry[] = files.map((file) => {
		try {
			const stat = statSync(join(cwd, file));
			return { path: file, mtimeMs: stat.mtimeMs, size: stat.size, missing: false };
		} catch {
			return { path: file, mtimeMs: 0, size: 0, missing: true };
		}
	});

	entries.sort((a, b) => a.path.localeCompare(b.path));

	const id = entries
		.map((entry) =>
			[entry.path, entry.mtimeMs, entry.size, entry.missing ? 1 : 0].join("\0"),
		)
		.join("\n");

	return { id, files: entries };
}

function snapshotChanged(before: Snapshot, after: Snapshot): boolean {
	return before.id !== after.id;
}

export { type SnapshotEntry, type Snapshot, buildSnapshot, snapshotChanged };
