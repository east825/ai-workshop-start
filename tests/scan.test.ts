// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture (see fixture/README.md for its cases), for a small GitHub repository answered in
// tests/helpers.ts and for recorded GitHub answers below.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { findSkills, SKILL_ROOTS } from '../src/core/find.ts';
import { openGitHub, openGitHubOrganization, parseGitHubOrganizationUrl, parseGitHubUrl } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 4 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      '  also in .junie/skills/commits/SKILL.md',
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
      'web-build — Build the web package with its own toolchain.',
      `  ${root}/packages/web/.claude/skills/web-build/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('./fixture: a copy and a symbolic link are listed once; test data and product skills are not listed', () => {
  // Listed once: the copy in .junie/skills/commits as `also in`, the link .junie/skills/code-style not at all.
  assert.equal(fixture.stdout.match(/^commits /gm)?.length, 1);
  assert.equal(fixture.stdout.match(/^code-style /gm)?.length, 1);
  assert.doesNotMatch(fixture.stdout, /\.junie\/skills\/code-style/);
  // testData/…/sample, plugin/resources/…/bundled and plugin/skills/user-guide.
  assert.doesNotMatch(fixture.stdout, /sample|bundled|user-guide/);
});

test('this repository: the skills in ./fixture are test data, not its own', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const own = await atlas(['scan', root]);
  assert.equal(own.code, 0, own.stderr);
  // Its own skills, whichever it has: each SKILL.md in a skill directory of its agents' folders.
  const skills = SKILL_ROOTS.flatMap((skillRoot) =>
    existsSync(join(root, skillRoot))
      ? readdirSync(join(root, skillRoot)).filter((name) => existsSync(join(root, skillRoot, name, 'SKILL.md'))).map((name) => `${skillRoot}/${name}/SKILL.md`)
      : [],
  );
  const [header, ...lines] = own.stdout.split('\n');
  assert.equal(header, `${basename(root)} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  const links = lines.filter((line) => line.startsWith('  file:')).map((line) => line.trim());
  assert.deepEqual(links.sort(), skills.map((path) => `${pathToFileURL(root).href}${path}`).sort());
  assert.doesNotMatch(own.stdout, /fixture/);
});

