/** Available create-app templates shown in App Hub UI */
export const TEMPLATES = [
  {
    id: "static-trial",
    label: "純 HTML（最輕）",
    labelEn: "Static HTML",
    stack: "Static HTML + Python http.server",
    hasUi: true,
    hasApi: false,
    hasDb: false,
    dbType: null,
    description: "單頁 HTML/CSS/JS，最快試 idea",
  },
  {
    id: "react-trial",
    label: "React + Vite（前端）",
    labelEn: "React + Vite",
    stack: "React + Vite",
    hasUi: true,
    hasApi: false,
    hasDb: false,
    dbType: null,
    description: "現代前端 UI，適合畫面／互動試驗",
  },
  {
    id: "api-json",
    label: "API + JSON 資料庫",
    labelEn: "API + JSON DB",
    stack: "Node Express + JSON file DB",
    hasUi: true,
    hasApi: true,
    hasDb: true,
    dbType: "json-file",
    description: "後端 API + 檔案資料庫，有簡單說明頁",
  },
  {
    id: "fullstack-db",
    label: "全端 + 資料庫（React+API+DB）",
    labelEn: "Fullstack + Database",
    stack: "React + Vite + Express + JSON file DB",
    hasUi: true,
    hasApi: true,
    hasDb: true,
    dbType: "json-file",
    description: "完整 Web App：畫面 + API + 可持久化資料（db.json）",
  },
];

export function getTemplateMeta(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}
