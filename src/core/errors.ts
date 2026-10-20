/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** GitHub refuses to answer for now: the other repositories of an organization would fail too. */
export class RateLimitError extends AtlasError {}
