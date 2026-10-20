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

  // One section per repository, each with its skills, under its short name: the h2 has the organization.
  const sections = results.locator('section.repository');
  await expect(sections).toHaveCount(2);
  await expect(results.locator('section.repository h3')).toHaveText(['cpython · 1 skill', 'mypy · 1 skill']);

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
  await expect(sections.locator('h3')).toHaveText('cpython · 1 skill');
  await expect(results.locator('h2')).toContainText('1 skill in 1 repository');

  const names = results.locator('section.repository a.name');
  await expect(names).toHaveText(['release']);
  // The matched prefix is highlighted inside the skill name.
  await expect(names.locator('mark')).toHaveText('rel');

  await expect(page).toHaveScreenshot('python-organization-filtered.png', { fullPage: true });
});
