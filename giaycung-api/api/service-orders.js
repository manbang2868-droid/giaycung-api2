// api/service-orders.js
import { allowCors, json, requireAdmin, getSheetsClient, getSpreadsheetId } from "./_lib/gsheets.js";

const TAB_ORDERS = "service_orders"; // tên sheet tab (đổi đúng theo sheet của bạn)

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function nowIsoDate() {
  // yyyy-mm-dd
  return new Date().toISOString().slice(0, 10);
}

function makeOrderNumber(n) {
  return `ORD-${String(n).padStart(3, "0")}`;
}

export default async function handler(req, res) {
  try {
    if (allowCors(req, res)) return;

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // ===== GET /api/service-orders =====
    if (req.method === "GET") {
      // đọc all rows
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${TAB_ORDERS}!A:Z`,
      });

      const rows = r.data.values || [];
      if (rows.length <= 1) return json(res, 200, { orders: [] });

      // Header ví dụ:
      // id | orderNumber | customerName | customerPhone | createdDate | totalAmount | status | assignedTo | shoesJson
      const header = rows[0];
      const dataRows = rows.slice(1);

      const idx = (name) => header.indexOf(name);

      const orders = dataRows
        .filter((row) => row.some((c) => String(c || "").trim() !== ""))
        .map((row) => {
          const shoesRaw = row[idx("shoesJson")] || "[]";
          let shoes = [];
          try { shoes = JSON.parse(shoesRaw); } catch { shoes = []; }

          return {
            id: row[idx("id")] || "",
            orderNumber: row[idx("orderNumber")] || "",
            customerName: row[idx("customerName")] || "",
            customerPhone: row[idx("customerPhone")] || "",
            createdDate: row[idx("createdDate")] || "",
            totalAmount: Number(row[idx("totalAmount")] || 0),
            status: row[idx("status")] || "pending",
            assignedTo: row[idx("assignedTo")] || "",
            shoes: Array.isArray(shoes) ? shoes : [],
          };
        });

      return json(res, 200, { orders });
    }

    // ===== POST /api/service-orders (ADMIN) =====
    if (req.method === "POST") {
      if (!requireAdmin(req)) return json(res, 401, { message: "Unauthorized" });

      const body = await readBody(req);
      const { customerName, customerPhone, totalAmount, assignedTo } = body || {};

      if (!customerName || !customerPhone || typeof totalAmount !== "number") {
        return json(res, 400, { message: "Missing required fields" });
      }

      // đọc current rows để tạo STT orderNumber đơn giản
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${TAB_ORDERS}!A:A`,
      });
      const count = Math.max((r.data.values || []).length - 1, 0);
      const id = `ord_${Date.now()}`;
      const orderNumber = makeOrderNumber(count + 1);

      const newOrder = [
        id,
        orderNumber,
        customerName,
        customerPhone,
        nowIsoDate(),
        String(totalAmount),
        "pending",
        assignedTo || "",
        JSON.stringify([]), // shoesJson
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${TAB_ORDERS}!A:Z`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [newOrder] },
      });

      return json(res, 200, { ok: true, id, orderNumber });
    }

    // ===== method khác =====
    return json(res, 405, { message: "Method Not Allowed" });
  } catch (e) {
    return json(res, 500, { message: e?.message || "Server error" });
  }
}
