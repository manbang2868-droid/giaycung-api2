// api/orders/index.js
import { google } from "googleapis";
import { allowCors, json, getSpreadsheetId, getSheetsClient } from "../_lib/gsheets.js"; 
// nếu file nằm api/orders/index.js thì đường dẫn là "../_lib/gsheets.js"

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    // ... phần xử lý GET/POST như bạn đang có ...
    // thay res.status(...).json(...) => json(res, status, data)

    if (req.method === "GET") {
      // ...
      return json(res, 200, { ok: true, data });
    }

    if (req.method === "POST") {
      // ...
      return json(res, 201, { ok: true, data: createdOrder });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders index error:", err);
    return json(res, 500, { ok: false, message: err?.message || "Server error" });
  }
}
