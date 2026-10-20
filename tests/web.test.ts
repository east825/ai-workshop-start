// The decisions in spec/web.md, checked on the running web view: its page and /api/scan, with
// GitHub answering from recordings (tests/helpers.ts and below), and `skill-atlas serve` itself.
// The page's own script runs in jsdom, against the same server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { JSDOM } from 'jsdom';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub, openGitHubOrganization, parseGitHubUrl, type GitHubOptions } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer, listen, parseOrganization, parseRepository, type WebOrganizationScan, type WebScan } from '../src/web.ts';
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
  // What GitHub answers once the token's rate limit is used up.
  'https://api.github.com/repos/JetBrains/limited': {
    status: 403,
    body: { message: 'API rate limit exceeded for user ID 1. (But here is the good news: ...)' },
  },
};

/** JetBrains/markup: a skill whose name and description are markup. */
const MARKUP: Recording = {
  'https://api.github.com/repos/JetBrains/markup': { status: 200, body: { full_name: 'JetBrains/markup', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/markup/commits/main': { status: 200, body: { sha: COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/markup&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/x/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/markup/${COMMIT}/.claude/skills/x/SKILL.md`]: {
    status: 200,
    body: '---\nname: "<b>bold</b>"\ndescription: "<img src=x onerror=alert(1)> Runs."\n---\n',
  },
};

const API = 'https://api.github.com';
const ORG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const skillFile = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n`;
const raw = (id: string, path: string) => `https://raw.githubusercontent.com/${id}/${ORG_COMMIT}/${path}`;

/** The repository and its default branch's commit, as GitHub answers them. */
function repository(id: string): Recording {
  return {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: ORG_COMMIT } },
  };
}

/**
 * The Acme organization, through code search: zeta and alpha have skills (alpha's in two agents'
 * folders, one malformed), tooling has only test data's and is never opened.
 */
const ACME: Recording = {
  [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } },
  [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: {
    status: 200,
    body: {
      total_count: 5,
      items: [
        { path: '.claude/skills/deploy/SKILL.md', repository: { full_name: 'Acme/zeta' } },
        { path: '.claude/skills/commits/SKILL.md', repository: { full_name: 'Acme/alpha' } },
        { path: '.junie/skills/commits/SKILL.md', repository: { full_name: 'Acme/alpha' } },
        { path: '.agents/skills/review/SKILL.md', repository: { full_name: 'Acme/alpha' } },
        { path: 'testData/.claude/skills/sample/SKILL.md', repository: { full_name: 'Acme/tooling' } },
      ],
    },
  },
  ...repository('Acme/zeta'),
  ...repository('Acme/alpha'),
  [raw('Acme/zeta', '.claude/skills/deploy/SKILL.md')]: { status: 200, body: skillFile('deploy', 'Deploy the service. Use before a release.') },
  [raw('Acme/alpha', '.claude/skills/commits/SKILL.md')]: { status: 200, body: skillFile('commits', 'Write commit messages. Use for every commit.') },
  [raw('Acme/alpha', '.junie/skills/commits/SKILL.md')]: { status: 200, body: skillFile('commits', 'Write commit messages. Use for every commit.') },
  [raw('Acme/alpha', '.agents/skills/review/SKILL.md')]: { status: 200, body: '---\nname: [review\n---\n' },
  // Bare: no skills at all.
  [`${API}/orgs/Bare`]: { status: 200, body: { login: 'Bare' } },
  [`${API}/search/code?q=filename:SKILL.md+org:Bare&per_page=100&page=1`]: { status: 200, body: { total_count: 0, items: [] } },
  [`${API}/orgs/no-such-organization`]: { status: 404, body: { message: 'Not Found' } },
};

/** As the CLI opens what it is given: a repository, or an organization of them. */
function openAny(url: string, options: GitHubOptions) {
  return parseGitHubUrl(url) ? openGitHub(url, options) : openGitHubOrganization(url, options);
}

/** The URLs the web view asked to open: a local directory must never be among them. */
const opened: string[] = [];
const recorded = replay({ ...SKILLS, ...MARKUP, ...ACME }, github);
const server = createWebServer({
  open: (url) => {
    opened.push(url);
    // With a token, through code search, as the recordings answer it.
    return openAny(url, { fetch: recorded, token: 'test' });
  },
});
const base = `http://localhost:${await listen(server, 0, '127.0.0.1')}`;
after(() => server.close());

