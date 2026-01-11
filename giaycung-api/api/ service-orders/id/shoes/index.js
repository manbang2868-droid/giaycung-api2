import {
  setCors,
  getSheetsClient,
  ensureHeaderRow,
  appendRow,
  safeTrim,
  jsonParseSafe,
} from "../../../_lib/sheets";

import { requireAdmin } from "../../../_lib/auth";

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

function makeId(prefix) {
  const s = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${prefix}-${s}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const orderId = safeTrim(req.query.id);
  if (!orderId) return res.status(400).json({ message: "Missing orderId" });

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    await ensureHeaderRow({
      sheets,
      spreadsheetId,
      sheetName: SHOES_SHEET,
      header: SHOES_HEADER,
    });

    if (req.method === "POST") {
      if (!requireAdmin(req, res)) return;

      const body = req.body || {};
      const name = safeTrim(body.name);
      const service = safeTrim(body.service);
      const status = safeTrim(body.status) || "received";
      const notes = safeTrim(body.notes);

      let images = body.images;
      if (typeof images === "string") images = jsonParseSafe(images, []);
      if (!Array.isArray(images)) images = [];

      if (!name || !service)
        return res
          .status(400)
          .json({ message: "Thiếu thông tin giày (name/service)" });

      const allowed = ["received", "processing", "completed"];
      if (!allowed.includes(status))
        return res
          .status(400)
          .json({ message: "Trạng thái giày không hợp lệ" });

      const id = makeId("SH");

      await appendRow(sheets, spreadsheetId, `${SHOES_SHEET}!A:H`, [
        id,
        orderId,
        name,
        service,
        status,
        JSON.stringify(images),
        notes,
        "0",
      ]);

      return res.status(201).json({
        data: { id, orderId, name, service, status, images, notes },
      });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (err) {
    console.error("shoes/index error:", err);
    return res
      .status(500)
      .json({ message: "Server error", detail: String(err?.message || err) });
  }
}
