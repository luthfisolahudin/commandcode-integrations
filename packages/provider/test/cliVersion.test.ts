import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMAND_CODE_CLI_VERSION } from "../src/cliVersion.ts";

test("the reported CLI version is a plain semver", () => {
	assert.match(COMMAND_CODE_CLI_VERSION, /^\d+\.\d+\.\d+$/);
});
