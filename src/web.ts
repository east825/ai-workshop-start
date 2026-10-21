// The web view: a page to paste a GitHub repository or organization into, and the scan behind it
// as JSON. The same core as the CLI, GitHub only: a page must not read the server's own directories.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink } from './core/model.ts';
import { scan, scanOrganization, type Organization, type ScanResult, type Source } from './core/scan.ts';

export type WebOptions = {
  /**
   * Opens a GitHub repository by its URL, `https://github.com/<owner>/<repo>`, or an organization
   * of them by its own, `https://github.com/<organization>`.
   */
  open(url: string): Promise<Source | Organization>;
  /**
   * Answers whatever `Host` it is asked by. Off by default: on localhost, another name is a page
   * that pointed its own hostname at this server (DNS rebinding) to scan with the user's token.
   * Only for a server put on the network on purpose, `--host`.
   */
  anyHost?: boolean;
};

type WebRepository = {
  repository: { id: string; url: string; commit: string };
  skills: { name: string; description: string; link: string; copies: string[] }[];
};

/** What `/api/scan` answers for a repository: the CLI's output, as data. */
export type WebScan = WebRepository & { warnings: string[] };

/**
 * What `/api/scan` answers for an organization: its repositories with skills, sorted by name, each
 * as for one repository; the warnings start with their repository.
 */
export type WebOrganizationScan = {
  organization: { id: string; url: string };
  repositories: WebRepository[];
  warnings: string[];
};

