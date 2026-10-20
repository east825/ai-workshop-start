// The decisions in spec/web.md, checked on the running web view: its page and /api/scan, with
// GitHub answering from recordings (tests/helpers.ts and below), and `skill-atlas serve` itself.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer, listen, parseRepository, type WebScan } from '../src/web.ts';
import { CLI, EXAMPLE_COMMIT, github } from './helpers.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** JetBrains/skills: one skill with a copy, and one with malformed front matter. */
const SKILLS: Recording = {
  'https://api.github.com/repos/JetBrains/skills': { status: 200, body: { full_name: 'JetBrains/skills', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/skills/commits/main': { status: 200, body: { sha: COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/skills&per_page=100&page=1': {
    status: 200,
    body: {
      total_count: 3,
      items: [{ path: '.junie/skills/review/SKILL.md' }, { path: '.claude/skills/review/SKILL.md' }, { path: '.agents/skills/broken/SKILL.md' }],
    },
  },
  [`https://raw.githubusercontent.com/JetBrains/skills/${COMMIT}/.claude/skills/review/SKILL.md`]: {
    status: 200,
    body: '---\nname: review\ndescription: Review a pull request.\n  Look at the tests first.\n---\n',
  },
  [`https://raw.githubusercontent.com/JetBrains/skills/${COMMIT}/.junie/skills/review/SKILL.md`]: {
    status: 200,
    body: '---\nname: review\ndescription: Review a pull request.\n---\n',
  },
  [`https://raw.githubusercontent.com/JetBrains/skills/${COMMIT}/.agents/skills/broken/SKILL.md`]: {
    status: 200,
    body: '---\nname: broken\ndescription: a: b: c\n---\n',
  },
};

/** The URLs the web view asked to open: a local directory must never be among them. */
const opened: string[] = [];
const recorded = replay(SKILLS, github);
const server = createWebServer({
  open: (url) => {
    opened.push(url);
    // With a token, through code search, as the recordings answer it.
    return openGitHub(url, { fetch: recorded, token: 'test' });
  },
});
const base = `http://localhost:${await listen(server, 0, '127.0.0.1')}`;
after(() => server.close());

async function api(repo: string) {
  const response = await fetch(`${base}/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: (await response.json()) as WebScan & { error?: string } };
}

const EXAMPLE: WebScan = {
  repository: { id: 'JetBrains/example', url: 'https://github.com/JetBrains/example', commit: EXAMPLE_COMMIT },
  skills: [
    {
      name: 'commits',
      description: 'Write commit messages the way this repository does.',
      link: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
      copies: [],
    },
  ],
  warnings: [],
};

test('the input: owner/repo, a repository URL in any form, or a page of the repository', () => {
  const example = { owner: 'JetBrains', repo: 'example' };
  for (const input of [
    'JetBrains/example',
    '  JetBrains/example  ',
    'JetBrains/example.git',
    'https://github.com/JetBrains/example',
    'http://www.github.com/JetBrains/example/',
    'github.com/JetBrains/example.git',
    'https://github.com/JetBrains/example/tree/main/docs',
    'https://github.com/JetBrains/example/blob/main/README.md#usage',
    'https://github.com/JetBrains/example?tab=readme-ov-file',
  ]) {
    assert.deepEqual(parseRepository(input), example, input);
  }
  assert.deepEqual(parseRepository('JetBrains/intellij.community'), { owner: 'JetBrains', repo: 'intellij.community' });
  for (const input of ['', 'JetBrains', 'github.com/JetBrains', 'https://gitlab.com/JetBrains/example', '/etc/passwd', './fixture', 'a/b/c']) {
    assert.equal(parseRepository(input), undefined, input);
  }
});

test('the page: one field for the repository and a pane below it for the skills', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  const page = await response.text();
  assert.match(page, /<form id="scan">\s*<input id="repo"[^>]*placeholder="owner\/repo or https:\/\/github\.com\/owner\/repo"/);
  assert.match(page, /<\/form>\s*<section id="results"/);
  // The scan is asked for relative to the page, so it works behind a proxy's path too.
  assert.match(page, /fetch\('api\/scan\?repo=' \+ encodeURIComponent\(repo\)\)/);
  // What GitHub answers goes into the page as text, never as markup.
  assert.doesNotMatch(page, /innerHTML/);
});

test('/api/scan: owner/repo and the repository URL scan the same repository, as the CLI prints it', async () => {
  for (const input of ['JetBrains/example', 'https://github.com/JetBrains/example', 'https://github.com/JetBrains/example/tree/main/src']) {
    const scanned = await api(input);
    assert.equal(scanned.status, 200, scanned.body.error);
    assert.deepEqual(scanned.body, EXAMPLE, input);
  }
});

test('/api/scan: sorted by name, first sentences, copies and warnings', async () => {
  const scanned = await api('github.com/JetBrains/skills');
  assert.equal(scanned.status, 200, scanned.body.error);
  assert.deepEqual(scanned.body.skills, [
    { name: 'broken', description: '', link: `https://github.com/JetBrains/skills/blob/${COMMIT}/.agents/skills/broken/SKILL.md`, copies: [] },
    {
      name: 'review',
      description: 'Review a pull request.',
      link: `https://github.com/JetBrains/skills/blob/${COMMIT}/.claude/skills/review/SKILL.md`,
      copies: ['.junie/skills/review/SKILL.md'],
    },
  ]);
  assert.equal(scanned.body.warnings.length, 1);
  assert.match(scanned.body.warnings[0], /^\.agents\/skills\/broken\/SKILL\.md: malformed front matter: .*; using the directory name$/);
});

