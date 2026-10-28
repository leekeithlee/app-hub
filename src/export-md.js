import fs from "node:fs";
import path from "node:path";
import { APPS_ROOT, enrichApp, readRegistry, tailscaleIp } from "./lib.js";

export const EXPORT_DIR = path.join(APPS_ROOT, "_meta", "exports");

function listTree(root, maxDepth = 3, prefix = "", depth = 0) {
  if (depth >= maxDepth || !fs.existsSync(root)) return [];
  const lines = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return lines;
  }
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    "data",
    "__pycache__",
    ".cache",
  ]);
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env.example") continue;
    if (skip.has(e.name)) {
      lines.push(`${prefix}${e.name}/`);
      continue;
    }
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      lines.push(`${prefix}${e.name}/`);
      lines.push(...listTree(full, maxDepth, prefix + "  ", depth + 1));
    } else {
      lines.push(`${prefix}${e.name}`);
    }
  }
  return lines;
}

function linesToBullets(text) {
  if (!text || !String(text).trim()) return ["_(none)_"];
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("-") || l.startsWith("*") ? l : `- ${l}`));
}

/**
 * @param {object} app
 * @param {{ mode?: 'brief'|'full'|'prompt', tailscaleIp?: string|null }} opts
 */
export async function buildAppExportMarkdown(app, opts = {}) {
  const mode = opts.mode || "full";
  const ts = opts.tailscaleIp ?? tailscaleIp();
  const enriched = await enrichApp(app, ts);
  const open = enriched.status?.openUrl || "";
  const phone = enriched.status?.phoneUrl || "";
  const running = enriched.status?.running ? "running" : "stopped";
  const goal = app.goal || app.description || "(no goal)";
  const nextTask = app.nextTask || "Implement MVP according to acceptance criteria.";
  const siteStyle = app.siteStyle || app.design?.siteStyle || "—";
  const colorTheme = app.colorTheme || app.design?.colorTheme || "—";
  const primaryColor =
    app.primaryColor || app.design?.primaryColor || "—";
  const audience = app.audience || app.design?.audience || "—";

  if (mode === "prompt") {
    return buildAgentPrompt(app, {
      open,
      phone,
      running,
      goal,
      nextTask,
      siteStyle,
      colorTheme,
      primaryColor,
      audience,
    });
  }

  const lines = [];
  lines.push(`# AGENT HANDOFF: ${app.nameZh || app.name} (\`${app.id}\`)`);
  lines.push(``);
  lines.push(
    `> Exported from **Keith App Hub** · mode=\`${mode}\` · ${new Date().toISOString()}`
  );
  lines.push(``);
  lines.push(`## Goal`);
  lines.push(goal);
  lines.push(``);
  lines.push(`## Next task`);
  lines.push(nextTask);
  lines.push(``);
  lines.push(`## Active URLs`);
  lines.push(`| Kind | URL |`);
  lines.push(`|------|-----|`);
  lines.push(`| Local | ${open || "_none_"} |`);
  lines.push(`| Phone (Tailscale) | ${phone || "_none_"} |`);
  lines.push(`| Status | **${running}** |`);
  lines.push(``);
  lines.push(`## How to run`);
  lines.push("```bash");
  lines.push(`cd ${app.path}`);
  lines.push(app.startCmd || "# no startCmd");
  lines.push("```");
  lines.push(``);
  lines.push(`Open Grok in this project:`);
  lines.push("```bash");
  lines.push(`grok --cwd ${app.path}`);
  lines.push("```");
  lines.push(``);
  // Git section (Vibe Coding safety)
  try {
    const { getGitStatus, gitRulesMarkdown } = await import("./git-utils.js");
    const git = enriched.git || getGitStatus(app.path);
    lines.push(`## Git status`);
    lines.push(`- Repo: ${git.isRepo ? "yes" : "no"}`);
    lines.push(`- Branch: ${git.branch || "—"}`);
    lines.push(`- Commits: ${git.commitCount ?? 0}`);
    lines.push(
      `- Working tree: ${git.dirty ? `dirty (${git.dirtyCount})` : "clean"}`
    );
    lines.push(
      `- Last: ${git.lastCommit ? `\`${git.lastCommit}\` ${git.lastCommitSubject || ""}` : "—"}`
    );
    lines.push(`- Remote: ${git.remoteUrl || "none"}`);
    lines.push(
      `- Health: ${git.healthyScore ?? 0}/${git.healthyMax ?? 5}`
    );
    lines.push(``);
    lines.push(gitRulesMarkdown(app, git));
  } catch {
    lines.push(`## Git status`);
    lines.push(`- _(unavailable)_`);
    lines.push(``);
  }
  lines.push(`## Design constraints`);
  lines.push(`- siteStyle: **${siteStyle}**`);
  lines.push(`- colorTheme: **${colorTheme}**`);
  lines.push(`- primaryColor: **${primaryColor}**`);
  lines.push(`- audience: **${audience}**`);
  lines.push(`- Prefer matching design.json if present.`);
  lines.push(``);
  lines.push(`## Site map`);
  const routes = app.siteMapRoutes?.length
    ? app.siteMapRoutes
    : null;
  if (routes?.length) {
    lines.push(`| Path | Title |`);
    lines.push(`|------|-------|`);
    for (const r of routes) {
      lines.push(`| \`${r.path}\` | ${r.title || ""} |`);
    }
    lines.push(``);
    lines.push(`Summary: ${app.siteMapSummary || routes.map((r) => r.path).join(" · ")}`);
  } else if (app.siteMap) {
    lines.push(...linesToBullets(app.siteMap));
  } else {
    lines.push(`- \`/\` Home (default)`);
  }
  lines.push(``);
  lines.push(`Implement pages/routes from the site map; stub OK for MVP.`);
  lines.push(``);

  if (mode === "brief") {
    lines.push(`## In scope`);
    lines.push(...linesToBullets(app.inScope));
    lines.push(``);
    lines.push(`## Acceptance criteria`);
    lines.push(...linesToBullets(app.acceptance));
    lines.push(``);
    lines.push(`## Paths`);
    lines.push(`- root: \`${app.path}\``);
    lines.push(`- AGENT.md: \`${path.join(app.path, "AGENT.md")}\``);
    lines.push(`- SITE_MAP.md: \`${path.join(app.path, "SITE_MAP.md")}\``);
    lines.push(``);
    return lines.join("\n");
  }

  // full
  lines.push(`## Mission / description`);
  lines.push(app.description || goal);
  lines.push(``);
  lines.push(`## In scope (MVP)`);
  lines.push(...linesToBullets(app.inScope));
  lines.push(``);
  lines.push(`## Out of scope`);
  lines.push(...linesToBullets(app.outOfScope));
  lines.push(``);
  lines.push(`## Acceptance criteria`);
  lines.push(...linesToBullets(app.acceptance));
  lines.push(``);
  lines.push(`## Do not break`);
  lines.push(...linesToBullets(app.doNotBreak || "start/stop scripts; ports; existing env"));
  lines.push(``);
  lines.push(`## Definition of done`);
  lines.push(
    ...linesToBullets(
      app.definitionOfDone ||
        `All acceptance criteria pass\nApp starts with startCmd\nActive URL loads\nUpdate AGENT.md Last change section`
    )
  );
  lines.push(``);
  lines.push(`## Paths & registry`);
  lines.push(`| Key | Value |`);
  lines.push(`|-----|-------|`);
  lines.push(`| Project root | \`${app.path}\` |`);
  lines.push(`| Registry id | \`${app.id}\` |`);
  lines.push(`| Category | ${app.category || "—"} |`);
  lines.push(`| Lifecycle | ${app.lifecycle || "—"} |`);
  lines.push(`| Template | ${app.template || "—"} |`);
  lines.push(`| Priority | ${app.priority || "P1"} |`);
  if (app.referenceUrl) {
    lines.push(`| Reference URL | ${app.referenceUrl} |`);
  }
  lines.push(``);
  lines.push(`## Stack & ports (this local app)`);
  lines.push(`- **Stack:** ${app.stack || "—"}`);
  lines.push(`- **DB type:** ${app.dbType || "none"}`);
  lines.push(
    `- **Ports:** UI ${app.ports?.ui ?? "—"} · API ${app.ports?.api ?? "—"}`
  );
  lines.push(`- **Tags:** ${(app.tags || []).join(", ") || "—"}`);
  lines.push(``);
  lines.push(`## Reference website tech (for further development)`);
  if (app.techSummary || app.refTech || app.codingLanguage) {
    lines.push(
      `- **Coding language (detected/guess):** ${app.codingLanguage || app.refTech?.summary?.codingLanguage || "—"}`
    );
    lines.push(
      `- **Frameworks/CMS:** ${app.refFrameworks || app.refTech?.summary?.frameworks?.join?.(", ") || "—"}`
    );
    lines.push(
      `- **Database (guess):** ${app.refDatabase || app.refTech?.summary?.database || "—"}`
    );
    lines.push(
      `- **Server/CDN/Hosting:** ${app.refTech?.summary?.serverHosting || "—"}`
    );
    lines.push(
      `- **Analytics:** ${app.refTech?.summary?.analytics || "—"}`
    );
    if (app.refTech?.localRecommendation) {
      lines.push(
        `- **Recommended local language:** ${app.refTech.localRecommendation.language}`
      );
      lines.push(
        `- **Recommended local DB approach:** ${app.refTech.localRecommendation.database}`
      );
    }
    lines.push(``);
    lines.push(
      app.techSummary || app.refTech?.summaryText || ""
    );
    lines.push(``);
    lines.push(
      `See also \`TECH.md\` in project root. DB/backend guesses are often incomplete — verify before production.`
    );
  } else {
    lines.push(`- _(No reference tech analysis — re-run URL analyze or fill manually)_`);
  }
  lines.push(``);
  if (app.notes) {
    lines.push(`## Notes`);
    lines.push(app.notes);
    lines.push(``);
  }
  lines.push(`## Grok hint`);
  lines.push(app.grokHint || `Edit under ${app.path}`);
  lines.push(``);
  lines.push(`## Project tree (shallow)`);
  lines.push("```");
  lines.push(listTree(app.path, 3).slice(0, 80).join("\n") || "(empty)");
  lines.push("```");
  lines.push(``);
  lines.push(`## Registry snippet`);
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        id: app.id,
        path: app.path,
        goal: app.goal,
        nextTask: app.nextTask,
        ports: app.ports,
        design: app.design,
        startCmd: app.startCmd,
        stopCmd: app.stopCmd,
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push(``);
  lines.push(`## Last change`);
  lines.push(app.lastChange || `_(none yet — agent should append here)_`);
  lines.push(``);
  return lines.join("\n");
}

