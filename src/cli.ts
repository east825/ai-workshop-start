#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored. `serve` keeps running: the web view, GitHub only.
import { run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { createWebServer, listen } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;

process.exitCode = await run(process.argv.slice(2), {
  open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input)),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  serve: async (port) => {
    const server = createWebServer({ open: (url) => openGitHub(url, { fetch, token }) });
    return `http://localhost:${await listen(server, port)}`;
  },
});
