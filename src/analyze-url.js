import { slugify } from "./lib.js";
import {
  extractSiteMapFromHtml,
  siteMapToText,
  defaultSiteMapForTemplate,
} from "./site-map.js";
import { detectTechStack } from "./tech-detect.js";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 12_000;

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
    .replace(/&nbsp;/g, " ");
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function metaContent(html, names) {
  for (const name of names) {
    const re1 = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i"
    );
    const m = html.match(re1) || html.match(re2);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  }
  return "";
}

function pickTitle(html) {
  const og = metaContent(html, ["og:title", "twitter:title"]);
  if (og) return og;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 120) : "";
}

function pickDescription(html) {
  const d =
    metaContent(html, [
      "og:description",
      "twitter:description",
      "description",
    ]) || "";
  if (d) return d.slice(0, 400);
  // first paragraph-ish
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (p) return stripTags(p[1]).slice(0, 400);
  return stripTags(html).slice(0, 200);
}

function hostToName(hostname) {
  let h = hostname.replace(/^www\./, "");
  const parts = h.split(".");
  // github.com/user/repo handled elsewhere
  if (parts.length >= 2) {
    const base = parts[parts.length - 2];
    return base;
  }
  return h.replace(/\./g, "-");
}

function extractThemeColor(html) {
  const m =
    html.match(
      /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i
    );
  return m?.[1]?.trim() || "";
}

function extractCssColors(html) {
  const colors = [];
  const re = /#([0-9a-fA-F]{3,8})\b/g;
  let m;
  const sample = html.slice(0, 80000);
  while ((m = re.exec(sample)) && colors.length < 20) {
    colors.push("#" + m[1].toLowerCase());
  }
  // rgb()
  const reRgb = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi;
  while ((m = reRgb.exec(sample)) && colors.length < 30) {
    const r = Number(m[1]),
      g = Number(m[2]),
      b = Number(m[3]);
    const hex =
      "#" +
      [r, g, b]
        .map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0"))
        .join("");
    colors.push(hex);
  }
  return colors;
}

function nearestColorTheme(hex) {
  if (!hex || !hex.startsWith("#")) return null;
  let h = hex.slice(1);
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length === 4 || h.length === 8) h = h.slice(0, 6); // drop alpha
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  // normalize returned primary to 6-digit
  hex = "#" + h;
  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  if (lum < 40) return { colorTheme: "dark", primaryColor: hex };
  if (lum > 220) return { colorTheme: "light", primaryColor: hex };
  // dominant channel
  if (r > g + 30 && r > b + 30) {
    if (r > 180 && g < 100) return { colorTheme: "red", primaryColor: hex };
    return { colorTheme: "orange", primaryColor: hex };
  }
  if (g > r + 20 && g > b + 20)
    return { colorTheme: "green", primaryColor: hex };
  if (b > r + 20 && b > g + 10) {
    if (b > 150 && r > 80) return { colorTheme: "purple", primaryColor: hex };
    if (g > 100) return { colorTheme: "teal", primaryColor: hex };
    return { colorTheme: "blue", primaryColor: hex };
  }
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25)
    return { colorTheme: "slate", primaryColor: hex };
  if (r > 150 && b > 150 && g < 120)
    return { colorTheme: "pink", primaryColor: hex };
  return { colorTheme: "indigo", primaryColor: hex };
}

