# Repository analysis

## Input

A **GitHub repository** URL, a **GitHub organization** URL, or a local directory

## Output

Every `SKILL.md`: **name**, **description**, **link**; for an organization, of each of its repositories

## Architecture

Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit

## Details

- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
- Skills should be deduplicated. If there are two skills with an identical name (the corresponding file can be copied or
  symlinked to another directory) include only one of them in the final results.
  - The same *name* (front matter, else the directory) is the same skill, whatever its content
  - The first path in path order is the skill; the other paths are its *copies*, printed as `also in`
  - Symbolic links are not followed, locally or on GitHub: a linked copy is not listed at all
- Don't list skills not related to the project sources themselves, e.g. skills inside a project's test data or skills included
  in the product built from the sources and, thus, intended for its users, not developers.
  - A skill is `<root>/<directory…>/SKILL.md`, where the root is an agent's folder: `.agents/skills`, `.claude/skills`,
    `.github/skills`, `.junie/skills` or `agent/skills`; anything else (`SKILL.md` at the root, `skills/x/SKILL.md`) is
    what the product ships
  - The root may be in a subdirectory (`packages/web/.claude/skills`), but not in one of test data or of product
    resources: `test`, `tests`, `testData`, `test-data`, `jvmTest`, `e2e-tests`, `__tests__`, `fixtures`, `mocks`,
    `snapshots`, `resources`, `templates` and the like
  - The skill's own directories are not checked: `.claude/skills/tests` is a skill
- An organization is every repository of it, each scanned as above, at its own default branch
  - Without `GITHUB_TOKEN`, every repository is listed and scanned through its tree; with it, one code search
    (`org:`) finds the repositories that have a `SKILL.md`, and only those with one of their own are scanned
  - Only repositories with skills are in the result
  - Forks are left out, with a token or without one: code search does not index them, and their skills
    are mostly their upstream's
  - A repository that cannot be scanned (an empty one, say) → a *warning*, the scan goes on; a rate limit stops it
  - Code search returns at most 1000 results: more → a *warning*
  - Unknown organization (a user account is not one) → a clear message, exit code 1

## Real repositories

What the scan prints for them is recorded in [tests/data](../tests/data), with GitHub's answers, and checked
offline; `npm run record` records them again.

- **JetBrains/MPS**: 42 skills, copied between `.agents/skills` and `.claude/skills`: each listed once, `also in`;
  a tree too large to list at once: only the skill roots, with a warning
- **JetBrains/android**: a tree too large to list at once, with a warning; 0 skills
- **JetBrains/koog**: a tree listed at once, no warning; 2 skills in `.claude/skills`
