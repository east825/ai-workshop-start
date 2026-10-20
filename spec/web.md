# Web view
`./skill-atlas serve [--port <port>]`: port **3000** by default, on every interface.
A *thin client* of the same core as the CLI; `GITHUB_TOKEN` as in the CLI.
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
