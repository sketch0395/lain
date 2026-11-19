// Thin adapter over lib/incidentCases.js (Lain-only; not in the shared
// assistant-tools submodule) — see that file for the actual implementation
// (schema, case CRUD, timeline, conversation links). Injects Lain's own
// SQLite connection (lib/db.js) into each call, same pattern as
// lib/incidentReports.js.
import { getDb } from "@/lib/db";
import incidentsTool from "./incidentCases";

export function createIncident(args) {
  return incidentsTool.createIncident(getDb(), args);
}

export function listIncidents(opts) {
  return incidentsTool.listIncidents(getDb(), opts);
}

export function getIncident(id) {
  return incidentsTool.getIncident(getDb(), id);
}

export function updateIncident(id, args, author) {
  return incidentsTool.updateIncident(getDb(), id, args, author);
}

export function deleteIncident(id) {
  return incidentsTool.deleteIncident(getDb(), id);
}

export function addIncidentEvent(id, args) {
  return incidentsTool.addIncidentEvent(getDb(), id, args);
}

export function linkConversation(id, conversationId) {
  return incidentsTool.linkConversation(getDb(), id, conversationId);
}

export function linkReport(id, reportId) {
  return incidentsTool.linkReport(getDb(), id, reportId);
}

export function getActiveIncidentForConversation(conversationId) {
  return incidentsTool.getActiveIncidentForConversation(getDb(), conversationId);
}

export function listIncidentsForConversation(conversationId) {
  return incidentsTool.listIncidentsForConversation(getDb(), conversationId);
}

export function incidentContextAddendum(incident) {
  return incidentsTool.incidentContextAddendum(incident);
}
