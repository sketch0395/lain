// Memories management API — backs the "Memories" panel so the user can see
// (and delete) facts Lain has auto-learned via the remember_fact tool, or
// add one manually. Protected by the same auth proxy as every other /api/*
// route (see proxy.js).

import { addMemory, deleteAllMemories, listMemories } from "@/lib/memory";
import { deleteAllConversations } from "@/lib/conversations";

const WIPE_PIN = process.env.LAIN_WIPE_PIN || "0395";

export async function GET() {
  return Response.json({ memories: listMemories() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const memory = addMemory(body.content);
    return Response.json({ memory });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

// Wipes every remembered fact AND every conversation/chat history — the
// Chat command (see WIPE_PHRASE in ChatClient.js) / Settings "Wipe All Memory" flow
// both land here, gated behind a 4-digit PIN so it can't be triggered by an
// accidental message.
export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  if (String(body.pin || "") !== WIPE_PIN) {
    return Response.json({ error: "Incorrect PIN" }, { status: 403 });
  }
  const wiped = deleteAllMemories();
  const conversationsWiped = deleteAllConversations();
  return Response.json({ wiped, conversationsWiped });
}
