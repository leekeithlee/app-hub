import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

function runGit(args, cwd, opts = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeout || 30000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Keith App Hub",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "apphub@local",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Keith App Hub",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "apphub@local",
      },
    });
    return { ok: true, out: (out || "").trim() };
  } catch (e) {
    return {
      ok: false,
      out: (e.stdout || "").toString().trim(),
      err: (e.stderr || e.message || String(e)).toString().trim(),
    };
  }
}

export function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

/**
 * Init repo + initial commit if needed.
 */
export function ensureGitRepo(dir, { message } = {}) {
  if (!fs.existsSync(dir)) {
    return { ok: false, error: "path missing" };
  }

  const created = !isGitRepo(dir);
  if (created) {
    const init = runGit(["init", "-b", "main"], dir);
    if (!init.ok) {
      // older git without -b
      const init2 = runGit(["init"], dir);
      if (!init2.ok) return { ok: false, error: init2.err || init.err };
      runGit(["branch", "-M", "main"], dir);
    }
    // ignore common junk
    const gi = path.join(dir, ".gitignore");
    if (!fs.existsSync(gi)) {
      fs.writeFileSync(
        gi,
        [
          "node_modules/",
          "dist/",
          "build/",
          ".env",
          ".env.*",
          "!.env.example",
          "data/",
          "server/data/",
          "*.log",
          ".DS_Store",
          "",
        ].join("\n")
      );
    }
  }

  runGit(["add", "-A"], dir);
  const status = runGit(["status", "--porcelain"], dir);
  if (status.ok && !status.out) {
    return {
      ok: true,
      created,
      committed: false,
      message: "clean working tree",
      ...getGitStatus(dir),
    };
  }

  const msg =
    message ||
    (created
      ? "chore: initial scaffold from App Hub"
      : "chore: App Hub snapshot");
  const commit = runGit(["commit", "-m", msg], dir);
  if (!commit.ok) {
    // maybe nothing to commit or identity issue
    return {
      ok: false,
      created,
      error: commit.err || commit.out || "commit failed",
      ...getGitStatus(dir),
    };
  }

  return {
    ok: true,
    created,
    committed: true,
    commitMessage: msg,
    ...getGitStatus(dir),
  };
}

export function gitCommitSnapshot(dir, message) {
  if (!isGitRepo(dir)) {
    return ensureGitRepo(dir, { message: message || "chore: initial commit" });
  }
  runGit(["add", "-A"], dir);
  const porcelain = runGit(["status", "--porcelain"], dir);
  if (porcelain.ok && !porcelain.out) {
    return {
      ok: true,
      committed: false,
      message: "nothing to commit (clean)",
      ...getGitStatus(dir),
    };
  }
  const msg =
    message ||
    `chore: snapshot ${new Date().toISOString().replace("T", " ").slice(0, 16)}`;
  const commit = runGit(["commit", "-m", msg], dir);
  if (!commit.ok) {
    return { ok: false, error: commit.err || commit.out, ...getGitStatus(dir) };
  }
  return {
    ok: true,
    committed: true,
    commitMessage: msg,
    ...getGitStatus(dir),
  };
}

