# OpenTelemetry Extension Specification

Telemetry design for pi coding agent following the **Wide Events** pattern.

> "For each unit-of-work emit one event with all the information you can collect about that work."
> — [A Practitioner's Guide to Wide Events](https://jeremymorrell.dev/blog/a-practitioners-guide-to-wide-events/)

---

## Design Principles

1. **One "main" span per prompt** with high-cardinality attributes for discovery
2. **Child spans** for turns and tools for drill-down/waterfall visualization
3. **Rollups bubble up** from tools → turns → main span
4. **Attribute-per-value pattern** for queryability (not comma-separated lists)
5. **Raw data on child spans**, aggregated counts on parent spans

---

## Span Hierarchy

```
Main Span (prompt) [main=true]
├── Rollups: files, commands, tokens, costs
│
├── Turn Span (turn-0)
│   ├── Rollups: this turn's files, commands, tokens
│   ├── Tool Span: bash
│   ├── Tool Span: read
│   └── Tool Span: read
│
├── Turn Span (turn-1)
│   ├── Rollups: this turn's files, commands, tokens
│   ├── Tool Span: edit
│   └── Tool Span: bash
│
└── Turn Span (turn-2)
    ├── Rollups: this turn's files, commands, tokens
    └── Tool Span: write
```

---

## Session Navigation Spans (Root)

Fork and tree navigation events emit **root spans** with their own trace IDs.
These spans are **not** children of prompt spans.

### `session.fork`

Emitted on `session_fork`.

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `session.id` | string | `ctx.sessionManager.getHeader().id` | New session ID |
| `session.name` | string | `ctx.sessionManager.getSessionName()` | Display name |
| `session.parent_id` | string | resolve from header `parentSession` | Parent session ID |
| `session.previous_id` | string | resolve from `event.previousSessionFile` | Previous session ID |
| `cwd` | string | `ctx.cwd` | Working directory |
| `service.name` | string | hardcoded | `"pi-coding-agent"` |

### `session.tree`

Emitted on `session_tree`.

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `session.id` | string | `ctx.sessionManager.getHeader().id` | Session ID |
| `session.name` | string | `ctx.sessionManager.getSessionName()` | Display name |
| `session.parent_id` | string | resolve from header `parentSession` | Parent session ID |
| `cwd` | string | `ctx.cwd` | Working directory |
| `session.tree.old_leaf_id` | string | `event.oldLeafId` | Leaf before navigation |
| `session.tree.new_leaf_id` | string | `event.newLeafId` | Leaf after navigation |
| `session.tree.summary_entry_id` | string | `event.summaryEntry.id` | Branch summary entry ID |
| `session.tree.summary_from_id` | string | `event.summaryEntry.fromId` | Summarized branch leaf |
| `session.tree.from_extension` | boolean | `event.fromExtension` | Custom summary from extension |
| `service.name` | string | hardcoded | `"pi-coding-agent"` |

---

## Main Span Attributes

### Identity

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `main` | `true` | hardcoded | Wide event marker |
| `session.id` | string | `ctx.sessionManager.getHeader().id` | Session ID |
| `session.name` | string | `ctx.sessionManager.getSessionName()` | Display name |
| `session.parent_id` | string | resolve from `ctx.sessionManager.getHeader().parentSession` | Parent session ID |
| `service.name` | string | hardcoded | `"pi-coding-agent"` |

### Environment

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `pi.version` | string | `import { VERSION }` | Agent version |
| `cwd` | string | `ctx.cwd` | Working directory |
| `has_ui` | boolean | `ctx.hasUI` | Interactive mode |
| `os.platform` | string | `process.platform` | linux/darwin/win32 |
| `os.arch` | string | `process.arch` | x64/arm64 |
| `runtime.name` | string | `process.versions.bun ? "bun" : "node"` | Runtime |
| `runtime.version` | string | `process.versions.bun \|\| process.version` | Version |

### Git (worktree-aware)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `git.branch` | string | `git branch --show-current` | Current branch |
| `git.commit` | string | `git rev-parse HEAD` | Full SHA |
| `git.commit_short` | string | `git rev-parse --short HEAD` | Short SHA |
| `git.worktree` | string | `git rev-parse --show-toplevel` | Worktree root |
| `git.cache_hit` | boolean | cached lookup | `true` if git info came from cache |
| `git.common_dir` | string | `git rev-parse --git-common-dir` | Shared .git dir |
| `git.remote_url` | string | `git remote get-url origin` | Repo URL |
| `git.repo_name` | string | parse from remote URL | Repository name |
| `git.user.name` | string | `git config user.name` | Git user |
| `git.user.email` | string | `git config user.email` | Git email |

### Input

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `input.source` | string | `InputEvent.source` | `interactive`/`rpc`/`extension` |
| `input.text` | string | `InputEvent.text` | Full prompt (truncated) |
| `input.text_length` | number | computed | Full length |
| `input.has_images` | boolean | `InputEvent.images?.length > 0` | Multimodal |
| `input.image_count` | number | `InputEvent.images?.length` | Image count |

### System Prompt

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `system_prompt` | string | `BeforeAgentStartEvent.systemPrompt` | Full prompt (truncated) |
| `system_prompt_length` | number | computed | Full length |

### Model (initial)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `model.provider` | string | `ctx.model.provider` | anthropic/openai/etc |
| `model.id` | string | `ctx.model.id` | Model ID |
| `model.name` | string | `ctx.model.name` | Human-readable |
| `model.reasoning` | boolean | `ctx.model.reasoning` | Thinking model? |
| `model.context_window` | number | `ctx.model.contextWindow` | Max context |
| `model.max_tokens` | number | `ctx.model.maxTokens` | Max output |
| `model.using_oauth` | boolean | `ctx.modelRegistry.isUsingOAuth()` | OAuth vs API key |
| `model.supports_images` | boolean | `ctx.model.input.includes("image")` | Multimodal capable |
| `model.cost.input` | number | `ctx.model.cost.input` | Cost per input token |
| `model.cost.output` | number | `ctx.model.cost.output` | Cost per output token |

### Active Tools

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tools.active.count` | number | `pi.getActiveTools().length` | Active tool count |
| `tools.active.<name>` | boolean | `pi.getActiveTools()` | Marker for an active tool |

### Context (at end)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `context.tokens` | number | `ctx.getContextUsage().tokens` | Total tokens |
| `context.percent` | number | `ctx.getContextUsage().percent` | % of window |
| `context.window` | number | `ctx.getContextUsage().contextWindow` | Window size |
| `context.usage_tokens` | number | `ctx.getContextUsage().usageTokens` | Tokens from last usage report |
| `context.trailing_tokens` | number | `ctx.getContextUsage().trailingTokens` | Estimated tokens after last usage |
| `context.last_usage_index` | number | `ctx.getContextUsage().lastUsageIndex` | Message index of last usage report |

### Outcome

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `status` | string | computed | `ok`/`error` |
| `final_stop_reason` | string | last turn's `stopReason` | `stop`/`tool_use`/`aborted` |
| `aborted` | boolean | `stopReason === "aborted"` | User aborted? |
| `error.message` | string | if errored | Error text |

### Thinking (if reasoning model)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `thinking.level` | string | `pi.getThinkingLevel()` | off/low/medium/high |

---

## Main Span Rollups

### Turn Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `turn.count` | number | Total turns |
| `turn.total_duration_ms` | number | Sum of turn times |
| `turn.avg_duration_ms` | number | Average turn time |
| `turn.max_duration_ms` | number | Slowest turn |
| `stop_reasons` | string | All stop reasons (comma-sep) |

### Token Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `tokens.input` | number | Total input tokens |
| `tokens.output` | number | Total output tokens |
| `tokens.cache_read` | number | Total cache reads |
| `tokens.cache_write` | number | Total cache writes |
| `tokens.total` | number | Grand total |
| `cost.total` | number | Total cost USD |

### Model Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `models` | string | All models used (comma-sep) |
| `model.switch_count` | number | Times model changed |

### Tool Aggregate Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `tool.count` | number | Total tool calls |
| `tool.error_count` | number | Failed tools |
| `tool.total_duration_ms` | number | Total tool time |
| `tool.unique_count` | number | Distinct tool types used |
| `tool.truncation_count` | number | Times output truncated |

### Per-Tool Type Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `tool.bash.count` | number | Bash calls |
| `tool.bash.duration_ms` | number | Total bash time |
| `tool.bash.error_count` | number | Failed commands |
| `tool.read.count` | number | Read calls |
| `tool.read.duration_ms` | number | Total read time |
| `tool.read.bytes_total` | number | Total bytes read |
| `tool.read.truncation_count` | number | Truncated reads |
| `tool.edit.count` | number | Edit calls |
| `tool.edit.duration_ms` | number | Total edit time |
| `tool.edit.error_count` | number | Failed edits |
| `tool.write.count` | number | Write calls |
| `tool.write.duration_ms` | number | Total write time |
| `tool.write.bytes_total` | number | Total bytes written |
| `tool.custom.count` | number | Custom tool calls |
| `tool.custom.duration_ms` | number | Total custom time |
| `tool.custom.error_count` | number | Failed custom |

### Bash Command Rollups (attribute-per-value)

Pattern: `bash.cmd.<base>.<subcommand> = count`

| Attribute | Type | Description |
|-----------|------|-------------|
| `bash.cmd.git.status` | number | Times `git status` ran |
| `bash.cmd.git.add` | number | Times `git add` ran |
| `bash.cmd.npm.install` | number | Times `npm install` ran |
| `bash.cmd.make.lint` | number | Times `make lint` ran |
| `bash.cmd.n/a` | number | Unparseable commands |
| `bash.unique_commands` | number | Distinct command types |

### File Path Rollups (attribute-per-value)

Pattern: `file.<path> = count`

| Attribute | Type | Description |
|-----------|------|-------------|
| `file./src/index.ts` | number | Times this file was touched |
| `file./package.json` | number | Times this file was touched |
| `files.unique_count` | number | Distinct files touched |
| `files.total_operations` | number | Total file operations |

### Per-Tool File Rollups

| Attribute | Type | Description |
|-----------|------|-------------|
| `tool.read.file./src/foo.ts` | number | Times read |
| `tool.edit.file./src/foo.ts` | number | Times edited |
| `tool.write.file./src/foo.ts` | number | Times written |
| `tool.read.unique_files` | number | Distinct files read |
| `tool.edit.unique_files` | number | Distinct files edited |
| `tool.write.unique_files` | number | Distinct files written |

### Session Events

| Attribute | Type | Description |
|-----------|------|-------------|
| `compaction.occurred` | boolean | Compaction happened? |
| `compaction.tokens_before` | number | Tokens before compaction |
| `compaction.from_extension` | boolean | Compaction triggered by extension |

---

## Turn Span Attributes

### Identity

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `turn.index` | number | `event.turnIndex` | Turn number |
| `turn.timestamp` | number | `event.timestamp` | Start time |
| `cwd` | string | `ctx.cwd` | Working directory |

### Model

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `model.provider` | string | `ctx.model.provider` | Model for this turn |
| `model.id` | string | `ctx.model.id` | Model ID |
| `thinking.level` | string | `pi.getThinkingLevel()` | Thinking level for this turn |

### Tokens

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tokens.input` | number | `message.usage.input` | Input tokens |
| `tokens.output` | number | `message.usage.output` | Output tokens |
| `tokens.cache_read` | number | `message.usage.cacheRead` | Cache read |
| `tokens.cache_write` | number | `message.usage.cacheWrite` | Cache write |
| `cost.total` | number | `message.usage.cost.total` | Turn cost |

### Timing

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `turn.duration_ms` | number | computed | Turn time |

### Response

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `stop_reason` | string | `message.stopReason` | stop/tool_use/aborted |
| `response.text` | string | extract from content | LLM response (truncated) |
| `response.text_length` | number | computed | Full length |
| `tool_results.count` | number | `event.toolResults.length` | Results received |

### Turn Rollups

Same pattern as main span, prefixed with `turn.`:

| Attribute | Type | Description |
|-----------|------|-------------|
| `turn.tool.count` | number | Tools called this turn |
| `turn.tool.error_count` | number | Failed tools this turn |
| `turn.tool.bash.count` | number | Bash calls this turn |
| `turn.bash.cmd.git.status` | number | This turn's git status calls |
| `turn.file./src/foo.ts` | number | This turn's touches to file |
| `turn.files.unique_count` | number | Distinct files this turn |

---

## Tool Span Attributes

### Base (All Tools)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.name` | string | `event.toolName` | Tool name |
| `tool.call_id` | string | `event.toolCallId` | Unique call ID |
| `tool.duration_ms` | number | computed | Execution time |
| `tool.is_error` | boolean | `event.isError` | Did it fail? |
| `tool.error_message` | string | extract from content | Error text if failed |
| `tool.model.provider` | string | state | Model that made this call |
| `tool.model.id` | string | state | Model ID |
| `tool.input_length` | number | computed | JSON length of tool input |
| `tool.output_length` | number | computed | Length of text output if present |
| `thinking.level` | string | `pi.getThinkingLevel()` | Thinking level for this tool call |
| `cwd` | string | `ctx.cwd` | Working directory |

### Bash

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.command` | string | `event.input.command` | Full command (truncated) |
| `tool.command_length` | number | computed | Full length |
| `tool.command_parsed` | string | `extractCommand()` | Normalized `git.status` |
| `tool.timeout` | number | `event.input.timeout` | Timeout if set |
| `tool.truncated` | boolean | `event.details.truncation` | Output truncated |
| `tool.full_output_path` | string | `event.details.fullOutputPath` | Temp file path |
| `tool.output` | string | parse from content | Output (stdout+stderr, truncated) |
| `tool.output_length` | number | computed | Full output length |

### Read

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.path` | string | `event.input.path` | File path |
| `tool.offset` | number | `event.input.offset` | Start line |
| `tool.limit` | number | `event.input.limit` | Max lines |
| `tool.truncated` | boolean | `event.details.truncation` | Was truncated |
| `tool.result` | string | `event.content` | File content (truncated) |
| `tool.result_length` | number | computed | Full length |
| `tool.is_image` | boolean | check content type | Image file? |

### Edit

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.path` | string | `event.input.path` | File path |
| `tool.old_text_length` | number | computed | Original text size |
| `tool.new_text_length` | number | computed | Replacement size |
| `tool.has_diff` | boolean | `!!event.details.diff` | Diff generated? |
| `tool.diff_length` | number | computed | Diff size |
| `tool.first_changed_line` | number | `event.details.firstChangedLine` | First modified line |

### Write

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.path` | string | `event.input.path` | File path |
| `tool.content_length` | number | computed | Content size |
| `tool.lines_written` | number | computed | Line count |

### Custom Tools (everything else)

| Attribute | Type | Source | Description |
|-----------|------|--------|-------------|
| `tool.name` | string | `event.toolName` | Custom tool name |
| `tool.input` | string | `JSON.stringify(event.input)` | Full input (truncated) |
| `tool.result` | string | `event.content` | Full result (truncated) |
| `tool.result_length` | number | computed | Full length |
| `tool.truncated` | boolean | computed | Output truncated by telemetry |
| `tool.has_images` | boolean | check content | Result has images |

---

## Truncation Strategy

| Content | Max Length | Store Length? |
|---------|------------|---------------|
| `input.text` | 10,000 | Yes |
| `system_prompt` | 10,000 | Yes |
| `response.text` | 10,000 | Yes |
| `tool.command` | 2,000 | Yes |
| `tool.output` | 5,000 | Yes |
| `tool.result` (read/custom) | 5,000 | Yes |
| `tool.input` (custom) | 2,000 | Yes |

```typescript
function truncate(value: string, maxLength: number): { 
  text: string; 
  length: number; 
  truncated: boolean 
} {
  const length = value.length;
  const truncated = length > maxLength;
  const text = truncated ? value.slice(0, maxLength) + "…[truncated]" : value;
  return { text, length, truncated };
}
```

---

## Command Parsing

```typescript
function extractCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return 'n/a';
  
  const parts = trimmed.split(/\s+/);
  const base = parts[0]?.replace(/^\.\//, '');
  if (!base) return 'n/a';
  
  const sub = parts[1];
  
  // Second part exists and isn't a flag
  if (sub && !sub.startsWith('-')) {
    return `${base}.${sub}`;
  }
  return base;
}

// Examples:
// "git status --porcelain" → "git.status"
// "npm install -D foo"     → "npm.install"
// "make lint"              → "make.lint"
// "ls -la"                 → "ls"
// "./build.sh --prod"      → "build.sh"
// ""                       → "n/a"
```

---

## Example Queries

### Discovery (Main Span)

```sql
-- Prompts that touched a specific file
WHERE file./src/index.ts > 0

-- Most common commands
GROUP BY bash.cmd.* ORDER BY count DESC

-- Expensive prompts
WHERE cost.total > 0.10 ORDER BY cost.total DESC

-- Prompts with many file operations
WHERE files.unique_count > 10

-- Failed prompts
WHERE status = "error"

-- Prompts using specific model
WHERE model.id = "claude-sonnet-4-20250514"

-- Interactive vs automated
GROUP BY input.source
```

### Turn Analysis

```sql
-- Slowest turns
ORDER BY turn.duration_ms DESC

-- Turns with most tool calls
WHERE turn.tool.count > 5

-- Turns that edited files
WHERE turn.tool.edit.count > 0
```

### Drill-Down (Tool Spans)

Once you find an interesting prompt/turn, drill into tool spans to see:
- Full `tool.command`
- Full `tool.result`
- Exact `tool.path`
- Error details

---

## Data Flow

```
InputEvent
    ↓
BeforeAgentStartEvent (capture system_prompt)
    ↓
AgentStartEvent (create main span, start rollup)
    ↓
┌─────────────────────────────────────────┐
│ TurnStartEvent (create turn span)       │
│     ↓                                   │
│ ToolCallEvent (create tool span)        │
│     ↓                                   │
│ ToolResultEvent (end tool span,         │
│                  update turn rollup)    │
│     ↓                                   │
│ TurnEndEvent (end turn span,            │
│               update main rollup)       │
└─────────────────────────────────────────┘
    ↓ (repeat for each turn)
AgentEndEvent (end main span, finalize rollups)
```

---

## State Management

```typescript
type PromptRollup = {
  // Turns
  turnCount: number;
  turnDurations: number[];
  stopReasons: Set<string>;
  
  // Tokens
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  costTotal: number;
  
  // Models
  models: Set<string>;
  modelSwitchCount: number;
  
  // Tools aggregate
  toolCount: number;
  toolErrorCount: number;
  toolTotalDurationMs: number;
  toolTruncationCount: number;
  
  // Per-tool type
  toolCounts: Map<string, number>;           // "bash" → 5
  toolDurations: Map<string, number>;        // "bash" → 12340
  toolErrors: Map<string, number>;           // "bash" → 1
  toolBytes: Map<string, number>;            // "read" → 45000
  
  // Commands (bash)
  bashCommands: Map<string, number>;         // "git.status" → 3
  
  // Files
  fileOperations: Map<string, number>;       // "/src/foo.ts" → 4
  filesByTool: Map<string, Map<string, number>>; // "read" → {"/src/foo.ts" → 2}
  
  // Session events
  compactionOccurred: boolean;
  compactionTokensBefore: number;
};

type TurnRollup = {
  toolCount: number;
  toolErrorCount: number;
  toolCounts: Map<string, number>;
  bashCommands: Map<string, number>;
  fileOperations: Map<string, number>;
};
```

---

## Export Configuration

Configuration is loaded from multiple sources in order of priority (highest first):

1. **Environment Variables** - Override everything
2. **Project Config** - `<cwd>/.pi/settings.json` under key `pi-opentelemetry`
3. **Global Config** - `~/.pi/agent/settings.json` under key `pi-opentelemetry`
4. **Defaults** - File export to `~/.pi/agent/telemetry`

### Config File Format

Both global and project config files use the same format under the `pi-opentelemetry` key:

```json
{
  "pi-opentelemetry": {
    "export": "http://localhost:4318/v1/traces",
    "headers": {
      "Authorization": "Bearer xxx",
      "X-Custom": "value"
    },
    "timeout": 5000,
    "batchSize": 10,
    "flushIntervalMs": 5000
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `export` | string | `file://~/.pi/agent/telemetry` | Destination URL |
| `headers` | object | - | HTTP headers (for http:// only) |
| `timeout` | number | 5000 | HTTP timeout in ms |
| `batchSize` | number | 10 | Spans to buffer before flush |
| `flushIntervalMs` | number | 5000 | Flush interval in ms |

### Environment Variables

Environment variables override config file settings:

```bash
# Destination (default: file://~/.pi/agent/telemetry)
PI_TELEMETRY_EXPORT=file://~/.pi/agent/telemetry
PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces
PI_TELEMETRY_EXPORT=https://otel.example.com/v1/traces
PI_TELEMETRY_EXPORT=unix:///var/run/otel.sock
PI_TELEMETRY_EXPORT=none

# HTTP options
PI_TELEMETRY_HEADERS="Authorization=Bearer xxx,X-Custom=value"
PI_TELEMETRY_TIMEOUT=5000

# Batching
PI_TELEMETRY_BATCH_SIZE=10
PI_TELEMETRY_FLUSH_INTERVAL=5000
```

### Config Merging Behavior

Configuration is merged in layers: defaults → global config → project config → env vars.
Each layer can override specific fields from previous layers.

#### Merging Rules

| Field | Behavior |
|-------|----------|
| `export` | Later value replaces earlier |
| `headers` | Later value **replaces entirely** (no merge of individual keys) |
| `timeout` | Later value replaces earlier |
| `batchSize` | Later value replaces earlier |
| `flushIntervalMs` | Later value replaces earlier |

#### HTTP Headers Behavior

When the destination is HTTP, headers follow these rules:

| Config Endpoint | Config Headers | Env Endpoint | Env Headers | Result Headers |
|-----------------|----------------|--------------|-------------|----------------|
| ✓ | ✓ | - | - | Config headers |
| ✓ | ✓ | - | ✓ | Env headers (replaces config) |
| ✓ | ✓ | ✓ | - | Config headers (preserved) |
| ✓ | ✓ | ✓ | ✓ | Env headers (replaces config) |
| ✓ | - | - | ✓ | Env headers |
| - | - | ✓ | ✓ | Env headers |

**Key behavior**: When `PI_TELEMETRY_EXPORT` overrides the endpoint but `PI_TELEMETRY_HEADERS` 
is not set, headers from config files are **preserved** (as long as both are HTTP destinations).

#### Common Patterns

**Pattern 1: Everything in config (committed to repo)**
```json
{
  "pi-opentelemetry": {
    "export": "http://otel.example.com/v1/traces",
    "headers": { "X-Team": "platform" }
  }
}
```

**Pattern 2: Endpoint in config, secrets in env (recommended)**
```json
{
  "pi-opentelemetry": {
    "export": "http://otel.example.com/v1/traces"
  }
}
```
```bash
PI_TELEMETRY_HEADERS="Authorization=Bearer $SECRET" pi
```

**Pattern 3: Local dev override**
```bash
# Override endpoint for local testing, config headers still apply
PI_TELEMETRY_EXPORT=http://localhost:4318/v1/traces pi
```

**Pattern 4: CI/CD full override**
```bash
# Override everything from env
PI_TELEMETRY_EXPORT=http://ci-collector/v1/traces \
PI_TELEMETRY_HEADERS="X-CI-Run=$RUN_ID" \
pi
```

**Pattern 5: Disable telemetry**
```bash
PI_TELEMETRY_EXPORT=none pi
```

#### Edge Cases

| Scenario | Result |
|----------|--------|
| Config has HTTP, env sets Unix socket | Headers lost (different destination type) |
| Config has HTTP, env sets `none` | Telemetry disabled, headers irrelevant |
| Global has headers, project has different headers | Project headers only (no merge) |
| Env headers empty string | Config headers preserved |

### Export Destinations

| Destination | Format | Example |
|-------------|--------|---------|
| File | `file://path` | `file://~/.pi/agent/telemetry` |
| HTTP | `http://` or `https://` | `http://localhost:4318/v1/traces` |
| Unix Socket | `unix://path` | `unix:///var/run/otel.sock` |
| Disabled | `none` | `none` |

### Types (TypeBox)

```typescript
import { Type, type Static } from "@sinclair/typebox";

/** Config file schema (under "pi-opentelemetry" key) */
const FileConfigSchema = Type.Object({
  export: Type.Optional(Type.String()),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  timeout: Type.Optional(Type.Number()),
  batchSize: Type.Optional(Type.Number()),
  flushIntervalMs: Type.Optional(Type.Number()),
});

/** Runtime destination types */
const FileDestination = Type.Object({
  type: Type.Literal("file"),
  dir: Type.String(),
});

const HttpDestination = Type.Object({
  type: Type.Literal("http"),
  url: Type.String(),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  timeout: Type.Optional(Type.Number({ default: 5000 })),
});

const UnixDestination = Type.Object({
  type: Type.Literal("unix"),
  path: Type.String(),
});

const NoneDestination = Type.Object({
  type: Type.Literal("none"),
});

const TelemetryDestination = Type.Union([
  FileDestination,
  HttpDestination,
  UnixDestination,
  NoneDestination,
]);

const TelemetryConfigSchema = Type.Object({
  destination: TelemetryDestination,
  batchSize: Type.Number({ default: 10 }),
  flushIntervalMs: Type.Number({ default: 5000 }),
});

type FileConfig = Static<typeof FileConfigSchema>;
type TelemetryDestination = Static<typeof TelemetryDestination>;
type TelemetryConfig = Static<typeof TelemetryConfigSchema>;
```

### Destination Parsing

```typescript
function parseDestination(value: string): TelemetryDestination {
  if (value === "none") {
    return { type: "none" };
  }
  if (value.startsWith("file://")) {
    return { type: "file", dir: value.slice(7) };
  }
  if (value.startsWith("unix://")) {
    return { type: "unix", path: value.slice(7) };
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return { type: "http", url: value };
  }
  // Default: treat as file path
  return { type: "file", dir: value };
}

function parseHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [key, val] = pair.split("=", 2);
    if (key && val) {
      headers[key.trim()] = val.trim();
    }
  }
  return headers;
}

function loadConfig(): TelemetryConfig {
  const exportEnv = process.env["PI_TELEMETRY_EXPORT"] ?? "file://~/.pi/agent/telemetry";
  const destination = parseDestination(exportEnv);
  
  // Add HTTP-specific config
  if (destination.type === "http") {
    destination.headers = parseHeaders(process.env["PI_TELEMETRY_HEADERS"]);
    destination.timeout = Number(process.env["PI_TELEMETRY_TIMEOUT"]) || 5000;
  }
  
  return {
    destination,
    batchSize: Number(process.env["PI_TELEMETRY_BATCH_SIZE"]) || 10,
    flushIntervalMs: Number(process.env["PI_TELEMETRY_FLUSH_INTERVAL"]) || 5000,
  };
}
```

### Behavior by Destination

| Destination | Behavior |
|-------------|----------|
| `file://` | Write OTLP JSONL, one batch per line, flush every N spans or M ms |
| `http(s)://` | POST OTLP JSON to endpoint, batch + retry on failure |
| `unix://` | Write OTLP JSON to socket, same batching as HTTP |
| `none` | Disabled, no telemetry collected |

---

## Output Format

### File Destination

Spans written as OTLP JSONL to `{dir}/{sessionId}_{timestamp}.otlp.jsonl`.

Each line is a complete OTLP export (one or more spans):

```jsonl
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"pi-coding-agent"}}]},"scopeSpans":[{"scope":{"name":"pi-telemetry","version":"0.1.0"},"spans":[...batch of spans...]}]}]}
```

### HTTP Destination

POST to endpoint with `Content-Type: application/json`:

```json
{
  "resourceSpans": [{
    "resource": {
      "attributes": [{"key": "service.name", "value": {"stringValue": "pi-coding-agent"}}]
    },
    "scopeSpans": [{
      "scope": {"name": "pi-telemetry", "version": "0.1.0"},
      "spans": [...]
    }]
  }]
}
```

### Unix Socket Destination

Same JSON format as HTTP, written to socket with newline delimiter.

---

## Flush Strategy

### Span Lifecycle

```
Span created (start)
    ↓
Span ended (complete, has all data)
    ↓
Span buffered in memory
    ↓
Batch flushed to destination
```

### Trigger Points

**Span completion (add to buffer):**
| Event | Action |
|-------|--------|
| `tool_result` | End tool span → buffer |
| `turn_end` | End turn span → buffer |
| `agent_end` | End main span → buffer → **flush immediately** |

**Flush triggers (send buffer to destination):**
| Trigger | Behavior |
|---------|----------|
| Buffer size reached | Flush when `spanBuffer.length >= batchSize` |
| Flush interval elapsed | Flush every `flushIntervalMs` if buffer not empty |
| `agent_end` | Flush immediately (natural boundary) |
| `session_shutdown` | Sync flush (blocking) |
| Process signals | Sync flush (blocking), let pi handle exit |

### Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `PI_TELEMETRY_BATCH_SIZE` | 10 | Spans before auto-flush |
| `PI_TELEMETRY_FLUSH_INTERVAL` | 5000 | ms before timer flush |

### Implementation

```typescript
const spanBuffer: OTLPSpan[] = [];
let flushTimer: Timer | null = null;

// On span complete - add to buffer
function bufferSpan(span: OTLPSpan): void {
  spanBuffer.push(span);
  
  if (spanBuffer.length >= config.batchSize) {
    flush();
  } else {
    scheduleFlush();
  }
}

// Schedule timer-based flush
function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, config.flushIntervalMs);
}

// Async flush (non-blocking)
function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (spanBuffer.length === 0) return;
  
  const batch = spanBuffer.splice(0, spanBuffer.length);
  exportBatch(batch);  // async, fire-and-forget
}

// Sync flush for shutdown (blocking)
function flushSync(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (spanBuffer.length === 0) return;
  
  const batch = spanBuffer.splice(0, spanBuffer.length);
  exportBatchSync(batch);  // blocking
}
```

### Event Handlers

```typescript
// Flush on agent_end (prompt complete)
pi.on("agent_end", (event, ctx) => {
  // ... end main span, buffer it ...
  flush();  // immediate flush at natural boundary
});

// Sync flush on session shutdown
pi.on("session_shutdown", () => {
  flushSync();
});

// Handle process signals (flush only, don't exit - pi handles that)
function setupShutdownHandlers(): void {
  process.on("SIGTERM", flushSync);
  process.on("SIGINT", flushSync);
  process.on("beforeExit", flushSync);
}
```

### Flush Behavior by Destination

| Destination | `flush()` (async) | `flushSync()` (blocking) |
|-------------|-------------------|--------------------------|
| `file://` | Append to file async | `appendFileSync()` |
| `http://` | POST with retry, fire-and-forget | POST with retry, await |
| `unix://` | Write to socket async | Write to socket sync |
| `none` | No-op | No-op |

### Error Handling

- **File**: Log error, continue (don't crash pi)
- **HTTP**: Retry up to 3 times with backoff, then drop batch
- **Unix**: Log error, continue

```typescript
async function exportBatch(batch: OTLPSpan[]): Promise<void> {
  try {
    await destination.send(batch);
  } catch (err) {
    // Log but don't throw - telemetry should never crash pi
    console.error("[telemetry] export failed:", err);
  }
}
```
