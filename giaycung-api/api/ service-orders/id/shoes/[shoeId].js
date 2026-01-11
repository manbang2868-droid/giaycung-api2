import {
  setCors,
  getSheetsClient,
  ensureHeaderRow,
  updateRowById,
  safeTrim,
  jsonParseSafe,
} from "../../../../_lib/sheets";

import { requireAdmin } from "../../../../_lib/auth";

const SHOES_SHEET = "service_order_shoes";
const SHOES_HEADER = [
  "id",
  "orderId",
  "name",
  "service",
  "status",
  "images",
  "notes",
  "deleted",
];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const orderId = safeTrim(req.query.id);
  const shoeId = safeTrim(req.query.shoeId);
  if (!orderId || !shoeId)
    return res.status(400).json({ message: "Missing params" });

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    await ensureHeaderRow({
      sheets,
      spreadsheetId,
      sheetName: SHOES_SHEET,
      header: SHOES_HEADER,
    });

    if (req.method === "PATCH") {
      if (!requireAdmin(req, res)) return;

      const body = req.body || {};
      const patch = {};

      if (body.status !== undefined) {
        const st = safeTrim(body.status);
        const allowed = ["received", "processing", "completed"];
        if (!allowed.includes(st))
          return res
            .status(400)
            .json({ message: "Trạng thái giày không hợp lệ" });
        patch.status = st;
      }

      if (body.name !== undefined) patch.name = safeTrim(body.name);
      if (body.service !== undefined) patch.service = safeTrim(body.service);
      if (body.notes !== undefined) patch.notes = safeTrim(body.notes);

      if (body.images !== undefined) {
        let images = body.images;
        if (typeof images === "string") images = jsonParseSafe(images, []);
        if (!Array.isArray(images)) images = [];
        patch.images = JSON.stringify(images);
      }

      const ok = await updateRowById({
        sheets,
        spreadsheetId,
        sheetName: SHOES_SHEET,
        idValue: shoeId,
        idColName: "id",
        patch,
      });

      if (!ok.ok)
        return res.status(404).json({ message: ok.message || "Not found" });
      return res.status(200).json({ data: { id: shoeId, orderId, ...patch } });
    }

    if (req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;

      const ok = await updateRowById({
        sheets,
        spreadsheetId,
        sheetName: SHOES_SHEET,
        idValue: shoeId,
        idColName: "id",
        patch: { deleted: "1" },
      });

      if (!ok.ok)
        return res.status(404).json({ message: ok.message || "Not found" });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (err) {
    console.error("shoes/[shoeId] error:", err);
    return res
      .status(500)
      .json({ message: "Server error", detail: String(err?.message || err) });
  }
}
