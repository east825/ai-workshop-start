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
import { openGitHub } from '../src/core/github.ts';
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
