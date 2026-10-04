// Thin adapter over the shared cybersecurity news aggregator (see
// tools-agent/shared/tools/cyberNews.js) — injects Lain's own SQLite
// connection into every call so the schema/query logic stays a single
// source of truth shared with Asuna, while each host still owns its own DB.

import { getDb } from "./db";
import cyberNewsTool from "../tools-agent/shared/tools/cyberNews";

export function addCyberNewsSource(name, url) {
  return cyberNewsTool.addCyberNewsSource(getDb(), name, url);
}

export function listCyberNewsSources() {
  return cyberNewsTool.listCyberNewsSources(getDb());
}

export function removeCyberNewsSource(nameOrUrl) {
  return cyberNewsTool.removeCyberNewsSource(getDb(), nameOrUrl);
}

export function setCyberNewsWatchTerms(text) {
  return cyberNewsTool.setCyberNewsWatchTerms(getDb(), text);
}

export function getCyberNewsWatchTerms() {
  return cyberNewsTool.getCyberNewsWatchTerms(getDb());
}

export function fetchCyberNews(opts) {
  return cyberNewsTool.fetchCyberNews(getDb(), opts);
}
