let state = {
  apps: [],
  filter: "all",
  q: "",
  templates: [],
  hubUi: { dropdownTopIds: [], customOrder: [], orderMode: "pinned" },
  selectedCardId: "",
  reorderMode: false,
};

function dropdownTopIds() {
  return state.hubUi?.dropdownTopIds || [];
}

function customOrder() {
  return state.hubUi?.customOrder || [];
}

function orderMode() {
  return state.hubUi?.orderMode === "custom" ? "custom" : "pinned";
}

function isPinnedTop(id) {
  return dropdownTopIds()[0] === id;
}

/** 置底清單（排在全部 app 最尾） */
function pinnedBottomIds() {
  return state.hubUi?.pinnedBottomIds || [];
}

function isPinnedBottom(id) {
  return pinnedBottomIds().includes(id);
}

function pinRank(id) {
  if (orderMode() === "custom") {
    const i = customOrder().indexOf(id);
    return i >= 0 ? i : null;
  }
  const i = dropdownTopIds().indexOf(id);
  return i >= 0 ? i : null;
}

/** Prefer pinned order for list + select (API already sorts; re-apply after filter). */
function sortByPin(apps) {
  if (orderMode() === "custom") {
    const order = customOrder();
    if (!order.length) return apps;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...apps].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : 9999;
      const rb = rank.has(b.id) ? rank.get(b.id) : 9999;
      return ra - rb;
    });
  }
  const order = dropdownTopIds();
  if (!order.length) return apps;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...apps].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : 9999;
    const rb = rank.has(b.id) ? rank.get(b.id) : 9999;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}

// The hub is reachable at "/" and behind a Tailscale serve path mount
// ("/hub/"). Absolute "/api/..." paths break under the mount, so every API
// call goes through this helper, which keeps the mount prefix.
function apiBase() {
  const p = window.location.pathname;
  const i = p.lastIndexOf("/");
  // "/" → "" ; "/hub/" → "/hub"
  return i > 0 ? p.slice(0, i) : "";
}

