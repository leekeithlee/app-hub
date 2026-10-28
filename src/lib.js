import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APPS_ROOT = path.resolve(__dirname, "../..");
export const REGISTRY_PATH = path.join(APPS_ROOT, "registry.json");
export const LOG_DIR = path.join(APPS_ROOT, "_meta", "logs");
export const RUN_DIR = path.join(APPS_ROOT, "_meta", "run");

export function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(path.join(APPS_ROOT, "daily"), { recursive: true });
  fs.mkdirSync(path.join(APPS_ROOT, "trials"), { recursive: true });
}

export function readRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
  return JSON.parse(raw);
}

export function writeRegistry(reg) {
  reg.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", "utf8");
}

/** Hub UI prefs (dropdown pin order, etc.) */
export function getHubUi(reg) {
  const ui = reg?.hubUi && typeof reg.hubUi === "object" ? reg.hubUi : {};
  const dropdownTopIds = Array.isArray(ui.dropdownTopIds)
    ? ui.dropdownTopIds.map(String).filter(Boolean)
    : [];
  // 置底清單（Keith 2026-10-26）：排喺全部 app 最尾
  const pinnedBottomIds = Array.isArray(ui.pinnedBottomIds)
    ? ui.pinnedBottomIds.map(String).filter(Boolean)
    : [];
  // 自訂全序（Keith 2026-10-26 要求：menu 次序自由調整）
  const customOrder = Array.isArray(ui.customOrder)
    ? ui.customOrder.map(String).filter(Boolean)
    : [];
  const orderMode = ui.orderMode === "custom" ? "custom" : "pinned";
  return { dropdownTopIds, pinnedBottomIds, customOrder, orderMode };
}

/**
 * Pin app id to the top of the Hub card dropdown (and preferred list order).
 * @returns {{ reg, hubUi, pinnedId }}
 */
export function pinAppToDropdownTop(id) {
  const reg = readRegistry();
  if (!reg.apps.some((a) => a.id === id)) {
    throw new Error(`搵唔到 app：${id}`);
  }
  const ui = getHubUi(reg);
  const rest = ui.dropdownTopIds.filter((x) => x !== id);
  reg.hubUi = {
    ...ui,
    dropdownTopIds: [id, ...rest],
  };
  writeRegistry(reg);
  return { reg, hubUi: reg.hubUi, pinnedId: id };
}

/**
 * 置底：將 app id 排喺全部 app 最尾（Keith 2026-10-26）。
 * 同時由置頂清單移除，避免一張卡同時置頂置底。
 */
export function pinAppToBottom(id) {
  const reg = readRegistry();
  if (!reg.apps.some((a) => a.id === id)) {
    throw new Error(`搵唔到 app：${id}`);
  }
  const ui = getHubUi(reg);
  const restBottom = ui.pinnedBottomIds.filter((x) => x !== id);
  const restTop = ui.dropdownTopIds.filter((x) => x !== id);
  reg.hubUi = {
    ...ui,
    dropdownTopIds: restTop,
    pinnedBottomIds: [...restBottom, id],
  };
  writeRegistry(reg);
  return { reg, hubUi: reg.hubUi, pinnedId: id };
}

/**
 * 取消置底（唔改置頂狀態）。
 */
export function unpinAppFromBottom(id) {
  const reg = readRegistry();
  const ui = getHubUi(reg);
  reg.hubUi = {
    ...ui,
    pinnedBottomIds: ui.pinnedBottomIds.filter((x) => x !== id),
  };
  writeRegistry(reg);
  return { reg, hubUi: reg.hubUi, pinnedId: id };
}

/**
 * 儲存自訂全序（Keith 2026-10-26）。
 * order: app id 嘅完整次序；任何唔喺 order 嘅 app 排喺尾（跟 registry 次序）。
 */