function buildAgentPrompt(app, ctx) {
  const lines = [];
  lines.push(`You are a coding agent working on Keith's local web app.`);
  lines.push(``);
  lines.push(`## App`);
  lines.push(`- Name: ${app.nameZh || app.name} (\`${app.id}\`)`);
  lines.push(`- Path: ${app.path}`);
  lines.push(`- Start: \`cd ${app.path} && ${app.startCmd || "./start.sh"}\``);
  lines.push(`- Grok cwd: \`grok --cwd ${app.path}\``);
  lines.push(`- Local URL: ${ctx.open || "set ports / start first"}`);
  lines.push(`- Phone URL: ${ctx.phone || "—"}`);
  lines.push(`- Status: ${ctx.running}`);
  lines.push(``);
  lines.push(`## Goal`);
  lines.push(ctx.goal);
  lines.push(``);
  lines.push(`## Next task (do this now)`);
  lines.push(ctx.nextTask);
  lines.push(``);
  lines.push(`## Design constraints (must follow)`);
  lines.push(`- Style: ${ctx.siteStyle}`);
  lines.push(`- Color theme: ${ctx.colorTheme}`);
  lines.push(`- Primary color: ${ctx.primaryColor}`);
  lines.push(`- Audience: ${ctx.audience}`);
  lines.push(`- Read design.json if present and keep UI consistent.`);
  lines.push(``);
  lines.push(`## Reference tech (planning only — do not blindly copy hosting stack)`);
  lines.push(
    `- Language guess: ${app.codingLanguage || app.refTech?.summary?.codingLanguage || "—"}`
  );
  lines.push(
    `- Frameworks/CMS: ${app.refFrameworks || "—"}`
  );
  lines.push(
    `- DB guess: ${app.refDatabase || "—"}`
  );
  lines.push(`- Prefer local template stack already scaffolded in this repo.`);
  lines.push(`- Read TECH.md for evidence table.`);
  lines.push(``);
  lines.push(`## Site map (implement these routes/pages)`);
  const routes = app.siteMapRoutes?.length
    ? app.siteMapRoutes
    : [{ path: "/", title: "Home" }];
  for (const r of routes) {
    lines.push(`- \`${r.path}\` — ${r.title || ""}`);
  }
  lines.push(``);
  lines.push(`## In scope`);
  lines.push(...linesToBullets(app.inScope));
  lines.push(``);
  lines.push(`## Out of scope (do NOT do)`);
  lines.push(...linesToBullets(app.outOfScope));
  lines.push(``);
  lines.push(`## Acceptance criteria`);
  lines.push(...linesToBullets(app.acceptance));
  lines.push(``);
  lines.push(`## Rules`);
  lines.push(`- Keep start.sh / stop.sh working.`);
  lines.push(`- Do not change ports without updating App Hub registry.`);
  lines.push(`- Follow site map; stub missing pages rather than inventing unrelated routes.`);
  lines.push(`- Prefer minimal diffs.`);
  lines.push(`- Git: commit a snapshot before large refactors; do not force-push main.`);
  lines.push(`- When done: list files changed, how to verify, update AGENT.md Last change.`);
  lines.push(``);
  lines.push(`## Reference`);
  if (app.referenceUrl) lines.push(`- Inspired by: ${app.referenceUrl}`);
  lines.push(`- Full brief: ${path.join(app.path, "AGENT.md")}`);
  lines.push(`- Site map file: ${path.join(app.path, "SITE_MAP.md")}`);
  lines.push(``);
  lines.push(`Implement the next task now.`);
  return lines.join("\n");
}

