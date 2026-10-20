// The web view: a page to paste a GitHub repository into, and the scan behind it as JSON. The
// same core as the CLI, GitHub only: a page must not read the server's own directories.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type WebOptions = {
  /** Opens a GitHub repository by its URL, `https://github.com/<owner>/<repo>`. */
  open(url: string): Promise<Source>;
  /**
   * Answers whatever `Host` it is asked by. Off by default: on localhost, another name is a page
   * that pointed its own hostname at this server (DNS rebinding) to scan with the user's token.
   * Only for a server put on the network on purpose, `--host`.
   */
  anyHost?: boolean;
};

/** What `/api/scan` answers: the CLI's output, as data. */
export type WebScan = {
  repository: { id: string; url: string; commit: string };
  skills: { name: string; description: string; link: string; copies: string[] }[];
  warnings: string[];
};

const NAME = '[\\w.-]+';
// Owners have no dots: `github.com/owner` is not the repository `owner` of `github.com`.
const SHORT = new RegExp(`^([\\w-]+)/(${NAME}?)(?:\\.git)?$`);
const FULL = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME}?)(?:\\.git)?(?:[/?#].*)?$`, 'i');

/**
 * `owner/repo`, or a repository's URL with or without the scheme; a page of the repository, such
 * as `…/tree/main/docs`, as copied from the address bar, is its repository.
 */
export function parseRepository(input: string): { owner: string; repo: string } | undefined {
  const match = FULL.exec(input.trim()) ?? SHORT.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
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
  const name = parseRepository(input);
  if (!name) {
    return json(response, 400, { error: `Not a GitHub repository: ${input.trim() || '(empty)'}. Paste owner/repo or a github.com URL.` });
  }
  try {
    json(response, 200, toWebScan(await scan(await options.open(`https://github.com/${name.owner}/${name.repo}`))));
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

function toWebScan({ repository, skills, warnings }: Awaited<ReturnType<typeof scan>>): WebScan {
  return {
    repository: { id: repository.id, url: repository.url, commit: repository.commit },
    skills: skills.map((skill) => ({
      name: skill.name,
      description: firstSentence(skill.description),
      link: skillLink(repository, skill),
      copies: skill.copies,
    })),
    warnings,
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
  #results { margin-top: 1.5rem; border-top: 1px solid #8884; padding-top: 1rem; }
  #results:empty { display: none; }
  ul { list-style: none; padding: 0; }
  li { padding: .6rem 0; border-bottom: 1px solid #8882; }
  .name { font-weight: 600; }
  .description { margin: .2rem 0 0; }
  .copies, .meta { color: #888; font-size: .9em; }
  .error { color: #d33; }
  .warnings { color: #b80; font-size: .9em; }
</style>
</head>
<body>
<h1>Skill Atlas</h1>
<p>Every agent skill in a GitHub repository.</p>
<form id="scan">
  <input id="repo" name="repo" placeholder="owner/repo or https://github.com/owner/repo" autocomplete="off" required autofocus>
  <button type="submit">Scan</button>
</form>
<section id="results" aria-live="polite"></section>
<script>
const form = document.getElementById('scan');
const input = document.getElementById('repo');
const button = form.querySelector('button');
const results = document.getElementById('results');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(result) {
  results.replaceChildren();
  const count = result.skills.length;
  const title = element('h2');
  const repository = element('a', '', result.repository.id);
  repository.href = result.repository.url;
  title.append(repository, ' · ' + count + (count === 1 ? ' skill' : ' skills'));
  results.append(title);
  const list = element('ul');
  for (const skill of result.skills) {
    const item = element('li');
    const name = element('a', 'name', skill.name);
    name.href = skill.link;
    name.target = '_blank';
    name.rel = 'noopener';
    item.append(name);
    if (skill.description) item.append(element('p', 'description', skill.description));
    if (skill.copies.length) item.append(element('div', 'copies', 'also in ' + skill.copies.join(', ')));
    list.append(item);
  }
  results.append(list);
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
    if (response.ok) render(body);
    else results.replaceChildren(element('p', 'error', body.error));
  } catch (error) {
    results.replaceChildren(element('p', 'error', 'Cannot reach the server: ' + error.message));
  } finally {
    button.disabled = false;
  }
}

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
