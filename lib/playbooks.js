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
