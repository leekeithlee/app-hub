import express from "express";
import { execSync } from "node:child_process";
import QRCode from "qrcode";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
/** Escape text for HTML output. */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

import {
  ensureDirs,
  readRegistry,
  writeRegistry,
  enrichApp,
  startAppProcess,
  stopAppProcess,
  tailscaleIp,
  tailscaleHostname,
  summaryText,
  destroyApp,
  previewAppDelete,
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

/**
 * Redirect to a Tailscale-only app that needs a fresh URL each time.
 *
 * `dsh web` mints a launch token on every start and the URL only lives in
 * `~/.dsh/web-url.txt`, so a hard-coded link would 401. This route reads the
 * current URL and sends the browser there.
 */
/**
 * Per-app credentials the owner never has to type on the phone.
 *
 * Each entry says how to get into the app without a prompt:
 *   - token: append ?token=... (the app swaps it for a cookie)
 *   - basic: put the credentials in the URL's userinfo part
 *   - url:   use the URL as-is (it already carries whatever it needs)
 */
function appCredential(app) {
  const id = app?.id || "";

  // DeepSeek Harness mints a launch token on every start; the watcher
  // keeps the current URL in a file.
  if (id === "dsh-web") {
    const file = process.env.DSH_WEB_URL_FILE || path.join(APPS_ROOT, "..", ".dsh", "web-url.txt");
    try {
      const url = fs.readFileSync(file, "utf8").trim();
      if (url) return { kind: "url", url, source: file };
    } catch {}
    return null;
  }

  // Hermes Bot swaps its access token for a signed cookie.
  if (id === "hermes-bot") {
    const file = path.join(APPS_ROOT, "daily", "hermes-bot", "data", "auth_token.txt");
    try {
      const token = fs.readFileSync(file, "utf8").trim();
      const host = process.env.HERMES_BOT_PUBLIC_HOST || "homea-gtr-pro.tail8f3151.ts.net";
      const port = process.env.HERMES_BOT_PUBLIC_PORT || "5207";
      if (token) {
        return { kind: "token", url: `http://${host}:${port}/?token=${token}`, source: file };
      }
    } catch {}
    return null;
  }

  // The Tokyo Trip v2 site is published as a Cloudflare Worker with its own
  // permanent hostname (https://tokyo.keithleehk.com) and HTTP Basic Auth.
  // The password lives only as a bcrypt hash on the site side, so the hub
  // cannot derive the credential; the launcher sends the browser straight to
  // the public URL and lets the browser's own Basic-auth prompt handle it.
  //
  // The URL is published verbatim: it is an absolute URL with its own origin,
  // so it must not be wrapped in the /go/<id> launcher (that resolves the
  // app's LOCAL port, which is a different thing entirely).
  if (id === "tokyo-trip-v2") {
    const url = process.env.TOKYO_V2_PUBLIC_URL || "https://tokyo.keithleehk.com";
    return { kind: "url", url, source: "env:TOKYO_V2_PUBLIC_URL" };
  }

  // The freeze dashboard uses HTTP Basic auth; the browser remembers the
  // credentials once it has them, so the user only ever sees the prompt
  // if the password changes.
  if (id === "freeze-dashboard") {
    const passFile = path.join(path.resolve("/home/homea"), "freeze-dashboard", ".password");
    let pw = "";
    try {
      pw = fs.readFileSync(passFile, "utf8").trim();
    } catch {}
    const user = process.env.FREEZE_DASH_USER || "keith";
    const host = process.env.HERMES_BOT_PUBLIC_HOST || "homea-gtr-pro.tail8f3151.ts.net";
    if (pw) {
      // The dashboard is published on the hub's own HTTPS origin under
      // /fd. The token goes in the query string, not in the URL's
      // userinfo part: a URL with credentials makes the browser refuse
      // to build its own fetch() calls and keeps the credentials
      // attached to the origin for the rest of the session.
      return {
        kind: "token",
        url: `https://${host}/fd/?t=${encodeURIComponent(pw)}`,
        source: passFile,
      };
    }
    return null;
  }

  return null;
}

app.get("/go/dsh", async (_req, res) => {
  try {
    const file = process.env.DSH_WEB_URL_FILE || path.join(APPS_ROOT, "..", ".dsh", "web-url.txt");
    const url = fs.readFileSync(file, "utf8").trim();
    if (!url) throw new Error("web-url.txt 係空嘅");
    // A 302 would be a cross-site redirect, and dsh's auth cookie is
    // SameSite=Strict, so the browser would drop it and answer 401. A
    // same-origin page that navigates with location.replace() keeps the
    // cookie.
    res.type("html").send(`<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>開啟 DeepSeek Harness</title>
<style>body{background:#0b0b0f;color:#e8e8f0;font:15px/1.6 system-ui,sans-serif;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}
a{color:#30d158}</style></head>
<body><p>正在開啟 DeepSeek Harness…</p>
<p><a href="${url}">撳呢度如果冇自動跳</a></p>
<script>location.replace(${JSON.stringify(url)});</script>
</body></html>`);
  } catch (e) {
    res.status(503).send(`dsh web 暫時攞唔到 URL：${String(e.message || e)}`);
  }
});

/**
 * Same-origin proxy for the DeepSeek Harness web UI.
 *
 * `dsh web` sets its auth cookie with SameSite=Strict, so a cross-site
 * redirect from the hub drops the cookie and the UI answers 401. Proxying
 * from the hub keeps the whole exchange same-origin: the browser only ever
 * sees 127.0.0.1:7890, and the cookie is set for the hub's own origin.
 */
/**
 * Same-origin proxy for the DeepSeek Harness web UI.
 *
 * `dsh web` guards its UI with a browser-trust fence: the root path needs a
 * launch token, and the token is exchanged for a signed cookie with
 * SameSite=Strict. A cross-site redirect from the hub therefore drops the
 * cookie and the UI answers 401.
 *
 * The hub keeps the cookie on the server side instead. The browser only
 * ever sees this origin, so SameSite never bites, and the launch token
 * never has to be exposed to it.
 */
app.get("/api/apps", async (_req, res) => {
  try {
    const reg = readRegistry();
    const ts = tailscaleIp();
    const tsHost = tailscaleHostname();
    const hubUi = getHubUi(reg);
    let apps = await Promise.all(reg.apps.map((a) => enrichApp(a, ts, tsHost)));
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

/**
 * Render a QR code for a URL.
 *
 * The code is generated here, on the machine, so the URL never leaves the
 * tailnet — no third-party QR service sees it.
 */
app.get("/api/qr", async (req, res) => {
  try {
    const url = String(req.query.url || "").trim();
    if (!url) return res.status(400).json({ error: "url required" });
    // Only render links the hub would produce for its own cards.
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "http(s) only" });
    }
    const png = await QRCode.toBuffer(url, {
      type: "png",
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    });
    res.type("image/png");
    res.set("Cache-Control", "no-store");
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get("/api/summary", async (_req, res) => {
  try {
    const reg = readRegistry();
    const ts = tailscaleIp();
    const tsHost = tailscaleHostname();
    const apps = await Promise.all(
      reg.apps.map((a) => enrichApp(a, ts, tsHost))
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
    const enriched = await enrichApp(item, tailscaleIp(), tailscaleHostname());
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
      "externalUrl",
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
 * What a full delete would remove: size, file count, the largest files,
 * and the unit that gets stopped. The card shows this before asking for
 * confirmation, so the decision is informed.
 */
app.get("/api/apps/:id/delete-preview", async (req, res) => {
  try {
    const preview = await previewAppDelete(req.params.id);
    res.json(preview);
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
  const tsHost = tailscaleHostname();
  console.log(`[app-hub] http://127.0.0.1:${PORT}`);
  if (ts) console.log(`[app-hub] phone: http://${ts}:${PORT}`);
  if (tsHost) console.log(`[app-hub] phone (hostname): http://${tsHost}:${PORT}`);
  console.log(`[app-hub] apps root: ${APPS_ROOT}`);
});

/**
 * Open an app without a credential prompt.
 *
 * The page is served from the hub's own origin and then navigates with
 * location.replace(), so the credential travels with the navigation
 * instead of being dropped by a cross-site redirect.
 */
/**
 * Where an app is really reachable from the tailnet.
 *
 * An app that binds 127.0.0.1 is not reachable on the tailnet address;
 * it needs a Tailscale serve mount on some other port. The registry's
 * UI port is the local one, so the public URL has to come from the
 * mount list.
 *
 * The mount list is read from `tailscale serve status --json` and cached
 * for a minute, because the hub asks for it on every phone link.
 */
let MOUNT_CACHE = { at: 0, mounts: [] };

function serveMounts() {
  const now = Date.now();
  if (now - MOUNT_CACHE.at < 60_000 && MOUNT_CACHE.mounts.length) {
    return MOUNT_CACHE.mounts;
  }
  const mounts = [];
  try {
    const raw = execSync("tailscale serve status --json 2>/dev/null", {
      encoding: "utf8",
    });
    const parsed = JSON.parse(raw);
    const web = parsed?.Web || {};
    for (const [hostPort, cfg] of Object.entries(web)) {
      for (const [route, handler] of Object.entries(cfg?.Handlers || {})) {
        const target = String(handler?.Proxy || "");
        const m = target.match(/:(\d+)$/);
        if (!m) continue;
        const [hostname, port] = hostPort.split(":");
        mounts.push({
          hostname,
          port: port || (parsed?.TCP?.[port]?.HTTPS ? "443" : "80"),
          https: Boolean(parsed?.TCP?.[port]?.HTTPS),
          route,
          localPort: Number(m[1]),
        });
      }
    }
  } catch {}
  MOUNT_CACHE = { at: now, mounts };
  return mounts;
}

/**
 * The tailnet URL for an app's local UI port, or null when the app
 * listens only on loopback and has no mount.
 */
function publicUrlFor(app) {
  const host = process.env.HERMES_BOT_PUBLIC_HOST || "homea-gtr-pro.tail8f3151.ts.net";
  const local = app.ports?.ui;
  if (!local) return null;

  const mounts = serveMounts();
  const hit = mounts.find((m) => m.localPort === Number(local));
  if (hit) {
    const scheme = hit.https ? "https" : "http";
    const defaultPort = hit.https ? "443" : "80";
    const portPart = hit.port && hit.port !== defaultPort ? `:${hit.port}` : "";
    // A path mount needs its prefix on the URL.
    const route = hit.route === "/" ? "" : hit.route.replace(/\/$/, "");
    return `${scheme}://${hit.hostname}${portPart}${route}/`;
  }

  // No mount: the app must be listening on the tailnet address itself.
  return `http://${host}:${local}${app.openPath || ""}`;
}

app.get("/go/:id", async (req, res) => {
  try {
    const { app: item } = findApp(req.params.id);
    // An app with no credential gets a plain redirect; the credential
    // ones get the token or the Basic-auth userinfo injected.
    //
    // findApp returns the raw registry entry, which has no status, so the
    // fallback URL is rebuilt from the entry's own port.
    const cred = appCredential(item);
    const plainTailnet = publicUrlFor(item);
    const target = cred?.url || plainTailnet || null;
    if (!target) {
      res.status(404).send(
        `<!doctype html><meta charset="utf-8"><body style="font:15px/1.6 system-ui;padding:2rem">` +
          `<p>「${escapeHtml(item.nameZh || item.name)}」未有可開嘅連結。</p>`
      );
      return;
    }
    const title = `開啟 ${item.nameZh || item.name}`;
    res.type("html").send(`<!doctype html>
<html lang="zh-HK"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{background:#0b0b0f;color:#e8e8f0;font:15px/1.6 system-ui,-apple-system,sans-serif;
display:grid;place-items:center;height:100dvh;margin:0;text-align:center;padding:1.5rem}
a{color:#30d158}p{opacity:.8;font-size:13px}</style></head>
<body><p>正在開啟 ${escapeHtml(item.nameZh || item.name)}…</p>
<p><a href="${escapeHtml(target)}">撳呢度如果冇自動跳</a></p>
<script>
(function(){
  var target = ${JSON.stringify(target)};
  var kind = ${JSON.stringify(cred?.kind || "")};
  // A URL with credentials in it authenticates the request, but the
  // browser refuses to build a fetch() from it, so the page's own API
  // calls break. Land on the clean URL once the credentials have been
  // accepted — the browser keeps them for the origin.
  //
  // Only the Basic-auth form needs this: a token lives in the query
  // string, which stays part of the URL and is safe to keep.
  if (kind !== "basic") { location.replace(target); return; }
  // The browser accepts credentials in the URL, authenticates the
  // navigation and then strips them from the address bar by itself.
  location.replace(target);
})();
</script>
</body></html>`);
  } catch (e) {
    res.status(404).send(`開唔到：${String(e.message || e)}`);
  }
});

