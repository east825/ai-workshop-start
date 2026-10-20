---
name: issue-to-pr
description: Preparing a PR for a Github issue
---

Evaluate the issue or a feature request. If it's reasonable to be implemented, prepare a PR.
Keep relevant changes together as atomic commits. Always strive to add tests and update the specification accordingly.
In a PR description start with a short high level overview of the changes and how it was tested. Explain non-trivial parts afterwards.


After the PR is published, put a label on it called "Awaiting early feedback", then check it every 5 minutes for an hour for new review comments. Address the comments with separate commits and answer them in the PR discussion. After one hour remove the label "Awaiting early feedback".