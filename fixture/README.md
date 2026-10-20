# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `.junie/skills/commits` | a copy of `.claude/skills/commits`: listed once, `also in` |
| `.junie/skills/code-style` | a symbolic link to `.github/skills/code-style`: listed once |
| `packages/web/.claude/skills/web-build` | a skill of a project in a subdirectory |
| `testData/project/.claude/skills/sample` | test data: not listed |
| `plugin/resources/.claude/skills/bundled` | shipped with the product: not listed |
| `plugin/skills/user-guide` | not in an agent's folder, shipped with the product: not listed |
