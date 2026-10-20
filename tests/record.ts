// Records what GitHub answers for `skill-atlas scan <repository>`, and what the scan prints, into
// tests/data/<repository>/ for tests/e2e.test.ts to replay offline:
//   node tests/record.ts https://github.com/JetBrains/MPS …
// Without a token, as on CI: the skills are found through the tree. Set GITHUB_TOKEN only if the
// rate limit stops the recording; it is not stored, and the recording is the same.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import type { Recording } from '../src/core/replay.ts';
import { DATA } from './helpers.ts';

const token = process.env.GITHUB_TOKEN || undefined;

for (const url of process.argv.slice(2)) {
  const name = parseGitHubUrl(url);
  if (!name) throw new Error(`Not a GitHub repository URL: ${url}`);
  const recording: Recording = {};
  const recorder: Fetch = async (request, init) => {
    // Without a token, the API is only asked what is asked on CI, but a token raises the limit.
    const headers = { ...init?.headers, ...(token && request.startsWith('https://api.github.com/') && { Authorization: `Bearer ${token}` }) };
    const response = await fetch(request, { headers });
    const text = await response.text();
    const json = (response.headers.get('content-type') ?? '').includes('json');
    recording[request] = { status: response.status, body: json ? prune(request, JSON.parse(text)) : text };
    return new Response(text, { status: response.status });
  };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', url], {
    open: (input) => openGitHub(input, { fetch: recorder }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  if (code !== 0) throw new Error(`skill-atlas scan ${url} failed:\n${stderr.join('\n')}`);
  const directory = join(DATA, name.repo);
  mkdirSync(directory, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(recording).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(directory, 'recording.json'), `${JSON.stringify(sorted, null, 1)}\n`);
  writeFileSync(join(directory, 'stdout.txt'), `${stdout.join('\n')}\n`);
  writeFileSync(join(directory, 'stderr.txt'), stderr.length ? `${stderr.join('\n')}\n` : '');
  console.log(`${url}: ${stdout[0]}, ${Object.keys(recording).length} answers recorded in ${directory}`);
}

type Tree = { tree: { path: string }[] };

/**
 * A recursive tree of a large repository is megabytes of files that cannot be skills: only the
 * entries named like a SKILL.md, in any case, are kept. The scan prints the same from what is left.
 */
function prune(request: string, body: unknown): unknown {
  if (!/\/git\/trees\/[^/]+\?recursive=1$/.test(request) || !Array.isArray((body as Tree).tree)) return body;
  const tree = body as Tree;
  return { ...tree, tree: tree.tree.filter((entry) => /(^|\/)skill\.md$/i.test(entry.path)) };
}
