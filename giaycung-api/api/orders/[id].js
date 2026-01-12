// api/orders/[id].js
import { allowCors, json, getSheetsClient, requireAdmin } from "../_lib/gsheets.js";

function safeTrim(x) {
  return String(x ?? "").trim();
}

async function readSheet(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function updateRowById(sheets, spreadsheetId, sheetName, id, idColIndex, patch) {
  const rows = await readSheet(sheets, spreadsheetId, `${sheetName}!A:Z`);
  if (rows.length <= 1) return { ok: false, message: "Sheet trống" };

  const header = rows[0];
  const body = rows.slice(1);

  const idx = body.findIndex((r) => safeTrim(r[idColIndex]) === id);
  if (idx === -1) return { ok: false, message: "Order not found" };

  const rowIndexInSheet = idx + 2; // header + 1-indexed
  const current = body[idx];

  const colIndexMap = Object.fromEntries(header.map((h, i) => [safeTrim(h), i]));
  const updated = [...current];

  for (const [k, v] of Object.entries(patch)) {
    const col = colIndexMap[k];
    if (col === undefined) continue;
    updated[col] = v;
  }

  const endCol = String.fromCharCode("A".charCodeAt(0) + header.length - 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${rowIndexInSheet}:${endCol}${rowIndexInSheet}`,
    valueInputOption: "RAW",
    requestBody: { values: [updated.slice(0, header.length)] },
  });

  return { ok: true };
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  // ✅ admin-only cho PATCH/DELETE
  if (req.method === "PATCH" || req.method === "DELETE") {
    if (!requireAdmin(req)) {
      return json(res, 401, {
        ok: false,
        message: "Unauthorized (missing/invalid X-Admin-Token)",
      });
    }
  }

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const ORDERS_SHEET = "orders";

    const id = safeTrim(req.query.id);
    if (!id) return json(res, 400, { ok: false, message: "Missing id" });

    if (req.method === "PATCH") {
      const status = safeTrim(req.body?.status);
      const allowed = ["pending", "processing", "completed", "cancelled"];
      if (!allowed.includes(status)) {
        return json(res, 400, { ok: false, message: "Status không hợp lệ" });
      }

      const ok = await updateRowById(sheets, spreadsheetId, ORDERS_SHEET, id, 0, { status });
      if (!ok.ok) return json(res, 404, { ok: false, message: ok.message || "Order not found" });

      return json(res, 200, { ok: true, data: { id, status } });
    }

    if (req.method === "DELETE") {
      const ok = await updateRowById(sheets, spreadsheetId, ORDERS_SHEET, id, 0, {
        status: "cancelled",
      });
      if (!ok.ok) return json(res, 404, { ok: false, message: ok.message || "Order not found" });

      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders [id] error:", err);
    return json(res, 500, {
      ok: false,
      message: "Server error",
      detail: String(err?.message || err),
    });
  }
}
