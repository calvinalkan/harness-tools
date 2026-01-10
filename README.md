# Harness Tools

Single source of truth for all coding agent customizations - extensions, prompts, themes, and more.

## Structure

```
harness-tools/
├── packages/
│   └── pi/                 # Pi agent customizations
│       ├── extensions/     # TypeScript extensions (auto-discovered)
│       ├── prompts/        # System prompts
│       ├── themes/         # Custom themes
│       └── skills/         # Custom skills
├── Makefile                # Link/unlink scripts
└── README.md               # This file
```

## Usage

### Install customizations

```bash
make link
```

This creates symlinks from the agent config directories (e.g., `~/.pi/agent/`) to the files in this repo.

### Remove customizations

```bash
make unlink
```

### Check status

```bash
make status
```

### Agent-specific commands

```bash
make link-pi      # Link only Pi agent
make unlink-pi    # Unlink only Pi agent
make status-pi    # Show Pi agent status
```

## Adding Customizations

Each agent has its own directory with a structure matching that agent's configuration format. Refer to the respective agent's documentation for details on extensions, prompts, themes, and skills.

## Adding New Agents

1. Create a directory for the agent: `<agent>/`
2. Add subdirectories matching the agent's config structure
3. Add Makefile targets: `link-<agent>`, `unlink-<agent>`, `status-<agent>`
4. Include the new targets in the main `link`, `unlink`, and `status` targets