test('/api/scan: not a GitHub repository → a clear message, and nothing is opened', async () => {
  opened.length = 0;
  for (const input of ['', './fixture', '/etc', 'https://gitlab.com/JetBrains/example']) {
    const scanned = await api(input);
    assert.equal(scanned.status, 400, input);
    assert.match(scanned.body.error!, /^Not a GitHub repository: .*\. Paste owner\/repo or a github\.com URL\.$/);
  }
  assert.deepEqual(opened, []);
});

test('/api/scan: a failed scan → the CLI\'s message', async () => {
  const notFound = createWebServer({
    open: (url) =>
      openGitHub(url, {
        fetch: replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } }),
      }),
  });
  const notFoundBase = `http://localhost:${await listen(notFound, 0, '127.0.0.1')}`;
  try {
    const response = await fetch(`${notFoundBase}/api/scan?repo=JetBrains/no-such-repository`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Repository not found: https://github.com/JetBrains/no-such-repository' });
  } finally {
    notFound.close();
  }

  const offline = await api('JetBrains/not-answered');
  assert.equal(offline.status, 400);
  assert.equal(offline.body.error, 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered');
});

test('anything else → 404; anything but GET → 405', async () => {
  assert.equal((await fetch(`${base}/api/other`)).status, 404);
  assert.equal((await fetch(`${base}/api/scan?repo=JetBrains/example`, { method: 'POST' })).status, 405);
});

test('serve: --port, a clear message for a wrong one or one in use', async () => {
  const serve = async (args: string[], withServe = true) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const ports: number[] = [];
    const code = await run(['serve', ...args], {
      open: () => Promise.reject(new Error('not used')),
      print: (text) => stdout.push(text),
      error: (text) => stderr.push(text),
      serve: withServe ? async (port) => (ports.push(port), `http://localhost:${port}`) : undefined,
    });
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), ports };
  };
  assert.deepEqual(await serve([]), { code: 0, stdout: 'Skill Atlas web view: http://localhost:3000', stderr: '', ports: [3000] });
  assert.deepEqual((await serve(['--port', '8080'])).ports, [8080]);
  for (const args of [['--port'], ['--port', 'x'], ['--port', '70000'], ['8080']]) {
    const wrong = await serve(args);
    assert.equal(wrong.code, 1, args.join(' '));
    assert.match(wrong.stderr, /Usage: skill-atlas serve \[--port <port>\]$/);
  }
  // The browser terminal has no server to start.
  assert.deepEqual(await serve([], false), {
    code: 1,
    stdout: '',
    stderr: 'The web view runs from the command line: skill-atlas serve',
    ports: [],
  });

  const port = Number(new URL(base).port);
  await assert.rejects(listen(createWebServer({ open: () => Promise.reject(new Error('not used')) }), port, '127.0.0.1'), {
    message: `Port ${port} is already in use`,
  });
});

test('the CLI: skill-atlas serve prints its address and answers there', async (t) => {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'serve', '--port', '0'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const [line] = (await once(createInterface({ input: child.stdout }), 'line')) as [string];
  const address = /^Skill Atlas web view: (http:\/\/localhost:\d+)$/.exec(line)?.[1];
  assert.ok(address, line);
  const page = await fetch(`${address}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Skill Atlas<\/title>/);
  // Rejected before any request to GitHub: the test never reaches the network.
  const local = await fetch(`${address}/api/scan?repo=${encodeURIComponent('./fixture')}`);
  assert.equal(local.status, 400);
});
