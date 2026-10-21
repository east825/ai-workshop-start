#!/usr/bin/env node
// Asks a question in a Slack channel and waits for the answer: for an agent that needs a human
// decision before it goes on. spec/slack.md. `SLACK_BOT_TOKEN`: a bot token that is a member of the channel.
//   node scripts/slack.ts ask <channel> <text> [--timeout <minutes>]
//   node scripts/slack.ts wait <channel> <ts> [--timeout <minutes>]
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
type Message = { ts: string; text?: string; user?: string; bot_id?: string; subtype?: string; files?: { name?: string; permalink?: string }[] };

const API = 'https://slack.com/api/';
/** How often to look for a reply. */
export const POLL_MS = 10_000;

export class SlackError extends Error {
  /**
   * A failure that may pass if asked again: the network, a 5xx or a 429. `retryAfterMs`: how long Slack asks to wait
   * first, from `Retry-After`.
   */
  readonly transient: boolean;
  readonly retryAfterMs: number;
  constructor(message: string, transient = false, retryAfterMs = 0) {
    super(message);
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}

async function call(options: SlackOptions, method: string, params: Record<string, string>, post = false): Promise<any> {
  const headers = { Authorization: `Bearer ${options.token}` };
  let response: Response;
  try {
    response = post
      ? await options.fetch(API + method, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(params),
        })
      : await options.fetch(`${API}${method}?${new URLSearchParams(params)}`, { headers });
  } catch (e) {
    throw new SlackError(`Slack ${method}: ${e instanceof Error ? e.message : e}`, true);
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    const transient = response.status === 429 || response.status >= 500;
    throw new SlackError(`Slack ${method}: HTTP ${response.status}`, transient, retryAfter > 0 ? retryAfter * 1000 : 0);
  }
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
 * Subtypes of a message a human writes: a reply also sent to the channel, a reply with a file. Every
 * other subtype is an event, such as a join, and not an answer.
 */
const HUMAN_SUBTYPES = new Set(['thread_broadcast', 'file_share']);

/** The text of a message and a line per file attached to it. */
function textOf(m: Message): string {
  const files = (m.files ?? []).map((f) => `File: ${[f.name, f.permalink].filter(Boolean).join(' ')}`);
  return [m.text ?? '', ...files].filter(Boolean).join('\n');
}

/** Ends a question that `ask` posts: only a reply in its thread is taken as the answer. */
export const REPLY_HINT = 'Reply in this thread.';

/**
 * The first reply in the thread of the message at `ts` from someone else than the bot; a message in
 * the channel is not one, it may answer another question. None until `timeoutMs` passes → undefined.
 * A look that fails for a while (the network, a 5xx, a 429) counts as no reply yet; any other failure is thrown.
 */
export async function waitForReply(options: SlackOptions, channel: string, ts: string, timeoutMs: number): Promise<string | undefined> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const self = (await call(options, 'auth.test', {})).user_id;
  const isReply = (m: Message) =>
    m.ts !== ts && m.user !== self && !m.bot_id && (!m.subtype || HUMAN_SUBTYPES.has(m.subtype)) && textOf(m) !== '';
  const deadline = now() + timeoutMs;
  for (;;) {
    let pause = POLL_MS;
    try {
      const thread: Message[] = (await call(options, 'conversations.replies', { channel, ts })).messages ?? [];
      // Slack answers the oldest message first in a thread.
      const reply = thread.find(isReply);
      if (reply) return textOf(reply);
    } catch (e) {
      if (!(e instanceof SlackError && e.transient)) throw e;
      pause = Math.max(POLL_MS, e.retryAfterMs);
    }
    if (now() >= deadline) return undefined;
    await sleep(Math.min(pause, Math.max(0, deadline - now())));
  }
}

/** `slack.ts <args>`: the exit code; the reply goes to `print`. */
export async function run(args: string[], options: SlackOptions & { print: (text: string) => void; error: (text: string) => void }) {
  const usage =
    'Usage: node scripts/slack.ts ask <channel> <text> [--timeout <minutes>] | wait <channel> <ts> [--timeout <minutes>] | post <channel> <text>';
  let timeout = 60;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--timeout') {
      timeout = Number(args[++i]);
      if (!(timeout > 0)) return options.error(`--timeout: a number of minutes, not ${args[i] ?? 'nothing'}\n${usage}`), 1;
    } else rest.push(args[i]);
  }
  const [command, channel, text, ...extra] = rest;
  if (!['ask', 'wait', 'post'].includes(command) || !channel || !text || extra.length) return options.error(usage), 1;
  if (command === 'wait' && !/^\d+\.\d+$/.test(text)) return options.error(`wait: a message timestamp such as 1700000000.000100, not ${text}\n${usage}`), 1;
  if (!options.token) return options.error('Set SLACK_BOT_TOKEN.'), 1;
  // Once the question is posted, the command that waits for its answer: printed on every way out without one.
  let again = '';
  try {
    const question =
      command === 'wait'
        ? { channel: await findChannel(options, channel), ts: text }
        : await post(options, channel, command === 'ask' ? `${text}\n\n${REPLY_HINT}` : text);
    if (command === 'post') return options.print(question.ts), 0;
    again = `node scripts/slack.ts wait ${question.channel} ${question.ts} --timeout ${timeout}`;
    const reply = await waitForReply(options, question.channel, question.ts, timeout * 60_000);
    // A caller whose commands may not run that long waits in rounds: this is the next one.
    if (reply === undefined) return options.error(`No reply in ${channel} within ${timeout} minutes. To wait longer: ${again}`), 2;
    options.print(reply);
    return 0;
  } catch (e) {
    if (e instanceof SlackError) return options.error(again ? `${e.message}. To wait again: ${again}` : e.message), 1;
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
