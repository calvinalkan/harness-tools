import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// --- Config schema (.pi/backpressure.json) ---
const CommandSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	run: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1, default: 60_000 })),
});

const RuleSchema = Type.Object({
	glob: Type.String({ minLength: 1 }),
	commands: Type.Array(CommandSchema, { minItems: 1 }),
});

const TriggerSchema = Type.Object(
	{
		modifications: Type.Integer({ minimum: 1, default: 5 }),
		files: Type.Integer({ minimum: 1, default: 3 }),
	},
	{ default: { modifications: 5, files: 3 } },
);

const BackpressureConfigSchema = Type.Object({
	trigger: TriggerSchema,
	rules: Type.Array(RuleSchema, { minItems: 1 }),
});

type BackpressureConfig = Static<typeof BackpressureConfigSchema>;

type Command = BackpressureConfig["rules"][number]["commands"][number];
type Rule = BackpressureConfig["rules"][number];

function loadConfig(cwd: string, ctx?: ExtensionContext): BackpressureConfig | null {
	const configPath = join(cwd, ".pi", "backpressure.json");
	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const raw = readFileSync(configPath, "utf8");
		const parsed: unknown = JSON.parse(raw);

		// Apply defaults first.
		const withDefaults = Value.Default(BackpressureConfigSchema, parsed);

		// Validate.
		if (!Value.Check(BackpressureConfigSchema, withDefaults)) {
			const errors = [...Value.Errors(BackpressureConfigSchema, withDefaults)];
			const first = errors[0];
			throw new Error(first ? `${first.path}: ${first.message}` : "Invalid config");
		}

		return withDefaults;
	} catch (err) {
		if (ctx?.hasUI === true) {
			ctx.ui.notify(
				`Backpressure config error: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		}
		return null;
	}
}

function commandDisplayName(cmd: Command): string {
	const explicit = cmd.name?.trim();
	if (typeof explicit === "string" && explicit.length > 0) {
		return explicit;
	}

	const exe = cmd.run[0] ?? "check";
	const second = cmd.run[1];
	if ((exe === "bash" || exe === "sh") && typeof second === "string" && second.length > 0) {
		return basename(second);
	}
	return basename(exe);
}

export { type BackpressureConfig, type Command, type Rule, loadConfig, commandDisplayName };
