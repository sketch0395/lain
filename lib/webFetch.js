// Thin adapter over the shared assistant-tools webFetch module — see
// tools-agent/shared/tools/webFetch.js for the actual implementation
// (fetching a URL and extracting readable text). Kept as its own file
// (rather than importing the shared module directly from lib/tools.js)
// so other host-specific code can import fetchWebPage the same way it
// always has, and so a host override could be added here later without
// touching the shared module.
import webFetchTool from "../tools-agent/shared/tools/webFetch";

export const fetchWebPage = webFetchTool.fetchWebPage;
