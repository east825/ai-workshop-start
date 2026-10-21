// The decisions in spec/slack.md, checked on scripts/slack.ts with Slack answering from a fake below.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, type Fetch } from '../scripts/slack.ts';

const BOT = 'U0BOT';
const HUMAN = 'U0HUMAN';
const CHANNEL = 'C0PROBE0001';
const QUESTION = '1700000000.000100';

type Fake = {
  /** What conversations.replies answers after the question, look after look. */
  threads?: object[][];
  /** What conversations.history answers: the channel, which is never looked at for an answer. */
  history?: object[];
  postError?: string;
};

/** Slack with one bot and channels #air-automation-probe and, on a second page, #other. */
function slack(fake: Fake = {}) {
  const calls: { method: string; params: Record<string, string> }[] = [];
  let looks = 0;
  const fetch: Fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const method = pathname.replace('/api/', '');
    const params = init?.body ? JSON.parse(init.body) : Object.fromEntries(searchParams);
    assert.equal(init?.headers?.Authorization, 'Bearer xoxb-test');
    calls.push({ method, params });
    const answer = (body: object) => new Response(JSON.stringify({ ok: true, ...body }));
    switch (method) {
      case 'auth.test':
        return answer({ user_id: BOT });
      case 'conversations.list':
        return params.cursor === 'page2'
          ? answer({ channels: [{ id: 'C0OTHER0001', name: 'other' }], response_metadata: { next_cursor: '' } })
          : answer({ channels: [{ id: CHANNEL, name: 'air-automation-probe' }], response_metadata: { next_cursor: 'page2' } });
      case 'chat.postMessage':
        if (fake.postError) return new Response(JSON.stringify({ ok: false, error: fake.postError }));
        return answer({ channel: params.channel, ts: QUESTION });
      case 'conversations.replies': {
        const threads = fake.threads ?? [];
        const messages = threads[Math.min(looks, threads.length - 1)] ?? [];
        looks++;
        return answer({ messages: [{ ts: QUESTION, user: BOT, text: 'question' }, ...messages] });
      }
      case 'conversations.history':
        return answer({ messages: fake.history ?? [] });
    }
    throw new Error(`unexpected ${method}`);
  };
  return { fetch, calls };
}

async function slackTs(args: string[], fake: Fake = {}, token = 'xoxb-test') {
  const { fetch, calls } = slack(fake);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let time = 0;
  const sleeps: number[] = [];
  const code = await run(args, {
    fetch,
    token,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), calls, sleeps };
}

