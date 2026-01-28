# AGENTS.MD

Work/Response style: telegraph; noun-phrases ok; drop filler/grammar; min tokens.

## Agent Protocol
- Contact: Calvin Alkan (calvin@snicco.io).
- Code/Projects: `~/code/repos/<repo>`.
- Git Worktrees: `~/code/worktrees/<repo>/<name>`
- Exploration (3rd-party or non-throwaway): `~/code/experiments`; create dirs with `try` (see `try --help`). 
  Clone from GitHub `try <github-url>`
- Throwaway code/quick testing: `mkdir -p /tmp/<name>`.
- `read-only file system` / `permission denied` errors for commands/file edits = likely sandboxed.
- Editor: `zed -n <path>`
- Web: search early; quote exact errors; prefer 2024–2025 sources
- Use Codex background for long jobs; `tmux` only for interactive/persistent (debugger/server), or when asked explicitly to.
  - Quick refs: `tmux new -d -s codex-shell`, `tmux attach -t codex-shell`, `tmux list-sessions`, `tmux kill-session -t codex-shell`.

## Critical Thinking
- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
- Leave breadcrumb notes in thread.

## Tests/Lint/Backpressure with `agent-run`
- Use global binary `agent-run` for project backpressure/lint/test (make check, make lint, make test, bun test, etc) 
For happy path usually exit 0 is all we care about for happy path; Saves tokens!
- Silent on success; on failure prints path to full output (read that file).
- Parallel:
    - `agent-run "cmd1" "cmd2" "cmd3"`.
  - stdin:
    - `echo -e "cmd1\ncmd2" | agent-run`.
- `agent-run --help` when stuck

## Git
- Commits: Conventional Commits (feat|fix|refactor|build|ci|chore|docs|style|perf|test).
- Safe by default: `git status/diff/log` ("read-only" commands).
- To prevent reverting changes from other agents: blocked git commands + alternatives : `checkout`→`switch`; `restore`→`stash`; `reset --hard`→`reset --soft`; `clean -f`→manual review; `push --force`→`--force-with-lease`; `stash pop`→`stash apply`.
