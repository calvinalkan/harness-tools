# How to Test the OpenTelemetry Extension

This guide explains how to use the test receiver to verify the OpenTelemetry extension implementation against the spec.

---

## Quick Start

```bash
# Terminal 1: Start the test receiver (all modes, verbose)
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"
tmux attach -t otel

# Terminal 2: Start pi with telemetry export
PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi

# Do stuff in pi, watch spans appear in Terminal 1
```

---

## Test Receiver

The `tools/otel-test-receiver.ts` script receives OTLP spans and pretty-prints them. It supports all three export modes the extension uses.

### Start All Modes (Recommended)

```bash
# Start in tmux with verbose output
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# Attach to watch output
tmux attach -t otel
```

This starts:
- **HTTP server** on `localhost:4318`
- **Unix socket** at `/tmp/otel.sock`
- **File watcher** on `~/.pi/agent/telemetry`

### Start Specific Modes

```bash
# HTTP only
bun tools/otel-test-receiver.ts --http --port 4318

# Unix socket only
bun tools/otel-test-receiver.ts --unix --sock /tmp/otel.sock

# File watcher only
bun tools/otel-test-receiver.ts --file --dir ~/.pi/agent/telemetry

# Combine modes
bun tools/otel-test-receiver.ts --http --unix
```

### Options

| Flag | Description |
|------|-------------|
| `--http` | Enable HTTP server |
| `--unix` | Enable Unix socket |
| `--file` | Enable file watcher |
| `--port <n>` | HTTP port (default: 4318) |
| `--sock <path>` | Unix socket path (default: /tmp/otel.sock) |
| `--dir <path>` | Directory to watch (default: ~/.pi/agent/telemetry) |
| `-v, --verbose` | Show all span attributes |
| `-h, --help` | Show help |

### tmux Commands

```bash
# Start receiver in background
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# Attach to see output
tmux attach -t otel

# Detach (while attached)
# Press: Ctrl+b then d

# Kill when done
tmux kill-session -t otel
```

---

## Testing Each Export Mode

### 1. HTTP Export

```bash
# Start receiver
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# Configure pi to export via HTTP
PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi

# Or test manually with curl
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[]},"scopeSpans":[{"scope":{"name":"test","version":"1.0"},"spans":[{"traceId":"abc","spanId":"123","name":"main","kind":1,"startTimeUnixNano":"1705600000000000000","endTimeUnixNano":"1705600001000000000","attributes":[{"key":"main","value":{"boolValue":true}}],"status":{"code":1}}]}]}]}'
```

### 2. Unix Socket Export

```bash
# Start receiver
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# Configure pi to export via Unix socket
PI_TELEMETRY_EXPORT=unix:///tmp/otel.sock pi

# Or test manually with nc
echo '{"resourceSpans":[{"resource":{"attributes":[]},"scopeSpans":[{"scope":{"name":"test","version":"1.0"},"spans":[{"traceId":"abc","spanId":"123","name":"main","kind":1,"startTimeUnixNano":"1705600000000000000","endTimeUnixNano":"1705600001000000000","attributes":[{"key":"main","value":{"boolValue":true}}],"status":{"code":1}}]}]}]}' | nc -U -q0 /tmp/otel.sock
```

### 3. File Export

```bash
# Start receiver
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# Configure pi to export to file (default)
PI_TELEMETRY_EXPORT=file://~/.pi/agent/telemetry pi

# Or test manually by appending to a .otlp.jsonl file
echo '{"resourceSpans":[...]}' >> ~/.pi/agent/telemetry/test.otlp.jsonl
```

---

## Understanding the Output

### Normal Output

