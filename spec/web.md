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
A **GitHub repository**, pasted into one field:
- `owner/repo`
- `https://github.com/owner/repo`, with or without the scheme, `www.`, `.git` or a trailing slash
- a page of the repository, as copied from the address bar (`…/tree/main/docs`): its repository

*GitHub only*: not a local directory. Anything else → a clear message, nothing is fetched.
## Output
A pane below the field, as in the CLI:
- `owner/repo · N skills`, linked to the repository
- Each skill: its **name**, linked to the `SKILL.md` at the scanned commit; the description's *first sentence*;
  `also in <paths>` for copies
- Sorted by **name**; warnings below the list
- Failure (repository not found, rate limit, GitHub unreachable) → the CLI's message, in the pane
- `?repo=<input>` in the page's address scans at once: a scan can be shared as a link
## API
`GET /api/scan?repo=<input>`, the pane's data:
- 200: `{ repository: { id, url, commit }, skills: [{ name, description, link, copies }], warnings }`
- 400: `{ error }`, for an input that is not a GitHub repository and for a failed scan