/** A GET with the `Host` header a browser would send for that name: fetch cannot set it. */
function getAs(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { Host: host } }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    }).on('error', reject);
  });
}

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

test('the input: an organization, by its name alone, its URL in any form, or a page of it', () => {
  for (const input of [
    'JetBrains',
    '  JetBrains  ',
    'https://github.com/JetBrains',
    'http://www.github.com/JetBrains/',
    'github.com/JetBrains',
    'https://github.com/JetBrains?tab=repositories',
    'https://github.com/orgs/JetBrains/repositories',
    'https://github.com/orgs/JetBrains/repositories?type=source',
  ]) {
    assert.deepEqual(parseOrganization(input), { owner: 'JetBrains' }, input);
    assert.equal(parseRepository(input), undefined, input);
  }
  for (const input of ['', 'JetBrains/example', 'github.com', 'https://gitlab.com/JetBrains', '/etc', './fixture', 'Jet.Brains', 'Jet Brains']) {
    assert.equal(parseOrganization(input), undefined, input);
  }
});

test('the page: one field for the repository and a pane below it for the skills', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  const page = await response.text();
  assert.match(page, /<form id="scan">\s*<input id="repo"[^>]*placeholder="owner\/repo, an organization or https:\/\/github\.com\/owner\/repo"/);
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

test('/api/scan: not a GitHub repository nor an organization → a clear message, and nothing is opened', async () => {
  opened.length = 0;
  for (const input of ['', './fixture', '/etc', 'https://gitlab.com/JetBrains/example', 'a/b/c']) {
    const scanned = await api(input);
    assert.equal(scanned.status, 400, input);
    assert.match(scanned.body.error!, /^Not a GitHub repository or organization: .*\. Paste owner\/repo, an organization or a github\.com URL\.$/);
  }
  assert.deepEqual(opened, []);
});

const ACME_SCAN: WebOrganizationScan = {
  organization: { id: 'Acme', url: 'https://github.com/Acme' },
  repositories: [
    {
      repository: { id: 'Acme/alpha', url: 'https://github.com/Acme/alpha', commit: ORG_COMMIT },
      skills: [
        {
          name: 'commits',
          description: 'Write commit messages.',
          link: `https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.claude/skills/commits/SKILL.md`,
          copies: ['.junie/skills/commits/SKILL.md'],
        },
        { name: 'review', description: '', link: `https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.agents/skills/review/SKILL.md`, copies: [] },
      ],
    },
    {
      repository: { id: 'Acme/zeta', url: 'https://github.com/Acme/zeta', commit: ORG_COMMIT },
      skills: [
        { name: 'deploy', description: 'Deploy the service.', link: `https://github.com/Acme/zeta/blob/${ORG_COMMIT}/.claude/skills/deploy/SKILL.md`, copies: [] },
      ],
    },
  ],
  warnings: [
    'Acme/alpha: .agents/skills/review/SKILL.md: malformed front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 14; using the directory name',
  ],
};

test('/api/scan: an organization → each of its repositories with skills, sorted by name, as the CLI prints them', async () => {
  for (const input of ['acme', 'https://github.com/acme', 'github.com/orgs/acme/repositories']) {
    opened.length = 0;
    const scanned = await api(input);
    assert.equal(scanned.status, 200, (scanned.body as { error?: string }).error);
    assert.deepEqual(scanned.body, ACME_SCAN, input);
    assert.deepEqual(opened, ['https://github.com/acme'], input);
  }
  // Without any skills: the organization, and no repositories.
  const bare = await api('Bare');
  assert.equal(bare.status, 200);
  assert.deepEqual(bare.body, { organization: { id: 'Bare', url: 'https://github.com/Bare' }, repositories: [], warnings: [] });
  // A user account, or no account at all, is not an organization.
  const notFound = await api('no-such-organization');
  assert.equal(notFound.status, 400);
  assert.equal(notFound.body.error, 'Organization not found: https://github.com/no-such-organization');
});

test('/api/scan: an organization without a token, through every repository\'s tree, forks left out', async () => {
  const tree = (id: string, paths: string[]): Recording => ({
    [`${API}/repos/${id}/git/trees/${ORG_COMMIT}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: path })) },
    },
  });
  const recording: Recording = {
    ...ACME,
    // Not answered in the recording: opening the fork fails the test.
    [`${API}/orgs/Acme/repos?per_page=100&page=1`]: {
      status: 200,
      body: [
        { full_name: 'Acme/zeta', fork: false },
        { full_name: 'Acme/fork', fork: true },
        { full_name: 'Acme/alpha', fork: false },
        { full_name: 'Acme/docs', fork: false },
      ],
    },
    ...tree('Acme/zeta', ['README.md', '.claude/skills/deploy/SKILL.md']),
    ...tree('Acme/alpha', ['.claude/skills/commits/SKILL.md', '.junie/skills/commits/SKILL.md', '.agents/skills/review/SKILL.md']),
    ...repository('Acme/docs'),
    ...tree('Acme/docs', ['README.md', 'docs/SKILL.md']),
  };
  const untokened = createWebServer({ open: (url) => openAny(url, { fetch: replay(recording) }) });
  const untokenedBase = `http://localhost:${await listen(untokened, 0, '127.0.0.1')}`;
  try {
    const response = await fetch(`${untokenedBase}/api/scan?repo=acme`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), ACME_SCAN);
  } finally {
    untokened.close();
  }
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

  const limited = await api('JetBrains/limited');
  assert.equal(limited.status, 400);
  assert.equal(limited.body.error, 'GitHub rate limit reached; try again in a minute');

  const offline = await api('JetBrains/not-answered');
  assert.equal(offline.status, 400);
  assert.equal(offline.body.error, 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered');
});

/** The page at the URL, its script running, its fetch going to the test server. */
async function page(url: string) {
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously',
    beforeParse: (window) => {
      window.fetch = (input: string | URL | Request, init?: RequestInit) => fetch(new URL(String(input), window.location.href), init);
    },
  });
  return dom.window;
}

/** Waits for the pane to show a result or an error, after `Scanning…`; a broken script shows neither. */
async function pane(window: Awaited<ReturnType<typeof page>>) {
  const results = window.document.getElementById('results')!;
  const deadline = Date.now() + 5000;
  while (!results.querySelector('h2, .error')) {
    if (Date.now() > deadline) assert.fail(`the pane shows no result: ${results.textContent || '(empty)'}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(window.document.querySelector('button')!.disabled, false);
  return results;
}

/** Each listed skill: its linked name, description and copies, as shown. */
function listed(results: HTMLElement) {
  return [...results.querySelectorAll(':scope > ul:not(.warnings) > li')].map((item) => ({
    name: item.querySelector('a.name')!.textContent,
    link: item.querySelector<HTMLAnchorElement>('a.name')!.href,
    description: item.querySelector('.description')?.textContent,
    copies: item.querySelector('.copies')?.textContent,
  }));
}

test('the pane: a pasted repository, its skills sorted by name, linked, with copies and warnings below', async () => {
  const window = await page(`${base}/`);
  window.document.querySelector<HTMLInputElement>('#repo')!.value = ' https://github.com/JetBrains/skills/tree/main ';
  window.document.querySelector<HTMLFormElement>('#scan')!.requestSubmit();
  const results = await pane(window);

  const title = results.querySelector('h2')!;
  assert.equal(title.textContent, 'JetBrains/skills · 2 skills');
  assert.equal(title.querySelector('a')!.href, 'https://github.com/JetBrains/skills');
  assert.deepEqual(listed(results), [
    { name: 'broken', link: `https://github.com/JetBrains/skills/blob/${COMMIT}/.agents/skills/broken/SKILL.md`, description: undefined, copies: undefined },
    {
      name: 'review',
      link: `https://github.com/JetBrains/skills/blob/${COMMIT}/.claude/skills/review/SKILL.md`,
      description: 'Review a pull request.',
      copies: 'also in .junie/skills/review/SKILL.md',
    },
  ]);
  // Below the list, not in it.
  const warnings = [...results.querySelectorAll(':scope > ul.warnings > li')].map((item) => item.textContent);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /^warning: \.agents\/skills\/broken\/SKILL\.md: malformed front matter: /);
  assert.equal(results.lastElementChild!.className, 'warnings');
  // The scan can be shared: the address now has it.
  assert.equal(new URL(window.location.href).searchParams.get('repo'), 'https://github.com/JetBrains/skills/tree/main');
});