const NAME = '[\\w.-]+';
// Owners have no dots: `github.com/owner` is not the repository `owner` of `github.com`.
const SHORT = new RegExp(`^([\\w-]+)/(${NAME}?)(?:\\.git)?$`);
const FULL = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME}?)(?:\\.git)?(?:[/?#].*)?$`, 'i');
const OWNER = '[\\w-]+';
const ORGANIZATION_SHORT = new RegExp(`^(${OWNER})$`);
const ORGANIZATION_FULL = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${OWNER})/?(?:[?#].*)?$`, 'i');
// `github.com/orgs/<organization>/repositories`, and the organization's other pages: not a repository.
const ORGANIZATION_PAGE = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/orgs/(${OWNER})(?:[/?#].*)?$`, 'i');

/**
 * `owner/repo`, or a repository's URL with or without the scheme; a page of the repository, such
 * as `…/tree/main/docs`, as copied from the address bar, is its repository.
 */
export function parseRepository(input: string): { owner: string; repo: string } | undefined {
  if (ORGANIZATION_PAGE.test(input.trim())) return undefined;
  const match = FULL.exec(input.trim()) ?? SHORT.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/**
 * An organization's name alone, `JetBrains`, or its URL with or without the scheme; one of its
 * pages, such as `github.com/orgs/JetBrains/repositories`, is the organization.
 */
export function parseOrganization(input: string): { owner: string } | undefined {
  const trimmed = input.trim();
  const match = ORGANIZATION_PAGE.exec(trimmed) ?? ORGANIZATION_FULL.exec(trimmed) ?? ORGANIZATION_SHORT.exec(trimmed);
  return match ? { owner: match[1] } : undefined;
}

export function createWebServer(options: WebOptions): Server {
  return createServer((request, response) => {
    handle(request, response, options).catch((error: unknown) => {
      if (!response.headersSent) send(response, 500, 'application/json', JSON.stringify({ error: 'Unexpected error' }));
      console.error(error);
    });
  });
}

/** localhost, by name or address. */
export function isLocal(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

/** Starts listening, on localhost only by default; resolves to the port, the actual one for port 0. */
export function listen(server: Server, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(new AtlasError(error.code === 'EADDRINUSE' ? `Port ${port} is already in use` : `Cannot listen on ${host}:${port}: ${error.message}`)),
    );
    server.listen(port, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, options: WebOptions) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!options.anyHost && !isLocal(hostname(request.headers.host))) {
    return send(response, 403, 'text/plain', 'Forbidden: the web view answers on localhost only');
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'text/plain', 'Method not allowed');
  if (url.pathname === '/') return send(response, 200, 'text/html; charset=utf-8', PAGE);
  if (url.pathname !== '/api/scan') return send(response, 404, 'text/plain', 'Not found');

  const input = url.searchParams.get('repo') ?? '';
  const repository = parseRepository(input);
  const organization = repository ? undefined : parseOrganization(input);
  if (!repository && !organization) {
    return json(response, 400, {
      error: `Not a GitHub repository or organization: ${input.trim() || '(empty)'}. Paste owner/repo, an organization or a github.com URL.`,
    });
  }
  try {
    const opened = await options.open(
      repository ? `https://github.com/${repository.owner}/${repository.repo}` : `https://github.com/${organization!.owner}`,
    );
    json(response, 200, 'repositories' in opened ? toWebOrganizationScan(await scanOrganization(opened)) : toWebScan(await scan(opened)));
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    json(response, 400, { error: error.message });
  }
}

/** The name in a `Host` header, without the port; empty when there is none or it is not one. */
function hostname(host: string | undefined): string {
  try {
    return host ? new URL(`http://${host}`).hostname : '';
  } catch {
    return '';
  }
}

function toWebScan(result: ScanResult): WebScan {
  return { ...toWebRepository(result), warnings: result.warnings };
}

function toWebOrganizationScan(result: Awaited<ReturnType<typeof scanOrganization>>): WebOrganizationScan {
  return {
    organization: { id: result.organization, url: `https://github.com/${result.organization}` },
    repositories: result.repositories.map(toWebRepository),
    warnings: result.warnings,
  };
}

function toWebRepository({ repository, skills }: ScanResult): WebRepository {
  return {
    repository: { id: repository.id, url: repository.url, commit: repository.commit },
    skills: skills.map((skill) => ({
      name: skill.name,
      description: firstSentence(skill.description),
      link: skillLink(repository, skill),
      copies: skill.copies,
    })),
  };
}

function json(response: ServerResponse, status: number, body: unknown) {
  send(response, status, 'application/json', JSON.stringify(body));
}

function send(response: ServerResponse, status: number, type: string, body: string) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}

/** The whole page: no build step, no dependencies. Everything from GitHub goes in as text. */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 52rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
  form { display: flex; gap: .5rem; }
  input { flex: 1; padding: .5rem; font: inherit; }
  button { padding: .5rem 1rem; font: inherit; cursor: pointer; }
  #filter-wrap { position: relative; margin-top: .75rem; }
  #filter { width: 100%; padding: .5rem; font: inherit; box-sizing: border-box; background: transparent; position: relative; }
  #filter-mirror { position: absolute; inset: 0; padding: .5rem; font: inherit; white-space: pre; overflow: hidden; pointer-events: none; color: transparent; border: 1px solid transparent; }
  #filter-mirror span { background: #ff0; }
  mark { background: #ff0; color: inherit; }
  /* A highlighter is yellow in both themes; in dark, the adaptive light text would vanish on it. */
  @media (prefers-color-scheme: dark) {
    #filter { color: #000; caret-color: CanvasText; }
    mark { color: #000; }
  }
  #group-wrap { margin-top: .5rem; font-size: .9em; color: #666; }
  #results { margin-top: 1.5rem; border-top: 1px solid #8884; padding-top: 1rem; }
  #results:empty { display: none; }
  ul { list-style: none; padding: 0; }
  li { padding: .6rem 0; border-bottom: 1px solid #8882; }
  .group { margin: 1rem 0 .25rem; font-size: .95em; color: #666; text-transform: lowercase; }
  .name { font-weight: 600; }
  .description { margin: .2rem 0 0; }
  .copies, .meta { color: #888; font-size: .9em; }
  .repository { margin-top: 1.5rem; }
  .error { color: #d33; }
  .warnings { color: #b80; font-size: .9em; }
</style>
</head>
<body>
<h1>Skill Atlas</h1>
<p>Every agent skill in a GitHub repository, or in every repository of an organization.</p>
<form id="scan">
  <input id="repo" name="repo" placeholder="owner/repo, an organization or https://github.com/owner/repo" autocomplete="off" required autofocus>
  <button type="submit">Scan</button>
</form>
<div id="filter-wrap" hidden>
  <span id="filter-mirror" aria-hidden="true"></span>
  <input id="filter" placeholder="Filter by skill name prefix" autocomplete="off">
</div>
<div id="group-wrap" hidden>
  <label><input id="group" type="checkbox"> Group by shared words in names</label>
</div>
<section id="results" aria-live="polite"></section>
<script>
const form = document.getElementById('scan');
const input = document.getElementById('repo');
const button = form.querySelector('button');
const filter = document.getElementById('filter');
const filterWrap = document.getElementById('filter-wrap');
const filterMirror = document.getElementById('filter-mirror');
const group = document.getElementById('group');
const groupWrap = document.getElementById('group-wrap');
const results = document.getElementById('results');
let lastResult = null;

function matches(skill) {
  const prefix = filter.value.trim().toLowerCase();
  return !prefix || skill.name.toLowerCase().startsWith(prefix);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

function title(tag, text, url, rest) {
  const node = element(tag);
  const link = element('a', '', text);
  link.href = url;
  node.append(link, ' · ' + rest);
  return node;
}

function skillItem(skill) {
  const item = element('li');
  const name = element('a', 'name');
  name.href = skill.link;
  name.target = '_blank';
  name.rel = 'noopener';
  const prefix = filter.value.trim();
  if (prefix && skill.name.toLowerCase().startsWith(prefix.toLowerCase())) {
    name.append(element('mark', '', skill.name.slice(0, prefix.length)), skill.name.slice(prefix.length));
  } else {
    name.textContent = skill.name;
  }
  item.append(name);
  if (skill.description) item.append(element('p', 'description', skill.description));
  if (skill.copies.length) item.append(element('div', 'copies', 'also in ' + skill.copies.join(', ')));
  return item;
}

function tokenize(name) {
  return name.toLowerCase().split(/[-_\\s]+/).filter((t) => t.length >= 3);
}

// Groups skills by the shared word (hyphen/underscore token) that most of their peers also carry;
// each skill lands in its strongest group, singletons fall into "other".
function groupSkills(skills) {
  const counts = new Map();
  for (const skill of skills) {
    for (const token of new Set(tokenize(skill.name))) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const groups = new Map();
  for (const skill of skills) {
    let best = '', bestCount = 1;
    for (const token of tokenize(skill.name)) {
      const count = counts.get(token) ?? 0;
      if (count > bestCount) { best = token; bestCount = count; }
    }
    if (!groups.has(best)) groups.set(best, []);
    groups.get(best).push(skill);
  }
  // Named groups first (by size, then name), then "other".
  const named = [...groups.entries()].filter(([k]) => k).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const other = groups.get('') ?? [];
  if (other.length) named.push(['other', other]);
  return named;
}

function skillList(skills) {
  if (!group.checked) {
    const list = element('ul');
    for (const skill of skills) list.append(skillItem(skill));
    return list;
  }
  const container = document.createDocumentFragment();
  for (const [name, members] of groupSkills(skills)) {
    container.append(element('h4', 'group', name + ' · ' + plural(members.length, 'skill', 'skills')));
    const list = element('ul');
    for (const skill of members) list.append(skillItem(skill));
    container.append(list);
  }
  return container;
}

function render(result) {
  results.replaceChildren();
  if (result.organization) {
    // As the CLI prints an organization: its repositories with skills, each as one repository.
    const repositories = result.repositories
      .map(({ repository, skills }) => ({ repository, skills: skills.filter(matches) }))
      .filter(({ skills }) => skills.length);
    const skills = repositories.reduce((count, { skills }) => count + skills.length, 0);
    const count = repositories.length
      ? plural(skills, 'skill', 'skills') + ' in ' + plural(repositories.length, 'repository', 'repositories')
      : '0 skills';
    results.append(title('h2', result.organization.id, result.organization.url, count));
    for (const { repository, skills } of repositories) {
      const section = element('section', 'repository');
      section.append(title('h3', repository.id, repository.url, plural(skills.length, 'skill', 'skills')), skillList(skills));
      results.append(section);
    }
  } else {
    const skills = result.skills.filter(matches);
    results.append(title('h2', result.repository.id, result.repository.url, plural(skills.length, 'skill', 'skills')));
    results.append(skillList(skills));
  }
  if (result.warnings.length) {
    const warnings = element('ul', 'warnings');
    for (const warning of result.warnings) warnings.append(element('li', '', 'warning: ' + warning));
    results.append(warnings);
  }
}

async function scan(repo) {
  button.disabled = true;
  results.replaceChildren(element('p', 'meta', 'Scanning ' + repo + '…'));
  try {
    const response = await fetch('api/scan?repo=' + encodeURIComponent(repo));
    const body = await response.json();
    if (response.ok) {
      lastResult = body;
      filterWrap.hidden = false;
      groupWrap.hidden = false;
      render(body);
    } else {
      lastResult = null;
      filterWrap.hidden = true;
      groupWrap.hidden = true;
      results.replaceChildren(element('p', 'error', body.error));
    }
  } catch (error) {
    lastResult = null;
    filterWrap.hidden = true;
    groupWrap.hidden = true;
    results.replaceChildren(element('p', 'error', 'Cannot reach the server: ' + error.message));
  } finally {
    button.disabled = false;
  }
}

filter.addEventListener('input', () => {
  filterMirror.replaceChildren(element('span', '', filter.value));
  filterMirror.scrollLeft = filter.scrollLeft;
  if (lastResult) render(lastResult);
});
filter.addEventListener('scroll', () => {
  filterMirror.scrollLeft = filter.scrollLeft;
});
group.addEventListener('change', () => {
  if (lastResult) render(lastResult);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const repo = input.value.trim();
  history.replaceState(null, '', '?repo=' + encodeURIComponent(repo));
  scan(repo);
});

// A link to the page with ?repo= scans at once.
const initial = new URLSearchParams(location.search).get('repo');
if (initial) {
  input.value = initial;
  scan(initial);
}
</script>
</body>
</html>
`;
