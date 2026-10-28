import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ensureDirs,
  readRegistry,
  writeRegistry,
  enrichApp,
  startAppProcess,
  stopAppProcess,
  tailscaleIp,
  summaryText,
  destroyApp,
  canDeleteAppFiles,
  getHubUi,
  pinAppToDropdownTop,
  pinAppToBottom,
  unpinAppFromBottom,
  sortAppsByDropdownTop,
  sortAppsByOrder,
  setCustomOrder,
  resetCustomOrder,
  APPS_ROOT,
  LOG_DIR,
} from "./lib.js";
import { createApp, createAppAsync } from "./create-app.js";
import { TEMPLATES } from "./templates-meta.js";
import {
  buildAppExportMarkdown,
  exportAppToFile,
  exportAllApps,
  EXPORT_DIR,
} from "./export-md.js";
import { analyzeWebPage } from "./analyze-url.js";
import {
  getGitStatus,
  ensureGitRepo,
  gitCommitSnapshot,
  pushToGitHub,
} from "./git-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");

ensureDirs();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function findApp(id) {
  const reg = readRegistry();
  const item = reg.apps.find((a) => a.id === id);
  if (!item) throw new Error(`搵唔到 app：${id}`);
  return { reg, app: item };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "keith-app-hub",
    appsRoot: APPS_ROOT,
    time: new Date().toISOString(),
  });
});

