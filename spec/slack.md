# Asking in Slack
`node scripts/slack.ts ask <channel> <text> [--timeout <minutes>]`: posts the question, ending with *Reply in this
thread.*, and waits for **the answer**;
for an agent that needs a human decision before it goes on (the `issue-to-pr` skill, in `#air-automation-probe`).
`node scripts/slack.ts wait <channel> <ts> [--timeout <minutes>]`: waits for the answer to a question posted before,
the message at `ts`; posts nothing. For a caller that can't run one command for an hour: it waits in rounds.
`node scripts/slack.ts post <channel> <text>`: posts only, prints the message's timestamp.
`SLACK_BOT_TOKEN`: a bot token, a *member* of the channel.
## Channel
- `#name`, `name` or an ID (`C0CAVD8062J`); a name is looked up among the channels the bot sees, public and private
- No such channel → a clear message, exit code 1
## Answer
- The first reply *in the question's thread* from someone else than the bot; printed to stdout, exit code 0
- A message in the *channel*, outside the thread, is not an answer: it may answer another question, or none
- A reply *also sent to the channel* or *with a file* is an answer; each file is printed as `File: <name> <link>`
- The bot's own messages, other bots' and joins or other events are not an answer
- Looks every 10 seconds; a look that fails for a while (the network, also partway through the answer, an answer
  that is not JSON such as a proxy's error page, HTTP 5xx, HTTP 429) is no answer yet, and the
  next one comes after 10 seconds, or after `Retry-After` on a 429 if that is longer
- A look that stalls, Slack answering nothing, is aborted after 30 seconds, or after the time left before `--timeout`
  but never sooner than 10 seconds, and is no answer yet: the wait ends at most 10 seconds after `--timeout`
- No answer within `--timeout` (*60 minutes* by default) → a message ending with the `wait`
  command that waits for the same answer again, `To wait longer: node scripts/slack.ts wait <channel ID> <ts> --timeout
  <minutes>`; exit code 2
## Errors
- No `SLACK_BOT_TOKEN`, a missing argument, an unknown command, a `--timeout` that is not a positive number or a
  `wait` `<ts>` that is not a message timestamp (`1700000000.000100`) → the usage, exit code 1
- Slack refuses (`not_in_channel`, `invalid_auth`, …) or can't be reached other than in a look for the answer → `Slack <method>: <error>`, exit code 1;
  so does `auth.test` before the first look when it stalls for 30 seconds;
  once the question is posted, the message ends with `To wait again: node scripts/slack.ts wait <channel ID> <ts>
  --timeout <minutes>`, so it is not lost
