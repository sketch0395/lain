// Thin adapter over the shared assistant-tools playbooks module — see
// tools-agent/shared/tools/playbooks.js for the actual implementation
// (schema, CRUD, FTS5 search). Injects Lain's own SQLite connection
// (lib/db.js) into each call, same pattern as lib/threatIntel.js.
import { getDb } from "@/lib/db";
import playbooksTool from "../tools-agent/shared/tools/playbooks";

export function addPlaybook(args) {
  return playbooksTool.addPlaybook(getDb(), args);
}

export function listPlaybooks(category) {
  return playbooksTool.listPlaybooks(getDb(), category);
}

export function listPlaybookCategories() {
  return playbooksTool.listPlaybookCategories(getDb());
}

export function updatePlaybook(id, args) {
  return playbooksTool.updatePlaybook(getDb(), id, args);
}

export function deletePlaybook(id) {
  return playbooksTool.deletePlaybook(getDb(), id);
}

export function searchPlaybooks(query, limit) {
  return playbooksTool.searchPlaybooks(getDb(), query, limit);
}

export function getPlaybookDraft(conversationId) {
  return playbooksTool.getPlaybookDraft(getDb(), conversationId);
}

export function startPlaybookDraft(conversationId, args) {
  return playbooksTool.startPlaybookDraft(getDb(), conversationId, args);
}

export function addPlaybookDraftStep(conversationId, step) {
  return playbooksTool.addPlaybookDraftStep(getDb(), conversationId, step);
}

export function discardPlaybookDraft(conversationId) {
  return playbooksTool.discardPlaybookDraft(getDb(), conversationId);
}

export function finalizePlaybookDraft(conversationId, args) {
  return playbooksTool.finalizePlaybookDraft(getDb(), conversationId, args);
}

export function playbookToMarkdown(entry) {
  return playbooksTool.playbookToMarkdown(entry);
}

export function parsePlaybookMarkdown(text, fallbackTitle) {
  return playbooksTool.parsePlaybookMarkdown(text, fallbackTitle);
}

export function playbookFilename(entry) {
  return playbooksTool.playbookFilename(entry);
}