```
━━━ MAIN SPAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
17:46:40.000 ✓ 3.20s
  session: sess_abc123
  model: claude-sonnet-4-20250514
  input: "fix the authentication bug in auth.ts"
  turns: 2 tools: 4
  cost: $0.0234

  ├── TURN 0 (1.80s) ✓
  │   tokens: 1200 in / 450 out | stop: tool_use
    │   🔧 read /src/auth.ts (20ms) ✓
    │   🔧 bash: grep -r "login" src/ (150ms) ✓

  ├── TURN 1 (1.40s) ✓
  │   tokens: 800 in / 320 out | stop: stop
    │   🔧 edit /src/auth.ts (30ms) ✓
    │   🔧 bash: bun test (800ms) ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Verbose Output (`-v`)

Adds all attributes after each span:

```
━━━ MAIN SPAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
17:46:40.000 ✓ 3.20s
  session: sess_abc123
  model: claude-sonnet-4-20250514
  Attributes:
    main: true
    session.id: "sess_abc123"
    model.id: "claude-sonnet-4-20250514"
    model.provider: "anthropic"
    turn.count: 2
    tool.count: 4
    tokens.input: 2000
    tokens.output: 770
    cost.total: 0.0234
    git.branch: "feature/auth-fix"
    file./src/auth.ts: 3
    bash.cmd.grep: 1
    bash.cmd.bun.test: 1
    ...
```

### Status Icons

| Icon | Meaning |
|------|---------|
| ✓ | Success (status code 1 = OK) |
| ✗ | Error (status code 2 = ERROR) |

---

## Verification Checklist

Use this checklist to verify the extension implements the spec correctly:

### Main Span Attributes

- [ ] `main` = `true`
- [ ] `session.id` present
- [ ] `model.id` and `model.provider` present
- [ ] `input.text` captured (truncated if long)
- [ ] `turn.count` matches actual turns
- [ ] `tool.count` matches actual tool calls
- [ ] `tokens.input`, `tokens.output` accumulated
- [ ] `cost.total` calculated
- [ ] `duration_ms` reasonable
- [ ] `status` = `ok` or `error`

### Turn Span Attributes

- [ ] `turn.index` sequential (0, 1, 2...)
- [ ] `tokens.input`, `tokens.output` for this turn
- [ ] `stop_reason` = `stop`, `tool_use`, or `aborted`
- [ ] Parent is main span

### Tool Span Attributes

- [ ] `tool.name` = `bash`, `read`, `edit`, `write`, or custom
- [ ] `tool.call_id` unique
- [ ] `tool.duration_ms` reasonable
- [ ] `error` set to `true` when tool fails, absent otherwise
- [ ] Tool-specific attributes:
  - **bash**: `tool.command`, `tool.command_parsed`
  - **read**: `tool.path`, `tool.truncated`
  - **edit**: `tool.path`, `tool.old_text_length`, `tool.new_text_length`
  - **write**: `tool.path`, `tool.content_length`
- [ ] Parent is turn span

### Rollups (Main Span)

- [ ] `bash.cmd.*` counts (e.g., `bash.cmd.git.status: 2`)
- [ ] `file.*` counts (e.g., `file./src/auth.ts: 3`)
- [ ] `tool.bash.count`, `tool.read.count`, etc.
- [ ] `files.unique_count`, `bash.unique_commands`

### Hierarchy

- [ ] Spans form correct tree: main → turn → tool
- [ ] `traceId` same for all spans in a prompt
- [ ] `parentSpanId` correctly links children to parents

---

## Example Test Session (Manual)

```bash
# 1. Start receiver
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# 2. Start pi with HTTP export
PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi

# 3. In pi, run a prompt that exercises tools:
#    > read package.json then run make check

# 4. Watch the receiver output (tmux attach -t otel)
#    Verify spans appear with correct hierarchy and attributes

# 5. Try other export modes:
PI_TELEMETRY_EXPORT=unix:///tmp/otel.sock pi
PI_TELEMETRY_EXPORT=file://~/.pi/agent/telemetry pi

# 6. Clean up
tmux kill-session -t otel
```

---

## Automated Test Session (tmux send-keys)

Run pi in tmux and send commands programmatically:

```bash
# 1. Start receiver in one session
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"

# 2. Start pi in another session with telemetry enabled
tmux new-session -d -s pi "PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi"

# 3. Wait for pi to initialize
sleep 2

# 4. Send a prompt to pi
tmux send-keys -t pi "read package.json" Enter

# 5. Wait for completion
sleep 5

# 6. Check receiver output
tmux capture-pane -t otel -p | tail -30

