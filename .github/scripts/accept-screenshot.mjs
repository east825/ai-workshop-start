#!/usr/bin/env node
// Called from the accept-screenshot workflow after a reviewer comments `/accept-screenshot <name>`
// (or `/accept-screenshot all`) on a PR. Copies the `<name>-actual.png` published by the latest
// failing CI run (from the `screenshot-diffs` branch) into tests/playwright/__screenshots__/<name>
// on the PR's head branch, and commits the result.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const token = must('GITHUB_TOKEN');
const repo = must('GITHUB_REPOSITORY');
const prNumber = must('PR_NUMBER');
const requested = must('REQUESTED').trim(); // "<name>.png" or "all"
const prBranch = must('PR_BRANCH');
const baselineDir = 'tests/playwright/__screenshots__';
const diffsBranch = 'screenshot-diffs';
const prefix = `pr-${prNumber}`;

function must(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing env var: ${name}`);
  return value;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString().trim();
}

// Fetch the latest run folder for this PR from the diffs branch.
const diffsDir = mkdtempSync(join(tmpdir(), 'diffs-'));
const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
try {
  sh(`git clone --depth=1 --branch ${diffsBranch} ${remote} ${diffsDir}`, { stdio: 'inherit' });
} catch {
  fail(`The \`${diffsBranch}\` branch does not exist yet. No screenshots have been published for review.`);
}

const prDir = join(diffsDir, prefix);
if (!existsSync(prDir)) fail(`No screenshot diffs have been published for PR #${prNumber}.`);
const runs = readdirSync(prDir).filter((name) => name.startsWith('run-')).sort(); // GITHUB_RUN_ID is monotonic
if (runs.length === 0) fail(`No run folders found under \`${prefix}/\`.`);
const latest = join(prDir, runs[runs.length - 1]);

// Figure out which actuals to copy.
const actuals = readdirSync(latest).filter((name) => name.endsWith('-actual.png'));
let picks;
if (requested === 'all') {
  picks = actuals;
} else {
  const base = requested.replace(/\.png$/, '');
  const match = `${base}-actual.png`;
  if (!actuals.includes(match)) fail(`No screenshot named \`${requested}\` in the latest published diffs. Available: ${actuals.map((n) => '`' + n.replace(/-actual\.png$/, '.png') + '`').join(', ') || '(none)'}.`);
  picks = [match];
}

// Clone the PR head branch and overwrite the baselines.
const prDirClone = mkdtempSync(join(tmpdir(), 'pr-'));
sh(`git clone --depth=1 --branch ${JSON.stringify(prBranch)} ${remote} ${prDirClone}`, { stdio: 'inherit' });
mkdirSync(join(prDirClone, baselineDir), { recursive: true });

const accepted = [];
for (const file of picks) {
  const name = file.replace(/-actual\.png$/, '.png');
  copyFileSync(join(latest, file), join(prDirClone, baselineDir, name));
  accepted.push(name);
}

sh(`git -C ${prDirClone} config user.name 'github-actions[bot]'`);
sh(`git -C ${prDirClone} config user.email '41898282+github-actions[bot]@users.noreply.github.com'`);
sh(`git -C ${prDirClone} add ${baselineDir}`, { stdio: 'inherit' });

const status = sh(`git -C ${prDirClone} status --porcelain`);
if (!status) {
  console.log('No changes to commit; baselines already match.');
  emit(`changed=false`);
  emit(`accepted=${accepted.join(', ')}`);
  process.exit(0);
}

const commitMessage = requested === 'all'
  ? `Accept new screenshot baselines (${accepted.length})`
  : `Accept new screenshot baseline: ${accepted[0]}`;
sh(`git -C ${prDirClone} commit -m ${JSON.stringify(commitMessage)}`, { stdio: 'inherit' });
sh(`git -C ${prDirClone} push origin HEAD:${JSON.stringify(prBranch)}`, { stdio: 'inherit' });

// Emit outputs for the workflow step to pick up.
emit(`changed=true`);
emit(`accepted=${accepted.join(', ')}`);

function emit(line) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `${line}\n`);
}

function fail(message) {
  emit(`error=${message.replace(/\n/g, ' ')}`);
  console.error(message);
  process.exit(1);
}
