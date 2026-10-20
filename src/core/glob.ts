import { AtlasError } from './errors.ts';

/**
 * A Unix glob, the way fnmatch reads it: `*` is any text, `?` any one character, `[abc]`, `[a-z]`
 * one of them and `[!abc]` (or `[^abc]`) none of them; `\` makes the next character literal. The
 * whole name must match, case-sensitively. An unclosed `[` is a literal `[`.
 */
export function globMatcher(pattern: string): (name: string) => boolean {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*') source += '.*';
    else if (char === '?') source += '.';
    else if (char === '\\' && index + 1 < pattern.length) source += literal(pattern[++index]);
    else if (char === '[' && bracketEnd(pattern, index) > 0) {
      const end = bracketEnd(pattern, index);
      source += bracket(pattern.slice(index + 1, end));
      index = end;
    } else source += literal(char);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(`^${source}$`, 'su');
  } catch {
    throw new AtlasError(`Not a valid glob pattern: ${pattern}`); // a range such as [z-a]
  }
  return (name) => regex.test(name);
}

/** Where the bracket expression opened at `start` closes; a `]` right after `[` or `[!` is a member. */
function bracketEnd(pattern: string, start: number): number {
  let index = start + 1;
  if (pattern[index] === '!' || pattern[index] === '^') index++;
  if (pattern[index] === ']') index++;
  return pattern.indexOf(']', index);
}

/** `[…]` as a regular expression class; a `-` between two members is a range, anything else is literal. */
function bracket(body: string): string {
  const negated = body[0] === '!' || body[0] === '^';
  const members = [...(negated ? body.slice(1) : body)];
  const items = members.map((char, index) =>
    char === '-' && index > 0 && index < members.length - 1 ? '-' : char.replace(/[\\\]\[^-]/, '\\$&'),
  );
  return `[${negated ? '^' : ''}${items.join('')}]`;
}

function literal(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\/]/, '\\$&');
}