export function setCustomOrder(order) {
  const reg = readRegistry();
  const valid = new Set((reg.apps || []).map((a) => a.id));
  const seen = new Set();
  const clean = [];
  for (const raw of Array.isArray(order) ? order : []) {
    const id = String(raw || "").trim();
    if (!id || !valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    clean.push(id);
  }
  const ui = getHubUi(reg);
  reg.hubUi = { ...ui, customOrder: clean, orderMode: "custom" };
  writeRegistry(reg);
  return { reg, hubUi: reg.hubUi, customOrder: clean };
}

/**
 * 還原成「置頂優先 + registry 次序」，並清走自訂全序。
 */
export function resetCustomOrder() {
  const reg = readRegistry();
  const ui = getHubUi(reg);
  reg.hubUi = { ...ui, customOrder: [], orderMode: "pinned" };
  writeRegistry(reg);
  return { reg, hubUi: reg.hubUi };
}

/**
 * 綜合排序（Keith 2026-10-26）：
 *   custom 模式 → 跟 customOrder 全序
 *   pinned 模式 → 置頂清單最前 → 其餘跟 registry 次序 → 置底清單最尾
 */
export function sortAppsByOrder(apps, hubUi = {}) {
  if (!Array.isArray(apps) || !apps.length) return apps || [];
  const custom = Array.isArray(hubUi.customOrder) ? hubUi.customOrder : [];
  if (hubUi.orderMode === "custom" && custom.length) {
    const rank = new Map(custom.map((id, i) => [id, i]));
    return [...apps].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : 9999;
      const rb = rank.has(b.id) ? rank.get(b.id) : 9999;
      return ra - rb;
    });
  }
  const top = Array.isArray(hubUi.dropdownTopIds) ? hubUi.dropdownTopIds : [];
  const bottom = Array.isArray(hubUi.pinnedBottomIds) ? hubUi.pinnedBottomIds : [];
  const topRank = new Map(top.map((id, i) => [id, i]));
  const bottomRank = new Map(bottom.map((id, i) => [id, i]));
  return [...apps].sort((a, b) => {
    const aTop = topRank.has(a.id);
    const bTop = topRank.has(b.id);
    if (aTop !== bTop) return aTop ? -1 : 1;
    const aBottom = bottomRank.has(a.id);
    const bBottom = bottomRank.has(b.id);
    if (aBottom !== bBottom) return aBottom ? 1 : -1;
    if (aTop && bTop) return topRank.get(a.id) - topRank.get(b.id);
    if (aBottom && bBottom) return bottomRank.get(a.id) - bottomRank.get(b.id);
    return 0;
  });
}

/** Sort apps so dropdownTopIds come first (stable for the rest). */
export function sortAppsByDropdownTop(apps, dropdownTopIds = []) {
  if (!Array.isArray(apps) || !apps.length) return apps || [];
  const order = Array.isArray(dropdownTopIds) ? dropdownTopIds : [];
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...apps].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : 9999;
    const rb = rank.has(b.id) ? rank.get(b.id) : 9999;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

export function pruneDropdownTopIds(reg) {
  if (!reg?.hubUi?.dropdownTopIds) return reg;
  const ids = new Set((reg.apps || []).map((a) => a.id));
  reg.hubUi.dropdownTopIds = reg.hubUi.dropdownTopIds.filter((id) => ids.has(id));
  if (Array.isArray(reg.hubUi.pinnedBottomIds)) {
    reg.hubUi.pinnedBottomIds = reg.hubUi.pinnedBottomIds.filter((id) => ids.has(id));
  }
  if (Array.isArray(reg.hubUi.customOrder)) {
    reg.hubUi.customOrder = reg.hubUi.customOrder.filter((id) => ids.has(id));
  }
  return reg;
}

