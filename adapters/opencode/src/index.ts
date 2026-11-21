import { createOpenCodePlugin } from "../../../engine/opencode/provider.ts";
import { MEASURED_WIRE_EFFORT, packs } from "@luthfisolahudin/commandcode-integrations-provider";

export default createOpenCodePlugin(packs[0]!, MEASURED_WIRE_EFFORT);
