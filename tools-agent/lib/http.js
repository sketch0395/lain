"use strict";

// Small HTTP helpers shared by every route module: bearer-token auth,
// JSON responses, reading a POST body, and a minimal router so each
// domain module can register its own routes instead of one giant
// if/else chain in server.js.

const crypto = require("node:crypto");
const { TOKEN } = require("./config");

function checkAuth(req) {
  if (!TOKEN) return false;
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

// Reads and JSON-parses a request body (used by the few POST endpoints).
// Resolves to {} if the body is empty/invalid JSON.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Tiny method+exact-path router. Each domain module (files.js, forensics.js,
// etc.) gets one of these and registers its own routes; server.js just
// tries each router in turn until one handles the request.
function createRouter() {
  const routes = [];
  return {
    get(routePath, handler) {
      routes.push({ method: "GET", path: routePath, handler });
    },
    post(routePath, handler) {
      routes.push({ method: "POST", path: routePath, handler });
    },
    // Matches any HTTP method — used for the read-only GET-style endpoints
    // that (in the original single-file server) never checked req.method,
    // so a request with any verb was still handled the same way.
    any(routePath, handler) {
      routes.push({ method: null, path: routePath, handler });
    },
    // Returns true if a route matched and was handled (sent a response,
    // possibly asynchronously), false if nothing matched. Handlers that
    // throw synchronously (most of the file/forensics tools do, on bad
    // input or a missing binary) are caught here and turned into a 500,
    // same as the previous single try/catch around the whole router.
    handle(req, res, url) {
      const route = routes.find(
        (r) => (r.method === null || r.method === req.method) && r.path === url.pathname
      );
      if (!route) return false;
      try {
        route.handler(req, res, url);
      } catch (err) {
        send(res, 500, { error: err.message });
      }
      return true;
    },
  };
}

module.exports = { checkAuth, send, readJsonBody, createRouter };
