---
name: issue-to-pr
description: Preparing a PR for a Github issue
---

Evaluate the issue or a feature request. If it's reasonable to be implemented, prepare a PR.
If the issue leaves a decision open (several reasonable behaviors, an unclear scope, a trade-off the issue doesn't settle),
don't guess: ask in the Slack channel #air-automation-probe and wait for the answer before going on.

```sh
node scripts/slack.ts ask '#air-automation-probe' '<question>'
```

Make the question self-contained: link the issue, name the decision and list the options with your recommendation.
The command waits up to an hour and prints the answer; follow it and mention it in the PR description. On no answer
(exit code 2), go on with your recommendation and say so in the PR description. It needs `SLACK_BOT_TOKEN`; see spec/slack.md.

Keep relevant changes together as atomic commits. Always strive to add tests and update the specification accordingly.
In a PR description start with a short high level overview of the changes and how it was tested. Explain non-trivial parts afterwards.


After the PR is published, put a label on it called "Awaiting early feedback", then check it every 5 minutes for an hour for new review comments. Address the comments with separate commits and answer them in the PR discussion. After one hour remove the label "Awaiting early feedback".