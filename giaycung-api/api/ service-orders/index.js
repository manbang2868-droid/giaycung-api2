import { getSheetsClient, json, allowCors, requireAdmin } from "../_lib/gsheets";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
const TAB_ORDERS = process.env.SHEET_TAB_ORDERS || "service_orders";

function getBearerToken(req) {
  const auth = req.headers?.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : "";
}

function isAdmin(req) {
  // hỗ trợ cả Bearer + X-Admin-Token
  const bearer = getBearerToken(req);
  if (bearer) {
    // hack: gán tạm để reuse requireAdmin (vì requireAdmin check x-admin-token)
    req.headers["x-admin-token"] = bearer;
  }
  return requireAdmin(req);
}

export default async function handler(req, res) {
  try {
    if (allowCors(req, res)) return;

    if (!SPREADSHEET_ID) return json(res, 500, { message: "Missing GOOGLE_SHEETS_ID" });

    const sheets = await getSheetsClient();

    // ✅ GET: list orders
    if (req.method === "GET") {
      // đọc dữ liệu đơn từ sheet
      // Giả sử bạn lưu header ở hàng 1, data từ hàng 2
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TAB_ORDERS}!A1:Z`,
      });

      const rows = r.data.values || [];
      if (rows.length <= 1) return json(res, 200, { orders: [] });

      const header = rows[0];
      const toObj = (row) => {
        const obj = {};
        header.forEach((k, i) => (obj[k] = row[i] ?? ""));
        // parse shoes json nếu có cột shoes
        if (obj.shoes && typeof obj.shoes === "string") {
          try { obj.shoes = JSON.parse(obj.shoes); } catch { obj.shoes = []; }
        } else if (!obj.shoes) {
          obj.shoes = [];
        }
        // normalize types
        obj.totalAmount = Number(obj.totalAmount || 0);
        return obj;
      };

      const orders = rows.slice(1).map(toObj).filter(o => o.id);
      return json(res, 200, { orders });
    }

    // ✅ POST: create order (ADMIN)
    if (req.method === "POST") {
      if (!isAdmin(req)) return json(res, 401, { message: "Unauthorized" });

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { customerName, customerPhone, totalAmount, assignedTo } = body;

      if (!customerName || !customerPhone || totalAmount == null) {
        return json(res, 400, { message: "Missing fields" });
      }

      const id = `ord_${Date.now()}`;
      const orderNumber = body.orderNumber || ""; // nếu bạn muốn generate theo sheet thì xử lý khác
      const createdDate = new Date().toISOString().slice(0, 10);

      // bạn nên đảm bảo sheet có header:
      // id | orderNumber | customerName | customerPhone | createdDate | totalAmount | status | assignedTo | shoes
      const newRow = [
        id,
        orderNumber || id.replace("ord_", "ORD-"),
        customerName,
        customerPhone,
        createdDate,
        String(Number(totalAmount)),
        "pending",
        assignedTo || "",
        "[]",
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TAB_ORDERS}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [newRow] },
      });

      return json(res, 201, { ok: true, id });
    }

    // method not allowed
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return json(res, 405, { message: "Method Not Allowed" });
  } catch (e) {
    return json(res, 500, { message: e?.message || "Server error" });
  }
}
