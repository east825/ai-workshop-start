import { AtlasError, RateLimitError } from './errors.ts';
import { findSkills, SKILL_ROOTS } from './find.ts';
import type { Organization, Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/** `https://github.com/owner`: an organization, with or without the scheme or a trailing slash. */
export function parseGitHubOrganizationUrl(input: string): { owner: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/?$/i.exec(input.trim());
  return match ? { owner: match[1] } : undefined;
}

/** Resolves the default branch to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  return openRepository(github, `${name.owner}/${name.repo}`, (id, sha, warnings) =>
    options.token ? searchPaths(github, `repo:${id}`) : treePaths(github, id, sha, warnings),
  );
}

/**
 * The organization's repositories that may have skills. With a token, one code search over the
 * whole organization finds them, and only those are opened; without it, every repository is,
 * through its tree. Forks are left out either way: code search does not index them.
 */
export async function openGitHubOrganization(input: string, options: GitHubOptions): Promise<Organization> {
  const name = parseGitHubOrganizationUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const notFound = `Organization not found: https://github.com/${name.owner}`;
  const warnings: string[] = [];
  const repository = (id: string, paths?: string[]) => ({
    id,
    open: () => openRepository(github, id, (id, sha, warnings) => (paths ? Promise.resolve(paths) : treePaths(github, id, sha, warnings))),
  });
  // The organization itself first: one without skills is told apart from one that does not exist.
  const { login } = await github.json<{ login: string }>(`${API}/orgs/${encodeURIComponent(name.owner)}`, notFound);
  if (options.token) {
    const byRepository = new Map<string, string[]>();
    for (const { path, repository } of await search(github, `org:${login}`, warnings)) {
      byRepository.set(repository.full_name, [...(byRepository.get(repository.full_name) ?? []), path]);
    }
    // Only the repositories with a SKILL.md of their own: the others would not be listed anyway.
    const own = [...byRepository].filter(([, paths]) => findSkills(paths).length > 0);
    return { id: login, repositories: own.map(([id, paths]) => repository(id, paths)), warnings };
  }
  const repositories: string[] = [];
  for (let page = 1; ; page++) {
    const answer = await github.json<{ full_name: string; fork: boolean }[]>(`${API}/orgs/${login}/repos?per_page=100&page=${page}`);
    // Like code search, which never finds a fork: the same result with a token or without one.
    repositories.push(...answer.filter((repository) => !repository.fork).map((repository) => repository.full_name));
    if (answer.length < 100) break;
  }
  return { id: login, repositories: repositories.map((id) => repository(id)), warnings };
}

type ListPaths = (id: string, sha: string, warnings: string[]) => Promise<string[]>;

/** The repository at its default branch's commit; `list` finds the files that may be skills. */
async function openRepository(github: Client, fullName: string, list: ListPaths): Promise<Source> {
  const info = await github.json<{ full_name: string; default_branch: string }>(
    `${API}/repos/${fullName}`,
    `Repository not found: https://github.com/${fullName}`,
  );
  const id = info.full_name;
  const { sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`);
  const warnings: string[] = [];
  const paths = await list(id, sha, warnings);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Code search looks at the whole default branch, 100 results a page. */
async function searchPaths(github: Client, scope: string): Promise<string[]> {
  return [...new Set((await search(github, scope, [])).map((item) => item.path))];
}

type SearchItem = { path: string; repository: { full_name: string } };

/** Every SKILL.md that code search finds in `repo:<id>` or `org:<name>`. */
async function search(github: Client, scope: string, warnings: string[]): Promise<SearchItem[]> {
  const items = new Map<string, SearchItem>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: SearchItem[] }>(
      `${API}/search/code?q=filename:SKILL.md+${scope}&per_page=100&page=${page}`,
    );
    for (const item of result.items) items.set(`${item.repository?.full_name}:${item.path}`, item);
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
    if (page === 10) warnings.push(`code search found ${result.total_count} SKILL.md files, but returns only the first 1000`);
  }
  return [...items.values()];
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string, warnings: string[]): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')} (GITHUB_TOKEN searches everywhere)`);
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  // The token goes with the files too: a private repository's answers 404 without it.
  const authorization: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', ...authorization };
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new RateLimitError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url, { headers: authorization });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
