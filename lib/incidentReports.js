// Thin adapter over the shared assistant-tools incident-reports module —
// see tools-agent/shared/tools/incidentReports.js for the actual
// implementation (schema, CRUD, FTS5 search, live incident tracking,
// Markdown export). Injects Lain's own SQLite connection (lib/db.js) into
// each call, same pattern as lib/playbooks.js.
import { getDb } from "@/lib/db";
import incidentReportsTool from "../tools-agent/shared/tools/incidentReports";

export function addIncidentReport(args) {
  return incidentReportsTool.addIncidentReport(getDb(), args);
}

export function listIncidentReports(category) {
  return incidentReportsTool.listIncidentReports(getDb(), category);
}

export function listIncidentReportCategories() {
  return incidentReportsTool.listIncidentReportCategories(getDb());
}

export function updateIncidentReport(id, args) {
  return incidentReportsTool.updateIncidentReport(getDb(), id, args);
}

export function deleteIncidentReport(id) {
  return incidentReportsTool.deleteIncidentReport(getDb(), id);
}

export function searchIncidentReports(query, limit) {
  return incidentReportsTool.searchIncidentReports(getDb(), query, limit);
}

export function getIncidentReportDraft(conversationId) {
  return incidentReportsTool.getIncidentReportDraft(getDb(), conversationId);
}

export function startIncidentReport(conversationId, args) {
  return incidentReportsTool.startIncidentReport(getDb(), conversationId, args);
}

export function logIncidentEntry(conversationId, args) {
  return incidentReportsTool.logIncidentEntry(getDb(), conversationId, args);
}

export function discardIncidentReport(conversationId) {
  return incidentReportsTool.discardIncidentReport(getDb(), conversationId);
}

export function finalizeIncidentReport(conversationId, args) {
  return incidentReportsTool.finalizeIncidentReport(getDb(), conversationId, args);
}

export function reportToMarkdown(entry) {
  return incidentReportsTool.reportToMarkdown(entry);
}

export function reportFilename(entry) {
  return incidentReportsTool.reportFilename(entry);
}

export function parseReportMarkdown(text, fallbackTitle) {
  return incidentReportsTool.parseReportMarkdown(text, fallbackTitle);
}