function suggestDesign(html, textSample, host) {
  const blob = `${host} ${textSample}`.toLowerCase();
  let siteStyle = "modern";
  let audience = "public";
  const reasons = [];

  if (/dashboard|admin|analytics|monitor|console/i.test(blob)) {
    siteStyle = "dashboard";
    reasons.push("儀表板／後台關鍵字 → dashboard 風格");
  } else if (/shop|cart|store|buy|price|checkout/i.test(blob)) {
    siteStyle = "ecommerce";
    reasons.push("商店關鍵字 → ecommerce");
  } else if (/blog|article|news|docs|documentation|readme/i.test(blob)) {
    siteStyle = "content";
    reasons.push("內容／文件 → content");
  } else if (/play|game|fun|kids|colorful/i.test(blob)) {
    siteStyle = "playful";
    reasons.push("活潑關鍵字 → playful");
  } else if (/enterprise|business|corp|finance|b2b/i.test(blob)) {
    siteStyle = "corporate";
    reasons.push("商務關鍵字 → corporate");
  } else if (/elegant|luxury|fashion|design studio/i.test(blob)) {
    siteStyle = "elegant";
  } else if (/developer|api|github|open.source|sdk/i.test(blob)) {
    siteStyle = "tech";
    audience = "developers";
    reasons.push("開發者／API → tech + developers");
  } else if (/minimal|simple|clean/i.test(blob)) {
    siteStyle = "minimal";
  }

  if (/family|parent|home/i.test(blob)) audience = "family";
  else if (/student|learn|course|education|\bedu\b/i.test(blob))
    audience = "students";
  else if (/internal|intranet|employee/i.test(blob)) audience = "internal";
  else if (/customer|client|saas|pricing/i.test(blob)) audience = "customers";
  else if (/kid|child|children/i.test(blob)) audience = "kids";
  else if (/senior|elder/i.test(blob)) audience = "seniors";
  else if (/developer|github|api|docs\.|npm/i.test(blob))
    audience = "developers";
  else if (/personal|portfolio|about me/i.test(blob)) audience = "personal";

  const themeColor = extractThemeColor(html);
  let colorTheme = "blue";
  let primaryColor = themeColor || "";
  if (themeColor) {
    const n = nearestColorTheme(themeColor);
    if (n) {
      colorTheme = n.colorTheme;
      primaryColor = n.primaryColor;
      reasons.push(`theme-color ${themeColor} → ${colorTheme}`);
    }
  } else {
    const colors = extractCssColors(html);
    // pick first "interesting" non-gray-ish
    for (const c of colors) {
      const n = nearestColorTheme(c);
      if (n && n.colorTheme !== "slate" && n.colorTheme !== "light") {
        colorTheme = n.colorTheme;
        primaryColor = c;
        reasons.push(`頁面色碼 ${c} → ${colorTheme}`);
        break;
      }
    }
    if (!primaryColor && /dark|night|black/i.test(blob)) {
      colorTheme = "dark";
      primaryColor = "#0f172a";
    }
  }

  return { siteStyle, colorTheme, audience, primaryColor, reasons };
}

