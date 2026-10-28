/**
 * Site map helpers: parse free text ↔ structured routes for App Hub / agents.
 */

/**
 * Parse lines like:
 *   / 首頁
 *   /services 服務
 *   services | 服務列表
 *   首頁
 * into { path, title }[]
 */
export function parseSiteMapText(text) {
  if (!text || !String(text).trim()) return [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•]\s*/, ""));

  const routes = [];
  const seen = new Set();

  for (const line of lines) {
    let path = "";
    let title = "";

    // "/path title" or "/path | title" or "/path - title"
    const m1 = line.match(/^(\/[^\s|#]*)\s*[|：:\-–—]?\s*(.*)$/);
    if (line.startsWith("/")) {
      const parts = line.split(/\s+/);
      path = parts[0].split("#")[0] || "/";
      title = line.slice(parts[0].length).replace(/^[|：:\-–—\s]+/, "").trim();
    } else if (line.includes("|")) {
      const [a, b] = line.split("|").map((s) => s.trim());
      if (a.startsWith("/")) {
        path = a;
        title = b;
      } else if (b.startsWith("/")) {
        path = b;
        title = a;
      } else {
        path = "/" + slugPath(a);
        title = b || a;
      }
    } else {
      // bare label → slug path
      title = line;
      path = "/" + slugPath(line);
      if (path === "/" || /^(home|index|首頁|主頁)$/i.test(line)) {
        path = "/";
        title = title || "首頁";
      }
    }

    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+/g, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({
      path,
      title: title || pathLabel(path),
    });
  }

  // ensure home exists first for multi-page apps
  if (routes.length && !routes.some((r) => r.path === "/")) {
    routes.unshift({ path: "/", title: "首頁" });
  }

  return routes.slice(0, 40);
}

function slugPath(s) {
  const t = String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, (m) => {
      // keep short CJK as encoded-ish slug via simple map length
      return "p" + m.length;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return t || "page";
}

function pathLabel(path) {
  if (path === "/") return "Home";
  const last = path.split("/").filter(Boolean).pop() || "page";
  return last.replace(/[-_]/g, " ");
}

export function siteMapToText(routes) {
  if (!routes?.length) return "";
  return routes.map((r) => `${r.path} ${r.title || ""}`.trim()).join("\n");
}

export function siteMapSummary(routes, max = 4) {
  if (!routes?.length) return "";
  const paths = routes.map((r) => r.path);
  if (paths.length <= max) return paths.join(" · ");
  return paths.slice(0, max).join(" · ") + ` · +${paths.length - max}`;
}

/**
 * Extract likely nav links from HTML for site map suggestion.
 */
export function extractSiteMapFromHtml(html, baseUrl) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const routes = [];
  const seen = new Set();

  // prefer nav/header blocks
  const chunks = [];
  const navRe = /<nav[\s\S]*?<\/nav>/gi;
  const headerRe = /<header[\s\S]*?<\/header>/gi;
  let m;
  while ((m = navRe.exec(html)) && chunks.length < 5) chunks.push(m[0]);
  while ((m = headerRe.exec(html)) && chunks.length < 8) chunks.push(m[0]);
  if (!chunks.length) chunks.push(html.slice(0, 120000));

  const aRe =
    /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const chunk of chunks) {
    let am;
    while ((am = aRe.exec(chunk)) && routes.length < 25) {
      let href = am[1].trim();
      if (!href || href.startsWith("javascript:") || href.startsWith("mailto:"))
        continue;
      if (href.startsWith("tel:")) continue;

      let abs;
      try {
        abs = new URL(href, base);
      } catch {
        continue;
      }
      // same host only
      if (abs.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, ""))
        continue;

      let path = abs.pathname || "/";
      path = path.replace(/\/+/g, "/");
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      // skip assets
      if (/\.(css|js|png|jpe?g|gif|svg|webp|pdf|zip|ico)$/i.test(path))
        continue;
      if (path.length > 60) continue;

      const title = String(am[2] || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);

      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({
        path: path || "/",
        title: title || pathLabel(path || "/"),
      });
    }
  }

  if (!routes.some((r) => r.path === "/")) {
    routes.unshift({ path: "/", title: "首頁" });
  }

  // rank: home first, then shorter paths, limit
  routes.sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.length - b.path.length;
  });

  return routes.slice(0, 16);
}

export function defaultSiteMapForTemplate(template) {
  if (template === "api-json") {
    return [
      { path: "/", title: "API home" },
      { path: "/api/health", title: "Health" },
      { path: "/api/records", title: "Records" },
    ];
  }
  if (template === "fullstack-db") {
    return [
      { path: "/", title: "首頁／列表" },
      { path: "/api/health", title: "API Health" },
      { path: "/api/items", title: "Items API" },
    ];
  }
  return [{ path: "/", title: "首頁" }];
}
