/**
 * Fingerprint reference-site technical stack from HTML + response headers.
 * Heuristic only — not 100% accurate (especially server/DB).
 */

function scoreHits(html, headersText, rules) {
  const blob = `${html}\n${headersText}`.toLowerCase();
  const hits = [];
  for (const rule of rules) {
    let score = 0;
    const matched = [];
    for (const sig of rule.sigs) {
      if (blob.includes(sig.toLowerCase())) {
        score += 1;
        matched.push(sig);
      }
    }
    if (score > 0) {
      hits.push({
        id: rule.id,
        label: rule.label,
        category: rule.category,
        score,
        confidence: Math.min(0.95, 0.35 + score * 0.15),
        evidence: matched.slice(0, 6),
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.confidence - a.confidence);
  return hits;
}

const RULES = [
  // CMS / platforms
  {
    id: "wordpress",
    label: "WordPress (PHP)",
    category: "cms",
    sigs: ["wp-content", "wp-includes", "wordpress", "wp-json", "wp-emoji"],
  },
  {
    id: "shopify",
    label: "Shopify",
    category: "cms",
    sigs: ["cdn.shopify.com", "shopify.theme", "myshopify.com", "shopify-section"],
  },
  {
    id: "wix",
    label: "Wix",
    category: "cms",
    sigs: ["wixstatic.com", "wix.com", "x-wix-"],
  },
  {
    id: "squarespace",
    label: "Squarespace",
    category: "cms",
    sigs: ["squarespace.com", "static.squarespace"],
  },
  {
    id: "webflow",
    label: "Webflow",
    category: "cms",
    sigs: ["webflow.com", "w-webflow"],
  },
  {
    id: "ghost",
    label: "Ghost",
    category: "cms",
    sigs: ["ghost.org", "content=\"ghost"],
  },
  {
    id: "drupal",
    label: "Drupal (PHP)",
    category: "cms",
    sigs: ["drupal.js", "sites/default/files", "x-drupal", "drupal.settings"],
  },
  {
    id: "joomla",
    label: "Joomla (PHP)",
    category: "cms",
    sigs: ["joomla", "/media/jui/", "option=com_"],
  },

  // Frontend frameworks
  {
    id: "react",
    label: "React",
    category: "frontend",
    sigs: ["react", "react-dom", "_next/static", "__next", "data-reactroot", "reactjs"],
  },
  {
    id: "nextjs",
    label: "Next.js",
    category: "frontend",
    sigs: ["_next/static", "__next_data__", "next/dist", "x-powered-by: next.js"],
  },
  {
    id: "vue",
    label: "Vue.js",
    category: "frontend",
    sigs: ["vue.js", "vue.min.js", "__vue__", "nuxt", "data-v-"],
  },
  {
    id: "nuxt",
    label: "Nuxt",
    category: "frontend",
    sigs: ["__nuxt", "_nuxt/", "nuxt.js"],
  },
  {
    id: "angular",
    label: "Angular",
    category: "frontend",
    sigs: ["ng-version", "angular.js", "angular.min", "ng-app"],
  },
  {
    id: "svelte",
    label: "Svelte / SvelteKit",
    category: "frontend",
    sigs: ["svelte", "__svelte", "_app/immutable"],
  },
  {
    id: "jquery",
    label: "jQuery",
    category: "frontend",
    sigs: ["jquery", "jquery.min.js", "jquery-"],
  },
  {
    id: "bootstrap",
    label: "Bootstrap",
    category: "css",
    sigs: ["bootstrap.min.css", "bootstrap.bundle", "cdn.jsdelivr.net/npm/bootstrap"],
  },
  {
    id: "tailwind",
    label: "Tailwind CSS",
    category: "css",
    sigs: ["tailwindcss", "tailwind.min.css", "--tw-"],
  },

  // Backend languages / runtimes (header + page signals)
  {
    id: "php",
    label: "PHP",
    category: "language",
    sigs: [
      "x-powered-by: php",
      ".php",
      "wordpress",
      "laravel",
      "wp-content",
      "phpsessid",
    ],
  },
  {
    id: "aspnet",
    label: "ASP.NET",
    category: "language",
    sigs: [
      "x-powered-by: asp.net",
      "x-aspnet-version",
      "__viewstate",
      ".aspx",
      "asp.net",
    ],
  },
  {
    id: "java",
    label: "Java",
    category: "language",
    sigs: ["jsessionid", "x-powered-by: servlet", "catalina", "spring", ".jsp"],
  },
  {
    id: "python",
    label: "Python",
    category: "language",
    sigs: ["wsgi", "django", "flask", "fastapi", "x-powered-by: uvicorn", "csrftoken"],
  },
  {
    id: "nodejs",
    label: "Node.js",
    category: "language",
    sigs: ["x-powered-by: express", "express", "next.js", "nuxt", "node.js"],
  },
  {
    id: "ruby",
    label: "Ruby / Rails",
    category: "language",
    sigs: ["x-powered-by: phusion passenger", "rails", "ruby", "_rails"],
  },
  {
    id: "go",
    label: "Go",
    category: "language",
    sigs: ["x-powered-by: go", "golang"],
  },

  // Hosting / CDN / server
  {
    id: "nginx",
    label: "nginx",
    category: "server",
    sigs: ["server: nginx", "nginx"],
  },
  {
    id: "apache",
    label: "Apache",
    category: "server",
    sigs: ["server: apache", "apache"],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    category: "cdn",
    sigs: ["cf-ray", "cloudflare", "__cf_bm", "cf-cache-status"],
  },
  {
    id: "vercel",
    label: "Vercel",
    category: "hosting",
    sigs: ["x-vercel", "vercel"],
  },
  {
    id: "netlify",
    label: "Netlify",
    category: "hosting",
    sigs: ["netlify", "x-nf-request-id"],
  },
  {
    id: "aws",
    label: "AWS",
    category: "hosting",
    sigs: ["amazons3", "cloudfront", "x-amz-", "aws"],
  },

  // Analytics / third party (supporting)
  {
    id: "ga",
    label: "Google Analytics",
    category: "analytics",
    sigs: ["google-analytics", "gtag/js", "googletagmanager", "ga.js", "gtm.js"],
  },
  {
    id: "facebook-pixel",
    label: "Facebook/Meta Pixel",
    category: "analytics",
    sigs: ["fbevents.js", "facebook.net/en_us/fbevents", "fbq("],
  },

  // DB hints (weak — rarely exposed)
  {
    id: "mysql",
    label: "MySQL / MariaDB (hint)",
    category: "database",
    sigs: ["mysql", "mariadb", "mysqli"],
  },
  {
    id: "postgres",
    label: "PostgreSQL (hint)",
    category: "database",
    sigs: ["postgres", "postgresql", "psql"],
  },
  {
    id: "mongodb",
    label: "MongoDB (hint)",
    category: "database",
    sigs: ["mongodb", "mongo"],
  },
  {
    id: "firebase",
    label: "Firebase",
    category: "database",
    sigs: ["firebase", "firestore", "firebaseio.com"],
  },
  {
    id: "supabase",
    label: "Supabase",
    category: "database",
    sigs: ["supabase", "supabase.co"],
  },
];

function pickTop(hits, category, n = 3) {
  return hits.filter((h) => h.category === category).slice(0, n);
}

function inferLanguages(hits, html) {
  const langs = new Set();
  const labels = [];
  for (const h of hits) {
    if (h.category === "language") {
      langs.add(h.id);
      labels.push(h.label);
    }
    if (h.id === "wordpress" || h.id === "drupal" || h.id === "joomla") {
      langs.add("php");
      labels.push("PHP");
    }
    if (h.id === "nextjs" || h.id === "nuxt") {
      langs.add("javascript");
      labels.push("JavaScript/TypeScript");
    }
    if (h.id === "shopify") {
      langs.add("liquid");
      labels.push("Liquid + JS (Shopify)");
    }
  }
  // script type module etc.
  if (/type=["']module["']/.test(html)) {
    langs.add("javascript");
    labels.push("Modern JS (ES modules)");
  }
  return {
    ids: [...langs],
    labels: [...new Set(labels)].slice(0, 8),
  };
}

function inferDatabases(hits, cmsId) {
  const dbs = [];
  for (const h of hits.filter((x) => x.category === "database")) {
    dbs.push({
      id: h.id,
      label: h.label,
      confidence: h.confidence,
      note: "Detected from public page signals (weak).",
    });
  }
  // CMS defaults (informed guess, not detection)
  if (cmsId === "wordpress" && !dbs.length) {
    dbs.push({
      id: "mysql",
      label: "MySQL / MariaDB (typical for WordPress)",
      confidence: 0.55,
      note: "Not confirmed from HTML — WordPress usually uses MySQL/MariaDB.",
    });
  }
  if (cmsId === "shopify" && !dbs.length) {
    dbs.push({
      id: "shopify-hosted",
      label: "Shopify hosted DB (not self-managed)",
      confidence: 0.7,
      note: "SaaS platform stores data; you don't pick MySQL yourself.",
    });
  }
  if (cmsId === "wix" || cmsId === "squarespace") {
    dbs.push({
      id: "platform-hosted",
      label: "Platform-hosted database",
      confidence: 0.65,
      note: "Closed SaaS CMS — DB not exposed.",
    });
  }
  if (!dbs.length) {
    dbs.push({
      id: "unknown",
      label: "Unknown / not exposed",
      confidence: 0.2,
      note: "Public HTML rarely reveals production DB. Common choices: PostgreSQL, MySQL, SQLite, MongoDB.",
    });
  }
  return dbs;
}

function suggestLocalStack(tech) {
  // Map reference site → recommended App Hub template + notes for rebuild
  const cms = tech.cms?.[0]?.id;
  const fe = tech.frontend?.map((x) => x.id) || [];
  let template = "react-trial";
  let language = "JavaScript/TypeScript";
  let database = "json-file (MVP) → PostgreSQL later";
  const notes = [];

  if (cms === "wordpress") {
    template = "fullstack-db";
    language = "JavaScript (rebuild) — original likely PHP/WordPress";
    database = "json-file MVP; production often MySQL (WP) → consider PostgreSQL for new app";
    notes.push(
      "參考站似 WordPress：本機重建唔使照抄 PHP，用 React+API+DB 更易維護。"
    );
  } else if (cms === "shopify") {
    template = "fullstack-db";
    language = "JavaScript";
    database = "json-file / custom product tables (not Shopify backend)";
    notes.push("Shopify 係托管電商；本地 MVP 用自建商品列表即可。");
  } else if (fe.includes("nextjs") || fe.includes("react")) {
    template = "react-trial";
    language = "JavaScript/TypeScript + React";
    database = tech.databases?.[0]?.id === "unknown"
      ? "optional; add fullstack-db if need persistence"
      : tech.databases?.[0]?.label || "PostgreSQL recommended";
  } else if (fe.includes("vue") || fe.includes("nuxt")) {
    template = "react-trial";
    language = "Original Vue/Nuxt — local template is React (or later Vue)";
    notes.push("參考站可能係 Vue；App Hub 預設 React 範本，可手動改。");
  } else if (tech.languages?.ids?.includes("php")) {
    template = "fullstack-db";
    language = "PHP (original) → recommend JS full stack for local Hub apps";
    database = "MySQL/MariaDB typical → JSON-file MVP or PostgreSQL";
  } else if (tech.languages?.ids?.includes("aspnet")) {
    template = "fullstack-db";
    language = "ASP.NET/C# (original) → JS/Python alternative for local MVP";
    database = "Often SQL Server → PostgreSQL/JSON for local";
  } else if (cms === "wix" || cms === "webflow" || cms === "squarespace") {
    template = "static-trial";
    language = "Mostly hosted builder + JS widgets";
    database = "Platform-hosted; local static or fullstack-db if you need forms";
  }

  if (tech.databases?.some((d) => d.id === "firebase" || d.id === "supabase")) {
    database = tech.databases.map((d) => d.label).join(", ");
    template = "fullstack-db";
  }

  return { template, language, database, notes };
}

/**
 * @param {string} html
 * @param {Headers|Record<string,string>} headers
 */
export function detectTechStack(html, headers) {
  let headersText = "";
  if (headers && typeof headers.forEach === "function") {
    headers.forEach((v, k) => {
      headersText += `${k}: ${v}\n`;
    });
  } else if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      headersText += `${k}: ${v}\n`;
    }
  }

  // generator meta
  const gen =
    html.match(
      /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i
    );
  const generator = gen?.[1] || null;
  if (generator) {
    headersText += `generator: ${generator}\n`;
  }

  const hits = scoreHits(html, headersText, RULES);
  const cms = pickTop(hits, "cms", 3);
  const frontend = pickTop(hits, "frontend", 5);
  const css = pickTop(hits, "css", 3);
  const server = pickTop(hits, "server", 3);
  const cdn = pickTop(hits, "cdn", 3);
  const hosting = pickTop(hits, "hosting", 3);
  const analytics = pickTop(hits, "analytics", 4);
  const languages = inferLanguages(hits, html);
  const databases = inferDatabases(hits, cms[0]?.id);

  const tech = {
    generator,
    cms,
    frontend,
    css,
    languages,
    databases,
    server,
    cdn,
    hosting,
    analytics,
    allHits: hits.slice(0, 20).map((h) => ({
      id: h.id,
      label: h.label,
      category: h.category,
      confidence: Number(h.confidence.toFixed(2)),
      evidence: h.evidence,
    })),
    confidenceNote:
      "Fingerprints from public HTML/headers only. Server language & DB are often hidden; treat DB as educated guess unless confirmed.",
  };

  tech.localRecommendation = suggestLocalStack(tech);
  tech.summary = buildTechSummary(tech);
  tech.summaryText = formatTechSummaryText(tech);
  return tech;
}

function buildTechSummary(tech) {
  return {
    codingLanguage:
      tech.languages.labels.join(", ") ||
      tech.localRecommendation.language ||
      "Unknown",
    frameworks: [
      ...tech.cms.map((x) => x.label),
      ...tech.frontend.map((x) => x.label),
      ...tech.css.map((x) => x.label),
    ].slice(0, 10),
    database: tech.databases.map((d) => d.label).join("; "),
    serverHosting: [
      ...tech.server.map((x) => x.label),
      ...tech.cdn.map((x) => x.label),
      ...tech.hosting.map((x) => x.label),
    ].join(", ") || "Unknown",
    analytics: tech.analytics.map((x) => x.label).join(", ") || "—",
    generator: tech.generator || "—",
    recommendedLocalTemplate: tech.localRecommendation.template,
    recommendedLocalLanguage: tech.localRecommendation.language,
    recommendedLocalDatabase: tech.localRecommendation.database,
  };
}

function formatTechSummaryText(tech) {
  const s = tech.summary;
  return [
    `Coding language (detected/guess): ${s.codingLanguage}`,
    `Frameworks/CMS: ${s.frameworks.join(", ") || "—"}`,
    `Database (guess): ${s.database}`,
    `Server/CDN/Hosting: ${s.serverHosting}`,
    `Analytics: ${s.analytics}`,
    `Generator meta: ${s.generator}`,
    `Recommended local template: ${s.recommendedLocalTemplate}`,
    `Recommended local language: ${s.recommendedLocalLanguage}`,
    `Recommended local DB: ${s.recommendedLocalDatabase}`,
    `Note: ${tech.confidenceNote}`,
  ].join("\n");
}