function suggestFromUrlAndHtml(urlObj, html, textSample) {
  const host = urlObj.hostname.toLowerCase();
  const path = urlObj.pathname.toLowerCase();
  const blob = `${host} ${path} ${textSample}`.toLowerCase();

  const tags = new Set(["from-url", "inspired"]);
  let template = "react-trial";
  let category = "trial";
  let lifecycle = "trial";
  let reasons = [];

  // GitHub repo → often fullstack interest
  if (host === "github.com" || host === "www.github.com") {
    tags.add("github");
    const segs = urlObj.pathname.split("/").filter(Boolean);
    if (segs.length >= 2) {
      tags.add(segs[0]);
      tags.add(segs[1]);
    }
    if (/react|vite|next/i.test(blob)) {
      template = "react-trial";
      reasons.push("GitHub + React 關鍵字 → React 範本");
    } else if (/api|express|fastapi|django|flask/i.test(blob)) {
      template = "api-json";
      reasons.push("GitHub + API 關鍵字 → API+JSON DB");
    } else if (/postgres|database|prisma|mongodb|sql/i.test(blob)) {
      template = "fullstack-db";
      reasons.push("GitHub + DB 關鍵字 → 全端+資料庫");
    } else {
      template = "react-trial";
      reasons.push("GitHub 專案 → 預設 React 試驗");
    }
  } else if (/docs\.|documentation|readme/i.test(blob)) {
    template = "static-trial";
    tags.add("docs");
    reasons.push("文件站感覺 → 純 HTML 最輕");
  } else if (/shop|cart|store|inventory|crm|todo|dashboard|admin|saas/i.test(blob)) {
    template = "fullstack-db";
    tags.add("product");
    reasons.push("產品／後台類 → 全端+資料庫");
  } else if (/api\.|swagger|openapi|graphql/i.test(blob)) {
    template = "api-json";
    tags.add("api");
    reasons.push("API 文件／端點 → API+JSON DB");
  } else if (/react|vue|angular|spa/i.test(blob)) {
    template = "react-trial";
    reasons.push("前端框架關鍵字 → React");
  } else {
    template = "react-trial";
    reasons.push("一般網站 → 預設 React 試驗（可手動改）");
  }

  if (/login|auth|account|user|postgres|database|db\b/i.test(blob)) {
    tags.add("database");
    if (template === "react-trial") {
      template = "fullstack-db";
      reasons.push("偵測到登入／資料庫概念 → 升級全端+DB");
    }
  }

  // name suggestion
  let name = "";
  let nameZh = "";
  if (host.includes("github.com")) {
    const segs = urlObj.pathname.split("/").filter(Boolean);
    name = segs[1] || segs[0] || hostToName(host);
  } else {
    name = hostToName(host);
  }
  name = slugify(name).slice(0, 40) || "inspired-app";

  const title = pickTitle(html);
  if (title) {
    // if title has CJK use as nameZh
    if (/[\u4e00-\u9fff]/.test(title)) {
      nameZh = title.slice(0, 40);
    } else {
      nameZh = title.slice(0, 40);
      // better english id from title words
      const fromTitle = slugify(title).slice(0, 40);
      if (fromTitle.length >= 3) name = fromTitle;
    }
  }
  if (!nameZh) nameZh = name;

  return {
    name,
    nameZh,
    template,
    category,
    lifecycle,
    tags: [...tags].slice(0, 12),
    reasons,
  };
}

