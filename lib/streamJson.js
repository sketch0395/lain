// Wraps a slow, JSON-producing route handler in a streamed HTTP response.
//
// Why this exists: if Lain is ever reached through a reverse proxy or
// tunnel with an edge/idle timeout (Cloudflare Tunnels enforce a ~100s
// edge timeout on Free/Pro plans — see the sibling Asuna app, which hit
// this in production), a single blocking response can't extend it — if
// the origin doesn't send *any* bytes before the limit, the proxy kills
// the connection and returns an HTML error page instead of JSON. Deep
// Thinking (the larger, slower OLLAMA_MODEL_DEEP model, plus its
// model-swap reload) is exactly the case most likely to blow past that:
// `res.json()` on the client then throws parsing the HTML error page as
// JSON — surfaced to the user as a cryptic native browser error (Safari's
// generic message is literally "The string did not match the expected
// pattern.") instead of a real, retryable error message.
//
// The fix: start the HTTP response immediately (so headers/first bytes
// arrive well under any such limit) and periodically flush a harmless
// heartbeat byte to the client while `run()` is still pending — any bytes
// reset a proxy's idle timer — then emit the real JSON payload as the
// final newline-terminated line once `run()` resolves. See
// app/api/chat/route.js and app/api/chat/confirm/route.js for the
// callers, and ChatClient.js's readStreamedJson() for how the client
// parses this on the way back.
const HEARTBEAT_MS = 15_000;

export function streamJsonResponse(run) {
  const encoder = new TextEncoder();
  let heartbeat;
  const stream = new ReadableStream({
    async start(controller) {
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode("\n"));
      }, HEARTBEAT_MS);
      try {
        const payload = await run();
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      } catch (err) {
        // Should be rare — callers are expected to catch their own errors
        // and return an { error } payload instead, but this is a safety
        // net so a thrown error still reaches the client as JSON rather
        // than as a truncated/aborted stream.
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ error: err?.message || "Unknown error" })}\n`)
        );
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
    cancel() {
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
