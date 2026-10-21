---
name: issue-to-pr
description: Preparing a PR for a Github issue
---

Evaluate the issue or a feature request. If it's reasonable to be implemented, prepare a PR.
If the issue leaves a decision open (several reasonable behaviors, an unclear scope, a trade-off the issue doesn't settle),
don't guess: ask in the Slack channel #air-automation-probe and wait for the answer before going on.

```sh
node scripts/slack.ts ask '#air-automation-probe' '<question>' --timeout 9
```

Make the question self-contained: link the issue, name the decision and list the options with your recommendation.
A shell command can't run in the foreground for more than 10 minutes, and a background one doesn't outlive your turn,
so wait in rounds: run the command in the foreground with a 10-minute (600000 ms) timeout. It prints the answer, posted
in the question's thread, with exit code 0; follow it and mention it in the PR description. With no answer yet (exit
code 2), it ends its message with `To wait longer: node scripts/slack.ts wait <channel> <ts> --timeout 9`; run that,
the same way, until an answer arrives or about an hour has passed since you asked. Then go on with your recommendation
and say so in the PR description. With exit code 1, Slack refused: if the message ends with `To wait again: …`, the
question was posted; fix the cause if you can and run that command, don't ask again. Otherwise, or if it still fails,
go on with your recommendation and say so in the PR description. It needs `SLACK_BOT_TOKEN`; see spec/slack.md.

Keep relevant changes together as atomic commits. Always strive to add tests and update the specification accordingly.
In a PR description start with a short high level overview of the changes and how it was tested. Explain non-trivial parts afterwards.


After the PR is published, put a label on it called "Awaiting early feedback", then check it every 5 minutes for an hour for new review comments. Address the comments with separate commits and answer them in the PR discussion. After one hour remove the label "Awaiting early feedback".