test('the pane: ?repo= in the address scans at once', async () => {
  const window = await page(`${base}/?repo=${encodeURIComponent('JetBrains/example')}`);
  assert.equal(window.document.querySelector<HTMLInputElement>('#repo')!.value, 'JetBrains/example');
  const results = await pane(window);
  assert.equal(results.querySelector('h2')!.textContent, 'JetBrains/example · 1 skill');
  assert.deepEqual(listed(results), [
    {
      name: 'commits',
      link: `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
      description: 'Write commit messages the way this repository does.',
      copies: undefined,
    },
  ]);
  assert.equal(results.querySelector('.warnings'), null);
});

test('the pane: an organization, its repositories with skills, each as one repository, warnings below', async () => {
  const window = await page(`${base}/`);
  window.document.querySelector<HTMLInputElement>('#repo')!.value = ' acme ';
  window.document.querySelector<HTMLFormElement>('#scan')!.requestSubmit();
  const results = await pane(window);

  const title = results.querySelector('h2')!;
  assert.equal(title.textContent, 'Acme · 3 skills in 2 repositories');
  assert.equal(title.querySelector('a')!.href, 'https://github.com/Acme');
  const repositories = [...results.querySelectorAll<HTMLElement>(':scope > section.repository')];
  assert.deepEqual(
    repositories.map((section) => ({ title: section.querySelector('h3')!.textContent, link: section.querySelector<HTMLAnchorElement>('h3 a')!.href })),
    [
      { title: 'Acme/alpha · 2 skills', link: 'https://github.com/Acme/alpha' },
      { title: 'Acme/zeta · 1 skill', link: 'https://github.com/Acme/zeta' },
    ],
  );
  assert.deepEqual(listed(repositories[0]), [
    {
      name: 'commits',
      link: `https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.claude/skills/commits/SKILL.md`,
      description: 'Write commit messages.',
      copies: 'also in .junie/skills/commits/SKILL.md',
    },
    { name: 'review', link: `https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.agents/skills/review/SKILL.md`, description: undefined, copies: undefined },
  ]);
  assert.deepEqual(listed(repositories[1]), [
    { name: 'deploy', link: `https://github.com/Acme/zeta/blob/${ORG_COMMIT}/.claude/skills/deploy/SKILL.md`, description: 'Deploy the service.', copies: undefined },
  ]);
  const warnings = [...results.querySelectorAll(':scope > ul.warnings > li')].map((item) => item.textContent);
  assert.deepEqual(warnings, [`warning: ${ACME_SCAN.warnings[0]}`]);
  assert.equal(results.lastElementChild!.className, 'warnings');
  assert.equal(new URL(window.location.href).searchParams.get('repo'), 'acme');

  // With no skills at all: the organization, 0 skills.
  const bare = await pane(await page(`${base}/?repo=Bare`));
  assert.equal(bare.querySelector('h2')!.textContent, 'Bare · 0 skills');
  assert.equal(bare.querySelector('section.repository, li'), null);
});

test('the pane: a failure → the message, in the pane', async () => {
  for (const [repo, message] of [
    ['./fixture', 'Not a GitHub repository or organization: ./fixture. Paste owner/repo, an organization or a github.com URL.'],
    ['no-such-organization', 'Organization not found: https://github.com/no-such-organization'],
    ['JetBrains/not-answered', 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered'],
    ['JetBrains/limited', 'GitHub rate limit reached; try again in a minute'],
  ]) {
    const results = await pane(await page(`${base}/?repo=${encodeURIComponent(repo)}`));
    assert.equal(results.querySelector('.error')!.textContent, message, repo);
    assert.equal(results.querySelector('h2'), null);
  }
});

test('the pane: what GitHub answers is shown as text, never as markup', async () => {
  const results = await pane(await page(`${base}/?repo=JetBrains/markup`));
  assert.deepEqual(listed(results).map(({ name, description }) => ({ name, description })), [
    { name: '<b>bold</b>', description: '<img src=x onerror=alert(1)> Runs.' },
  ]);
  assert.equal(results.querySelector('b, img'), null);
});

test('anything else → 404; anything but GET → 405', async () => {
  assert.equal((await fetch(`${base}/api/other`)).status, 404);
  assert.equal((await fetch(`${base}/api/scan?repo=JetBrains/example`, { method: 'POST' })).status, 405);
});

test('access: on localhost, only for localhost; any name with --host', async (t) => {
  const port = new URL(base).port;
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'LOCALHOST']) {
    assert.equal(await getAs(`${base}/api/scan?repo=JetBrains/example`, host), 200, host);
  }
  // DNS rebinding: a page whose own name now points at 127.0.0.1.
  for (const host of [`attacker.example:${port}`, 'localhost.attacker.example', '192.0.2.1']) {
    assert.equal(await getAs(`${base}/`, host), 403, host);
    assert.equal(await getAs(`${base}/api/scan?repo=JetBrains/example`, host), 403, host);
  }

  const network = createWebServer({ open: (url) => openGitHub(url, { fetch: recorded, token: 'test' }), anyHost: true });
  const networkBase = `http://localhost:${await listen(network, 0, '127.0.0.1')}`;
  t.after(() => network.close());
  assert.equal(await getAs(`${networkBase}/api/scan?repo=JetBrains/example`, 'skill-atlas.example'), 200);
});

