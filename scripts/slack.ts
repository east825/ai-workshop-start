#!/usr/bin/env node
// Asks a question in a Slack channel and waits for the answer: for an agent that needs a human
// decision before it goes on. spec/slack.md. `SLACK_BOT_TOKEN`: a bot token that is a member of the channel.
//   node scripts/slack.ts ask <channel> <text> [--timeout <minutes>]
//   node scripts/slack.ts post <channel> <text>

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Response>;

export type SlackOptions = {
  fetch: Fetch;
  token: string;
  /** Waits between two looks for a reply; a test does not wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** A message in a channel, as Slack answers it. */
type Message = { ts: string; text?: string; user?: string; bot_id?: string; subtype?: string };

const API = 'https://slack.com/api/';
/** How often to look for a reply. */
export const POLL_MS = 10_000;

export class SlackError extends Error {}

async function call(options: SlackOptions, method: string, params: Record<string, string>, post = false): Promise<any> {
  const headers = { Authorization: `Bearer ${options.token}` };
  const response = post
    ? await options.fetch(API + method, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(params),
      })
    : await options.fetch(`${API}${method}?${new URLSearchParams(params)}`, { headers });
  if (!response.ok) throw new SlackError(`Slack ${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.ok) throw new SlackError(`Slack ${method}: ${body.error}`);
  return body;
}

/** The ID of a channel by its name, `#name` or `name`; an ID such as `C0CAVD8062J` is taken as is. */
export async function findChannel(options: SlackOptions, channel: string): Promise<string> {
  const name = channel.replace(/^#/, '');
  if (/^[CGD][A-Z0-9]{8,}$/.test(name)) return name;
  let cursor = '';
  do {
    const params: Record<string, string> = { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '1000' };
    if (cursor) params.cursor = cursor;
    const body = await call(options, 'conversations.list', params);
    const found = body.channels.find((c: { name: string }) => c.name === name);
    if (found) return found.id;
    cursor = body.response_metadata?.next_cursor ?? '';
  } while (cursor);
  throw new SlackError(`No channel #${name}: is the bot a member of it?`);
}

/** Posts `text`; the channel's ID and the message's timestamp, to wait for a reply to it. */
export async function post(options: SlackOptions, channel: string, text: string): Promise<{ channel: string; ts: string }> {
  const id = await findChannel(options, channel);
  const body = await call(options, 'chat.postMessage', { channel: id, text }, true);
  return { channel: id, ts: body.ts };
}

/**
 * The first reply to the message at `ts` from someone else than the bot: in its thread, or else
 * in the channel after it. None until `timeoutMs` passes → undefined.
 */
export async function waitForReply(options: SlackOptions, channel: string, ts: string, timeoutMs: number): Promise<string | undefined> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const self = (await call(options, 'auth.test', {})).user_id;
  const isReply = (m: Message) => m.ts !== ts && m.user !== self && !m.bot_id && !m.subtype && m.text;
  const deadline = now() + timeoutMs;
  for (;;) {
    const thread: Message[] = (await call(options, 'conversations.replies', { channel, ts })).messages ?? [];
    const history: Message[] = (await call(options, 'conversations.history', { channel, oldest: ts })).messages ?? [];
    // Slack answers the newest message first in the history, the oldest first in a thread.
    const reply = thread.find(isReply) ?? history.filter(isReply).sort((a, b) => Number(a.ts) - Number(b.ts))[0];
    if (reply) return reply.text;
    if (now() >= deadline) return undefined;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - now())));
  }
}

/** `slack.ts <args>`: the exit code; the reply goes to `print`. */
export async function run(args: string[], options: SlackOptions & { print: (text: string) => void; error: (text: string) => void }) {
  const usage = 'Usage: node scripts/slack.ts ask <channel> <text> [--timeout <minutes>] | post <channel> <text>';
  let timeout = 60;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout') {
      timeout = Number(args[++i]);
      if (!(timeout > 0)) return options.error(`--timeout: a number of minutes, not ${args[i] ?? 'nothing'}\n${usage}`), 1;
    } else rest.push(args[i]);
  }
  const [command, channel, text, ...extra] = rest;
  if (!['ask', 'post'].includes(command) || !channel || !text || extra.length) return options.error(usage), 1;
  if (!options.token) return options.error('Set SLACK_BOT_TOKEN.'), 1;
  try {
    const posted = await post(options, channel, text);
    if (command === 'post') return options.print(posted.ts), 0;
    const reply = await waitForReply(options, posted.channel, posted.ts, timeout * 60_000);
    if (reply === undefined) return options.error(`No reply in ${channel} within ${timeout} minutes.`), 2;
    options.print(reply);
    return 0;
  } catch (e) {
    if (e instanceof SlackError) return options.error(e.message), 1;
    throw e;
  }
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2), {
    fetch,
    token: process.env.SLACK_BOT_TOKEN ?? '',
    print: (text) => console.log(text),
    error: (text) => console.error(text),
  });
}
