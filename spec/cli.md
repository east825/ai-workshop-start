# Command line
`./skill-atlas scan <GitHub URL | directory> [--name-filter <glob>]`; the URL of a repository, or of an organization: `https://github.com/JetBrains`
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
## Name filter
`--name-filter <glob>` (or `--name-filter=<glob>`, before or after the repository): only the skills
whose **name** matches are listed, and counted in the header; without it, every skill
- A *Unix glob*, as fnmatch: `*` any text, `?` one character, `[abc]`, `[a-z]`, `[!abc]` or `[^abc]`; `\` escapes
- The *whole* name must match, case-sensitively: `web-*` matches `web-build`, not `my-web-build` or `Web-build`
- Copies stay with their skill: a skill and its `also in` share one name
- No match → `<repo> · 0 skills`, exit code 0; warnings are printed as without the filter
- No pattern after `--name-filter`, the option twice, an unknown option or an invalid glob (`[z-a]`) →
  a clear message, exit code 1
## Output for an organization
```
JetBrains · 9 skills in 2 repositories

JetBrains/intellij-community · 3 skills
…

JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Grouped by **repository**, sorted by its name; each group as for one repository, after a blank line
- A repository with *no skills* is not printed; with none at all, `JetBrains · 0 skills`
- Warnings start with their repository: `warning: JetBrains/kotlin: …`
- `--name-filter` filters each repository's skills; a repository with no match is not printed
