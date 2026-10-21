// Opens the web UI in a real browser, scans a repository whose skill names share words, and checks
// "Group by shared words in names" (spec/web.md). GitHub answers from the recording below; the
// server runs in-process on an ephemeral port.
import { expect, test } from '@playwright/test';
import { openGitHub, openGitHubOrganization, parseGitHubUrl, type GitHubOptions } from '../../src/core/github.ts';
import { replay, type Recording } from '../../src/core/replay.ts';
import { createWebServer, listen } from '../../src/web.ts';

const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const ID = 'JetBrains/grouping';
const API = 'https://api.github.com';

/**
 * mps-* share "mps" (3) and two of them "aspect" (2): all three go under "mps", their strongest word.
 * code-* share "code" (2), *-web "web" (2): of the same size, "code" comes first by word, though
 * "web" has the first skill by name. qa (too short a word) and ssr share nothing: "other".
 */
const SKILLS: [string, string][] = [
  ['build-web', 'Build the web site.'],
  ['code-review', 'Review a pull request.'],
  ['code-style', 'Format the code as the repository does.'],
  ['deploy-web', 'Deploy the web site.'],
  ['mps-aspect-editor', 'Write an MPS editor.'],
  ['mps-aspect-generator', 'Write an MPS generator.'],
  ['mps-console', 'Run queries in the MPS console.'],
  ['qa', 'Check a build by hand.'],
  ['ssr', 'Search and replace structurally.'],
];

const path = (name: string) => `.claude/skills/${name}/SKILL.md`;

const recording: Recording = {
  [`${API}/repos/${ID}`]: { status: 200, body: { full_name: ID, default_branch: 'main' } },
  [`${API}/repos/${ID}/commits/main`]: { status: 200, body: { sha: COMMIT } },
  [`${API}/search/code?q=filename:SKILL.md+repo:${ID}&per_page=100&page=1`]: {
    status: 200,
    body: { total_count: SKILLS.length, items: SKILLS.map(([name]) => ({ path: path(name) })) },
  },
  ...Object.fromEntries(
    SKILLS.map(([name, description]) => [
      `https://raw.githubusercontent.com/${ID}/${COMMIT}/${path(name)}`,
      { status: 200, body: `---\nname: ${name}\ndescription: ${description}\n---\n` },
    ]),
  ),
};

const open = (url: string, options: GitHubOptions) => (parseGitHubUrl(url) ? openGitHub(url, options) : openGitHubOrganization(url, options));

const server = createWebServer({
  open: (url) => open(url, { fetch: replay(recording), token: 'test' }),
});
const port = await listen(server, 0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ALL = SKILLS.map(([name]) => name);

test('grouping by shared words in names: each skill under its most shared word, biggest groups first, "other" last', async ({ page }) => {
  await page.goto(base);
  const toggle = page.getByLabel('Group by shared words in names');
  // Nothing to group before a scan.
  await expect(toggle).toBeHidden();

  await page.getByPlaceholder(/owner\/repo/).fill(ID);
  await page.getByRole('button', { name: 'Scan' }).click();

  const results = page.locator('#results');
  await expect(results.locator('h2')).toContainText(`${ID} · 9 skills`);
  const names = results.locator('a.name');
  const groups = results.locator('h4.group');

  // Off by default: one list, sorted by name.
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(groups).toHaveCount(0);
  await expect(names).toHaveText(ALL);

  await toggle.check();
  await expect(groups).toHaveText(['mps · 3 skills', 'code · 2 skills', 'web · 2 skills', 'other · 2 skills']);
  // Each heading is followed by its own list, sorted by name.
  const members = (heading: string) => results.locator(`h4.group:has-text("${heading}") + ul a.name`);
  await expect(members('mps ·')).toHaveText(['mps-aspect-editor', 'mps-aspect-generator', 'mps-console']);
  await expect(members('code ·')).toHaveText(['code-review', 'code-style']);
  await expect(members('web ·')).toHaveText(['build-web', 'deploy-web']);
  await expect(members('other ·')).toHaveText(['qa', 'ssr']);
  // Skills keep their links and descriptions inside groups.
  await expect(results.getByRole('link', { name: 'mps-console' })).toHaveAttribute(
    'href',
    `https://github.com/${ID}/blob/${COMMIT}/${path('mps-console')}`,
  );
  await expect(results.getByText('Run queries in the MPS console.')).toBeVisible();

  await expect(page).toHaveScreenshot('grouping.png', { fullPage: true });

  // Off again: back to the flat list.
  await toggle.uncheck();
  await expect(groups).toHaveCount(0);
  await expect(names).toHaveText(ALL);
});

test('grouping applies to the filtered skills: a word shared only with filtered-out skills makes no group', async ({ page }) => {
  await page.goto(`${base}/?repo=${encodeURIComponent(ID)}`);
  const results = page.locator('#results');
  await expect(results.locator('h2')).toContainText(`${ID} · 9 skills`);

  await page.getByLabel('Group by shared words in names').check();
  await page.getByPlaceholder(/Filter by skill name prefix/).fill('mps-aspect');

  await expect(results.locator('h2')).toContainText(`${ID} · 2 skills`);
  // Among the two left, "mps" and "aspect" are equally shared: the first word of the name wins.
  await expect(results.locator('h4.group')).toHaveText(['mps · 2 skills']);
  await expect(results.locator('a.name')).toHaveText(['mps-aspect-editor', 'mps-aspect-generator']);

  await page.getByPlaceholder(/Filter by skill name prefix/).fill('code-r');
  // A single skill shares its words with nobody: it is "other".
  await expect(results.locator('h4.group')).toHaveText(['other · 1 skill']);
  await expect(results.locator('a.name')).toHaveText(['code-review']);
});