test('serve: --port and --host, a clear message for a wrong one or a port in use', async () => {
  const serve = async (args: string[], withServe = true) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const listened: [number, string | undefined][] = [];
    const code = await run(['serve', ...args], {
      open: () => Promise.reject(new Error('not used')),
      print: (text) => stdout.push(text),
      error: (text) => stderr.push(text),
      serve: withServe ? async (port, host) => (listened.push([port, host]), `http://${host ?? 'localhost'}:${port}`) : undefined,
    });
    return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), listened };
  };
  assert.deepEqual(await serve([]), {
    code: 0,
    stdout: 'Skill Atlas web view: http://localhost:3000',
    stderr: '',
    listened: [[3000, undefined]],
  });
  assert.deepEqual((await serve(['--port', '8080'])).listened, [[8080, undefined]]);
  assert.deepEqual((await serve(['--host', '0.0.0.0', '--port', '8080'])).listened, [[8080, '0.0.0.0']]);
  for (const args of [['--port'], ['--port', 'x'], ['--port', '70000'], ['8080'], ['--host'], ['--port', '1', '--port', '2'], ['--other', 'x']]) {
    const wrong = await serve(args);
    assert.equal(wrong.code, 1, args.join(' '));
    assert.match(wrong.stderr, /Usage: skill-atlas serve \[--port <port>\] \[--host <host>\]$/);
  }
  // The browser terminal has no server to start.
  assert.deepEqual(await serve([], false), {
    code: 1,
    stdout: '',
    stderr: 'The web view runs from the command line: skill-atlas serve',
    listened: [],
  });

  const port = Number(new URL(base).port);
  await assert.rejects(listen(createWebServer({ open: () => Promise.reject(new Error('not used')) }), port, '127.0.0.1'), {
    message: `Port ${port} is already in use`,
  });
});

test('the CLI: skill-atlas serve prints its address and answers there, for localhost only, never with its token', async (t) => {
  // The token comes from serve's environment; nothing the server answers may contain it.
  const token = 'ghp_skill_atlas_test_token';
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'serve', '--port', '0'], {
    env: { ...process.env, GITHUB_TOKEN: token },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const [line] = (await once(createInterface({ input: child.stdout }), 'line')) as [string];
  const address = /^Skill Atlas web view: (http:\/\/localhost:\d+)$/.exec(line)?.[1];
  assert.ok(address, line);
  const page = await fetch(`${address}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Skill Atlas<\/title>/);
  assert.ok(!line.includes(token) && !html.includes(token));
  assert.ok(!JSON.stringify([...page.headers]).includes(token));
  // Rejected before any request to GitHub: the test never reaches the network.
  const local = await fetch(`${address}/api/scan?repo=${encodeURIComponent('./fixture')}`);
  assert.equal(local.status, 400);
  assert.ok(!(await local.text()).includes(token));
  assert.equal(await getAs(`${address}/`, 'attacker.example'), 403);
});