export function isPortOpen(port, host = "127.0.0.1") {
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** 檢查 port 喺 loopback 或 Tailscale IP 有冇監聽（apps/* 權限 = 讀）。 */
async function isPortOpenAny(port, tsIp) {
  if (await isPortOpen(port)) return true;
  // Tailscale-only app（例如 lee-brain Dashboard 綁 config dashboard.bind）
  if (tsIp) return await isPortOpen(port, tsIp);
  return false;
}

export async function enrichApp(app, tsIp) {
  const uiUp = await isPortOpenAny(app.ports?.ui, tsIp);
  const apiUp = await isPortOpenAny(app.ports?.api, tsIp);
  const running = Boolean(
    (app.ports?.ui && uiUp) || (app.ports?.api && apiUp && !app.ports?.ui)
  );
  // Tailscale-only app 喺 loopback 開唔到：開 URL 用 tsIp（fallback 127.0.0.1）
  const openHost =
    app.ports?.ui && !(await isPortOpen(app.ports?.ui)) && tsIp ? tsIp : "127.0.0.1";
  const openUrl = app.ports?.ui
    ? `http://${openHost}:${app.ports.ui}${app.openPath || ""}`
    : null;
  const phoneUrl =
    app.ports?.ui && tsIp
      ? `http://${tsIp}:${app.ports.ui}${app.openPath || ""}`
      : null;

  let pathExists = false;
  try {
    pathExists = fs.existsSync(app.path);
  } catch {
    pathExists = false;
  }

  let git = null;
  try {
    const { getGitStatus } = await import("./git-utils.js");
    git = getGitStatus(app.path);
  } catch {
    git = { isRepo: false, summary: "git status unavailable" };
  }

  return {
    ...app,
    pathExists,
    git,
    status: { running, uiUp, apiUp, openUrl, phoneUrl },
  };
}

export function pidFile(id) {
  return path.join(RUN_DIR, `${id}.pid`);
}

export function readPid(id) {
  const f = pidFile(id);
  if (!fs.existsSync(f)) return null;
  const n = Number(fs.readFileSync(f, "utf8").trim());
  return Number.isFinite(n) ? n : null;
}

export function writePid(id, pid) {
  fs.writeFileSync(pidFile(id), String(pid), "utf8");
}

export function clearPid(id) {
  try {
    fs.unlinkSync(pidFile(id));
  } catch {}
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function startAppProcess(app) {
  if (!app.startCmd) {
    throw new Error("呢個 app 未設定 startCmd");
  }
  if (!fs.existsSync(app.path)) {
    throw new Error(`路徑唔存在：${app.path}`);
  }

  const logFile = path.join(LOG_DIR, `${app.id}.log`);
  const out = fs.openSync(logFile, "a");
  const child = spawn("bash", ["-lc", app.startCmd], {
    cwd: app.path,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env },
  });
  child.unref();
  writePid(app.id, child.pid);
  return { pid: child.pid, logFile };
}

export function stopAppProcess(app) {
  const results = [];

  if (app.stopCmd && fs.existsSync(app.path)) {
    try {
      const r = spawn("bash", ["-lc", app.stopCmd], {
        cwd: app.path,
        stdio: "ignore",
      });
      results.push(`stopCmd pid=${r.pid}`);
    } catch (e) {
      results.push(`stopCmd error: ${e.message}`);
    }
  }

  const pid = readPid(app.id);
  if (pid && isPidAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
      results.push(`killed process group ${pid}`);
    } catch {
      try {
        process.kill(pid, "SIGTERM");
        results.push(`killed pid ${pid}`);
      } catch (e) {
        results.push(`kill failed: ${e.message}`);
      }
    }
  }
  clearPid(app.id);

  for (const port of [app.ports?.ui, app.ports?.api].filter(Boolean)) {
    try {
      spawn("bash", ["-lc", `fuser -k ${port}/tcp 2>/dev/null || true`], {
        stdio: "ignore",
      });
    } catch {}
  }

  return results;
}

export function nextPorts(reg) {
  const usedUi = new Set([reg.hub?.port || 7890]);
  const usedApi = new Set();
  const usedDb = new Set();
  for (const a of reg.apps) {
    if (a.ports?.ui) usedUi.add(a.ports.ui);
    if (a.ports?.api) usedApi.add(a.ports.api);
    if (a.ports?.db) usedDb.add(a.ports.db);
  }

  let ui = reg.portRanges?.uiStart || 5173;
  while (usedUi.has(ui)) ui += 1;
  let api = reg.portRanges?.apiStart || 3001;
  while (usedApi.has(api)) api += 1;
  let db = reg.portRanges?.dbStart || 54329;
  while (usedDb.has(db)) db += 1;
  return { ui, api, db };
}