app.get("/api/apps", async (_req, res) => {
  try {
    const reg = readRegistry();
    const ts = tailscaleIp();
    const hubUi = getHubUi(reg);
    let apps = await Promise.all(reg.apps.map((a) => enrichApp(a, ts)));
    apps = sortAppsByOrder(apps, hubUi);
    res.json({
      hub: reg.hub,
      hubUi,
      updatedAt: reg.updatedAt,
      tailscaleIp: ts,
      apps,
      counts: {
        total: apps.length,
        daily: apps.filter((a) => a.category === "daily").length,
        trial: apps.filter((a) => a.category === "trial").length,
        running: apps.filter((a) => a.status.running).length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Pin a card to the top of the hub dropdown / preferred list order */
app.post("/api/hub/pin-top", (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) throw new Error("需要 id");
    const { hubUi, pinnedId } = pinAppToDropdownTop(id);
    res.json({
      ok: true,
      pinnedId,
      hubUi,
      message: `已置頂「${pinnedId}」到下拉清單頂部`,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 置底：將卡排喺全部 app 最尾（Keith 2026-10-26） */
app.post("/api/hub/pin-bottom", (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) throw new Error("需要 id");
    const { hubUi, pinnedId } = pinAppToBottom(id);
    res.json({
      ok: true,
      pinnedId,
      hubUi,
      message: `已置底「${pinnedId}」到清單最後`,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 取消置底 */
app.post("/api/hub/unpin-bottom", (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) throw new Error("需要 id");
    const { hubUi, pinnedId } = unpinAppFromBottom(id);
    res.json({
      ok: true,
      pinnedId,
      hubUi,
      message: `已取消置底「${pinnedId}」`,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 儲存自訂全序（Keith 2026-10-26：menu 次序自由調整） */
app.post("/api/hub/order", (req, res) => {
  try {
    const order = req.body?.order;
    if (!Array.isArray(order)) throw new Error("需要 order array");
    const { hubUi, customOrder } = setCustomOrder(order);
    res.json({
      ok: true,
      hubUi,
      customOrder,
      message: `已儲存自訂次序（${customOrder.length} 張卡）`,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** 還原置頂模式 */
app.post("/api/hub/order/reset", (_req, res) => {
  try {
    const { hubUi } = resetCustomOrder();
    res.json({
      ok: true,
      hubUi,
      message: "已還原成「置頂優先 + 註冊次序」",
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/summary", async (_req, res) => {
  try {
    const reg = readRegistry();
    const ts = tailscaleIp();
    const apps = await Promise.all(
      reg.apps.map((a) => enrichApp(a, ts))
    );
    const markdown = summaryText(apps);
    res.type("text/markdown").send(markdown);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/apps/:id/start", async (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const enriched = await enrichApp(item, tailscaleIp());
    if (enriched.status.running) {
      return res.json({
        ok: true,
        already: true,
        message: "已經喺度跑",
        status: enriched.status,
      });
    }
    const result = startAppProcess(item);
    res.json({
      ok: true,
      message: "已啟動（等幾秒再 Open）",
      ...result,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/apps/:id/stop", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const results = stopAppProcess(item);
    res.json({ ok: true, message: "已送出停止", results });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/templates", (_req, res) => {
  res.json({ templates: TEMPLATES });
});

/** Git status for one app */
app.get("/api/apps/:id/git", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    res.json({ ok: true, id: item.id, git: getGitStatus(item.path) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Init git if missing */
app.post("/api/apps/:id/git/init", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const result = ensureGitRepo(item.path, {
      message: req.body?.message || `chore: init ${item.id} from App Hub`,
    });
    res.json({ ok: !!result.ok, ...result });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Snapshot commit */
app.post("/api/apps/:id/git/commit", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const message =
      req.body?.message ||
      item.nextTask ||
      `chore: snapshot ${item.id}`;
    const result = gitCommitSnapshot(item.path, message);
    res.json({ ok: !!result.ok, ...result });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Optional push to GitHub via gh */
app.post("/api/apps/:id/git/push", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const result = pushToGitHub(item.path, {
      name: req.body?.name || item.id,
      privateRepo: req.body?.private !== false,
    });
    res.json({ ok: !!result.ok, ...result });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/**
 * Analyze a webpage URL and suggest fields for new app form.
 * Body: { url: "https://..." }
 */
app.post("/api/analyze-url", async (req, res) => {
  try {
    const url = req.body?.url;
    if (!url || !String(url).trim()) {
      return res.status(400).json({ error: "請提供 url" });
    }
    const result = await analyzeWebPage(url);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/apps", async (req, res) => {
  try {
    const created = await createAppAsync(req.body || {});
    const exportInfo = created._export || null;
    delete created._export;
    res.status(201).json({
      ok: true,
      app: created,
      export: exportInfo,
      hints: {
        cwd: `grok --cwd ${created.path}`,
        start: `cd ${created.path} && ${created.startCmd || "./start.sh"}`,
        agentMd: `${created.path}/AGENT.md`,
        promptMd: `${created.path}/AGENT_PROMPT.md`,
      },
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Markdown export for other agents (download) ?mode=full|brief|prompt */
app.get("/api/apps/:id/export.md", async (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const mode = ["brief", "full", "prompt"].includes(req.query.mode)
      ? req.query.mode
      : "full";
    const md = await buildAppExportMarkdown(item, { mode });
    const suffix =
      mode === "brief" ? ".brief.md" : mode === "prompt" ? ".prompt.md" : ".agent.md";
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${item.id}${suffix}"`
    );
    res.type("text/markdown").send(md);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Write MD to ~/apps/_meta/exports and project AGENT.md */
app.post("/api/apps/:id/export", async (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const mode = ["brief", "full", "prompt"].includes(req.body?.mode)
      ? req.body.mode
      : "full";
    const result = await exportAppToFile(item, { mode });
    res.json({
      ok: true,
      message: `已匯出 Markdown（${mode}）畀其他 agent`,
      ...result,
      exportDir: EXPORT_DIR,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/** Get ready-to-paste agent prompt text */
app.get("/api/apps/:id/prompt", async (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const md = await buildAppExportMarkdown(item, { mode: "prompt" });
    res.json({
      ok: true,
      prompt: md,
      cwd: `grok --cwd ${item.path}`,
      path: item.path,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post("/api/export-all", async (_req, res) => {
  try {
    const result = await exportAllApps();
    res.json({
      ok: true,
      message: "已匯出全部 app",
      ...result,
      exportDir: EXPORT_DIR,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.patch("/api/apps/:id", async (req, res) => {
  try {
    const { reg, app: item } = findApp(req.params.id);
    const allowed = [
      "name",
      "nameZh",
      "description",
      "category",
      "lifecycle",
      "notes",
      "tags",
      "startCmd",
      "stopCmd",
      "openPath",
      "grokHint",
      "stack",
      "siteStyle",
      "colorTheme",
      "audience",
      "primaryColor",
      "referenceUrl",
      "goal",
      "inScope",
      "outOfScope",
      "acceptance",
      "nextTask",
      "priority",
      "doNotBreak",
      "definitionOfDone",
      "lastChange",
      "siteMap",
      "siteMapRoutes",
      "refTech",
      "techSummary",
      "codingLanguage",
      "refDatabase",
      "refFrameworks",
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) item[k] = req.body[k];
    }
    // re-parse site map text if provided as string
    if (typeof req.body?.siteMap === "string") {
      const { parseSiteMapText, siteMapToText, siteMapSummary } =
        await import("./site-map.js");
      item.siteMapRoutes = parseSiteMapText(req.body.siteMap);
      item.siteMap = siteMapToText(item.siteMapRoutes);
      item.siteMapSummary = siteMapSummary(item.siteMapRoutes);
    } else if (Array.isArray(req.body?.siteMapRoutes)) {
      item.siteMapRoutes = req.body.siteMapRoutes;
      const { siteMapToText, siteMapSummary } = await import("./site-map.js");
      item.siteMap = siteMapToText(item.siteMapRoutes);
      item.siteMapSummary = siteMapSummary(item.siteMapRoutes);
    }
    item.design = {
      siteStyle: item.siteStyle || null,
      colorTheme: item.colorTheme || null,
      audience: item.audience || null,
      primaryColor: item.primaryColor || null,
      density: item.design?.density || null,
      fontScale: item.design?.fontScale || null,
      siteMap: item.siteMapRoutes || item.design?.siteMap || null,
    };
    item.briefVersion = (item.briefVersion || 1) + 1;
    item.updatedAt = new Date().toISOString().slice(0, 10);
    writeRegistry(reg);
    res.json({ ok: true, app: item });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/apps/:id/log", (req, res) => {
  try {
    const logFile = path.join(LOG_DIR, `${req.params.id}.log`);
    if (!fs.existsSync(logFile)) {
      return res.type("text/plain").send("(未有 log)");
    }
    const text = fs.readFileSync(logFile, "utf8");
    const tail = text.slice(-12000);
    res.type("text/plain").send(tail);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Preview whether full delete is allowed */
app.get("/api/apps/:id/delete-check", (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    const check = canDeleteAppFiles(item);
    res.json({
      id: item.id,
      path: item.path,
      canDeleteFiles: check.ok,
      reason: check.reason || null,
      resolved: check.resolved || null,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

/**
 * Remove card and/or delete files.
 * Body: { mode: "unregister"|"delete", confirmId: "<id>" }
 * - unregister: 只喺 Hub 移除卡片，保留 code
 * - delete: 停服務 + 移除卡片 + 刪除整個資料夾（code+data）
 */
app.delete("/api/apps/:id", (req, res) => {
  try {
    const id = req.params.id;
    const mode = req.body?.mode === "delete" ? "delete" : "unregister";
    const confirmId = String(req.body?.confirmId || "");
    if (confirmId !== id) {
      return res.status(400).json({
        error: "確認失敗：confirmId 必須等於 app id",
      });
    }
    if (mode === "delete" && req.body?.confirmPhrase !== "DELETE") {
      return res.status(400).json({
        error: '完整刪除需要 confirmPhrase 為 "DELETE"',
      });
    }
    const result = destroyApp(id, mode);
    res.json({
      ok: true,
      message:
        mode === "delete"
          ? "已刪除 app 卡片、code 同 data"
          : "已從 Hub 移除卡片（code 仍保留）",
      result,
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

const reg = readRegistry();
const PORT = Number(process.env.HUB_PORT || reg.hub?.port || 7890);
const HOST = process.env.HUB_HOST || "0.0.0.0";

app.listen(PORT, HOST, () => {
  const ts = tailscaleIp();
  console.log(`[app-hub] http://127.0.0.1:${PORT}`);
  if (ts) console.log(`[app-hub] phone: http://${ts}:${PORT}`);
  console.log(`[app-hub] apps root: ${APPS_ROOT}`);
});
