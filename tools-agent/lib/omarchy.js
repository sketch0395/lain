"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { OMARCHY_STATE_DIR } = require("./config");
const { send, readJsonBody } = require("./http");

function hyprctlJson(args) {
  try {
    const out = execFileSync("hyprctl", ["-j", ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function omarchyStatus() {
  let theme = "unknown";
  try {
    theme = fs.readFileSync(path.join(OMARCHY_STATE_DIR, "theme.name"), "utf8").trim();
  } catch {
    // best-effort only
  }

  const activeWorkspace = hyprctlJson(["activeworkspace"]);
  const clients = hyprctlJson(["clients"]) || [];
  const monitors = hyprctlJson(["monitors"]) || [];
  const activeClient = hyprctlJson(["activewindow"]);

  return {
    theme,
    activeWorkspace: activeWorkspace
      ? { id: activeWorkspace.id, name: activeWorkspace.name, monitor: activeWorkspace.monitor }
      : null,
    activeWindow: activeClient
      ? { class: activeClient.class, title: activeClient.title }
      : null,
    monitors: monitors.map((m) => ({
      name: m.name,
      activeWorkspace: m.activeWorkspace && m.activeWorkspace.name,
      focused: Boolean(m.focused),
    })),
    windowCount: clients.length,
  };
}

function omarchyThemeList() {
  const out = execFileSync("omarchy-theme-list", [], {
    encoding: "utf8",
    timeout: 5000,
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function omarchySetTheme(themeName) {
  // Validate against the actual installed theme list first, so we only ever
  // pass a known-good value to execFile (no shell involved either way, but
  // this also gives a clean error instead of omarchy-theme-set's own).
  const available = omarchyThemeList();
  if (!available.includes(themeName)) {
    throw new Error(`Unknown theme "${themeName}". Available: ${available.join(", ")}`);
  }
  execFileSync("omarchy-theme-set", [themeName], { timeout: 10000 });
  return { theme: themeName };
}

function registerRoutes(router) {
  router.get("/omarchy/status", (req, res) => send(res, 200, omarchyStatus()));

  router.get("/omarchy/themes", (req, res) =>
    send(res, 200, { themes: omarchyThemeList() })
  );

  router.post("/omarchy/theme", async (req, res) => {
    const { theme } = await readJsonBody(req);
    if (!theme) return send(res, 400, { error: "theme is required" });
    try {
      send(res, 200, omarchySetTheme(theme));
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

module.exports = {
  hyprctlJson,
  omarchyStatus,
  omarchyThemeList,
  omarchySetTheme,
  registerRoutes,
};
