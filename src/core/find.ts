/** A skill found in a repository: its SKILL.md and its directory's name. */
export type SkillFile = { path: string; name: string };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', '.junie/skills', 'agent/skills'];

/**
 * Every file named exactly SKILL.md in a skill directory under one of the SKILL_ROOTS, named
 * after its directory. The roots can be nested in a project's subdirectory, but not in its test
 * data or in what the product ships to its users: those skills are not the developers' own.
 */
export function findSkills(paths: string[]): SkillFile[] {
  return paths
    .filter(isOwnSkill)
    .sort()
    .map((path) => ({ path, name: path.split('/').at(-2)! }));
}

function isOwnSkill(path: string): boolean {
  const segments = path.split('/');
  if (segments.at(-1) !== 'SKILL.md') return false;
  const roots = SKILL_ROOTS.map((root) => root.split('/'));
  for (let start = 0; start < segments.length; start++) {
    // The root, then at least the skill's own directory, then SKILL.md.
    const root = roots.find(
      (root) => start + root.length + 2 <= segments.length && root.every((segment, index) => segments[start + index] === segment),
    );
    if (root) return !segments.slice(0, start).some(isForeignDirectory);
  }
  return false;
}

/** A directory of test data, or of resources and templates that the product ships. */
function isForeignDirectory(segment: string): boolean {
  return (
    /^(?:.*[-_.])?test(?:s|data|[-_]data|resources|[-_]resources)?$/i.test(segment) || // test, tests, testData, e2e-tests
    /[a-z0-9]Test(?:s|Data|Resources)?$/.test(segment) || // jvmTest, integrationTests
    /^(?:__)?(?:tests?|fixtures?|mocks?|snapshots?)(?:__)?$/i.test(segment) || // fixtures, __tests__
    /^(?:resources|templates?)$/i.test(segment)
  );
}
