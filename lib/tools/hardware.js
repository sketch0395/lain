// Hardware/system specs + "can this model run on my laptop?" checks, both
// dispatched via the laptop tools agent.
//
// The actual tool schemas/dispatch logic live in the shared assistant-tools
// submodule (tools-agent/shared/app-tools/hardware.js) so they stay in sync
// with other projects that use the same tools (Asuna) — this file just
// injects this app's own httpClient (LAIN_TOOLS_URL/TOKEN).
import { fetchToolsAgent } from "./httpClient";
import sharedHardware from "../../tools-agent/shared/app-tools/hardware";

export const CONFIRM_REQUIRED_TOOLS = sharedHardware.CONFIRM_REQUIRED_TOOLS;
export const CATEGORY_KEYWORDS = sharedHardware.CATEGORY_KEYWORDS;
export const NAMES = sharedHardware.NAMES;

export function getDefinitions(flags) {
  return sharedHardware.getDefinitions(flags);
}

export function describe(name, args) {
  return sharedHardware.describe(name, args);
}

export async function execute(name, args) {
  return sharedHardware.execute(name, args, { fetchToolsAgent });
}
