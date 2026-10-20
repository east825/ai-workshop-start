import { AtlasError, RateLimitError } from './errors.ts';
import { findSkills, type SkillFile } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** An organization to scan: its repositories, each opened when it is scanned. */
export type Organization = {
  /** The organization's name, for example `JetBrains`. */
  id: string;
  /** The repositories that may have skills; `id` is `owner/name`. */
  repositories: { id: string; open(): Promise<Source> }[];
  /** What listing the repositories had to leave out. */
  warnings: string[];
};

/** Only the repositories with skills, sorted by name. Warnings name their repository. */
export type OrganizationResult = { organization: string; repositories: ScanResult[]; warnings: string[] };

/** A few repositories at a time: an organization can have thousands, each a few requests. */
const PARALLEL_REPOSITORIES = 8;

/**
 * Every repository of the organization, scanned as one. A repository that cannot be scanned (an
 * empty one, say) is a warning, and the scan goes on; a rate limit stops it, as every other
 * repository would hit it too.
 */
export async function scanOrganization(organization: Organization): Promise<OrganizationResult> {
  const { repositories } = organization;
  // By the repository's place in the list, so that the warnings come in its order.
  const outcomes: { result?: ScanResult; warnings: string[] }[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < repositories.length; index = next++) {
      const { id, open } = repositories[index];
      try {
        const result = await scan(await open());
        outcomes[index] = { result, warnings: result.warnings.map((warning) => `${id}: ${warning}`) };
      } catch (error) {
        if (!(error instanceof AtlasError) || error instanceof RateLimitError) throw error;
        outcomes[index] = { warnings: [`${id}: skipped: ${error.message}`] };
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_REPOSITORIES }, worker));
  const results = outcomes.flatMap((outcome) => (outcome.result ? [outcome.result] : []));
  const warnings = [...organization.warnings, ...outcomes.flatMap((outcome) => outcome.warnings)];
  const compare = (a: ScanResult, b: ScanResult) => (a.repository.id < b.repository.id ? -1 : a.repository.id > b.repository.id ? 1 : 0);
  return {
    organization: organization.id,
    repositories: results.filter((result) => result.skills.length > 0).sort(compare),
    warnings,
  };
}

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(deduplicate(results.flatMap((result) => (result.skill ? [result.skill] : [])))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warning?: string }> {
  const bytes = await source.read(file.path);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: [],
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}

/**
 * One skill per name: a skill copied or linked into another agent's folder is the same skill.
 * The first path keeps it; the others become its copies.
 */
function deduplicate(skills: Skill[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const skill of sortSkills(skills)) {
    const first = byName.get(skill.name);
    if (first) first.copies.push(skill.path);
    else byName.set(skill.name, skill);
  }
  return [...byName.values()];
}
