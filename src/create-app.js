import fs from "node:fs";
import path from "node:path";
import {
  APPS_ROOT,
  nextPorts,
  readRegistry,
  slugify,
  writeRegistry,
} from "./lib.js";
import { getTemplateMeta } from "./templates-meta.js";
import { exportAppToFile } from "./export-md.js";
import {
  parseSiteMapText,
  siteMapToText,
  siteMapSummary,
  defaultSiteMapForTemplate,
} from "./site-map.js";
import { ensureGitRepo } from "./git-utils.js";

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function renderTemplate(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : ""
  );
}

function walkReplace(dir, vars) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkReplace(p, vars);
    else {
      // skip binary-ish / node_modules never in templates
      const base = path.basename(p);
      if (base === "package-lock.json") continue;
      try {
        const text = fs.readFileSync(p, "utf8");
        if (text.includes("{{")) {
          fs.writeFileSync(p, renderTemplate(text, vars), "utf8");
        }
      } catch {
        // binary skip
      }
    }
  }
}

/**
 * Create a new app from template.
 * @param {{
 *  name: string,
 *  nameZh?: string,
 *  category?: string,
 *  template?: string,
 *  description?: string,
 *  tags?: string[]|string,
 *  notes?: string,
 *  lifecycle?: string,
 *  referenceUrl?: string,
 *  siteStyle?: string,
 *  colorTheme?: string,
 *  audience?: string,
 *  primaryColor?: string,
 *  goal?: string,
 *  inScope?: string,
 *  outOfScope?: string,
 *  acceptance?: string,
 *  nextTask?: string,
 *  priority?: string,
 *  doNotBreak?: string,
 *  definitionOfDone?: string,
 *  siteMap?: string|array,
 *  refTech?: object,
 *  techSummary?: string,
 *  codingLanguage?: string,
 *  refDatabase?: string,
 *  refFrameworks?: string
 * }} opts
 */
