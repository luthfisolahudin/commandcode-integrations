/**
 * The Command Code CLI version reported in `x-command-code-version`.
 *
 * The billing endpoints gate on the CLI version, so a stale value can be refused
 * as an unsupported client. `scripts/sync-cli-version.ts` rewrites this constant
 * from the npm registry; do not hand-edit it in a pull request.
 */
export const COMMAND_CODE_CLI_VERSION = "1.93.5";
