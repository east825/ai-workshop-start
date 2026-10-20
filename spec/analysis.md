# Repository analysis

## Input

A **GitHub repository** URL, or a local directory

## Output

Every `SKILL.md`: **name**, **description**, **link**

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
- Don't list skills not related to the project sources themselves, e.g. skills inside a project's test data or skills included
  in the product built from the sources and, thus, intended for its users, not developers.
