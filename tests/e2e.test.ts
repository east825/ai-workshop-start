// End to end on real repositories: `skill-atlas scan` must print what it printed when
// tests/record.ts scanned them, from the GitHub answers recorded then. Offline, without a token, as
// on CI. To update after a change in the scan or in a repository: `npm run record`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { DATA } from './helpers.ts';

const REPOSITORIES = [
  // Skills copied between .agents/skills and .claude/skills: each listed once, `also in`. A tree
  // too large to list at once: only the skill roots, with a warning.
  { name: 'MPS', skills: 42 },
  // A tree too large to list at once, with a warning; no skills in the skill roots.
  { name: 'android', skills: 0 },
  // A tree listed at once; the skills in .claude/skills.
  { name: 'koog', skills: 2 },
];

for (const { name, skills } of REPOSITORIES) {
  test(`JetBrains/${name}: the scan prints what was recorded`, async () => {
    const data = (file: string) => readFileSync(join(DATA, name, file), 'utf8');
    const recording = JSON.parse(data('recording.json')) as Recording;
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(['scan', `https://github.com/JetBrains/${name}`], {
      open: (input) => openGitHub(input, { fetch: replay(recording) }),
      print: (text) => stdout.push(text),
      error: (text) => stderr.push(text),
    });
    assert.equal(code, 0, stderr.join('\n'));
    assert.equal(`${stdout.join('\n')}\n`, data('stdout.txt'));
    assert.equal(stderr.length ? `${stderr.join('\n')}\n` : '', data('stderr.txt'));
    assert.equal(stdout[0], `JetBrains/${name} · ${skills} ${skills === 1 ? 'skill' : 'skills'}`);
  });
}
