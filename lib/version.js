// Checks Lain's running version against the public GitHub repo
// (github.com/sketch0395/lain). This is intentionally independent of the
// laptop tools agent — it's a plain outbound HTTPS call to GitHub's public
// REST API (no auth needed, no token stored), so "are there updates?"
// works even on installs that haven't set up the tools agent. Applying an
// update (update_lain) still goes through the tools agent, since that
// needs host access to git pull + rebuild the container.

const GITHUB_REPO = "sketch0395/lain";
const GITHUB_BRANCH = "master";

// Baked into the image at build time (see Dockerfile's GIT_COMMIT build
// arg, set automatically by deploy.sh/scripts/update.sh from `git rev-parse
// HEAD`). "unknown" only if someone built the image without going through
// those scripts.
const CURRENT_COMMIT = process.env.LAIN_GIT_COMMIT || "unknown";

export async function checkForUpdates() {
  if (CURRENT_COMMIT === "unknown") {
    throw new Error(
      "This build doesn't have a git commit baked in (LAIN_GIT_COMMIT is " +
        "unset) — rebuild via ./deploy.sh, which sets it automatically, to " +
        "enable update checks."
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/compare/${CURRENT_COMMIT}...${GITHUB_BRANCH}`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (res.status === 404) {
    throw new Error(
      `Current commit ${CURRENT_COMMIT} wasn't found in ${GITHUB_REPO} on ` +
        "GitHub — this checkout may have local commits that were never " +
        "pushed, or the repo/branch name changed."
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}`);
  }

  const data = await res.json();
  const commits = (data.commits || []).map(
    (c) => `${c.sha.slice(0, 7)} ${c.commit.message.split("\n")[0]}`
  );

  return {
    repo: GITHUB_REPO,
    branch: GITHUB_BRANCH,
    currentCommit: CURRENT_COMMIT,
    upToDate: data.status === "identical",
    commitsBehind: data.behind_by || 0,
    commits: commits.slice(-20).reverse(),
    compareUrl: data.html_url,
  };
}