export function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-")
      .slice(0, 48) || `app-${Date.now()}`
  );
}

export function tailscaleIp() {
  try {
    const ip = execSync("tailscale ip -4 2>/dev/null", { encoding: "utf8" })
      .trim()
      .split("\n")[0];
    return ip || null;
  } catch {
    return null;
  }
}

/** Paths that must never be deleted by App Hub */
export function isProtectedPath(targetPath) {
  const resolved = path.resolve(targetPath);
  const home = path.resolve("/home/homea");
  const protectedExact = new Set([
    home,
    APPS_ROOT,
    path.join(APPS_ROOT, "app-hub"),
    path.join(APPS_ROOT, "templates"),
    path.join(APPS_ROOT, "bin"),
    path.join(APPS_ROOT, "_meta"),
    path.join(APPS_ROOT, "daily"),
    path.join(APPS_ROOT, "trials"),
    REGISTRY_PATH,
  ]);
  if (protectedExact.has(resolved)) return true;
  // never touch dot-config / system dirs
  const bannedPrefixes = [
    path.join(home, ".grok"),
    path.join(home, ".hermes"),
    path.join(home, ".openclaw"),
    path.join(home, ".config"),
    path.join(home, ".local"),
    path.join(home, ".ssh"),
  ];
  for (const p of bannedPrefixes) {
    if (resolved === p || resolved.startsWith(p + path.sep)) return true;
  }
  // must stay under home
  if (resolved !== home && !resolved.startsWith(home + path.sep)) return true;
  return false;
}

export function canDeleteAppFiles(app) {
  if (!app?.path) return { ok: false, reason: "冇 path" };
  if (app.id === "app-hub") return { ok: false, reason: "唔可以刪除 App Hub 自己" };
  const resolved = path.resolve(app.path);
  if (isProtectedPath(resolved)) {
    return { ok: false, reason: `受保護路徑，拒絕刪除：${resolved}` };
  }
  // Prefer apps created under daily/trials; allow other home projects with care
  const underApps =
    resolved.startsWith(path.join(APPS_ROOT, "daily") + path.sep) ||
    resolved.startsWith(path.join(APPS_ROOT, "trials") + path.sep);
  const underHomeProject =
    resolved.startsWith(path.resolve("/home/homea") + path.sep) &&
    resolved !== path.resolve("/home/homea");
  if (!underApps && !underHomeProject) {
    return { ok: false, reason: "路徑唔喺允許刪除範圍" };
  }
  return { ok: true, resolved, underApps };
}

export function removeAppFromRegistry(id) {
  const reg = readRegistry();
  const idx = reg.apps.findIndex((a) => a.id === id);
  if (idx < 0) throw new Error(`搵唔到 app：${id}`);
  const [removed] = reg.apps.splice(idx, 1);
  pruneDropdownTopIds(reg);
  writeRegistry(reg);
  clearPid(id);
  // drop log (optional keep? clear for cleanliness)
  try {
    fs.unlinkSync(path.join(LOG_DIR, `${id}.log`));
  } catch {}
  return removed;
}

/**
 * Unregister only, or full delete code+data.
 * @param {string} id
 * @param {"unregister"|"delete"} mode
 */
