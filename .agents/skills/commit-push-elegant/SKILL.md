---
name: commit-push-elegant
description: Commits changes using emoji conventional commit format (commit-elegant style) and pushes to remote in one workflow. Handles pre-commit verification, auto-staging, diff analysis, logical commit splitting, writing clear imperative commit messages, and pushing — including setting the upstream branch if not yet configured. Use this skill when the user wants to commit and push in one go.
---

# Commit Push

Commit using **commit-elegant** style, then push to remote — all in one workflow. Handles upstream setup automatically.

## Workflow

### Phase 1 — Commit (commit-elegant)

1. **Pre-commit checks** (skip if `--no-verify` is passed):
   - Detect the project's lint/typecheck/docs commands (check `package.json` scripts, `Makefile`, etc.).
   - Run them. If any fail, show the errors and ask the user: fix first or proceed anyway?
2. **Check staged files** — run `git status`.
   - If files are already staged, only commit those — do not auto-add.
   - If 0 files are staged, run `git add -A` to add all modified and new files.
3. **Diff** — run `git diff --staged` to understand what is being committed.
4. **Analyze** — determine if the diff contains multiple distinct logical concerns (different types, different domains, unrelated files).
5. **Split or single** — if multiple distinct concerns exist, present the proposed split to the user before executing. Otherwise, proceed with one commit.
6. **Commit** — for each commit, write a message in the format below and run `git commit -m "<message>"`.
7. **Verify** — review the committed diff to confirm the message accurately represents the change.

### Phase 2 — Push

8. **Check upstream** — determine if the current branch has an upstream tracking branch:
   ```bash
   git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
   ```
   - If this fails (exit code ≠ 0), the branch has **no upstream**.
9. **Push**:
   - **No upstream**: run `git push -u origin <branch>` to push and set the tracking branch.
   - **Has upstream**: run `git push` to push the committed changes.
10. **Confirm** — display the push result. If the push fails (e.g., rejected due to remote changes), inform the user and suggest `git pull --rebase` before retrying.

## Commit Message Format

### Subject line (required)
```
<emoji> <type>[(<scope>)][!]: <short imperative description>
```
- `(<scope>)` is optional — use when the change is clearly scoped to a module, package, or domain. Scope must be a noun (e.g., `auth`, `parser`, `ui`).
- `!` is optional — append immediately before `:` to flag a breaking change (e.g., `feat(api)!: remove v1 endpoints`).
- First line ≤ 72 characters.
- Use present-tense, imperative mood: "add feature", not "added feature".
- Do NOT include a `Co-Authored-By` line.

### Body (optional)
Add a body when the "why" is not obvious from the subject alone:
```
<emoji> <type>: <subject>

<body explaining why, not what>

[optional footer(s)]
```
- Separate subject from body with a blank line.
- Wrap body lines at 72 characters.
- Use body for motivation, context, or trade-off reasoning — not restating the diff.

### Footers (optional)
Footers go after the body, separated by a blank line. Common footers:
- `BREAKING CHANGE: <explanation>` — signals a breaking API change (correlates with SemVer MAJOR).
- `Refs: #<issue>` — links to an issue or ticket.
- `Reviewed-by: <name>` — credits a reviewer.
- Footer tokens use `-` instead of spaces (e.g., `Acked-by`), except `BREAKING CHANGE`.
- If `!` is used in the subject, `BREAKING CHANGE:` footer may be omitted.

### SemVer Correlation
- `fix` → PATCH release
- `feat` → MINOR release
- `BREAKING CHANGE` (any type) → MAJOR release

## Emoji + Type Reference

| Emoji | Type | Use for |
|-------|------|---------|
| ✨ | feat | New feature |
| 🐛 | fix | Bug fix |
| 🚑️ | fix | Critical hotfix |
| 🔒️ | fix | Security fix |
| 🚨 | fix | Fix compiler/linter warnings |
| 🩹 | fix | Simple non-critical fix |
| ✏️ | fix | Fix typos |
| 🔇 | fix | Remove logs |
| 🔥 | fix | Remove code or files |
| 📝 | docs | Documentation changes |
| 💡 | docs | Add or update source comments |
| 💄 | style | Formatting/style (no logic change) |
| 🎨 | style | Improve code structure/format |
| ♻️ | refactor | Refactor (no feature, no fix) |
| 🚚 | refactor | Move or rename resources |
| ⚰️ | refactor | Remove dead code |
| ⚡️ | perf | Performance improvement |
| ✅ | test | Add or update tests |
| 🧪 | test | Add a failing test |
| 📸 | test | Add or update snapshots |
| 🔧 | chore | Tooling, configuration |
| 🙈 | chore | Add or update .gitignore |
| 📦️ | chore | Add or update compiled files/packages |
| ➕ | chore | Add a dependency |
| ➖ | chore | Remove a dependency |
| 🔖 | chore | Release/version tag |
| 📌 | chore | Pin dependencies to specific versions |
| 👥 | chore | Add or update contributors |
| 🔀 | chore | Merge branches |
| 👷 | ci | Add or update CI build system |
| 🚀 | ci | CI/CD improvements |
| 💚 | fix | Fix CI build |
| ⏪️ | revert | Revert changes |
| 🗑️ | revert | Remove (deprecated/dead things) |
| 💥 | feat | Introduce breaking changes |
| 🏷️ | feat | Add or update types |
| 🦺 | feat | Add or update validation logic |
| 👔 | feat | Add or update business logic |
| 🌐 | feat | Internationalization/localization |
| 📱 | feat | Responsive design |
| 🚸 | feat | Improve UX/usability |
| ♿️ | feat | Improve accessibility |
| 🔊 | feat | Add or update logs |
| 📈 | feat | Add or update analytics/tracking |
| 🧵 | feat | Multithreading/concurrency |
| 🚩 | feat | Feature flags |
| 🔍️ | feat | Improve SEO |
| 💬 | feat | Add or update text and literals |
| 🥅 | fix | Catch errors |
| 👽️ | fix | Update code due to external API changes |
| 🗃️ | db | Perform database related changes |
| 🏗️ | refactor | Architectural changes |
| 🧑‍💻 | chore | Improve developer experience |
| 🌱 | chore | Add or update seed files |
| 🎉 | chore | Begin a project |
| 📄 | chore | Add or update license |
| 🤡 | test | Mock things |
| ⚗️ | experiment | Perform experiments |
| 🚧 | wip | Work in progress |
| 💫 | ui | Animations and transitions |
| 🍱 | assets | Add or update assets |
| 🥚 | feat | Add or update easter egg |
| ✈️ | feat | Improve offline support |