export function getGitStatus(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return {
      isRepo: false,
      healthyScore: 0,
      healthyMax: 5,
      summary: "path missing",
    };
  }
  if (!isGitRepo(dir)) {
    return {
      isRepo: false,
      branch: null,
      dirty: false,
      dirtyCount: 0,
      commitCount: 0,
      lastCommit: null,
      lastCommitAt: null,
      remote: null,
      remoteUrl: null,
      healthyScore: 0,
      healthyMax: 5,
      summary: "no git repo",
    };
  }

  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  const porcelain = runGit(["status", "--porcelain"], dir);
  const dirtyLines = porcelain.ok && porcelain.out ? porcelain.out.split("\n").filter(Boolean) : [];
  const count = runGit(["rev-list", "--count", "HEAD"], dir);
  const last = runGit(["log", "-1", "--format=%h|%s|%ci"], dir);
  const remote = runGit(["remote"], dir);
  let remoteUrl = null;
  if (remote.ok && remote.out) {
    const first = remote.out.split("\n")[0];
    const u = runGit(["remote", "get-url", first], dir);
    if (u.ok) remoteUrl = u.out;
  }

  let lastHash = null;
  let lastSubject = null;
  let lastAt = null;
  if (last.ok && last.out) {
    const [h, s, t] = last.out.split("|");
    lastHash = h;
    lastSubject = s;
    lastAt = t;
  }

  const commitCount = count.ok ? Number(count.out) || 0 : 0;
  const dirty = dirtyLines.length > 0;

  // health: has repo, has commits, clean, has remote, recent commit (<7d)
  let score = 0;
  if (true) score += 1; // is repo
  if (commitCount > 0) score += 1;
  if (!dirty) score += 1;
  if (remoteUrl) score += 1;
  if (lastAt) {
    const age = Date.now() - new Date(lastAt).getTime();
    if (age < 7 * 24 * 3600 * 1000) score += 1;
  }

  return {
    isRepo: true,
    branch: branch.ok ? branch.out : null,
    dirty,
    dirtyCount: dirtyLines.length,
    commitCount,
    lastCommit: lastHash,
    lastCommitSubject: lastSubject,
    lastCommitAt: lastAt,
    remote: remote.ok && remote.out ? remote.out.split("\n")[0] : null,
    remoteUrl,
    healthyScore: score,
    healthyMax: 5,
    summary: dirty
      ? `${branch.out || "?"} · ${commitCount} commits · ⚠ ${dirtyLines.length} dirty`
      : `${branch.out || "?"} · ${commitCount} commits · clean`,
  };
}

/**
 * Optional: create private GitHub repo and push (requires gh auth).
 */
export function pushToGitHub(dir, { name, privateRepo = true } = {}) {
  if (!isGitRepo(dir)) {
    const ens = ensureGitRepo(dir);
    if (!ens.ok) return { ok: false, error: ens.error || "git init failed" };
  }
  // ensure commit
  gitCommitSnapshot(dir, "chore: prepare for GitHub push");

  try {
    execSync("gh auth status", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return { ok: false, error: "gh not logged in. Run: gh auth login" };
  }

  const repoName = name || path.basename(dir);
  const visibility = privateRepo ? "--private" : "--public";

  // if remote already exists, just push
  const rem = runGit(["remote"], dir);
  if (rem.ok && rem.out.includes("origin")) {
    const push = runGit(["push", "-u", "origin", "HEAD"], dir, { timeout: 120000 });
    return {
      ok: push.ok,
      error: push.ok ? null : push.err,
      ...getGitStatus(dir),
      pushed: push.ok,
    };
  }

  try {
    const cmd = `gh repo create ${JSON.stringify(repoName)} ${visibility} --source=. --remote=origin --push`;
    execSync(cmd, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    return { ok: true, pushed: true, created: true, ...getGitStatus(dir) };
  } catch (e) {
    return {
      ok: false,
      error: (e.stderr || e.message || String(e)).toString(),
      ...getGitStatus(dir),
    };
  }
}

export function gitRulesMarkdown(app, git) {
  const g = git || getGitStatus(app.path);
  return [
    `## Git rules for this thread`,
    `- Work only in: \`${app.path}\``,
    `- Branch now: **${g.branch || "n/a"}** · commits: **${g.commitCount ?? 0}** · ${g.dirty ? "⚠ dirty" : "clean"}`,
    g.lastCommit
      ? `- Last commit: \`${g.lastCommit}\` ${g.lastCommitSubject || ""}`
      : `- No commits yet — create a snapshot before big edits`,
    g.remoteUrl ? `- Remote: ${g.remoteUrl}` : `- No GitHub remote yet (optional push later)`,
    `- Before large refactors: commit a snapshot`,
    `- Prefer branch \`feature/<short-name>\` for experiments`,
    `- Do not force-push main`,
    `- After done: summarize commits + how to verify`,
    ``,
  ].join("\n");
}
