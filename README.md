# Harness Tools


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

