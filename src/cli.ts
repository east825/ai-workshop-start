#!/usr/bin/env node
// The Node client: a GitHub repository or organization through the GitHub API, or a local
// directory; stdout and stderr. Nothing is stored. `serve` keeps running: the web view, GitHub only.
import { readFileSync, unlinkSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './commands.ts';
import { AtlasError } from './core/errors.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganizationUrl, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { createWebServer, isLocal, listen } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;
// A running `serve` records its PID here so `stop` on the same machine can find it.
const pidFile = join(tmpdir(), 'skill-atlas.pid');

process.exitCode = await run(process.argv.slice(2), {
  open: (input) =>
    parseGitHubUrl(input)
      ? openGitHub(input, { fetch, token })
      : parseGitHubOrganizationUrl(input)
        ? openGitHubOrganization(input, { fetch, token })
        : openDirectory(input),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  serve: async (port, host) => {
    // On the network, the server answers by any name: whoever reaches it scans with the token.
    const local = host === undefined || isLocal(host);
    const server = createWebServer({
      open: (url) => (parseGitHubUrl(url) ? openGitHub(url, { fetch, token }) : openGitHubOrganization(url, { fetch, token })),
      anyHost: !local,
    });
    const actual = await listen(server, port, host);
    await writeFile(pidFile, `${process.pid}\n`);
    const cleanup = () => {
      // Only remove the file if it still points at us: a later `serve` may have taken it over.
      try {
        if (Number(readFileSync(pidFile, 'utf8').trim()) === process.pid) unlinkSync(pidFile);
      } catch {}
    };
    process.on('exit', cleanup);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => {
        cleanup();
        process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1));
      });
    }
    return `http://${local ? 'localhost' : host!.includes(':') ? `[${host}]` : host}:${actual}`;
  },
  stop: async () => {
    const pid = await readPidFile();
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        await unlink(pidFile).catch(() => {});
        throw new AtlasError('No running Skill Atlas web view');
      }
      throw new AtlasError(`Cannot stop PID ${pid}: ${(error as Error).message}`);
    }
    return `Stopped Skill Atlas web view (PID ${pid})`;
  },
});

async function readPidFile(): Promise<number> {
  let text: string;
  try {
    text = await readFile(pidFile, 'utf8');
  } catch {
    throw new AtlasError('No running Skill Atlas web view');
  }
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new AtlasError(`Stale PID file: ${pidFile}`);
  return pid;
}

