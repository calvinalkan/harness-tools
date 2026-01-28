# Harness Tools

This repo is the single source of truth for all coding agent customizations we use - extensions, prompts, themes, and more.

## Structure

```
harness-tools/
├── packages/
│   ├── codex/
│   │   └── AGENTS.md       # Codex global AGENTS.md (linked to ~/.codex/AGENTS.md)
│   └── pi/                 # Pi agent customizations
│       ├── extensions/     # TypeScript extensions (auto-discovered)
│       ├── prompts/        # System prompts
│       ├── themes/         # Custom themes
│       └── skills/         # Custom skills
```

## Commands

```bash
make check # run everything
make typecheck # typecheck code
make lint # lint code
```

Important: We do **only** use `Bun` to manage dependencies or run commands.
Never use `npm`, `yarn`, or `pnpm`, `npx` or `bunx`.

We use `tsgo` (bun tsgo), not `tsc`.

Note: Linking workflow lives in `Makefile` (`link`/`unlink`/`status`, plus agent-specific targets).

## Adding Customizations

Each agent has its own directory with a structure matching that agent's configuration format. Refer to the respective agent's documentation for details on extensions, prompts, themes, and skills.

### Adding New Agents

1. Create a directory for the agent: `<agent>/`
2. Add subdirectories matching the agent's config structure
3. Add Makefile targets: `link-<agent>`, `unlink-<agent>`, `status-<agent>`
4. Include the new targets in the main `link`, `unlink`, and `status` targets