async function api(path, opts) {
  const base = apiBase();
  const url = path.startsWith("/") && base ? base + path : path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(id) {
  return document.getElementById(id);
}

function renderStats(data) {
  const c = data.counts || {};
  el("stats").innerHTML = `
    <div class="stat"><span class="muted">全部</span><b>${c.total ?? 0}</b></div>
    <div class="stat"><span class="muted">日常</span><b>${c.daily ?? 0}</b></div>
    <div class="stat"><span class="muted">試驗</span><b>${c.trial ?? 0}</b></div>
    <div class="stat"><span class="muted">運行中</span><b>${c.running ?? 0}</b></div>
  `;
  el("hubMeta").textContent = `更新：${data.updatedAt || "—"} · Tailscale：${data.tailscaleIp || "—"} · Hub port ${data.hub?.port || 7890}`;
}

function filteredApps() {
  const list = state.apps.filter((a) => {
    if (state.filter === "daily" && a.category !== "daily") return false;
    if (state.filter === "trial" && a.category !== "trial") return false;
    if (state.filter === "running" && !a.status?.running) return false;
    if (state.filter === "database") {
      const hasDb =
        a.dbType ||
        (a.tags || []).includes("database") ||
        /postgres|database|json-file|sqlite|db/i.test(
          `${a.stack || ""} ${a.template || ""}`
        );
      if (!hasDb) return false;
    }
    if (state.q) {
      const hay = [
        a.id,
        a.name,
        a.nameZh,
        a.description,
        a.path,
        a.stack,
        a.dbType,
        a.template,
        ...(a.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
  return sortByPin(list);
}

function renderCardSelect() {
  const sel = el("cardSelect");
  if (!sel) return;
  const prev = state.selectedCardId || sel.value || "";
  const apps = sortByPin(state.apps);
  const top = dropdownTopIds()[0];
  const opts = [
    `<option value="">— 選擇 App 卡片（${apps.length}）—</option>`,
    ...apps.map((a, idx) => {
      const label = a.nameZh || a.name || a.id;
      const run = a.status?.running ? "🟢" : "⚫";
      const pin = pinRank(a.id);
      const bottom = isPinnedBottom(a.id);
      const pinMark = bottom
        ? "⬇️ "
        : pin === 0
          ? "📌 "
          : pin != null
            ? `#${pin + 1} `
            : "";
      const cls = pin === 0 ? ' class="pinned-opt"' : bottom ? ' class="bottom-opt"' : "";
      return `<option value="${escapeHtml(a.id)}"${cls}${
        a.id === prev ? " selected" : ""
      }>${pinMark}${run} ${escapeHtml(label)} · ${escapeHtml(a.id)}${
        a.category === "daily" ? " · 日常" : " · 試驗"
      }</option>`;
    }),
  ];
  sel.innerHTML = opts.join("");
  if (prev && apps.some((a) => a.id === prev)) {
    sel.value = prev;
    state.selectedCardId = prev;
  } else if (top && apps.some((a) => a.id === top)) {
    // default highlight top-pinned in select (not force-select empty)
    state.selectedCardId = state.selectedCardId || "";
  }
  updatePickerButtons();
}

function jumpToCard(id) {
  if (!id) return;
  state.selectedCardId = id;
  const sel = el("cardSelect");
  if (sel) sel.value = id;
  document.querySelectorAll(".card.is-selected").forEach((c) => c.classList.remove("is-selected"));
  document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add("is-selected");
  updatePickerButtons();
  const cardEl = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!cardEl) {
    // may be filtered out — clear filters and retry once
    if (state.filter !== "all" || state.q) {
      state.filter = "all";
      state.q = "";
      document.querySelectorAll(".chip[data-filter]").forEach((c) => {
        c.classList.toggle("active", c.dataset.filter === "all");
      });
      if (el("search")) el("search").value = "";
      renderList();
      const again = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      if (again) {
        again.scrollIntoView({ behavior: "smooth", block: "start" });
        again.classList.add("card-flash");
        setTimeout(() => again.classList.remove("card-flash"), 1200);
        return;
      }
    }
    alert(`列表入面搵唔到卡片：${id}`);
    return;
  }
  cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  cardEl.classList.add("card-flash");
  setTimeout(() => cardEl.classList.remove("card-flash"), 1200);
}

/** Is this link a Tailscale hostname (rather than a raw tailnet IP)? */
function isTsHost(url) {
  try {
    const u = new URL(url);
    return !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
  } catch {
    return false;
  }
}

function card(a) {
  const run = a.status?.running;
  const open = a.status?.openUrl;
  const phone = a.status?.phoneUrl;
  const external = a.status?.externalUrl;
  const canStart = Boolean(a.startCmd && a.pathExists);
  const canStop = Boolean(a.stopCmd || a.ports?.ui || a.ports?.api);
  const hasLink = Boolean(open);

  // Active link = primary identity of the app in the hub
  const linkBlock = hasLink
    ? `
    <div class="link-hero ${run ? "is-live" : "is-offline"}">
      <div class="link-hero-label">
        ${run ? "🟢 活躍連結（可直接開）" : "🔗 預設連結（啟動後可用）"}
      </div>
      <a class="link-hero-url" href="${escapeHtml(open)}" target="_blank" rel="noopener" title="開呢個 Web App">
        ${escapeHtml(open)}
      </a>
      ${
        phone
          ? `<div class="ts-entry">
               <div class="ts-entry-head">
                 <span class="ts-dot"></span>
                 <span class="ts-label">Tailscale 入口</span>
                 <span class="ts-badge">${isTsHost(phone) ? "HOSTNAME" : "TAILNET IP"}</span>
               </div>
               <div class="ts-entry-body">
                 <a class="ts-url" href="${escapeHtml(phone)}">${escapeHtml(phone)}</a>
                 <div class="ts-entry-actions">
                   <button type="button" data-act="copy-link" class="ghost sm" data-link="${escapeHtml(phone)}">複製</button>
                   <button type="button" data-act="ts-qr" class="ghost sm" data-link="${escapeHtml(phone)}">QR 碼</button>
                 </div>
                 <div class="ts-qr" hidden><img alt="Tailscale QR" loading="lazy"></div>
               </div>
             </div>`
          : ""
      }
      ${
        external
          ? `<div class="ts-entry">
               <div class="ts-entry-head">
                 <span class="ts-dot"></span>
                 <span class="ts-label">公開網址</span>
                 <span class="ts-badge">PUBLIC</span>
               </div>
               <div class="ts-entry-body">
                 <a class="ts-url" href="${escapeHtml(external)}" target="_blank" rel="noopener">${escapeHtml(external)}</a>
                 <div class="ts-entry-actions">
                   <button type="button" data-act="copy-link" class="ghost sm" data-link="${escapeHtml(external)}">複製</button>
                   <button type="button" data-act="ts-qr" class="ghost sm" data-link="${escapeHtml(external)}">QR 碼</button>
                 </div>
                 <div class="ts-qr" hidden><img alt="Public URL QR" loading="lazy"></div>
               </div>
             </div>`
          : ""
      }
      <div class="link-hero-actions">
        <a class="button primary big" href="${escapeHtml(open)}" target="_blank" rel="noopener">開啟 Web App</a>
        ${
          phone
            ? `<a class="button big" href="${escapeHtml(phone)}" target="_blank" rel="noopener">手機開啟</a>`
            : ""
        }
        ${
          external
            ? `<a class="button big" href="${escapeHtml(external)}" target="_blank" rel="noopener">🌐 公開網址</a>`
            : ""
        }
        <button type="button" data-act="copy-link" class="ghost" data-link="${escapeHtml(open)}">複製連結</button>
        ${
          external
            ? `<button type="button" data-act="copy-link" class="ghost" data-link="${escapeHtml(external)}">複製公開網址</button>`
            : ""
        }
        ${
          !run && canStart
            ? `<button type="button" data-act="start" class="ghost">先啟動</button>`
            : ""
        }
      </div>
    </div>`
    : `
    <div class="link-hero is-missing">
      <div class="link-hero-label">${external ? "🔗 官方網頁版" : "⚠️ 未設定活躍連結"}</div>
      <div class="meta">${
        external
          ? `呢個 app 冇本機 web 介面（桌面程式／雲端 SaaS）。手機可以直接開官方網頁版。`
          : `呢個 app 未登記 UI port，所以冇開啟網址。喺 registry 加 <code>ports.ui</code> 同 <code>startCmd</code> 就會出現。`
      }</div>
      ${
        external
          ? `<div class="link-hero-body">
               <a class="link-hero-url" href="${escapeHtml(external)}" target="_blank" rel="noopener">${escapeHtml(external)}</a>
             </div>`
          : ""
      }
      <div class="link-hero-actions">
        ${
          external
            ? `<a class="button primary big" href="${escapeHtml(external)}" target="_blank" rel="noopener">開啟網頁版</a>
               <button type="button" data-act="copy-link" class="ghost" data-link="${escapeHtml(external)}">複製連結</button>`
            : ""
        }
        ${
          canStart
            ? `<button type="button" data-act="start" ${external ? 'class="ghost"' : ""}>${external ? "啟動桌面程式" : "啟動"}</button>`
            : ""
        }
      </div>
    </div>`;

  // The destructive actions live on the card itself, not inside the
  // collapsed build-info section: deleting an app should not require
  // hunting for it.
  const dangerBlock = `
    <div class="danger-zone">
      <div class="danger-title">危險操作</div>
      <div class="actions">
        <button type="button" data-act="unregister" class="ghost danger-outline">移除卡片</button>
        <button type="button" data-act="delete" class="danger">永久刪除整個 App</button>
      </div>
      <div class="meta danger-hint">
        移除卡片＝只係 Hub 唔再顯示，code 保留。<br/>
        永久刪除＝停止服務 + 刪 registry + <strong>刪除整個資料夾</strong>（code + data，唔可復原）。會有兩步確認。
      </div>
    </div>`;

  const exportBar = `
    <div class="export-bar">
      <div class="export-bar-label">📄 匯出 brief · 畀其他 Agent</div>
      <div class="export-bar-actions">
        <button type="button" data-act="export-md" data-mode="full" class="button primary">匯出 Full MD</button>
        <button type="button" data-act="export-md" data-mode="brief" class="ghost">Brief</button>
        <button type="button" data-act="export-md" data-mode="prompt" class="ghost">Prompt 檔</button>
        <a class="button" href="${apiBase()}/api/apps/${encodeURIComponent(a.id)}/export.md?mode=full" download="${escapeHtml(a.id)}.agent.md">下載 Full</a>
      </div>
      <div class="meta export-bar-hint">
        Full → <code>AGENT.md</code> + <code>_meta/exports/${escapeHtml(a.id)}.agent.md</code>
      </div>
    </div>`;

  const git = a.git || {};
  const gitScore = `${git.healthyScore ?? 0}/${git.healthyMax ?? 5}`;
  const gitBar = `
    <div class="git-bar ${git.isRepo ? (git.dirty ? "git-dirty" : "git-ok") : "git-missing"}">
      <div class="git-bar-label">
        📦 Git 安全網 · 健康 ${escapeHtml(gitScore)}
        ${git.isRepo ? "" : "· 未初始化"}
      </div>
      <div class="meta git-summary">
        ${
          git.isRepo
            ? `<code>${escapeHtml(git.branch || "?")}</code> · ${git.commitCount ?? 0} commits · ${
                git.dirty
                  ? `⚠ dirty ${git.dirtyCount || ""}`
                  : "clean"
              }${
                git.lastCommit
                  ? ` · last <code>${escapeHtml(git.lastCommit)}</code> ${escapeHtml(git.lastCommitSubject || "")}`
                  : ""
              }${git.remoteUrl ? ` · remote ✓` : " · no remote"}`
            : "未有 .git — 撳「初始化 Git」建立還原點"
        }
      </div>
      <div class="git-bar-actions">
        ${
          git.isRepo
            ? `<button type="button" data-act="git-commit" class="button primary">📸 快照 Commit</button>
               <button type="button" data-act="git-push" class="ghost">☁ Push GitHub</button>`
            : `<button type="button" data-act="git-init" class="button primary">初始化 Git</button>`
        }
      </div>
    </div>`;

  const agentBar = `
    <div class="agent-bar">
      <div class="agent-bar-label">🤖 Agent 交接（預設）</div>
      <div class="agent-bar-actions">
        <button type="button" data-act="copy-cwd" class="button primary">複製 grok --cwd</button>
        <button type="button" data-act="copy-prompt" class="button">複製完整 Prompt</button>
        <button type="button" data-act="copy-export-hint" class="ghost">複製路徑包</button>
        ${
          open
            ? `<a class="button" href="${escapeHtml(open)}" target="_blank" rel="noopener">開啟 App</a>`
            : ""
        }
      </div>
    </div>`;

  const mapRoutes = a.siteMapRoutes?.length
    ? a.siteMapRoutes
    : a.design?.siteMap?.length
      ? a.design.siteMap
      : null;
  const mapSummary =
    a.siteMapSummary ||
    (mapRoutes ? mapRoutes.map((r) => r.path).join(" · ") : "");
  const mapCount = mapRoutes?.length || 0;

  const workBlock =
    a.goal || a.nextTask || mapSummary
      ? `<div class="work-summary">
          <div><strong>Goal：</strong>${escapeHtml(a.goal || a.description || "—")}</div>
          <div><strong>Next：</strong>${escapeHtml(a.nextTask || "—")}</div>
          ${a.priority ? `<div><strong>Priority：</strong>${escapeHtml(a.priority)}</div>` : ""}
          <div class="sitemap-line">
            <strong>🗺 Site map${mapCount ? `（${mapCount}）` : ""}：</strong>
            ${
              mapSummary
                ? `<code class="sitemap-paths">${escapeHtml(mapSummary)}</code>`
                : "<span class='muted'>— 未設定</span>"
            }
          </div>
          ${
            a.codingLanguage || a.refDatabase || a.refFrameworks || a.techSummary
              ? `<div class="tech-line">
                  <strong>⚙ 參考站技術：</strong>
                  ${a.codingLanguage ? `語言 <code>${escapeHtml(a.codingLanguage)}</code> · ` : ""}
                  ${a.refFrameworks ? `框架 <code>${escapeHtml(String(a.refFrameworks).slice(0, 80))}</code> · ` : ""}
                  ${a.refDatabase ? `DB <code>${escapeHtml(String(a.refDatabase).slice(0, 60))}</code>` : ""}
                </div>
                ${
                  a.techSummary
                    ? `<details class="sitemap-details"><summary>展開完整技術摘要</summary><pre class="sitemap-pre">${escapeHtml(a.techSummary)}</pre></details>`
                    : ""
                }`
              : ""
          }
          ${
            mapRoutes?.length
              ? `<details class="sitemap-details"><summary>展開全部 routes</summary><ul class="sitemap-list">${mapRoutes
                  .map(
                    (r) =>
                      `<li><code>${escapeHtml(r.path)}</code> ${escapeHtml(r.title || "")}</li>`
                  )
                  .join("")}</ul></details>`
              : a.siteMap
                ? `<details class="sitemap-details"><summary>展開 site map 文字</summary><pre class="sitemap-pre">${escapeHtml(a.siteMap)}</pre></details>`
                : ""
          }
        </div>`
      : "";

  const displayName = a.nameZh || a.name || a.id;
  const showId = a.name && a.nameZh && a.name !== a.nameZh;

  const pinned = isPinnedTop(a.id);
  const rank = pinRank(a.id);
  const bottomed = isPinnedBottom(a.id);

  return `
  <article class="card ${run ? "card-live" : ""} ${pinned ? "is-dropdown-top" : ""}" data-id="${a.id}"${state.reorderMode ? ' draggable="true"' : ""}>
    <div class="card-title-row">
      <h2 class="project-name" title="${escapeHtml(a.id)}">${escapeHtml(displayName)}</h2>
      ${
        showId
          ? `<span class="project-id">\`${escapeHtml(a.name)}\` · <code>${escapeHtml(a.id)}</code></span>`
          : `<span class="project-id"><code>${escapeHtml(a.id)}</code></span>`
      }
      <button type="button" data-act="pin-top" class="ghost btn-pin-top" title="置頂到頂部下拉清單">
        ${pinned ? "📌 已係下拉頂部" : "📌 置頂到下拉清單"}
      </button>
      <button type="button" data-act="${bottomed ? "unpin-bottom" : "pin-bottom"}" class="ghost btn-pin-bottom" title="${bottomed ? "取消置底" : "置底（排喺清單最後）"}">
        ${bottomed ? "⬇️ 已置底" : "⬇️ 置底"}
      </button>
      ${
        state.reorderMode
          ? `<span class="drag-handle" data-drag-handle title="拖我落另一張卡上面（或者用 Alt+↑/↓）" aria-label="拖曳排序">⠿</span>`
          : ""
      }
    </div>
    <div class="card-top">
      <div class="card-desc meta">${escapeHtml(a.description || a.goal || "")}</div>
      <div class="badges">
        ${
          pinned
            ? `<span class="badge pinned">📌 下拉 #1</span>`
            : rank != null
              ? `<span class="badge pinned">📌 #${rank + 1}</span>`
              : ""
        }
        ${
          bottomed
            ? `<span class="badge pinned-bottom">⬇️ 置底</span>`
            : ""
        }
        ${
          state.reorderMode && orderMode() === "custom" && rank != null
            ? `<span class="badge order-badge">#${rank + 1}</span>`
            : ""
        }
        <span class="badge ${a.category}">${a.category === "daily" ? "日常" : "試驗"}</span>
        <span class="badge ${run ? "run" : "stop"}">${run ? "🟢 運行中" : "⚫ 停"}</span>
        ${a.priority ? `<span class="badge">${escapeHtml(a.priority)}</span>` : ""}
        ${
          a.dbType || (a.tags || []).includes("database")
            ? `<span class="badge db">🗄 ${escapeHtml(a.dbType || "database")}</span>`
            : ""
        }
        ${
          a.siteStyle || a.design?.siteStyle
            ? `<span class="badge style">風格 ${escapeHtml(a.siteStyle || a.design?.siteStyle)}</span>`
            : ""
        }
        ${
          a.colorTheme || a.design?.colorTheme
            ? `<span class="badge color">色 ${escapeHtml(a.colorTheme || a.design?.colorTheme)}</span>`
            : ""
        }
        ${
          a.audience || a.design?.audience
            ? `<span class="badge audience">對象 ${escapeHtml(a.audience || a.design?.audience)}</span>`
            : ""
        }
        ${
          mapCount
            ? `<span class="badge sitemap">🗺 ${mapCount} pages</span>`
            : ""
        }
        <span class="badge export">MD 可匯出</span>
      </div>
    </div>

    ${workBlock}

    ${
      a.siteStyle || a.colorTheme || a.audience || a.primaryColor
        ? `<div class="design-summary meta">
            🎨 風格：<strong>${escapeHtml(a.siteStyle || "—")}</strong>
            · 主色：<strong>${escapeHtml(a.colorTheme || "—")}</strong>
            ${a.primaryColor ? `(<code>${escapeHtml(a.primaryColor)}</code>)` : ""}
            · 對象：<strong>${escapeHtml(a.audience || "—")}</strong>
          </div>`
        : ""
    }

    ${linkBlock}

    ${gitBar}

    ${agentBar}

    ${exportBar}

    <details class="build-info">
      <summary>建置資料 / Grok 改 code（次要）</summary>
      <div class="build-info-body">
        <div class="meta">
          Stack：${escapeHtml(a.stack || "—")}<br/>
          Ports：UI ${a.ports?.ui ?? "—"} · API ${a.ports?.api ?? "—"}
          ${a.ports?.db ? ` · DB ${a.ports.db}` : ""}
        </div>
        <div class="path" title="Grok 開呢個資料夾改 code">📁 ${escapeHtml(a.path)}</div>
        ${
          a.grokHint
            ? `<div class="meta">Grok：${escapeHtml(a.grokHint)}</div>`
            : ""
        }
        <div class="actions secondary-actions">
          <button type="button" data-act="start" ${canStart && !run ? "" : "disabled"}>啟動</button>
          <button type="button" data-act="stop" class="ghost" ${canStop ? "" : "disabled"}>停止</button>
          <button type="button" data-act="copy-path" class="ghost">複製路徑</button>
          <button type="button" data-act="log" class="ghost">Log</button>
        </div>
      </div>
    </details>

    ${dangerBlock}
  </article>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderList() {
  const apps = filteredApps();
  const root = el("list");
  if (!apps.length) {
    root.innerHTML = `<div class="card muted">冇符合嘅 app。撳「+ 新 App」建立試驗專案。</div>`;
    renderCardSelect();
    return;
  }
  root.innerHTML = apps.map(card).join("");
  renderCardSelect();
}

// ---------------------------------------------------------------------
// 自訂次序（Keith 2026-10-26：menu 次序自由調整）
// ---------------------------------------------------------------------

/** 依家畫面顯示嘅次序（受 filter 影響）→ 完整全序。 */
function currentOrder() {
  const shown = filteredApps().map((a) => a.id);
  const rest = customOrder().filter((id) => !shown.includes(id));
  return [...shown, ...rest];
}

/** 將 fromId 移動到 targetId 嘅位置（before = true 放上面）。 */
function moveInOrder(order, fromId, targetId, before = true) {
  const next = [...order];
  const from = next.indexOf(fromId);
  if (from < 0) return next;
  next.splice(from, 1);
  let to = next.indexOf(targetId);
  if (to < 0) to = next.length;
  next.splice(before ? to : to + 1, 0, fromId);
  return next;
}

async function saveOrder(order) {
  const res = await api("/api/hub/order", {
    method: "POST",
    body: JSON.stringify({ order }),
  });
  state.hubUi = res.hubUi || state.hubUi;
  renderStats({ counts: currentCounts() });
  renderList();
  toast(res.message || "已儲存次序");
}

function currentCounts() {
  return {
    total: state.apps.length,
    daily: state.apps.filter((a) => a.category === "daily").length,
    trial: state.apps.filter((a) => a.category === "trial").length,
    running: state.apps.filter((a) => a.status?.running).length,
  };
}

function toast(msg) {
  let t = el("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function enableReorderMode() {
  if (orderMode() !== "custom") {
    // 第一次入 reorder mode：先將現時畫面次序寫入 customOrder
    const order = currentOrder();
    const res = await api("/api/hub/order", {
      method: "POST",
      body: JSON.stringify({ order }),
    });
    state.hubUi = res.hubUi || state.hubUi;
  }
  state.reorderMode = true;
  renderList();
  updateReorderBar();
  toast("排序模式開咗：拖 ⠿ 把手，拖完即刻儲存");
}

function disableReorderMode() {
  state.reorderMode = false;
  renderList();
  updateReorderBar();
}

function updateReorderBar() {
  const bar = el("reorderBar");
  if (!bar) return;
  bar.classList.toggle("hidden", !state.reorderMode);
  const btn = el("btnReorder");
  if (btn) btn.classList.toggle("active", state.reorderMode);
  const label = el("reorderStatus");
  if (label) {
    label.textContent = state.reorderMode
      ? `自訂次序模式 · 拖 ⠿ 落另一張卡上面（或者 Alt+↑/↓）`
      : "";
  }
}

/** 鍵盤排序：Alt+↑ / Alt+↓ 移動 focused 卡。 */
async function keyboardMove(id, dir) {
  const order = currentOrder();
  const i = order.indexOf(id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= order.length) return;
  const next = [...order];
  next.splice(j, 0, next.splice(i, 1)[0]);
  await saveOrder(next);
  // 保持 focus
  requestAnimationFrame(() => {
    const el2 = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (el2) {
      el2.scrollIntoView({ block: "nearest" });
      el2.setAttribute("tabindex", "-1");
      el2.focus({ preventScroll: true });
    }
  });
}

async function refresh() {
  const data = await api("/api/apps");
  state.apps = data.apps || [];
  state.hubUi = data.hubUi || { dropdownTopIds: [], customOrder: [], orderMode: "pinned" };
  renderStats(data);
  renderList();
  updateReorderBar();
}

// ---------------------------------------------------------------------
// 拖曳排序（HTML5 drag & drop）
// ---------------------------------------------------------------------
let dragId = null;

el("list").addEventListener("dragstart", (e) => {
  if (!state.reorderMode) return;
  const handle = e.target.closest("[data-drag-handle]");
  const cardEl = e.target.closest(".card");
  if (!handle || !cardEl) {
    e.preventDefault();
    return;
  }
  dragId = cardEl.dataset.id;
  cardEl.classList.add("is-dragging");
  e.dataTransfer.effectAllowed = "move";
  try {
    e.dataTransfer.setData("text/plain", dragId);
  } catch (_) {
    /* some browsers refuse setData on certain handles */
  }
});

el("list").addEventListener("dragover", (e) => {
  if (!state.reorderMode || !dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const cardEl = e.target.closest(".card");
  document
    .querySelectorAll(".card.drop-before, .card.drop-after")
    .forEach((n) => n.classList.remove("drop-before", "drop-after"));
  if (!cardEl || cardEl.dataset.id === dragId) return;
  const rect = cardEl.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  cardEl.classList.add(after ? "drop-after" : "drop-before");
});

el("list").addEventListener("dragleave", (e) => {
  const cardEl = e.target.closest(".card");
  if (cardEl) cardEl.classList.remove("drop-before", "drop-after");
});

el("list").addEventListener("drop", async (e) => {
  if (!state.reorderMode || !dragId) return;
  e.preventDefault();
  const cardEl = e.target.closest(".card");
  const fromId = dragId;
  dragId = null;
  document
    .querySelectorAll(".card.is-dragging, .card.drop-before, .card.drop-after")
    .forEach((n) => n.classList.remove("is-dragging", "drop-before", "drop-after"));
  if (!cardEl || cardEl.dataset.id === fromId) return;
  const rect = cardEl.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  const order = moveInOrder(currentOrder(), fromId, cardEl.dataset.id, !after);
  await saveOrder(order);
});

el("list").addEventListener("dragend", () => {
  dragId = null;
  document
    .querySelectorAll(".card.is-dragging, .card.drop-before, .card.drop-after")
    .forEach((n) => n.classList.remove("is-dragging", "drop-before", "drop-after"));
});

/** 鍵盤排序：Alt+↑ / Alt+↓ */
document.addEventListener("keydown", async (e) => {
  if (!state.reorderMode) return;
  if (!(e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown"))) return;
  const focused = document.activeElement?.closest?.(".card");
  if (!focused) return;
  e.preventDefault();
  await keyboardMove(focused.dataset.id, e.key === "ArrowUp" ? -1 : 1);
});

el("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const cardEl = btn.closest(".card");
  const id = cardEl?.dataset.id;
  if (!id) return;
  const act = btn.dataset.act;
  try {
    if (act === "pin-top") {
      btn.disabled = true;
      const r = await api(`/api/hub/pin-top`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      btn.disabled = false;
      state.selectedCardId = id;
      await refresh();
      jumpToCard(id);
      const label = state.apps.find((x) => x.id === id);
      // brief toast via button text
      btn.textContent = "📌 已置頂";
      setTimeout(() => {
        const still = document.querySelector(
          `.card[data-id="${CSS.escape(id)}"] [data-act="pin-top"]`
        );
        if (still) still.textContent = "📌 已係下拉頂部";
      }, 800);
      if (r?.message) {
        /* silent success — UI already updates */
      }
      return;
    } else if (act === "pin-bottom" || act === "unpin-bottom") {
      btn.disabled = true;
      const path = act === "pin-bottom" ? "pin-bottom" : "unpin-bottom";
      await api(`/api/hub/${path}`, {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      btn.disabled = false;
      await refresh();
      toast(act === "pin-bottom" ? `已置底「${id}」` : `已取消置底「${id}」`);
      return;
    } else if (act === "start") {
      btn.disabled = true;
      await api(`/api/apps/${id}/start`, { method: "POST", body: "{}" });
      setTimeout(refresh, 1500);
      setTimeout(refresh, 4000);
    } else if (act === "stop") {
      btn.disabled = true;
      await api(`/api/apps/${id}/stop`, { method: "POST", body: "{}" });
      setTimeout(refresh, 1000);
    } else if (act === "copy-link") {
      const link = btn.dataset.link || state.apps.find((a) => a.id === id)?.status?.openUrl;
      if (link) {
        await navigator.clipboard.writeText(link);
        const was = btn.textContent;
        btn.textContent = "已複製連結";
        setTimeout(() => (btn.textContent = was), 1200);
      }
    } else if (act === "ts-qr") {
      const link = btn.dataset.link;
      const box = btn.closest(".ts-entry")?.querySelector(".ts-qr");
      if (!link || !box) return;
      if (!box.hidden) { box.hidden = true; return; }
      const img = box.querySelector("img");
      img.src = `${apiBase()}/api/qr?url=${encodeURIComponent(link)}`;
      box.hidden = false;
    } else if (act === "copy-path") {
      const app = state.apps.find((a) => a.id === id);
      if (app?.path) {
        await navigator.clipboard.writeText(app.path);
        btn.textContent = "已複製";
        setTimeout(() => (btn.textContent = "複製路徑"), 1200);
      }
    } else if (act === "log") {
      const res = await fetch(`${apiBase()}/api/apps/${id}/log`);
      const text = await res.text();
      alert(text.slice(-3000) || "(empty)");
    } else if (act === "export-md") {
      const mode = btn.dataset.mode || "full";
      btn.disabled = true;
      const r = await api(`/api/apps/${id}/export`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      btn.disabled = false;
      el("exportMsg").textContent = r.message || "已匯出";
      el("exportPaths").textContent = [
        `模式：${mode}`,
        `匯出檔：${r.exportPath || "—"}`,
        `專案 AGENT.md：${r.projectAgentPath || "—"}`,
        `專案 AGENT_PROMPT.md：${r.projectPromptPath || "—"}`,
        ``,
        `其他 agent：`,
        `  grok --cwd ${state.apps.find((x) => x.id === id)?.path || "<path>"}`,
        `  讀 AGENT.md 或 AGENT_PROMPT.md`,
      ].join("\n");
      el("exportModal").dataset.copy = r.exportPath || "";
      el("exportModal").classList.remove("hidden");
    } else if (act === "git-init") {
      btn.disabled = true;
      const r = await api(`/api/apps/${id}/git/init`, {
        method: "POST",
        body: "{}",
      });
      btn.disabled = false;
      alert(r.ok ? `Git 已初始化\n${r.summary || ""}` : `失敗：${r.error || r.message || "unknown"}`);
      await refresh();
    } else if (act === "git-commit") {
      const app = state.apps.find((x) => x.id === id);
      const defaultMsg = app?.nextTask
        ? `chore: ${String(app.nextTask).slice(0, 60)}`
        : "";
      const msg = prompt("Commit message（快照）", defaultMsg || `chore: snapshot ${id}`);
      if (msg === null) return;
      btn.disabled = true;
      const r = await api(`/api/apps/${id}/git/commit`, {
        method: "POST",
        body: JSON.stringify({ message: msg || undefined }),
      });
      btn.disabled = false;
      if (r.ok) {
        alert(
          r.committed
            ? `已 commit\n${r.commitMessage || msg}\n${r.summary || ""}`
            : r.message || "working tree clean"
        );
      } else {
        alert(`Commit 失敗：${r.error || "unknown"}`);
      }
      await refresh();
    } else if (act === "git-push") {
      const ok = confirm(
        "推去 GitHub？\n\n會用 gh 建立 private repo（若未有 remote）並 push。\n需要本機已 gh auth login。"
      );
      if (!ok) return;
      btn.disabled = true;
      const r = await api(`/api/apps/${id}/git/push`, {
        method: "POST",
        body: JSON.stringify({ private: true }),
      });
      btn.disabled = false;
      alert(
        r.ok
          ? `Push 成功\n${r.remoteUrl || r.summary || ""}`
          : `Push 失敗：${r.error || "unknown"}`
      );
      await refresh();
    } else if (act === "copy-cwd") {
      const app = state.apps.find((x) => x.id === id);
      const cmd = `grok --cwd ${app?.path || ""}`;
      await navigator.clipboard.writeText(cmd);
      btn.textContent = "已複製 cwd";
      setTimeout(() => (btn.textContent = "複製 grok --cwd"), 1200);
    } else if (act === "copy-prompt") {
      btn.disabled = true;
      const r = await api(`/api/apps/${id}/prompt`);
      await navigator.clipboard.writeText(r.prompt || "");
      btn.disabled = false;
      btn.textContent = "已複製 Prompt";
      setTimeout(() => (btn.textContent = "複製完整 Prompt"), 1500);
    } else if (act === "copy-export-hint") {
      const app = state.apps.find((x) => x.id === id);
      const hint = [
        `App: ${app?.nameZh || app?.name || id} (${id})`,
        `Goal: ${app?.goal || app?.description || ""}`,
        `Next: ${app?.nextTask || ""}`,
        `Path: ${app?.path || ""}`,
        `Open: ${app?.status?.openUrl || "(start first)"}`,
        `Phone: ${app?.status?.phoneUrl || "—"}`,
        `Grok: grok --cwd ${app?.path || ""}`,
        `Start: cd ${app?.path || ""} && ${app?.startCmd || "./start.sh"}`,
        `AGENT.md: ${(app?.path || "") + "/AGENT.md"}`,
        `AGENT_PROMPT.md: ${(app?.path || "") + "/AGENT_PROMPT.md"}`,
        `design.json: ${(app?.path || "") + "/design.json"}`,
        `Export: ~/apps/_meta/exports/${id}.agent.md`,
        `Stack: ${app?.stack || "—"}`,
        `DB: ${app?.dbType || "none"}`,
        `Style: ${app?.siteStyle || "—"}`,
        `Color: ${app?.colorTheme || "—"} ${app?.primaryColor || ""}`,
        `Audience: ${app?.audience || "—"}`,
        `Site map: ${app?.siteMapSummary || app?.siteMap || "/"}`,
        `SITE_MAP.md: ${(app?.path || "") + "/SITE_MAP.md"}`,
        `Git: ${app?.git?.summary || "—"}`,
        `Git health: ${app?.git?.healthyScore ?? "?"}/${app?.git?.healthyMax ?? 5}`,
        `Remote: ${app?.git?.remoteUrl || "none"}`,
      ].join("\n");
      await navigator.clipboard.writeText(hint);
      btn.textContent = "已複製路徑包";
      setTimeout(() => (btn.textContent = "複製路徑包"), 1200);
    } else if (act === "unregister") {
      const app = state.apps.find((a) => a.id === id);
      const name = app?.nameZh || app?.name || id;
      const ok = confirm(
        `移除卡片「${name}」？\n\n` +
          `• 只係喺 App Hub 列表拎走\n` +
          `• 唔會刪 code／data\n` +
          `• 路徑：${app?.path || "—"}\n\n` +
          `確定？`
      );
      if (!ok) return;
      btn.disabled = true;
      await api(`/api/apps/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ mode: "unregister", confirmId: id }),
      });
      await refresh();
    } else if (act === "delete") {
      await openDeleteModal(id);
    }
  } catch (err) {
    alert(err.message || String(err));
    refresh();
  }
});

document.querySelectorAll(".chip[data-filter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip[data-filter]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.filter = chip.dataset.filter;
    renderList();
  });
});

el("search").addEventListener("input", (e) => {
  state.q = e.target.value.trim();
  renderList();
});

el("btnRefresh").addEventListener("click", () => refresh().catch(alert));

// 自訂次序（Keith 2026-10-26）
el("btnReorder")?.addEventListener("click", async () => {
  try {
    if (state.reorderMode) {
      disableReorderMode();
      toast("排序模式完");
    } else {
      await enableReorderMode();
    }
  } catch (e) {
    alert(String(e.message || e));
  }
});
el("btnReorderDone")?.addEventListener("click", () => {
  disableReorderMode();
  toast("次序已儲存");
});
el("btnReorderReset")?.addEventListener("click", async () => {
  try {
    const res = await api("/api/hub/order/reset", { method: "POST", body: "{}" });
    state.hubUi = res.hubUi || state.hubUi;
    state.reorderMode = false;
    await refresh();
    toast(res.message || "已還原");
  } catch (e) {
    alert(String(e.message || e));
  }
});

// Top dropdown: selecting an app only selects it.
//
// It used to jump straight to the card, which scrolled the page away the
// moment the owner picked an option and left the picker buttons
// ("跳到此卡", "開啟選中 App", "📱 Tailscale") unreachable. Selecting now
// only arms the buttons; the jump is the button's job.
const cardSelectEl = el("cardSelect");
if (cardSelectEl) {
  cardSelectEl.addEventListener("change", () => {
    const id = cardSelectEl.value;
    state.selectedCardId = id;
    // Highlight the chosen card without moving the page.
    document.querySelectorAll(".card.is-selected").forEach((c) => c.classList.remove("is-selected"));
    if (id) {
      document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add("is-selected");
    }
    updatePickerButtons();
  });
}

/** Enable the picker buttons only when an app is selected. */
function updatePickerButtons() {
  const id = el("cardSelect")?.value || state.selectedCardId;
  const app = state.apps.find((a) => a.id === id);
  const jump = el("btnJumpCard");
  const open = el("btnOpenSelected");
  const ts = el("btnOpenTs");
  if (jump) jump.disabled = !id;
  if (open) open.disabled = !id || !app?.status?.openUrl;
  if (ts) ts.disabled = !id || !app?.status?.phoneUrl;
  if (ts) {
    ts.title = app?.status?.phoneUrl
      ? `用 Tailscale 網址開啟：${app.status.phoneUrl}`
      : "呢張卡未有 Tailscale 連結";
  }
}
el("btnJumpCard")?.addEventListener("click", () => {
  const id = el("cardSelect")?.value || state.selectedCardId;
  if (!id) {
    alert("請先喺下拉清單揀一張卡");
    return;
  }
  jumpToCard(id);
});
el("btnOpenSelected")?.addEventListener("click", () => {
  const id = el("cardSelect")?.value || state.selectedCardId;
  if (!id) {
    alert("請先喺下拉清單揀一張卡");
    return;
  }
  const app = state.apps.find((a) => a.id === id);
  const url = app?.status?.openUrl;
  if (!url) {
    alert("呢張卡未有活躍連結（可能未設 port 或未啟動）");
    jumpToCard(id);
    return;
  }
  window.open(url, "_blank", "noopener");
});

// Open the selected app straight on its Tailscale URL, without going
// through the card. The link is the Magic DNS hostname, so the phone and
// the machine reach the same address.
el("btnOpenTs")?.addEventListener("click", () => {
  const id = el("cardSelect")?.value || state.selectedCardId;
  if (!id) {
    alert("請先喺下拉清單揀一張卡");
    return;
  }
  const app = state.apps.find((a) => a.id === id);
  const url = app?.status?.phoneUrl;
  if (!url) {
    alert("呢張卡未有 Tailscale 連結（可能未設 port）");
    jumpToCard(id);
    return;
  }
  window.open(url, "_blank", "noopener");
});

function renderTemplateOptions(selectedId) {
  const box = el("templateOptions");
  if (!box) return;
  const list =
    state.templates.length > 0
      ? state.templates
      : [
          {
            id: "react-trial",
            label: "React + Vite",
            description: "前端",
            hasDb: false,
          },
        ];
  const sel =
    selectedId && list.some((t) => t.id === selectedId)
      ? selectedId
      : list[0]?.id;
  box.innerHTML = list
    .map(
      (t) => `
    <label class="template-card">
      <input type="radio" name="template" value="${escapeHtml(t.id)}" ${t.id === sel ? "checked" : ""} />
      <span class="template-card-body">
        <strong>${escapeHtml(t.label || t.id)}</strong>
        ${t.hasDb ? `<span class="badge db">有資料庫</span>` : `<span class="badge">無 DB</span>`}
        <span class="muted">${escapeHtml(t.description || t.stack || "")}</span>
      </span>
    </label>`
    )
    .join("");
}

function applyAnalyzeFill(fill) {
  if (!fill) return;
  if (fill.name) el("fieldName").value = fill.name;
  if (fill.nameZh) el("fieldNameZh").value = fill.nameZh;
  if (fill.category) el("fieldCategory").value = fill.category;
  if (fill.lifecycle) el("fieldLifecycle").value = fill.lifecycle;
  if (fill.description) el("fieldDescription").value = fill.description;
  if (fill.tags) el("fieldTags").value = fill.tags;
  if (fill.notes) el("fieldNotes").value = fill.notes;
  if (fill.referenceUrl) el("fieldReferenceUrl").value = fill.referenceUrl;
  if (fill.siteStyle && el("fieldSiteStyle"))
    el("fieldSiteStyle").value = fill.siteStyle;
  if (fill.colorTheme && el("fieldColorTheme"))
    el("fieldColorTheme").value = fill.colorTheme;
  if (fill.audience && el("fieldAudience"))
    el("fieldAudience").value = fill.audience;
  if (fill.primaryColor != null && el("fieldPrimaryColor"))
    el("fieldPrimaryColor").value = fill.primaryColor;
  // seed work order from analysis
  if (el("fieldGoal") && (fill.description || fill.nameZh)) {
    el("fieldGoal").value =
      fill.goal ||
      `做出受「${fill.nameZh || fill.name}」啟發嘅本機 Web App MVP`;
  }
  if (el("fieldNextTask") && !el("fieldNextTask").value) {
    el("fieldNextTask").value =
      fill.nextTask ||
      "按 design 約束起首頁骨架，並對齊參考站主要導航／CTA";
  }
  if (el("fieldInScope") && !el("fieldInScope").value) {
    el("fieldInScope").value = [
      "首頁／主要 landing",
      "關鍵服務或內容列表",
      "一個主要 CTA（例如預約／聯絡）",
    ].join("\n");
  }
  if (el("fieldOutOfScope") && !el("fieldOutOfScope").value) {
    el("fieldOutOfScope").value = ["真實付款", "完整會員系統", "公開雲端部署"].join(
      "\n"
    );
  }
  if (el("fieldAcceptance") && !el("fieldAcceptance").value) {
    el("fieldAcceptance").value = [
      "./start.sh 可啟動",
      "本機活躍連結打得開",
      "風格／主色／對象符合設定",
      "Site map 主要 route 有對應畫面或 stub",
      "AGENT.md 已生成",
    ].join("\n");
  }
  if (el("fieldSiteMap") && (fill.siteMap || fill.siteMapRoutes)) {
    el("fieldSiteMap").value =
      fill.siteMap ||
      (fill.siteMapRoutes || [])
        .map((r) => `${r.path} ${r.title || ""}`.trim())
        .join("\n");
  }
  if (el("fieldCodingLanguage") && fill.codingLanguage)
    el("fieldCodingLanguage").value = fill.codingLanguage;
  if (el("fieldRefDatabase") && fill.refDatabase)
    el("fieldRefDatabase").value = fill.refDatabase;
  if (el("fieldRefFrameworks") && fill.refFrameworks)
    el("fieldRefFrameworks").value = fill.refFrameworks;
  if (el("fieldTechSummary") && fill.techSummary)
    el("fieldTechSummary").value = fill.techSummary;
  if (el("fieldRefTechJson") && fill.refTech) {
    try {
      el("fieldRefTechJson").value = JSON.stringify(fill.refTech);
    } catch {
      el("fieldRefTechJson").value = "";
    }
  }
  if (fill.template) renderTemplateOptions(fill.template);
}

async function loadTemplates() {
  try {
    const data = await api("/api/templates");
    state.templates = data.templates || [];
  } catch {
    state.templates = [];
  }
  renderTemplateOptions();
}

el("btnNew").addEventListener("click", () => {
  el("formError").textContent = "";
  el("analyzeStatus").textContent = "";
  el("analyzeStatus").className = "meta";
  el("analyzeUrl").value = "";
  el("fieldReferenceUrl").value = "";
  renderTemplateOptions();
  el("modal").classList.remove("hidden");
});
el("btnCancel").addEventListener("click", () => el("modal").classList.add("hidden"));

el("btnAnalyzeUrl")?.addEventListener("click", async () => {
  let url = el("analyzeUrl").value.trim();
  const st = el("analyzeStatus");
  st.className = "meta";
  if (!url) {
    st.textContent = "請先貼上網址";
    st.classList.add("err");
    return;
  }
  // client-side normalize so input box also shows full URL after success
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    url = "https://" + url.replace(/^\/\//, "");
    el("analyzeUrl").value = url;
  }
  const btn = el("btnAnalyzeUrl");
  btn.disabled = true;
  st.textContent = "分析緊網站…（最多約 12 秒）";
  try {
    const r = await api("/api/analyze-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    applyAnalyzeFill(r.fill);
    if (r.sourceUrl) el("analyzeUrl").value = r.sourceUrl;
    const reasons = (r.analysis?.reasons || []).join("；");
    st.textContent = `✅ 已填表：${r.fetchedTitle || r.sourceUrl}${reasons ? " · " + reasons : ""}。可再手動改，然後撳建立。`;
    st.classList.add("ok");
  } catch (err) {
    st.textContent = `❌ ${err.message || err}`;
    st.classList.add("err");
  } finally {
    btn.disabled = false;
  }
});

el("newForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  if (!body.referenceUrl) delete body.referenceUrl;
  el("formError").textContent = "";
  try {
    // default goal from description if empty
    if (!body.goal && body.description) body.goal = body.description;
    if (!body.goal && body.nameZh) body.goal = body.nameZh;
    // parse hidden tech json if present
    if (body.refTechJson) {
      try {
        body.refTech = JSON.parse(body.refTechJson);
      } catch {
        /* ignore */
      }
      delete body.refTechJson;
    }
    const r = await api("/api/apps", {
      method: "POST",
      body: JSON.stringify(body),
    });
    el("modal").classList.add("hidden");
    e.target.reset();
    el("fieldReferenceUrl").value = "";
    await refresh();
    const hints = r.hints || {};
    const exp = r.export || {};
    const msg = [
      `已建立：${r.app.id}`,
      `路徑：${r.app.path}`,
      `Goal：${r.app.goal || "—"}`,
      `Next：${r.app.nextTask || "—"}`,
      `UI：${r.app.ports?.ui}`,
      ``,
      `已自動匯出：`,
      `  ${exp.projectAgentPath || exp.exportPath || "AGENT.md"}`,
      `  ${exp.projectPromptPath || "AGENT_PROMPT.md"}`,
      ``,
      `Grok：${hints.cwd || "grok --cwd " + r.app.path}`,
      ``,
      `（完整 Prompt 可喺卡片撳「複製完整 Prompt」）`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(hints.cwd || `grok --cwd ${r.app.path}`);
    } catch {}
    alert(msg);
  } catch (err) {
    el("formError").textContent = err.message || String(err);
  }
});

el("btnExportAll")?.addEventListener("click", async () => {
  try {
    const r = await api("/api/export-all", { method: "POST", body: "{}" });
    el("exportMsg").textContent = r.message || "已匯出全部";
    el("exportPaths").textContent = [
      `全部：${r.allPath || "—"}`,
      `目錄：${r.exportDir || "~/apps/_meta/exports"}`,
      ...(r.files || []).map(
        (f) => `- ${f.id}: ${f.exportPath}${f.projectAgentPath ? " + AGENT.md" : ""}`
      ),
    ].join("\n");
    el("exportModal").dataset.copy = r.allPath || "";
    el("exportModal").classList.remove("hidden");
  } catch (err) {
    alert(err.message || String(err));
  }
});

el("btnCloseExport")?.addEventListener("click", () =>
  el("exportModal").classList.add("hidden")
);
el("btnCopyExport")?.addEventListener("click", async () => {
  const p = el("exportModal").dataset.copy || el("exportPaths").textContent;
  await navigator.clipboard.writeText(p);
  el("btnCopyExport").textContent = "已複製";
  setTimeout(() => (el("btnCopyExport").textContent = "複製路徑"), 1200);
});

el("btnSummary").addEventListener("click", async () => {
  const res = await fetch(`${apiBase()}/api/summary`);
  const text = await res.text();
  el("summaryBody").textContent = text;
  el("summaryModal").classList.remove("hidden");
});
el("btnCloseSummary").addEventListener("click", () =>
  el("summaryModal").classList.add("hidden")
);
el("btnCopySummary").addEventListener("click", async () => {
  await navigator.clipboard.writeText(el("summaryBody").textContent);
  el("btnCopySummary").textContent = "已複製";
  setTimeout(() => (el("btnCopySummary").textContent = "複製"), 1200);
});

loadTemplates()
  .then(() => refresh())
  .catch((e) => {
    el("list").innerHTML = `<div class="card error">載入失敗：${escapeHtml(e.message)}</div>`;
  });
setInterval(() => refresh().catch(() => {}), 8000);

/* ══ Delete app: two-step confirmation ══════════════════════════════ */

let delState = null;

function humanBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Open the destructive-delete dialog.
 *
 * The card shows what would be removed — size, file count, the largest
 * files — before anything happens, so the owner confirms with facts rather
 * than a guess. The button only arms once the app id is typed correctly,
 * and the second step needs the word DELETE.
 */
async function openDeleteModal(id) {
  const app = state.apps.find((a) => a.id === id);
  if (!app) return;

  const modal = el("deleteModal");
  const name = app.nameZh || app.name || id;

  el("delName").textContent = name;
  el("delSub").textContent =
    "會停止服務、從 Hub 移除卡片，然後永久刪除整個資料夾（code + data）。呢個操作唔可以復原。";
  el("delPath").textContent = app.path || "—";
  el("delConfirmHint").textContent = id;
  el("delConfirmInput").value = "";
  el("delPhraseInput").value = "";
  el("delPhraseStep").hidden = true;
  el("delError").textContent = "";
  el("btnDelConfirm").disabled = true;
  el("delPreview").innerHTML = '<div class="del-stats"><div class="muted">統計中…</div></div>';
  el("delPath").textContent = app.path || "—";

  modal.classList.remove("hidden");
  el("delConfirmInput").focus();

  let preview;
  try {
    preview = await api(`/api/apps/${id}/delete-preview`);
  } catch (e) {
    el("delPreview").innerHTML = `<div class="del-warn">預覽失敗：${escapeHtml(String(e.message || e))}</div>`;
    return;
  }

  delState = { id, name, preview };

  if (!preview.canDelete) {
    el("delPath").textContent = preview.path || "—";
    el("delPreview").innerHTML = `<div class="del-warn">唔可以刪除：${escapeHtml(preview.reason || "未知原因")}</div>`;
    el("btnDelConfirm").disabled = true;
    return;
  }

  const stats = [
    ["檔案", preview.fileCount],
    ["資料夾", preview.dirCount],
    ["總大小", humanBytes(preview.totalBytes)],
  ];
  if (preview.dbType && preview.dbType !== "none") stats.push(["資料庫", preview.dbType]);
  if (preview.service) stats.push(["服務", preview.service.active === "active" ? "運行中" : preview.service.active]);

  el("delPreview").innerHTML = `
    <div class="del-stats">
      ${stats
        .map(
          ([label, value]) =>
            `<div class="del-stat"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`
        )
        .join("")}
    </div>
    ${
      preview.largest && preview.largest.length
        ? `<ul class="del-largest">${preview.largest
            .map(
              (f) =>
                `<li><span>${escapeHtml(f.name)}</span><span>${escapeHtml(humanBytes(f.bytes))}</span></li>`
            )
            .join("")}</ul>`
        : ""
    }
    <div class="del-warn">
      呢個資料夾會被永久刪除，唔會留喺垃圾桶。<br/>
      服務：${escapeHtml(preview.service?.unit || "無 systemd unit")}
    </div>`;

  updateDeleteConfirmState();
}

function updateDeleteConfirmState() {
  if (!delState) return;
  const typedId = el("delConfirmInput").value.trim();
  const idOk = typedId === delState.id;
  // The second step only appears once the id matches.
  el("delPhraseStep").hidden = !idOk;
  const phrase = el("delPhraseInput").value.trim();
  el("btnDelConfirm").disabled = !(idOk && phrase === "DELETE");
}

async function runDelete() {
  if (!delState) return;
  const btn = el("btnDelConfirm");
  btn.disabled = true;
  el("delError").textContent = "";
  try {
    await api(`/api/apps/${delState.id}`, {
      method: "DELETE",
      body: JSON.stringify({
        mode: "delete",
        confirmId: delState.id,
        confirmPhrase: "DELETE",
      }),
    });
    el("deleteModal").classList.add("hidden");
    delState = null;
    await refresh();
    toast("已永久刪除");
  } catch (e) {
    el("delError").textContent = String(e.message || e);
    btn.disabled = false;
  }
}

/* Delete modal wiring */
el("btnDelCancel")?.addEventListener("click", () => {
  el("deleteModal").classList.add("hidden");
  delState = null;
});
el("delConfirmInput")?.addEventListener("input", updateDeleteConfirmState);
el("delPhraseInput")?.addEventListener("input", updateDeleteConfirmState);
el("btnDelConfirm")?.addEventListener("click", runDelete);
el("deleteModal")?.addEventListener("click", (e) => {
  if (e.target === el("deleteModal")) {
    el("deleteModal").classList.add("hidden");
    delState = null;
  }
});