export function createApp(opts) {
  const reg = readRegistry();
  const name = opts.name?.trim();
  if (!name) throw new Error("需要 name");

  const id = slugify(opts.id || name);
  if (reg.apps.some((a) => a.id === id)) {
    throw new Error(`id 已存在：${id}`);
  }

  const category = opts.category === "daily" ? "daily" : "trial";
  const template = opts.template || "react-trial";
  const meta = getTemplateMeta(template);
  if (!meta) {
    throw new Error(`未知 template：${template}`);
  }
  const templateDir = path.join(APPS_ROOT, "templates", template);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`搵唔到 template 目錄：${template}`);
  }

  const ports = nextPorts(reg);
  const appPath = path.join(
    APPS_ROOT,
    category === "daily" ? "daily" : "trials",
    id
  );
  if (fs.existsSync(appPath)) {
    throw new Error(`目錄已存在：${appPath}`);
  }

  copyDir(templateDir, appPath);

  const vars = {
    APP_ID: id,
    APP_NAME: name,
    APP_NAME_ZH: opts.nameZh || name,
    APP_DESCRIPTION: opts.description || `${name} — created by App Hub`,
    PORT_UI: String(ports.ui),
    PORT_API: String(ports.api),
    PORT_DB: String(ports.db),
    CREATED_AT: new Date().toISOString().slice(0, 10),
  };
  walkReplace(appPath, vars);

  for (const s of ["start.sh", "stop.sh"]) {
    const f = path.join(appPath, s);
    if (fs.existsSync(f)) fs.chmodSync(f, 0o755);
  }

  let tags = [];
  if (Array.isArray(opts.tags)) tags = opts.tags.map(String);
  else if (typeof opts.tags === "string" && opts.tags.trim()) {
    tags = opts.tags.split(/[,，\s]+/).filter(Boolean);
  }
  tags = [
    ...new Set([category, template, "app-hub", meta.hasDb ? "database" : null, ...tags].filter(Boolean)),
  ];

  const goal =
    (opts.goal || "").trim() ||
    (opts.description || "").trim() ||
    `${opts.nameZh || name} MVP`;
  const nextTask =
    (opts.nextTask || "").trim() ||
    "Scaffold UI to match design constraints; implement first acceptance criterion.";
  const inScope =
    (opts.inScope || "").trim() ||
    "Core happy-path UI\nBasic data flow if template has DB\nMatch siteStyle / color / audience";
  const outOfScope =
    (opts.outOfScope || "").trim() ||
    "Auth / payments\nPublic cloud deploy\nComplex multi-user roles";
  const acceptance =
    (opts.acceptance || "").trim() ||
    "App starts with ./start.sh\nActive URL loads without console errors\nPrimary UI matches chosen style/color/audience at a glance\nSite map primary routes reachable or stubbed\nAGENT.md exists and is up to date";

  let siteMapRoutes = [];
  if (Array.isArray(opts.siteMapRoutes) && opts.siteMapRoutes.length) {
    siteMapRoutes = opts.siteMapRoutes;
  } else if (opts.siteMap) {
    siteMapRoutes = parseSiteMapText(opts.siteMap);
  }
  if (!siteMapRoutes.length) {
    siteMapRoutes = defaultSiteMapForTemplate(template);
  }
  const siteMapText = siteMapToText(siteMapRoutes);

  const app = {
    id,
    name,
    nameZh: opts.nameZh || name,
    path: appPath,
    category,
    lifecycle:
      opts.lifecycle || (category === "daily" ? "active" : "trial"),
    description: opts.description || goal,
    goal,
    inScope,
    outOfScope,
    acceptance,
    nextTask,
    priority: opts.priority || "P1",
    doNotBreak:
      opts.doNotBreak ||
      "start.sh / stop.sh\nAssigned ports\nApp Hub registry fields",
    definitionOfDone:
      opts.definitionOfDone ||
      "Acceptance criteria all pass\nSmoke open local URL\nUpdate AGENT.md Last change",
    stack: meta.stack,
    dbType: meta.dbType,
    tags,
    ports:
      template === "fullstack-db"
        ? { ui: ports.ui, api: ports.api }
        : template === "api-json"
          ? { ui: ports.ui, api: ports.ui }
          : { ui: ports.ui, api: null },
    startCmd: "./start.sh",
    stopCmd: "./stop.sh",
    openPath: "/",
    createdAt: vars.CREATED_AT,
    updatedAt: vars.CREATED_AT,
    lastChange: `Created via App Hub ${vars.CREATED_AT}`,
    notes:
      opts.notes ||
      "由 App Hub 建立。用 Grok：`grok --cwd <path>`。讀 AGENT.md / AGENT_PROMPT.md。",
    referenceUrl: opts.referenceUrl || null,
    siteStyle: opts.siteStyle || null,
    colorTheme: opts.colorTheme || null,
    audience: opts.audience || null,
    primaryColor: opts.primaryColor || null,
    siteMap: siteMapText,
    siteMapRoutes,
    siteMapSummary: siteMapSummary(siteMapRoutes),
    refTech: opts.refTech || null,
    techSummary: opts.techSummary || opts.refTech?.summaryText || null,
    codingLanguage: opts.codingLanguage || opts.refTech?.summary?.codingLanguage || null,
    refDatabase: opts.refDatabase || opts.refTech?.summary?.database || null,
    refFrameworks: opts.refFrameworks || opts.refTech?.summary?.frameworks?.join?.(", ") || null,
    design: {
      siteStyle: opts.siteStyle || null,
      colorTheme: opts.colorTheme || null,
      audience: opts.audience || null,
      primaryColor: opts.primaryColor || null,
      density:
        opts.audience === "seniors" || opts.audience === "kids"
          ? "comfortable"
          : "default",
      fontScale:
        opts.audience === "seniors" ? 1.15 : opts.audience === "kids" ? 1.1 : 1,
      siteMap: siteMapRoutes,
    },
    grokHint: [
      `Open ${appPath}. Template ${template} (${meta.stack}).`,
      `UI :${ports.ui}${template === "fullstack-db" ? ` API :${ports.api}` : ""}.`,
      meta.hasDb ? "Data under data/ or server/data/." : "",
      `Goal: ${goal}.`,
      `Next: ${nextTask}.`,
      `Site map: ${siteMapSummary(siteMapRoutes) || "/"}.`,
      opts.siteStyle ? `Style: ${opts.siteStyle}.` : "",
      opts.colorTheme
        ? `Color: ${opts.colorTheme}${opts.primaryColor ? ` (${opts.primaryColor})` : ""}.`
        : "",
      opts.audience ? `Audience: ${opts.audience}.` : "",
      opts.referenceUrl ? `Inspired by ${opts.referenceUrl}.` : "",
      "Read AGENT.md, design.json (incl. siteMap), and SITE_MAP.md first.",
    ]
      .filter(Boolean)
      .join(" "),
    template,
    briefVersion: 1,
  };

  // design tokens for coding agents
  try {
    fs.writeFileSync(
      path.join(appPath, "design.json"),
      JSON.stringify(
        {
          appId: id,
          siteStyle: app.design.siteStyle,
          colorTheme: app.design.colorTheme,
          primaryColor: app.design.primaryColor,
          audience: app.design.audience,
          density: app.design.density,
          fontScale: app.design.fontScale,
          siteMap: siteMapRoutes,
          goal,
          nextTask,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n"
    );
  } catch {}

  // SITE_MAP.md for agents
  try {
    fs.writeFileSync(
      path.join(appPath, "SITE_MAP.md"),
      [
        `# Site map: ${app.nameZh || name}`,
        ``,
        `| Path | Title |`,
        `|------|-------|`,
        ...siteMapRoutes.map((r) => `| \`${r.path}\` | ${r.title || ""} |`),
        ``,
        `## Text form`,
        "```",
        siteMapText,
        "```",
        ``,
        `Implement routes/pages according to this map. Stub pages are OK for MVP.`,
        ``,
      ].join("\n")
    );
  } catch {}

  // TECH.md — reference site technical analysis for further development
  try {
    const tech = opts.refTech;
    const lines = [
      `# Reference tech analysis: ${app.nameZh || name}`,
      ``,
      app.referenceUrl ? `Source: ${app.referenceUrl}` : null,
      ``,
      `## Summary`,
      app.techSummary || tech?.summaryText || "_(no tech analysis — added manually)_",
      ``,
      `## For local rebuild (App Hub)`,
      `- Coding language (detected/guess): ${app.codingLanguage || "—"}`,
      `- Frameworks/CMS: ${app.refFrameworks || "—"}`,
      `- Database (guess): ${app.refDatabase || "—"}`,
      `- Local template used: ${template}`,
      `- Local stack: ${meta.stack}`,
      tech?.localRecommendation
        ? `- Recommended local language: ${tech.localRecommendation.language}`
        : null,
      tech?.localRecommendation
        ? `- Recommended local DB path: ${tech.localRecommendation.database}`
        : null,
      ``,
      `## Evidence (fingerprints)`,
    ].filter((x) => x !== null);

    if (tech?.allHits?.length) {
      lines.push(`| Tech | Category | Confidence | Evidence |`);
      lines.push(`|------|----------|------------|----------|`);
      for (const h of tech.allHits.slice(0, 15)) {
        lines.push(
          `| ${h.label} | ${h.category} | ${h.confidence} | ${(h.evidence || []).join(", ")} |`
        );
      }
    } else {
      lines.push(`_(none)_`);
    }
    lines.push(``);
    lines.push(`## Caution`);
    lines.push(
      tech?.confidenceNote ||
        "Public pages rarely expose real production databases. Use this as planning input only."
    );
    lines.push(``);
    if (tech?.localRecommendation?.notes?.length) {
      lines.push(`## Rebuild notes`);
      for (const n of tech.localRecommendation.notes) lines.push(`- ${n}`);
      lines.push(``);
    }
    fs.writeFileSync(path.join(appPath, "TECH.md"), lines.join("\n"));
  } catch {}

  // TASKS checklist for humans/agents
  try {
    fs.writeFileSync(
      path.join(appPath, "TASKS.md"),
      [
        `# Tasks: ${app.nameZh || name}`,
        ``,
        `## Goal`,
        goal,
        ``,
        `## Next`,
        `- [ ] ${nextTask}`,
        ``,
        `## Site map pages`,
        ...siteMapRoutes.map(
          (r) => `- [ ] \`${r.path}\` ${r.title || ""}`.trim()
        ),
        ``,
        `## In scope`,
        ...inScope.split(/\r?\n/).filter(Boolean).map((l) => `- [ ] ${l.replace(/^[-*]\s*/, "")}`),
        ``,
        `## Acceptance`,
        ...acceptance.split(/\r?\n/).filter(Boolean).map((l) => `- [ ] ${l.replace(/^[-*]\s*/, "")}`),
        ``,
      ].join("\n")
    );
  } catch {}

  reg.apps.push(app);
  writeRegistry(reg);

  try {
    fs.appendFileSync(
      path.join(APPS_ROOT, "ports.md"),
      `| ${id} | ${category} | ${app.ports.ui ?? "—"} | ${app.ports.api ?? "—"} | ${app.dbType || "—"} | ${template} |\n`
    );
  } catch {}

  // A: auto git init + initial commit (Vibe Coding safety net)
  try {
    app.gitInit = ensureGitRepo(appPath, {
      message: `chore: initial scaffold ${id} from App Hub`,
    });
  } catch (e) {
    app.gitInit = { ok: false, error: String(e.message || e) };
  }

  return app;
}

/** async wrapper used by API so export completes */
export async function createAppAsync(opts) {
  const app = createApp(opts);
  try {
    const exp = await exportAppToFile(app, { mode: "full" });
    app._export = {
      exportPath: exp.exportPath,
      projectAgentPath: exp.projectAgentPath,
      projectPromptPath: exp.projectPromptPath,
    };
  } catch (e) {
    app._export = { error: String(e.message || e) };
  }
  return app;
}
