// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { globMatcher } from './core/glob.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
    --name-filter <glob>          only the skills whose name matches, e.g. 'web-*'
  help                            show this help`;

const scanUsage = 'Usage: skill-atlas scan <GitHub URL | directory> [--name-filter <glob>]';

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  const { input, nameFilter } = scanArguments(args);
  const matches = nameFilter === undefined ? () => true : globMatcher(nameFilter);
  const result = await scan(await context.open(input));
  printRepository(result.repository, result.skills.filter((skill) => matches(skill.name)), context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/** The repository, and `--name-filter <glob>` or `--name-filter=<glob>`, in any order. */
function scanArguments(args: string[]): { input: string; nameFilter?: string } {
  const inputs: string[] = [];
  let nameFilter: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    let value: string | undefined;
    if (arg === '--name-filter') {
      value = args[++index];
      if (value === undefined) throw new AtlasError(`--name-filter needs a glob pattern\n${scanUsage}`);
    } else if (arg.startsWith('--name-filter=')) value = arg.slice('--name-filter='.length);
    else if (arg.startsWith('--')) throw new AtlasError(`Unknown option: ${arg}\n${scanUsage}`);
    else {
      inputs.push(arg);
      continue;
    }
    if (nameFilter !== undefined) throw new AtlasError(`--name-filter is given twice\n${scanUsage}`);
    nameFilter = value;
  }
  if (inputs.length !== 1) throw new AtlasError(scanUsage);
  return { input: inputs[0], nameFilter };
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}
