import { createPiExtension } from "../../../engine/pi/provider.ts";
import { MEASURED_WIRE_EFFORT, packs } from "@luthfisolahudin/commandcode-integrations-provider";

export default createPiExtension(packs[0]!, MEASURED_WIRE_EFFORT);
