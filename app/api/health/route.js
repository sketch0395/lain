import { toolsConfigured, toolsReachable } from "@/lib/tools";
import { pushConfigured } from "@/lib/push";
import { emailConfigured } from "@/lib/email";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://10.5.1.20:11434";

export async function GET() {
  let ollamaReachable = false;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    ollamaReachable = res.ok;
  } catch {
    ollamaReachable = false;
  }

  const toolsEnabled = toolsConfigured();
  const toolsOk = toolsEnabled ? await toolsReachable() : null;

  return Response.json({
    status: "ok",
    ollamaReachable,
    toolsEnabled,
    toolsReachable: toolsOk,
    pushEnabled: pushConfigured(),
    emailEnabled: emailConfigured(),
  });
}