test('only skills in an agent folder, outside test data and product resources, are the repository\'s own', () => {
  const own = [
    '.claude/skills/commits/SKILL.md',
    '.agents/skills/group/nested/SKILL.md',
    '.github/skills/tests/SKILL.md', // a skill may be named after tests
    '.junie/skills/x/SKILL.md',
    'agent/skills/x/SKILL.md',
    'packages/web/.claude/skills/x/SKILL.md',
    'latest/.claude/skills/x/SKILL.md', // ends with "test", but is not test data
  ];
  const foreign = [
    'SKILL.md', // a repository that is a skill ships it to its users
    'docs/SKILL.md',
    'skills/pdf/SKILL.md',
    '.claude/skills/SKILL.md', // not in a skill's own directory
    '.claude/skills/x/skill.md',
    '.claude/skills/x/SKILL.md.bak',
    'test/.claude/skills/x/SKILL.md',
    'src/test/resources/.claude/skills/x/SKILL.md',
    'tests/e2e/.agents/skills/x/SKILL.md',
    'plugins/foo/testData/.claude/skills/x/SKILL.md',
    'plugins/foo/test-data/.claude/skills/x/SKILL.md',
    'src/jvmTest/.claude/skills/x/SKILL.md',
    'e2e-tests/.claude/skills/x/SKILL.md',
    '__tests__/.claude/skills/x/SKILL.md',
    'fixtures/repo/.claude/skills/x/SKILL.md',
    'plugins/foo/resources/.claude/skills/x/SKILL.md',
    'templates/new-project/.claude/skills/x/SKILL.md',
    'plugins/foo/skills/x/SKILL.md',
  ];
  assert.deepEqual(findSkills([...foreign, ...own]).map((file) => file.path), [...own].sort());
  assert.deepEqual(findSkills(['.agents/skills/group/nested/SKILL.md']), [
    { path: '.agents/skills/group/nested/SKILL.md', name: 'nested' },
  ]);
});

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** JetBrains/monorepo: one skill in three agents' folders, and skills that are not its own. */
function monorepo(paths: string[], tree: { path: string; mode: string; type: string; sha: string }[]): Recording {
  const commits = '---\nname: commits\ndescription: Write commit messages. Use for every commit.\n---\n';
  const raw = (path: string) => `https://raw.githubusercontent.com/JetBrains/monorepo/${COMMIT}/${path}`;
  return {
    'https://api.github.com/repos/JetBrains/monorepo': { status: 200, body: { full_name: 'JetBrains/monorepo', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/monorepo/commits/main': { status: 200, body: { sha: COMMIT } },
    'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/monorepo&per_page=100&page=1': {
      status: 200,
      body: { total_count: paths.length, items: paths.map((path) => ({ path })) },
    },
    [`https://api.github.com/repos/JetBrains/monorepo/git/trees/${COMMIT}?recursive=1`]: { status: 200, body: { truncated: false, tree } },
    [raw('.claude/skills/commits/SKILL.md')]: { status: 200, body: commits },
    [raw('.agents/skills/commits/SKILL.md')]: { status: 200, body: commits },
    // Named in its front matter like the others, in a directory of another name.
    [raw('.github/skills/commit-messages/SKILL.md')]: { status: 200, body: commits },
  };
}

async function scanGitHub(recording: Recording, token?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', 'https://github.com/JetBrains/monorepo'], {
    open: (input) => openGitHub(input, { fetch: replay(recording), token }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const MONOREPO = [
  'JetBrains/monorepo · 1 skill',
  'commits — Write commit messages.',
  `  https://github.com/JetBrains/monorepo/blob/${COMMIT}/.agents/skills/commits/SKILL.md`,
  '  also in .claude/skills/commits/SKILL.md, .github/skills/commit-messages/SKILL.md',
].join('\n');

test('GitHub, code search: skills with one name are listed once; test data and product skills are not listed', async () => {
  // Not answered in the recording: reading any of them fails the scan.
  const foreign = ['testData/.claude/skills/sample/SKILL.md', 'plugin/resources/skills/bundled/SKILL.md', 'SKILL.md'];
  const paths = ['.claude/skills/commits/SKILL.md', '.agents/skills/commits/SKILL.md', '.github/skills/commit-messages/SKILL.md'];
  const scanned = await scanGitHub(monorepo([...foreign, ...paths], []), 'test');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, MONOREPO);
  assert.equal(scanned.stderr, '');
});

test('GitHub, the tree: a symbolic link to a skill is not listed again', async () => {
  const blob = (path: string) => ({ path, mode: '100644', type: 'blob', sha: path });
  const scanned = await scanGitHub(
    monorepo(
      [],
      [
        blob('.claude/skills/commits/SKILL.md'),
        blob('.agents/skills/commits/SKILL.md'),
        blob('.github/skills/commit-messages/SKILL.md'),
        { path: '.junie/skills/commits', mode: '120000', type: 'blob', sha: 'link' },
        { path: '.github/skills/commits/SKILL.md', mode: '120000', type: 'blob', sha: 'link' },
        blob('testData/project/.agents/skills/sample/SKILL.md'),
        blob('src/main/resources/.claude/skills/bundled/SKILL.md'),
      ],
    ),
  );
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, MONOREPO);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  // Node before 24 warns on stderr that type stripping is experimental: that line is Node's, not the CLI's.
  const missing = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'scan', join(FIXTURE, 'no-such-directory')], {
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

/** The `./fixture` scan with `--name-filter <glob>`: the header, then the names it lists. */
async function filtered(...args: string[]) {
  const scanned = await atlas(['scan', FIXTURE, ...args]);
  assert.equal(scanned.code, 0, scanned.stderr);
  return scanned.stdout.split('\n').filter((line) => !line.startsWith(' ')).map((line) => line.split(' — ')[0]);
}

test('--name-filter: only the skills whose whole name matches the glob, counted in the header', async () => {
  assert.deepEqual(await filtered('--name-filter', 'c*'), ['fixture · 2 skills', 'code-style', 'commits']);
  assert.deepEqual(await filtered('--name-filter=*-build'), ['fixture · 1 skill', 'web-build']);
  assert.deepEqual(await filtered('--name-filter', '?ommits'), ['fixture · 1 skill', 'commits']);
  assert.deepEqual(await filtered('--name-filter', '[rw]*'), ['fixture · 2 skills', 'release-checklist', 'web-build']);
  assert.deepEqual(await filtered('--name-filter', '[!c]*'), ['fixture · 2 skills', 'release-checklist', 'web-build']);
  assert.deepEqual(await filtered('--name-filter', '[^a-d]*'), ['fixture · 2 skills', 'release-checklist', 'web-build']);
  assert.deepEqual(await filtered('--name-filter', '*'), await filtered());
  // The whole name, case-sensitively; `\` makes `*` literal.
  assert.deepEqual(await filtered('--name-filter', 'build'), ['fixture · 0 skills']);
  assert.deepEqual(await filtered('--name-filter', 'C*'), ['fixture · 0 skills']);
  assert.deepEqual(await filtered('--name-filter', 'web\\*'), ['fixture · 0 skills']);
});

test('--name-filter: before or after the repository; a matched skill keeps its copies and warnings still go to stderr', async () => {
  const after = await atlas(['scan', FIXTURE, '--name-filter', 'commits']);
  const before = await atlas(['scan', '--name-filter', 'commits', FIXTURE]);
  assert.deepEqual(before, after);
  assert.equal(after.code, 0);
  assert.equal(
    after.stdout,
    [
      'fixture · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  ${pathToFileURL(FIXTURE).href}/.claude/skills/commits/SKILL.md`,
      '  also in .junie/skills/commits/SKILL.md',
    ].join('\n'),
  );
  assert.equal(after.stderr, fixture.stderr);
});

test('--name-filter on GitHub: the same filter, a pinned link', async () => {
  assert.deepEqual(await atlas(['scan', 'github.com/JetBrains/example', '--name-filter', 'com*']), example);
  const none = await atlas(['scan', 'github.com/JetBrains/example', '--name-filter', 'code-*']);
  assert.equal(none.code, 0, none.stderr);
  assert.equal(none.stdout, 'JetBrains/example · 0 skills');
});

test('--name-filter without a pattern, twice, an unknown option or an invalid glob → a clear message, exit code 1', async () => {
  const cases: [string[], RegExp][] = [
    [['--name-filter'], /^--name-filter needs a glob pattern\nUsage: skill-atlas scan /],
    [['--name-filter', 'a*', '--name-filter=b*'], /^--name-filter is given twice\nUsage: skill-atlas scan /],
    [['--name', 'a*'], /^Unknown option: --name\nUsage: skill-atlas scan /],
    [['--name-filter', '[z-a]'], /^Not a valid glob pattern: \[z-a\]$/],
  ];
  for (const [args, message] of cases) {
    const failed = await atlas(['scan', FIXTURE, ...args]);
    assert.equal(failed.code, 1, args.join(' '));
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, message);
  }
});

test('the CLI takes the --name-filter glob as it is given', () => {
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE, '--name-filter', 'web-*'], { encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.match(scanned.stdout, /^fixture · 1 skill\nweb-build — /);
});

/** `skill-atlas scan <input>`, a repository or an organization, with GitHub answering from the recording. */
async function scanRecorded(input: string, recording: Recording, token?: string, ...options: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const github = { fetch: replay(recording), token };
  const code = await run(['scan', input, ...options], {
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, github) : openGitHubOrganization(input, github)),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const ORG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const API = 'https://api.github.com';
const raw = (id: string, path: string) => `https://raw.githubusercontent.com/${id}/${ORG_COMMIT}/${path}`;
const skillFile = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n`;
const blob = (path: string) => ({ path, mode: '100644', type: 'blob', sha: path });

/** The repository and its default branch's commit, as GitHub answers them. */
function repository(id: string): Recording {
  return {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: ORG_COMMIT } },
  };
}

/** The tree at the commit: what the scan lists without a token. */
function tree(id: string, paths: string[]): Recording {
  return { [`${API}/repos/${id}/git/trees/${ORG_COMMIT}?recursive=1`]: { status: 200, body: { truncated: false, tree: paths.map(blob) } } };
}

/**
 * The Acme organization: zeta and alpha have skills (alpha's in two agents' folders), docs has
 * none, tooling has only test data's, and empty has no commits yet.
 */
const ACME: Recording = {
  [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } },
  ...repository('Acme/zeta'),
  ...repository('Acme/alpha'),
  [raw('Acme/zeta', '.claude/skills/deploy/SKILL.md')]: { status: 200, body: skillFile('deploy', 'Deploy the service. Use before a release.') },
  [raw('Acme/alpha', '.claude/skills/commits/SKILL.md')]: { status: 200, body: skillFile('commits', 'Write commit messages. Use for every commit.') },
  [raw('Acme/alpha', '.junie/skills/commits/SKILL.md')]: { status: 200, body: skillFile('commits', 'Write commit messages. Use for every commit.') },
  [raw('Acme/alpha', '.agents/skills/review/SKILL.md')]: { status: 200, body: '---\nname: [review\n---\n' },
};

const ACME_OUTPUT = [
  'Acme · 3 skills in 2 repositories',
  '',
  'Acme/alpha · 2 skills',
  'commits — Write commit messages.',
  `  https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.claude/skills/commits/SKILL.md`,
  '  also in .junie/skills/commits/SKILL.md',
  'review',
  `  https://github.com/Acme/alpha/blob/${ORG_COMMIT}/.agents/skills/review/SKILL.md`,
  '',
  'Acme/zeta · 1 skill',
  'deploy — Deploy the service.',
  `  https://github.com/Acme/zeta/blob/${ORG_COMMIT}/.claude/skills/deploy/SKILL.md`,
].join('\n');

const MALFORMED_REVIEW =
  'warning: Acme/alpha: .agents/skills/review/SKILL.md: malformed front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 14; using the directory name';

test('an organization URL is not a repository URL', () => {
  for (const input of ['https://github.com/JetBrains', 'github.com/JetBrains/', 'http://www.github.com/JetBrains']) {
    assert.deepEqual(parseGitHubOrganizationUrl(input), { owner: 'JetBrains' }, input);
    assert.equal(parseGitHubUrl(input), undefined, input);
  }
  assert.equal(parseGitHubOrganizationUrl('https://github.com/JetBrains/kotlin'), undefined);
  assert.equal(parseGitHubOrganizationUrl('./fixture'), undefined);
});

test('organization, the tree: skills grouped by repository, sorted by its name; repositories without skills are not listed', async () => {
  const recording: Recording = {
    ...ACME,
    [`${API}/orgs/Acme/repos?per_page=100&page=1`]: {
      status: 200,
      body: ['zeta', 'docs', 'empty', 'tooling', 'alpha'].map((name) => ({ full_name: `Acme/${name}` })),
    },
    ...tree('Acme/zeta', ['README.md', '.claude/skills/deploy/SKILL.md']),
    ...tree('Acme/alpha', ['.claude/skills/commits/SKILL.md', '.junie/skills/commits/SKILL.md', '.agents/skills/review/SKILL.md']),
    ...repository('Acme/docs'),
    ...tree('Acme/docs', ['README.md', 'docs/SKILL.md']),
    ...repository('Acme/tooling'),
    ...tree('Acme/tooling', ['testData/.claude/skills/sample/SKILL.md']),
    // What GitHub answers for a repository without commits.
    [`${API}/repos/Acme/empty`]: { status: 200, body: { full_name: 'Acme/empty', default_branch: 'main' } },
    [`${API}/repos/Acme/empty/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  };
  const scanned = await scanRecorded('https://github.com/acme', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, ACME_OUTPUT);
  // Warnings name their repository, in the organization's order; an unscannable repository is skipped.
  assert.equal(
    scanned.stderr,
    [`warning: Acme/empty: skipped: GitHub answered 409 for ${API}/repos/Acme/empty/commits/main: Git Repository is empty.`, MALFORMED_REVIEW].join('\n'),
  );
});

test('organization, the tree: every page of its repositories is scanned', async () => {
  const names = Array.from({ length: 101 }, (_, index) => `Acme/r${String(index).padStart(3, '0')}`);
  const recording: Recording = {
    [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } },
    [`${API}/orgs/Acme/repos?per_page=100&page=1`]: { status: 200, body: names.slice(0, 100).map((full_name) => ({ full_name })) },
    [`${API}/orgs/Acme/repos?per_page=100&page=2`]: { status: 200, body: names.slice(100).map((full_name) => ({ full_name })) },
  };
  for (const name of names) Object.assign(recording, repository(name), tree(name, ['README.md']));
  Object.assign(recording, tree('Acme/r100', ['.claude/skills/deploy/SKILL.md']), {
    [raw('Acme/r100', '.claude/skills/deploy/SKILL.md')]: { status: 200, body: skillFile('deploy', 'Deploy the service.') },
  });
  const scanned = await scanRecorded('github.com/acme', recording);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'Acme · 1 skill in 1 repository',
      '',
      'Acme/r100 · 1 skill',
      'deploy — Deploy the service.',
      `  https://github.com/Acme/r100/blob/${ORG_COMMIT}/.claude/skills/deploy/SKILL.md`,
    ].join('\n'),
  );
});

test('organization, code search: one search finds the repositories with skills, only they are opened', async () => {
  const item = (repository: string, path: string) => ({ path, repository: { full_name: `Acme/${repository}` } });
  const items = [
    item('zeta', '.claude/skills/deploy/SKILL.md'),
    item('alpha', '.claude/skills/commits/SKILL.md'),
    item('alpha', '.junie/skills/commits/SKILL.md'),
    item('alpha', '.agents/skills/review/SKILL.md'),
    // Not answered in the recording: opening either repository fails the test.
    item('tooling', 'testData/.claude/skills/sample/SKILL.md'),
    item('docs', 'docs/SKILL.md'),
  ];
  const recording: Recording = {
    ...ACME,
    [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: { status: 200, body: { total_count: items.length, items } },
  };
  const scanned = await scanRecorded('https://github.com/acme', recording, 'test');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, ACME_OUTPUT);
  assert.equal(scanned.stderr, MALFORMED_REVIEW);
});

test('organization with --name-filter: only the matching skills; a repository without one is not listed', async () => {
  const item = (repository: string, path: string) => ({ path, repository: { full_name: `Acme/${repository}` } });
  const items = [
    item('zeta', '.claude/skills/deploy/SKILL.md'),
    item('alpha', '.claude/skills/commits/SKILL.md'),
    item('alpha', '.junie/skills/commits/SKILL.md'),
    item('alpha', '.agents/skills/review/SKILL.md'),
  ];
  const recording: Recording = {
    ...ACME,
    [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: { status: 200, body: { total_count: items.length, items } },
  };
  const scanned = await scanRecorded('https://github.com/acme', recording, 'test', '--name-filter', 'd*');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(
    scanned.stdout,
    [
      'Acme · 1 skill in 1 repository',
      '',
      'Acme/zeta · 1 skill',
      'deploy — Deploy the service.',
      `  https://github.com/Acme/zeta/blob/${ORG_COMMIT}/.claude/skills/deploy/SKILL.md`,
    ].join('\n'),
  );
  // Warnings are printed as without the filter.
  assert.equal(scanned.stderr, MALFORMED_REVIEW);
  const none = await scanRecorded('https://github.com/acme', recording, 'test', '--name-filter', 'x*');
  assert.equal(none.stdout, 'Acme · 0 skills');
});

test('organization, code search: more than 1000 SKILL.md files → a warning that some are left out', async () => {
  const recording: Recording = { [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } } };
  for (let page = 1; page <= 10; page++) {
    const items = Array.from({ length: 100 }, (_, index) => ({
      path: `testData/.claude/skills/s${page}-${index}/SKILL.md`,
      repository: { full_name: 'Acme/tooling' },
    }));
    recording[`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=${page}`] = { status: 200, body: { total_count: 1500, items } };
  }
  const scanned = await scanRecorded('github.com/acme', recording, 'test');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, 'Acme · 0 skills');
  assert.equal(scanned.stderr, 'warning: code search found 1500 SKILL.md files, but returns only the first 1000');
});

test('organization without skills → the organization, 0 skills', async () => {
  const recording: Recording = {
    [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } },
    [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: { status: 200, body: { total_count: 0, items: [] } },
  };
  const scanned = await scanRecorded('github.com/acme', recording, 'test');
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.equal(scanned.stdout, 'Acme · 0 skills');
});

test('unreachable organization → a clear message, exit code 1', async () => {
  const notFound = await scanRecorded('https://github.com/no-such-organization', {
    [`${API}/orgs/no-such-organization`]: { status: 404, body: { message: 'Not Found' } },
  });
  assert.equal(notFound.code, 1);
  assert.equal(notFound.stdout, '');
  assert.equal(notFound.stderr, 'Organization not found: https://github.com/no-such-organization');
});

test('organization: a rate limit stops the scan with a message that asks for GITHUB_TOKEN', async () => {
  const limited = await scanRecorded('github.com/acme', {
    [`${API}/orgs/acme`]: { status: 200, body: { login: 'Acme' } },
    [`${API}/orgs/Acme/repos?per_page=100&page=1`]: { status: 200, body: [{ full_name: 'Acme/zeta' }, { full_name: 'Acme/alpha' }] },
    ...repository('Acme/zeta'),
    ...tree('Acme/zeta', []),
    [`${API}/repos/Acme/alpha`]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  });
  assert.equal(limited.code, 1);
  assert.equal(limited.stdout, '');
  assert.equal(limited.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});
