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

/** WCAG contrast ratio of two `rgb(r, g, b)` colors, as computed by the browser. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map((c) => {
      const s = Number(c) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('the filter highlight stays readable: the typed prefix and the matched one in names', async ({ page }) => {
      await page.goto(`${base}/?repo=python`);
      const results = page.locator('#results');
      await expect(results.locator('h2')).toContainText('2 skills in 2 repositories');

      const filter = page.getByPlaceholder(/Filter by skill name prefix/);
      // Empty, the field's color is the page's own: Firefox draws the placeholder in it.
      const empty = await filter.evaluate((e) => getComputedStyle(e).color);
      const canvas = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('div'));
        probe.style.color = 'Canvas';
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect(contrast(empty, canvas)).toBeGreaterThanOrEqual(4.5);
      await filter.fill('rel');
      const mark = results.locator('a.name mark');
      await expect(mark).toHaveText('rel');

      const style = (selector: string) =>
        page.locator(selector).evaluate((e) => ({ color: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor }));
      // The typed text is the input's own, drawn over the mirror's highlighted span.
      const typed = (await style('#filter')).color;
      const highlight = (await style('#filter-mirror span')).background;
      expect(contrast(typed, highlight)).toBeGreaterThanOrEqual(4.5);
      const marked = await style('#results a.name mark');
      expect(contrast(marked.color, marked.background)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
