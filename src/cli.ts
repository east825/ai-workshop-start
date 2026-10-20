#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored. `serve` keeps running: the web view, GitHub only.
import { run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { createWebServer, isLocal, listen } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;

process.exitCode = await run(process.argv.slice(2), {
  open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input)),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  serve: async (port, host) => {
    // On the network, the server answers by any name: whoever reaches it scans with the token.
    const local = host === undefined || isLocal(host);
    const server = createWebServer({ open: (url) => openGitHub(url, { fetch, token }), anyHost: !local });
    const actual = await listen(server, port, host);
    return `http://${local ? 'localhost' : host!.includes(':') ? `[${host}]` : host}:${actual}`;
  },
});
