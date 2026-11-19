// Adapter over lib/playbookRuns.js (Lain-only): injects Lain's SQLite
// connection, same pattern as lib/incidents.js.
import { getDb } from "@/lib/db";
import playbookRuns from "./playbookRuns";

export function startPlaybookRun(incidentId, playbookId, author) {
  return playbookRuns.startRun(getDb(), incidentId, playbookId, author);
}

export function getPlaybookRun(runId) {
  return playbookRuns.getRun(getDb(), runId);
}

export function getActivePlaybookRun(incidentId) {
  return playbookRuns.getActiveRun(getDb(), incidentId);
}

export function updatePlaybookStep(runId, step, args, author) {
  return playbookRuns.updateStep(getDb(), runId, step, args, author);
}

export function finishPlaybookRun(runId, status, author) {
  return playbookRuns.finishRun(getDb(), runId, status, author);
}
