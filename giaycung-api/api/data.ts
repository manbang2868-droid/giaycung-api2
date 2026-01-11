// api/data.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCors, json, getSheetsClient, getSpreadsheetId } from "./_lib/gsheets";

type DataType = "services" | "products" | "news" | "orders" | "serviceOrders";

const TAB_MAP: Record<DataType, string> = {
  services: "services",
  products: "products",
  news: "news",
  orders: "orders",
  serviceOrders: "service_orders",
};

function rowsToObjects(rows: any[][]) {
  if (!rows || rows.length === 0) return [];
  const header = rows[0].map((h) => String(h || "").trim());
  return rows.slice(1).filter(r => r.some(c => String(c||"").trim() !== "")).map((r) => {
    const obj: any = {};
    header.forEach((k, i) => (obj[k] = r[i] ?? ""));
    return obj;
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (allowCors(req, res)) return;

    if (req.method !== "GET") {
      return json(res, 405, { message: "Method Not Allowed" });
    }

    const type = String(req.query.type || "") as DataType;
    if (!type || !(type in TAB_MAP)) {
      return json(res, 400, { message: "Missing/invalid type" });
    }

    const tab = TAB_MAP[type];

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:Z`,
    });

    const rows = r.data.values || [];
    const items = rowsToObjects(rows);

    return json(res, 200, { type, tab, items });
  } catch (e: any) {
    return json(res, 500, { message: e?.message || "Server error" });
  }
}
