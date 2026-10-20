# Web view
`./skill-atlas serve [--port <port>] [--host <host>]`: **localhost:3000** by default.
A *thin client* of the same core as the CLI.
## Access
`GITHUB_TOKEN`, optional, as in the CLI: from the environment of `skill-atlas serve`, read when it starts.
Every scan uses it, whoever asks for it; the page never sends nor receives it. The token may read private
repositories, so:
- On localhost, only requests for `localhost`, `127.0.0.1` or `[::1]` are answered; any other `Host` → 403
  (a page that points its own name at localhost, DNS rebinding, does not get the token's answers)
- `--host <host>` other than localhost puts the server on the network *on purpose*: it answers by any name,
  and whoever reaches it scans with the token
## Input
A **GitHub repository** or a **GitHub organization**, pasted into one field:
- `owner/repo`
- `https://github.com/owner/repo`, with or without the scheme, `www.`, `.git` or a trailing slash
- a page of the repository, as copied from the address bar (`…/tree/main/docs`): its repository
- an organization's name alone, `JetBrains`, or `https://github.com/JetBrains`, with or without the scheme,
  `www.` or a trailing slash; a page of it (`?tab=repositories`, `github.com/orgs/JetBrains/repositories`):
  the organization, scanned as in the CLI ([analysis](analysis.md)): code search with the token, every
  repository's tree without it, forks left out

*GitHub only*: not a local directory. Anything else → a clear message, nothing is fetched.
## Output
A pane below the field, as in the CLI:
- `owner/repo · N skills`, linked to the repository
- Each skill: its **name**, linked to the `SKILL.md` at the scanned commit; the description's *first sentence*;
  `also in <paths>` for copies
- Sorted by **name**; warnings below the list
- An organization, as the CLI prints it: `JetBrains · N skills in M repositories`, linked to the
  organization; then each repository with skills, sorted by its name, as one repository is shown above;
  with none at all, `JetBrains · 0 skills`; warnings below, each starting with its repository
- Failure (repository or organization not found, rate limit, GitHub unreachable) → the CLI's message, in the pane
- `?repo=<input>` in the page's address scans at once: a scan can be shared as a link
## API
`GET /api/scan?repo=<input>`, the pane's data:
- 200: `{ repository: { id, url, commit }, skills: [{ name, description, link, copies }], warnings }`
- 200, for an organization: `{ organization: { id, url }, repositories: [{ repository, skills }], warnings }`,
  only the repositories with skills, each as above
- 400: `{ error }`, for an input that is neither a GitHub repository nor an organization and for a failed scan
