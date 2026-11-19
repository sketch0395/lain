// Adapter over lib/incidentIocs.js: injects Lain's SQLite connection and the
// real reputation lookups (only the ones whose API keys are configured, so
// enrichment degrades gracefully to "no source configured" otherwise).
import { getDb } from "@/lib/db";
import incidentIocs from "./incidentIocs";
import { ipReputationConfigured, checkIpReputation } from "./ipReputation";
import { urlhausConfigured, checkUrlhaus } from "./urlhaus";
import { fileReputationConfigured, checkFileHash } from "./fileReputation";

function buildLookups() {
  const lookups = {};
  if (ipReputationConfigured()) lookups.abuseIpdb = (ip) => checkIpReputation(ip);
  if (urlhausConfigured()) {
    lookups.urlhausHost = (host) => checkUrlhaus({ host });
    lookups.urlhausUrl = (url) => checkUrlhaus({ url });
    lookups.urlhausHash = (hash) => checkUrlhaus({ hash });
  }
  if (fileReputationConfigured()) lookups.vtFile = (hash) => checkFileHash(hash);
  return lookups;
}

export function extractIocsFromText(incidentId, text, opts) {
  return incidentIocs.extractAndAdd(getDb(), incidentId, text, opts);
}

export function addIocByValue(incidentId, value, opts) {
  return incidentIocs.addIocByValue(getDb(), incidentId, value, opts);
}

export function listIocs(incidentId, opts) {
  return incidentIocs.listIocs(getDb(), incidentId, opts);
}

export function updateIoc(id, args, author) {
  return incidentIocs.updateIoc(getDb(), id, args, author);
}

export function deleteIoc(id) {
  return incidentIocs.deleteIoc(getDb(), id);
}

export function enrichIncidentIocs(incidentId, opts) {
  return incidentIocs.enrichIncidentIocs(getDb(), incidentId, buildLookups(), opts);
}
