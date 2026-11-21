import { createPiExtension } from "@luthfisolahudin/ai-integrations-pi";
import { provider } from "@luthfisolahudin/commandcode-integrations-provider";

export default createPiExtension(provider.packs[0]!, provider.effort);