# 7. Send another prompt
tmux send-keys -t pi "what files are in src/" Enter
sleep 5

# 8. Check again
tmux capture-pane -t otel -p | tail -50

# 9. Exit pi gracefully
tmux send-keys -t pi "/exit" Enter

# 10. Clean up
tmux kill-session -t pi
tmux kill-session -t otel
```

### Full Automated Test Script

```bash
#!/usr/bin/env bash
set -e

echo "=== Starting OTLP Test ==="

# Clean up any existing sessions
tmux kill-session -t otel 2>/dev/null || true
tmux kill-session -t pi 2>/dev/null || true

# Start receiver
echo "Starting receiver..."
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"
sleep 1

# Start pi with HTTP export
echo "Starting pi..."
tmux new-session -d -s pi "PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi"
sleep 3

# Test 1: Read a file
echo "Test 1: Reading a file..."
tmux send-keys -t pi "read README.md" Enter
sleep 5

# Check if span appeared
echo "Checking receiver output..."
OUTPUT=$(tmux capture-pane -t otel -p)
if echo "$OUTPUT" | grep -q "MAIN SPAN"; then
  echo "✓ Main span received"
else
  echo "✗ No main span found"
fi

if echo "$OUTPUT" | grep -q "tool.name.*read"; then
  echo "✓ Read tool span found"
else
  echo "✗ No read tool span"
fi

# Test 2: Run a command
echo "Test 2: Running bash command..."
tmux send-keys -t pi "run ls -la" Enter
sleep 5

OUTPUT=$(tmux capture-pane -t otel -p)
if echo "$OUTPUT" | grep -q "bash"; then
  echo "✓ Bash tool span found"
else
  echo "✗ No bash tool span"
fi

# Exit pi
echo "Cleaning up..."
tmux send-keys -t pi "/exit" Enter
sleep 2

# Show final output
echo ""
echo "=== Final Receiver Output ==="
tmux capture-pane -t otel -p | tail -40

# Cleanup
tmux kill-session -t pi 2>/dev/null || true
tmux kill-session -t otel 2>/dev/null || true

echo ""
echo "=== Test Complete ==="
```

### Testing Different Export Modes

```bash
# Test HTTP
tmux new-session -d -s pi "PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi"

# Test Unix socket
tmux new-session -d -s pi "PI_TELEMETRY_EXPORT=unix:///tmp/otel.sock pi"

# Test file export
tmux new-session -d -s pi "PI_TELEMETRY_EXPORT=file://~/.pi/agent/telemetry pi"
```

### Useful tmux Commands for Testing

```bash
# Capture full scrollback buffer (not just visible)
tmux capture-pane -t otel -p -S -1000

# Watch receiver in real-time while running tests
# Terminal 1:
tmux attach -t otel

# Terminal 2:
tmux send-keys -t pi "your prompt here" Enter

# Check if pi is still running
tmux list-sessions

# See what's in pi's pane
tmux capture-pane -t pi -p
```

---

## Troubleshooting

### No spans appearing

1. Check pi is configured: `echo $PI_TELEMETRY_EXPORT`
2. Check receiver is running: `tmux ls`
3. Check for errors in receiver: `tmux attach -t otel`

### HTTP connection refused

```bash
# Check if port is in use
lsof -i :4318

# Try a different port
bun tools/otel-test-receiver.ts --http --port 4319
PI_TELEMETRY_EXPORT=http://localhost:4319/v1/traces pi
```

### Unix socket permission denied

```bash
# Remove stale socket
rm /tmp/otel.sock

# Restart receiver
tmux kill-session -t otel
tmux new-session -d -s otel "bun tools/otel-test-receiver.ts -v"
```

### File watcher not picking up changes

1. Check directory exists: `ls ~/.pi/agent/telemetry`
2. Check file extension is `.otlp.jsonl`
3. File watcher polls every 1s, may have slight delay

---

## Cleanup

```bash
# Kill receiver
tmux kill-session -t otel

# Remove test files
rm -f ~/.pi/agent/telemetry/test*.otlp.jsonl

# Remove socket
rm -f /tmp/otel.sock
```
