import { execFileSync } from "node:child_process";
import { matchesGlob } from "node:path";

import { type BackpressureConfig, type Command, commandDisplayName, type Rule } from "./config";
import { log } from "./log";

type CommandGroup = {
	command: Command;
	name: string;
	files: string[];
};

function globMatch(filePath: string, pattern: string): boolean {
	try {
		return matchesGlob(filePath, pattern);
	} catch {
		return false;
	}
}

function firstMatchingRule(filePath: string, rules: BackpressureConfig["rules"]): Rule | null {
	for (const rule of rules) {
		const matches = globMatch(filePath, rule.glob);
		log(`glob: "${filePath}" vs "${rule.glob}" = ${matches}`);
		if (matches) {
			return rule;
		}
	}
	log(`glob: "${filePath}" matched no rules`);
	return null;
}

function formatArgForDisplay(arg: string): string {
	// Not shell escaping, just a readable representation for logs/UI.
	return /^[a-zA-Z0-9_./:@%+=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function groupFilesByCommand(
	files: Set<string>,
	cfg: BackpressureConfig,
): Map<string, CommandGroup> {
	const groups = new Map<string, CommandGroup>();

	for (const file of files) {
		const rule = firstMatchingRule(file, cfg.rules);
		if (rule === null) {
			continue;
		}

		for (const command of rule.commands) {
			const name = commandDisplayName(command);
			const key = `${name}\0${command.run.join("\0")}`;
			const existing = groups.get(key);
			if (existing) {
				existing.files.push(file);
			} else {
				groups.set(key, { command, name, files: [file] });
			}
		}
	}

	return groups;
}

function runCommands(
	cwd: string,
	groups: Map<string, CommandGroup>,
): { passed: boolean; errors: { name: string; files: string[]; cmd: string; output: string }[] } {
	const errors: { name: string; files: string[]; cmd: string; output: string }[] = [];

	for (const [, group] of groups) {
		const { command, files, name } = group;
		if (files.length === 0) {
			continue;
		}

		const exe = command.run[0];
		if (typeof exe !== "string" || exe.length === 0) {
			const output = "Invalid command config: run[0] is empty";
			log(`runCommands: "${name}" skipped: ${output}`);
			errors.push({ name, files, cmd: "(invalid)", output });
			continue;
		}

		const fullArgs = [...command.run.slice(1), ...files];
		const reproduce = [exe, ...fullArgs].map((a) => formatArgForDisplay(a)).join(" ");

		log(`runCommands: executing "${name}": ${reproduce}`);

		try {
			execFileSync(exe, fullArgs, {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: command.timeoutMs ?? 60_000,
				shell: false,
			});
			log(`runCommands: "${name}" succeeded`);
		} catch (err: unknown) {
			const e = err instanceof Error ? err : new Error(String(err));
			const errObj = e as Error & {
				stdout?: Buffer | string;
				stderr?: Buffer | string;
				killed?: boolean;
				signal?: string;
			};

			const killed = errObj.killed === true;
			const sigterm = errObj.signal === "SIGTERM";

			if (killed || sigterm) {
				log(`runCommands: "${name}" timed out`);
				errors.push({ name, files, cmd: reproduce, output: "Command timed out" });
				continue;
			}

			const stdout = typeof errObj.stdout === "string" ? errObj.stdout : "";
			const stderr = typeof errObj.stderr === "string" ? errObj.stderr : "";
			const output = `${stdout}${stderr}`.trim() || "(command failed with no output)";
			log(`runCommands: "${name}" failed: ${output.slice(0, 200)}`);
			errors.push({ name, files, cmd: reproduce, output });
		}
	}

	return { passed: errors.length === 0, errors };
}

export { type CommandGroup, groupFilesByCommand, runCommands };
