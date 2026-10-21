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
- Looks every 10 seconds; no answer within `--timeout` (*60 minutes* by default) → a message ending with the `wait`
  command that waits for the same answer again, `To wait longer: node scripts/slack.ts wait <channel ID> <ts> --timeout
  <minutes>`; exit code 2
## Errors
- No `SLACK_BOT_TOKEN`, a missing argument, an unknown command, a `--timeout` that is not a positive number or a
  `wait` `<ts>` that is not a message timestamp (`1700000000.000100`) → the usage, exit code 1
- Slack refuses (`not_in_channel`, `invalid_auth`, …) → `Slack <method>: <error>`, exit code 1
