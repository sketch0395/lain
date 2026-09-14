// Thin adapter over the shared assistant-tools threatIntel module — see
// tools-agent/shared/tools/threatIntel.js for the actual implementation
// (schema, CRUD, FTS5 search). Injects Lain's own SQLite connection
// (lib/db.js) into each call, same pattern as the tools-agent/lib/*.js
// adapters use for registerRoutes(router, opts).
import { getDb } from "@/lib/db";
import threatIntelTool from "../tools-agent/shared/tools/threatIntel";

export function addThreatIntel(args) {
  return threatIntelTool.addThreatIntel(getDb(), args);
}

export function listThreatIntel(category) {
  return threatIntelTool.listThreatIntel(getDb(), category);
}

export function listThreatIntelCategories() {
  return threatIntelTool.listThreatIntelCategories(getDb());
}

export function deleteThreatIntel(id) {
  return threatIntelTool.deleteThreatIntel(getDb(), id);
}

export function searchThreatIntel(query, limit) {
  return threatIntelTool.searchThreatIntel(getDb(), query, limit);
}
