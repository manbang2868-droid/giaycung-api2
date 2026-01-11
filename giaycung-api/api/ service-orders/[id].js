import {
  setCors,
  getSheetsClient,
  ensureHeaderRow,
  updateRowById,
  safeTrim,
  toNumber,
} from "../_lib/sheets";

import { requireAdmin } from "../_lib/auth";

const ORDERS_SHEET = "service_orders";
const ORDERS_HEADER = [
  "id",
  "orderNumber",
  "customerName",
  "customerPhone",
  "createdAt",
  "totalAmount",
  "status",
  "assignedTo",
  "deleted",
];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const id = safeTrim(req.query.id);
  if (!id) return res.status(400).json({ message: "Missing id" });

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    await ensureHeaderRow({
      sheets,
      spreadsheetId,
      sheetName: ORDERS_SHEET,
      header: ORDERS_HEADER,
    });

    if (req.method === "PATCH") {
      if (!requireAdmin(req, res)) return;

      const body = req.body || {};
      const patch = {};

      if (body.status !== undefined) {
        const st = safeTrim(body.status);
        const allowed = ["pending", "processing", "completed", "cancelled"];
        if (!allowed.includes(st))
          return res.status(400).json({ message: "Status không hợp lệ" });
        patch.status = st;
      }

      if (body.assignedTo !== undefined)
        patch.assignedTo = safeTrim(body.assignedTo);
      if (body.customerName !== undefined)
        patch.customerName = safeTrim(body.customerName);
      if (body.customerPhone !== undefined)
        patch.customerPhone = safeTrim(body.customerPhone);
      if (body.totalAmount !== undefined)
        patch.totalAmount = String(toNumber(body.totalAmount));

      const ok = await updateRowById({
        sheets,
        spreadsheetId,
        sheetName: ORDERS_SHEET,
        idValue: id,
        idColName: "id",
        patch,
      });

      if (!ok.ok)
        return res.status(404).json({ message: ok.message || "Not found" });
      return res.status(200).json({ data: { id, ...patch } });
    }

    if (req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;

      const ok = await updateRowById({
        sheets,
        spreadsheetId,
        sheetName: ORDERS_SHEET,
        idValue: id,
        idColName: "id",
        patch: { deleted: "1", status: "cancelled" },
      });

      if (!ok.ok)
        return res.status(404).json({ message: ok.message || "Not found" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (err) {
    console.error("service-orders/[id] error:", err);
    return res
      .status(500)
      .json({ message: "Server error", detail: String(err?.message || err) });
  }
}
