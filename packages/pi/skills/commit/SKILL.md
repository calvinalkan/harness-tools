---
name: commit
description: Create git commits for session changes with clear, atomic messages following conventional commit format
---

# Commit Changes

You are tasked with creating git commits for the changes made during this session.

## Process:

1. **Think about what changed:**
   - Review the conversation history and understand what was accomplished
   - Run `git status` to see current changes
   - Run `git diff` to understand the modifications
   - Consider whether changes should be one commit or multiple logical commits

2. **Plan your commit(s):**
   - Identify which files belong together
   - Draft clear, descriptive commit messages
   - Use imperative mood in commit messages
   - **REQUIRED**: Use conventional commit format: `<type>(<scope>): <description>`
     - Types: feat, fix, refactor, test, docs, chore, perf, style
     - Scope: Package name (inference, playground) or general area
     - Examples:
       - `feat(inference): add streaming support to parseText`
       - `fix(playground): resolve API endpoint race condition`
       - `refactor(schema): simplify typedSchema overloads`
   - Focus on why the changes were made, not just what

3. **Executes:**
   - Use `git add` with specific files (never use `-A` or `.`)
   - Never commit dummy files, test scripts, or other files which you created or which appear to have been created but which were not part of your changes or directly caused by them (e.g. generated code)
   - Create commits with your planned messages until all of your changes are committed with `git commit -m`

## Remember:

- You have the full context of what was done in this session
- Group related changes together
- Keep commits focused and atomic when possible
- The user trusts your judgment - they asked you to commit
- Do not commit files that where not created by you, and crucially, do NOT delete or revert them either. Leave them as-is,
and instead tell the user about those files.