function normalizeUrlInput(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("請提供網址");
  // strip common wrappers
  s = s.replace(/^<|>$/g, "").replace(/^['"]|['"]$/g, "");
  // user often pastes www.example.com without scheme
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    s = "https://" + s.replace(/^\/\//, "");
  }
  return s;
}

function assertSafeUrl(raw) {
  const normalized = normalizeUrlInput(raw);
  let u;
  try {
    u = new URL(normalized);
  } catch {
    throw new Error(
      `網址格式唔正確。請試：https://www.homeasy.hk（已嘗試：${normalized}）`
    );
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("只支援 http:// 或 https://（可只填 www.xxx.com，會自動加 https://）");
  }
  // Block cloud metadata
  if (
    u.hostname === "169.254.169.254" ||
    u.hostname === "metadata.google.internal"
  ) {
    throw new Error("唔允許呢個位址");
  }
  if (!u.hostname || u.hostname === "localhost" && false) {
    /* allow localhost for local tools */
  }
  return u;
}

/**
 * Fetch a public webpage and suggest form fields for new app card.
 */
export async function analyzeWebPage(urlInput) {
  const urlObj = assertSafeUrl(urlInput);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(urlObj.href, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "KeithAppHub/1.0 (+local; url-analyze for app scaffolding)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("連線逾時（12 秒）");
    throw new Error(`無法連線：${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`網站回應 HTTP ${res.status}`);
  }

  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error("頁面太大，拒絕分析");
  }
  let html = buf.toString("utf8");
  // if not html, still try
  if (
    ctype &&
    !ctype.includes("html") &&
    !ctype.includes("text") &&
    !ctype.includes("xml")
  ) {
    // JSON API root?
    try {
      const j = JSON.parse(html);
      html = `<title>${urlObj.hostname} API</title><meta name="description" content="${JSON.stringify(j).slice(0, 200)}"/>`;
    } catch {
      /* keep raw */
    }
  }

  const title = pickTitle(html);
  const description = pickDescription(html);
  const siteName = metaContent(html, ["og:site_name"]);
  const textSample = stripTags(html).slice(0, 2000);
  const suggestion = suggestFromUrlAndHtml(urlObj, html, textSample);
  const design = suggestDesign(html, textSample, urlObj.hostname);
  const tech = detectTechStack(html, res.headers);
  // prefer tech-based template when stronger than generic
  if (
    tech.localRecommendation?.template &&
    (tech.cms?.[0]?.confidence > 0.5 ||
      tech.frontend?.[0]?.confidence > 0.5 ||
      tech.cms?.length)
  ) {
    suggestion.template = tech.localRecommendation.template;
    suggestion.reasons.push(
      `技術指紋建議範本：${tech.localRecommendation.template}`
    );
  }
  let siteMapRoutes = extractSiteMapFromHtml(html, urlObj.href);
  if (!siteMapRoutes.length) {
    siteMapRoutes = defaultSiteMapForTemplate(suggestion.template);
  }
  const siteMapText = siteMapToText(siteMapRoutes);
  const siteMapReason =
    siteMapRoutes.length > 1
      ? `Site map 由導航估到 ${siteMapRoutes.length} 個 route`
      : "Site map 預設首頁";

  const notes = [
    `參考網站：${urlObj.href}`,
    title ? `原站標題：${title}` : null,
    siteName ? `網站名：${siteName}` : null,
    `分析時間：${new Date().toISOString()}`,
    `建議原因：${[...suggestion.reasons, ...design.reasons, siteMapReason].join("；")}`,
    `風格：${design.siteStyle} · 主色：${design.colorTheme}${design.primaryColor ? ` (${design.primaryColor})` : ""} · 對象：${design.audience}`,
    `Site map：${siteMapRoutes.map((r) => r.path).join(" · ")}`,
    ``,
    `=== 參考站技術分析（指紋／推斷）===`,
    tech.summaryText,
    tech.localRecommendation?.notes?.length
      ? `重建建議：${tech.localRecommendation.notes.join("；")}`
      : null,
    `注意：呢個係「靈感／參考」scaffold，唔係 clone 成個網站；DB/後端語言多數唔公開，僅供開發參考。`,
  ]
    .filter(Boolean)
    .join("\n");

  const finalDescription =
    description ||
    `受 ${title || urlObj.hostname} 啟發嘅 Web App（由 App Hub 網址分析自動填寫）`;

  // enrich tags with tech
  const techTags = [
    ...suggestion.tags,
    ...(tech.cms?.slice(0, 2).map((c) => c.id) || []),
    ...(tech.frontend?.slice(0, 2).map((c) => c.id) || []),
    "tech-analyzed",
  ];

  return {
    ok: true,
    sourceUrl: urlObj.href,
    fetchedTitle: title || null,
    siteName: siteName || null,
    fill: {
      name: suggestion.name,
      nameZh: suggestion.nameZh,
      category: suggestion.category,
      lifecycle: suggestion.lifecycle,
      template: suggestion.template,
      description: finalDescription,
      tags: [...new Set(techTags)].slice(0, 16).join(", "),
      notes,
      referenceUrl: urlObj.href,
      siteStyle: design.siteStyle,
      colorTheme: design.colorTheme,
      audience: design.audience,
      primaryColor: design.primaryColor || "",
      siteMap: siteMapText,
      siteMapRoutes,
      refTech: tech,
      techSummary: tech.summaryText,
      codingLanguage: tech.summary.codingLanguage,
      refDatabase: tech.summary.database,
      refFrameworks: tech.summary.frameworks.join(", "),
      goal: `做出受「${suggestion.nameZh || suggestion.name}」啟發嘅本機 Web App MVP`,
      nextTask:
        "按 design、site map 同 TECH 分析起首頁骨架；DB/語言用本地建議，唔使照抄原站托管平台",
      inScope: siteMapRoutes
        .slice(0, 6)
        .map((r) => `${r.path} ${r.title}`)
        .join("\n"),
    },
    analysis: {
      reasons: [...suggestion.reasons, ...design.reasons, siteMapReason],
      sampleText: textSample.slice(0, 280),
      design,
      siteMapRoutes,
      tech,
    },
  };
}
