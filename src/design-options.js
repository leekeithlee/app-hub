/** Design / branding options for new app cards */

export const SITE_STYLES = [
  { id: "minimal", label: "簡約 Minimal", labelZh: "簡約" },
  { id: "modern", label: "現代 Modern", labelZh: "現代" },
  { id: "corporate", label: "商務 Corporate", labelZh: "商務" },
  { id: "playful", label: "活潑 Playful", labelZh: "活潑" },
  { id: "tech", label: "科技 Tech", labelZh: "科技" },
  { id: "elegant", label: "優雅 Elegant", labelZh: "優雅" },
  { id: "dashboard", label: "儀表板 Dashboard", labelZh: "儀表板" },
  { id: "content", label: "內容／部落格 Content", labelZh: "內容" },
  { id: "ecommerce", label: "商店 Ecommerce", labelZh: "商店" },
  { id: "brutalist", label: "粗野／個性 Brutalist", labelZh: "粗野" },
];

export const COLOR_THEMES = [
  { id: "blue", label: "藍色 Blue", hex: "#3b82f6", labelZh: "藍" },
  { id: "indigo", label: "靛藍 Indigo", hex: "#6366f1", labelZh: "靛藍" },
  { id: "teal", label: "青綠 Teal", hex: "#14b8a6", labelZh: "青綠" },
  { id: "green", label: "綠色 Green", hex: "#22c55e", labelZh: "綠" },
  { id: "orange", label: "橙色 Orange", hex: "#f97316", labelZh: "橙" },
  { id: "red", label: "紅色 Red", hex: "#ef4444", labelZh: "紅" },
  { id: "pink", label: "粉紅 Pink", hex: "#ec4899", labelZh: "粉紅" },
  { id: "purple", label: "紫色 Purple", hex: "#a855f7", labelZh: "紫" },
  { id: "slate", label: "灰藍 Slate", hex: "#64748b", labelZh: "灰藍" },
  { id: "dark", label: "深色 Dark", hex: "#0f172a", labelZh: "深色" },
  { id: "light", label: "淺色 Light", hex: "#f8fafc", labelZh: "淺色" },
  { id: "multi", label: "多彩 Multi", hex: "linear", labelZh: "多彩" },
];

export const AUDIENCES = [
  { id: "personal", label: "自己／個人 Personal", labelZh: "個人" },
  { id: "family", label: "家庭 Family", labelZh: "家庭" },
  { id: "friends", label: "朋友 Friends", labelZh: "朋友" },
  { id: "internal", label: "內部／公司 Internal", labelZh: "內部" },
  { id: "customers", label: "客戶 Customers", labelZh: "客戶" },
  { id: "developers", label: "開發者 Developers", labelZh: "開發者" },
  { id: "students", label: "學生 Students", labelZh: "學生" },
  { id: "public", label: "公眾 Public", labelZh: "公眾" },
  { id: "kids", label: "小朋友 Kids", labelZh: "小朋友" },
  { id: "seniors", label: "長輩 Seniors", labelZh: "長輩" },
];

export function labelOf(list, id) {
  return list.find((x) => x.id === id)?.label || id || "—";
}