export async function exportAppToFile(app, opts = {}) {
  const mode = opts.mode || "full";
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const md = await buildAppExportMarkdown(app, { ...opts, mode });
  const suffix =
    mode === "brief" ? ".brief.md" : mode === "prompt" ? ".prompt.md" : ".agent.md";
  const fileName = `${app.id}${suffix}`;
  const outPath = path.join(EXPORT_DIR, fileName);
  fs.writeFileSync(outPath, md, "utf8");

  let projectAgent = null;
  if (mode === "full" && app.path && fs.existsSync(app.path)) {
    projectAgent = path.join(app.path, "AGENT.md");
    try {
      fs.writeFileSync(projectAgent, md, "utf8");
    } catch {
      projectAgent = null;
    }
  }
  // always write prompt helper into project when possible
  let projectPrompt = null;
  if (app.path && fs.existsSync(app.path)) {
    try {
      const promptMd = await buildAppExportMarkdown(app, {
        ...opts,
        mode: "prompt",
      });
      projectPrompt = path.join(app.path, "AGENT_PROMPT.md");
      fs.writeFileSync(projectPrompt, promptMd, "utf8");
    } catch {
      projectPrompt = null;
    }
  }

  return {
    markdown: md,
    mode,
    exportPath: outPath,
    projectAgentPath: projectAgent,
    projectPromptPath: projectPrompt,
  };
}

