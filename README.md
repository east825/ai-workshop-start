# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

`--name-filter '<glob>'` lists only the skills whose name matches a Unix glob, such as
`--name-filter 'build-*'`.

`./skill-atlas serve` opens the same in the browser, at http://localhost:3000 (`--port` for another one): paste
`owner/repo` or a GitHub URL and the skills are listed below.

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

- [spec/](spec/): what it does, [spec/web.md](spec/web.md) for the web view. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
- [tests/data/](tests/data/): real repositories, JetBrains/MPS, JetBrains/android and JetBrains/koog: what GitHub
  answered and what the scan printed, replayed by the tests; `npm run record` records them again.
