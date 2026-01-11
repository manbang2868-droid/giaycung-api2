import { google } from "googleapis";

function safeTrim(x) {
  return String(x ?? "").trim();
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function getSheetsClient() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  if (!spreadsheetId || !client_email || !private_key) {
    const miss = [
      !spreadsheetId ? "SPREADSHEET_ID" : null,
      !client_email ? "GOOGLE_CLIENT_EMAIL" : null,
      !private_key ? "GOOGLE_PRIVATE_KEY" : null,
    ].filter(Boolean);
    throw new Error(`Missing ENV: ${miss.join(", ")}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
}

async function readSheet(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function updateRowById(
  sheets,
  spreadsheetId,
  sheetName,
  id,
  idColIndex,
  patch
) {
  const rows = await readSheet(sheets, spreadsheetId, `${sheetName}!A:Z`);
  if (rows.length <= 1) return { ok: false, message: "Sheet trống" };

  const header = rows[0];
  const body = rows.slice(1);

  const idx = body.findIndex((r) => safeTrim(r[idColIndex]) === id);
  if (idx === -1) return { ok: false, message: "Order not found" };

  const rowIndexInSheet = idx + 2;
  const current = body[idx];

  const colIndexMap = Object.fromEntries(
    header.map((h, i) => [safeTrim(h), i])
  );

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
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const ORDERS_SHEET = "orders";

    const id = safeTrim(req.query.id); // /api/orders/:id
    if (!id) return res.status(400).json({ ok: false, message: "Missing id" });

    if (req.method === "PATCH") {
      const status = safeTrim(req.body?.status);
      const allowed = ["pending", "processing", "completed", "cancelled"];
      if (!allowed.includes(status)) {
        return res
          .status(400)
          .json({ ok: false, message: "Status không hợp lệ" });
      }

      const ok = await updateRowById(
        sheets,
        spreadsheetId,
        ORDERS_SHEET,
        id,
        0,
        { status }
      );
      if (!ok.ok)
        return res
          .status(404)
          .json({ ok: false, message: ok.message || "Order not found" });

      return res.status(200).json({ ok: true, data: { id, status } });
    }

    if (req.method === "DELETE") {
      // soft delete => cancelled
      const ok = await updateRowById(
        sheets,
        spreadsheetId,
        ORDERS_SHEET,
        id,
        0,
        { status: "cancelled" }
      );
      if (!ok.ok)
        return res
          .status(404)
          .json({ ok: false, message: ok.message || "Order not found" });

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders [id] API error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      detail: String(err?.message || err),
    });
  }
}