export async function exportAllApps(opts = {}) {
  const reg = readRegistry();
  const ts = tailscaleIp();
  const parts = [
    `# Keith App Hub — all apps export`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    `Apps root: \`${APPS_ROOT}\``,
    ``,
  ];
  const files = [];
  for (const app of reg.apps) {
    const result = await exportAppToFile(app, {
      tailscaleIp: ts,
      mode: opts.mode || "full",
    });
    files.push({
      id: app.id,
      exportPath: result.exportPath,
      projectAgentPath: result.projectAgentPath,
    });
    parts.push(`---`);
    parts.push(``);
    parts.push(result.markdown);
    parts.push(``);
  }
  const allPath = path.join(EXPORT_DIR, `_all-apps.agent.md`);
  fs.writeFileSync(allPath, parts.join("\n"), "utf8");
  return { allPath, files };
}

/** Clipboard-friendly one-liner pack for agents */
export function buildCopyHints(app, enriched) {
  return {
    cwd: `grok --cwd ${app.path}`,
    start: `cd ${app.path} && ${app.startCmd || "./start.sh"}`,
    openUrl: enriched?.status?.openUrl || "",
    exportFull: path.join(EXPORT_DIR, `${app.id}.agent.md`),
    agentMd: path.join(app.path, "AGENT.md"),
    promptMd: path.join(app.path, "AGENT_PROMPT.md"),
  };
}
