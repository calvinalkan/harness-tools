#!/usr/bin/env bash
# Auto-backpressure validation script
# Usage: auto_backpressure.sh <file1> [file2] ...
# Runs lint suppression check, oxlint, and typecheck on specified files

set -euo pipefail

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <file1> [file2] ..." >&2
    exit 1
fi

# Check for lint suppressions first
bash backpressure/no-lint-suppress.sh "$@"

# Build regex pattern from file arguments
files_pattern="($(IFS='|'; echo "$*"))"

# Run typecheck and filter to only specified files
# Capture tsgo output, preserving its exit code via PIPESTATUS
tsgo_output=$(bun tsgo 2>&1) && tsgo_exit=0 || tsgo_exit=$?

# rg exit codes: 0=matches found, 1=no matches, 2+=error
errors=$(echo "$tsgo_output" | rg "$files_pattern") && rg_exit=0 || rg_exit=$?

if [[ $rg_exit -ge 2 ]]; then
    echo "Error: rg failed" >&2
    exit 2
fi

if [[ -n "$errors" ]]; then
    echo "$errors"
    exit 1
fi

# If tsgo crashed (not just type errors), fail hard
# Exit code 1 = type errors found (normal), higher = crash/missing
if [[ $tsgo_exit -gt 1 ]]; then
    echo "Error: tsgo crashed (exit $tsgo_exit)" >&2
    echo "$tsgo_output" >&2
    exit 2
fi

# Run oxlint
bun oxlint --fix --deny-warnings --type-aware --format=stylish "$@"