export function destroyApp(id, mode = "unregister") {
  if (id === "app-hub") {
    throw new Error("唔可以移除／刪除 App Hub 自己");
  }
  const reg = readRegistry();
  const app = reg.apps.find((a) => a.id === id);
  if (!app) throw new Error(`搵唔到 app：${id}`);

  // Always try stop first
  let stopResults = [];
  try {
    stopResults = stopAppProcess(app);
  } catch (e) {
    stopResults = [`stop warning: ${e.message}`];
  }

  const result = {
    id,
    mode,
    stopped: stopResults,
    unregistered: false,
    deletedPath: null,
    deletedExtra: [],
    warnings: [],
  };

  if (mode === "delete") {
    const check = canDeleteAppFiles(app);
    if (!check.ok) {
      throw new Error(check.reason);
    }
    const target = check.resolved;
    // Resolve real path if symlink
    let real = target;
    try {
      real = fs.realpathSync(target);
    } catch {
      real = target;
    }
    if (isProtectedPath(real)) {
      throw new Error(`真實路徑受保護，拒絕刪除：${real}`);
    }

    // Remove registry entry first so UI won't show half-deleted app
    removeAppFromRegistry(id);
    result.unregistered = true;

    // Delete main path (symlink or dir)
    try {
      fs.rmSync(target, { recursive: true, force: true });
      result.deletedPath = target;
    } catch (e) {
      result.warnings.push(`刪 ${target} 失敗：${e.message}`);
    }

    // If path was symlink under daily/trials already removed; if real path different and under allowed area, delete real too when it was a managed app under apps/
    if (real !== target && !isProtectedPath(real)) {
      const underManaged =
        real.startsWith(path.join(APPS_ROOT, "daily") + path.sep) ||
        real.startsWith(path.join(APPS_ROOT, "trials") + path.sep);
      // For external projects like ~/local-fullstack: only delete if path equals app.path real and user confirmed delete mode
      const isAppHomeProject =
        real.startsWith(path.resolve("/home/homea") + path.sep) &&
        path.basename(real) === app.id ||
        real === path.resolve(app.path);
      if (underManaged || path.resolve(app.path) === target || path.resolve(app.path) === real) {
        try {
          if (fs.existsSync(real)) {
            fs.rmSync(real, { recursive: true, force: true });
            result.deletedExtra.push(real);
          }
        } catch (e) {
          result.warnings.push(`刪 real path ${real} 失敗：${e.message}`);
        }
      }
    }

    // Clean leftover symlink/dir in daily/trials with same id
    for (const folder of ["daily", "trials"]) {
      const link = path.join(APPS_ROOT, folder, id);
      try {
        if (fs.lstatSync(link)) {
          fs.rmSync(link, { recursive: true, force: true });
          result.deletedExtra.push(link);
        }
      } catch {
        // missing — ok
      }
    }

    return result;
  }

  // unregister only
  removeAppFromRegistry(id);
  result.unregistered = true;
  return result;
}

export function summaryText(apps) {
  const daily = apps.filter((a) => a.category === "daily");
  const trial = apps.filter((a) => a.category === "trial");
  const running = apps.filter((a) => a.status?.running);
  const lines = [];
  lines.push(`# Keith Web Apps 摘要`);
  lines.push(``);
  lines.push(`更新：${new Date().toISOString()}`);
  lines.push(
    `總數：${apps.length}（daily ${daily.length} / trial ${trial.length}）`
  );
  lines.push(`運行中：${running.length}`);
  lines.push(``);
  lines.push(`## 活躍連結（預設／最重要）`);
  for (const a of apps) {
    const live = a.status?.running ? "🟢" : "⚫";
    const url = a.status?.openUrl || "（未設定 port／連結）";
    const phone = a.status?.phoneUrl ? ` · 手機 ${a.status.phoneUrl}` : "";
    lines.push(
      `- ${live} **${a.nameZh || a.name}** — ${url}${phone}`
    );
  }
  lines.push(``);
  lines.push(`## Daily（日常）`);
  for (const a of daily) {
    lines.push(
      `- **${a.nameZh || a.name}** (\`${a.id}\`) — ${a.status?.running ? "🟢 運行中" : "⚫ 停"} — ${a.status?.openUrl || "無連結"} — ${a.description || ""}`
    );
  }
  lines.push(``);
  lines.push(`## Trial（試驗）`);
  for (const a of trial) {
    lines.push(
      `- **${a.nameZh || a.name}** (\`${a.id}\`) — ${a.status?.running ? "🟢 運行中" : "⚫ 停"} — ${a.status?.openUrl || "無連結"} — ${a.description || ""}`
    );
  }
  lines.push(``);
  lines.push(`## 建置 / Grok 路徑（次要）`);
  for (const a of apps) {
    lines.push(`- \`${a.path}\` — ${a.grokHint || a.stack || ""}`);
  }
  return lines.join("\n");
}