test('ask: posts the question to the channel found by name, asking for a reply in its thread, and prints the reply', async () => {
  const r = await slackTs(['ask', '#air-automation-probe', 'Which one?'], {
    threads: [[
      { ts: '1700000001.000000', user: HUMAN, text: 'The second' },
      { ts: '1700000002.000000', user: HUMAN, text: 'later' },
    ]],
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'The second');
  assert.deepEqual(r.calls.find((c) => c.method === 'chat.postMessage')?.params, {
    channel: CHANNEL,
    text: 'Which one?\n\nReply in this thread.',
  });
});

test('ask: a channel without # and on a later page of the list, or an ID, is found', async () => {
  const reply = { threads: [[{ ts: '1700000001.000000', user: HUMAN, text: 'ok' }]] };
  const byName = await slackTs(['ask', 'other', 'q'], reply);
  assert.equal(byName.calls.find((c) => c.method === 'chat.postMessage')?.params.channel, 'C0OTHER0001');
  const byId = await slackTs(['ask', CHANNEL, 'q'], reply);
  assert.equal(byId.calls.find((c) => c.method === 'chat.postMessage')?.params.channel, CHANNEL);
  assert.ok(!byId.calls.some((c) => c.method === 'conversations.list'));
});

test('ask: a message in the channel, outside the thread, is not the answer: it may answer another question', async () => {
  const r = await slackTs(['ask', 'air-automation-probe', 'q', '--timeout', '1'], {
    history: [{ ts: '1700000002.000000', user: HUMAN, text: 'B: the first one' }],
  });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.ok(!r.calls.some((c) => c.method === 'conversations.history'));
});

test('ask: the bot itself, other bots and events are not a reply; it looks again every 10 seconds', async () => {
  const noise = [
    { ts: '1700000001.000000', user: BOT, text: 'own message' },
    { ts: '1700000001.100000', bot_id: 'B0OTHER', text: 'another bot' },
    { ts: '1700000001.200000', user: HUMAN, subtype: 'channel_join', text: 'joined' },
  ];
  const r = await slackTs(['ask', 'air-automation-probe', 'q'], {
    threads: [noise, noise, [...noise, { ts: '1700000005.000000', user: HUMAN, text: 'answer' }]],
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'answer');
  assert.deepEqual(r.sleeps, [10_000, 10_000]);
});

test('ask: a reply also sent to the channel, or with a file, is an answer; the file is printed as a link', async () => {
  const broadcast = await slackTs(['ask', 'air-automation-probe', 'q'], {
    threads: [[{ ts: '1700000001.000000', user: HUMAN, subtype: 'thread_broadcast', text: 'The second' }]],
  });
  assert.equal(broadcast.code, 0);
  assert.equal(broadcast.stdout, 'The second');
  const file = { name: 'mockup.png', permalink: 'https://example.slack.com/files/U0HUMAN/F0001/mockup.png' };
  const withFile = await slackTs(['ask', 'air-automation-probe', 'q'], {
    threads: [[{ ts: '1700000001.000000', user: HUMAN, subtype: 'file_share', text: 'Like this', files: [file] }]],
  });
  assert.equal(withFile.code, 0);
  assert.equal(withFile.stdout, `Like this\nFile: mockup.png ${file.permalink}`);
  const onlyFile = await slackTs(['ask', 'air-automation-probe', 'q'], {
    threads: [[{ ts: '1700000001.000000', user: HUMAN, text: '', files: [file] }]],
  });
  assert.equal(onlyFile.code, 0);
  assert.equal(onlyFile.stdout, `File: mockup.png ${file.permalink}`);
});

test('ask: no reply within --timeout → exit code 2; 60 minutes by default', async () => {
  const short = await slackTs(['ask', 'air-automation-probe', 'q', '--timeout', '1']);
  assert.equal(short.code, 2);
  assert.match(short.stderr, /No reply in air-automation-probe within 1 minutes/);
  assert.match(short.stderr, new RegExp(`To wait longer: node scripts/slack.ts wait ${CHANNEL} ${QUESTION} --timeout 1$`));
  assert.equal(short.sleeps.reduce((a, b) => a + b, 0), 60_000);
  const long = await slackTs(['ask', 'air-automation-probe', 'q']);
  assert.equal(long.code, 2);
  assert.equal(long.sleeps.reduce((a, b) => a + b, 0), 60 * 60_000);
});

test('wait: waits for a reply to a question posted before, without posting; on none, the same command again', async () => {
  const answered = await slackTs(['wait', '#air-automation-probe', QUESTION, '--timeout', '9'], {
    threads: [[], [{ ts: '1700000001.000000', user: HUMAN, text: 'The second' }]],
  });
  assert.equal(answered.code, 0);
  assert.equal(answered.stdout, 'The second');
  assert.ok(!answered.calls.some((c) => c.method === 'chat.postMessage'));
  assert.deepEqual(answered.calls.find((c) => c.method === 'conversations.replies')?.params, { channel: CHANNEL, ts: QUESTION });
  const none = await slackTs(['wait', CHANNEL, QUESTION, '--timeout', '9']);
  assert.equal(none.code, 2);
  assert.equal(none.sleeps.reduce((a, b) => a + b, 0), 9 * 60_000);
  assert.ok(none.stderr.endsWith(`To wait longer: node scripts/slack.ts wait ${CHANNEL} ${QUESTION} --timeout 9`));
  assert.ok(!none.calls.some((c) => c.method === 'conversations.list'));
});

test('post: posts only and prints the timestamp', async () => {
  const r = await slackTs(['post', 'air-automation-probe', 'ping']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, QUESTION);
  assert.equal(r.calls.find((c) => c.method === 'chat.postMessage')?.params.text, 'ping');
  assert.ok(!r.calls.some((c) => c.method === 'conversations.replies'));
});

test('an unknown channel or a Slack error → a clear message, exit code 1', async () => {
  const unknown = await slackTs(['ask', 'nowhere', 'q']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /No channel #nowhere/);
  const refused = await slackTs(['post', 'air-automation-probe', 'q'], { postError: 'not_in_channel' });
  assert.equal(refused.code, 1);
  assert.equal(refused.stderr, 'Slack chat.postMessage: not_in_channel');
});

test('no token, missing arguments, an unknown command or a bad --timeout → the usage, exit code 1', async () => {
  assert.equal((await slackTs(['ask', 'c', 'q'], {}, '')).stderr, 'Set SLACK_BOT_TOKEN.');
  for (const args of [[], ['ask', 'c'], ['send', 'c', 'q'], ['ask', 'c', 'q', 'extra'], ['ask', 'c', 'q', '--timeout', '0'], ['ask', 'c', 'q', '--timeout'], ['wait', 'c'], ['wait', 'c', 'not-a-ts']]) {
    const r = await slackTs(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, /Usage:/, args.join(' '));
    assert.equal(r.calls.length, 0);
  }
});