## When to Split Commits

Split when changes span:
1. **Different concerns** — unrelated parts of the codebase
2. **Different types** — e.g., mixing a feature with a refactor or a test
3. **Different file domains** — e.g., source code vs. CI config vs. documentation
4. **Logical independence** — changes that are easier to understand or review separately
5. **Size** — very large diffs that would be clearer if broken down

When splitting, present the proposed list of commits to the user before executing them.

### How to split mechanically
1. Unstage everything: `git reset HEAD`
2. For each proposed commit, selectively stage the relevant files:
   - `git add <file1> <file2>` for whole files
   - `git add -p <file>` for partial hunks within a file
3. Commit, then repeat for the next group.
4. After all commits are made, push once (Phase 2 handles this).

## Push Scenarios

### First push — no upstream
```bash
$ git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
# (exits non-zero — no upstream)

$ git push -u origin feature/add-auth-flow
# Branch 'feature/add-auth-flow' set up to track 'origin/feature/add-auth-flow'.
```

### Subsequent push — upstream exists
```bash
$ git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
# origin/feature/add-auth-flow

$ git push
```

### Push rejected — remote has new commits
```bash
$ git push
# ! [rejected] feature/add-auth-flow -> feature/add-auth-flow (non-fast-forward)

# Suggest:
$ git pull --rebase origin feature/add-auth-flow
$ git push
```

### Force push (only when explicitly requested)
```bash
$ git push --force-with-lease
```
Never force-push unless the user explicitly asks for it. Prefer `--force-with-lease` over `--force`.

## Edge Cases

- **Amend**: If the user says "amend", use `git commit --amend` and rewrite the message to reflect the combined change. Then push with `--force-with-lease` (since history was rewritten).
- **Empty commit**: Never create an empty commit unless explicitly requested (`git commit --allow-empty`).
- **Merge commits**: Do not rewrite merge commit messages — leave them as generated by git.
- **Fixup**: If a change is a direct fix to the previous commit, suggest `git commit --fixup=HEAD` for later interactive rebase, or amend if the user prefers.
- **Wrong type**: If a commit was made with the wrong type, suggest `git rebase -i` to reword it before pushing. After push, note that cleanup depends on the team's workflow.
- **Multi-type change**: If a single change conforms to more than one type, always split into multiple commits.
- **Detached HEAD**: If in detached HEAD state, warn the user and suggest creating a branch first with `git checkout -b <branch>`.
- **Protected branch**: If pushing to a protected branch fails, inform the user that the branch is protected and suggest creating a PR instead.
- **No remote**: If no remote named `origin` exists, run `git remote -v` to list available remotes. If none exist, ask the user for the remote URL.

## Examples

### Single commit + push (new branch)
```
✨ feat: add user authentication system
→ git push -u origin feature/add-auth-system
```

### Single commit + push (existing upstream)
```
🐛 fix: resolve memory leak in rendering process
→ git push
```

### Split commits + single push
```
✨ feat: add new solc version type definitions
📝 docs: update documentation for new solc versions
🔧 chore: update package.json dependencies
→ git push
```

### Amend + force push
```
♻️ refactor: simplify error handling logic in parser
→ git push --force-with-lease
```

## Anti-Patterns

Avoid these:
```
# Too vague
🔧 chore: update stuff
🐛 fix: fix bug
✨ feat: changes

# Past tense
🐛 fix: fixed the login issue

# Too long
✨ feat: add user authentication system with JWT tokens and refresh token rotation and session management

# Mixing concerns in one commit
✨ feat: add auth system and fix header styling and update docs

# Meaningless scope
🐛 fix(code): resolve bug

# Force pushing without being asked
git push --force  (never do this unprompted)

# Pushing without verifying the commit first
git commit -m "..." && git push  (always verify between commit and push)
```
