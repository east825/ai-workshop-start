// Opens the web UI in a real browser, scans the `python` organization, and checks that the
// recorded skills show up. GitHub answers from tests/data/python/recording.json; the server runs
// in-process on an ephemeral port.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openGitHub, openGitHubOrganization, parseGitHubUrl, type GitHubOptions } from '../../src/core/github.ts';
import { replay, type Recording } from '../../src/core/replay.ts';
import { createWebServer, listen } from '../../src/web.ts';

const recording = JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/python/recording.json', import.meta.url)), 'utf8'),
) as Recording;

const open = (url: string, options: GitHubOptions) => (parseGitHubUrl(url) ? openGitHub(url, options) : openGitHubOrganization(url, options));

const server = createWebServer({
  open: (url) => open(url, { fetch: replay(recording), token: 'test' }),
});
const port = await listen(server, 0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('the web UI shows the skills recorded for the python organization', async ({ page }) => {
  await page.goto(base);
  await page.getByPlaceholder(/owner\/repo/).fill('python');
  await page.getByRole('button', { name: 'Scan' }).click();

  const results = page.locator('#results');
  // The organization header: name links to github.com/python, with a count of skills and repos.
  const header = results.locator('h2');
  await expect(header).toContainText('python');
  await expect(header).toContainText('2 skills in 2 repositories');
  await expect(header.locator('a')).toHaveAttribute('href', 'https://github.com/python');

  // One section per repository, each with its skills.
  const sections = results.locator('section.repository');
  await expect(sections).toHaveCount(2);
  await expect(results.locator('section.repository h3')).toContainText(['python/cpython', 'python/mypy']);

  const names = results.locator('section.repository a.name');
  await expect(names).toHaveText(['release', 'types']);
  await expect(results.getByText('Cut a CPython release.')).toBeVisible();
  await expect(results.getByText('Check type annotations across the repository.')).toBeVisible();

  await expect(page).toHaveScreenshot('python-organization.png', { fullPage: true });
});

test('the filter narrows the python organization results to skills whose name starts with "rel"', async ({ page }) => {
  await page.goto(`${base}/?repo=python`);
  const results = page.locator('#results');
  // Wait for the scan to resolve before touching the filter.
  await expect(results.locator('h2')).toContainText('2 skills in 2 repositories');

  await page.getByPlaceholder(/Filter by skill name prefix/).fill('rel');

  const sections = results.locator('section.repository');
  await expect(sections).toHaveCount(1);
  await expect(sections.locator('h3')).toContainText('python/cpython');
  await expect(results.locator('h2')).toContainText('1 skill in 1 repository');

  const names = results.locator('section.repository a.name');
  await expect(names).toHaveText(['release']);
  // The matched prefix is highlighted inside the skill name.
  await expect(names.locator('mark')).toHaveText('rel');

  await expect(page).toHaveScreenshot('python-organization-filtered.png', { fullPage: true });
});

// The look (spec/web.md): one palette, switched by the system's color scheme.
for (const [colorScheme, background, highlight, text, muted] of [
  ['light', 'rgb(246, 247, 251)', 'rgb(255, 224, 102)', 'rgb(31, 35, 48)', 'rgb(99, 107, 122)'],
  ['dark', 'rgb(20, 22, 28)', 'rgb(122, 92, 0)', 'rgb(230, 232, 238)', 'rgb(154, 161, 176)'],
] as const) {
  test.describe(`in ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test(`the page follows the ${colorScheme} palette, its highlight and groups included`, async ({ page }) => {
      await page.goto(`${base}/?repo=python`);
      const results = page.locator('#results');
      await expect(results.locator('h2')).toContainText('2 skills in 2 repositories');
      await page.getByPlaceholder(/Filter by skill name prefix/).fill('rel');

      await expect(page.locator('body')).toHaveCSS('background-color', background);
      await expect(results.locator('a.name mark')).toHaveCSS('background-color', highlight);
      await expect(page.locator('#filter-mirror span')).toHaveCSS('background-color', highlight);
      // In a link too, the highlighted text is the page's text color, readable over the highlight.
      await expect(results.locator('a.name mark')).toHaveCSS('color', text);

      await page.getByLabel('Group by shared words in names').check();
      await expect(results.locator('.group').first()).toHaveCSS('color', muted);
    });
  });
}
