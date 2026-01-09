import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const SHEET_NAME = "contact";

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "";
    const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL || "";
    const GOOGLE_PRIVATE_KEY_RAW = process.env.GOOGLE_PRIVATE_KEY || "";

    if (!SPREADSHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_RAW) {
      return res.status(500).json({
        ok: false,
        message:
          "Missing ENV: SPREADSHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY",
      });
    }

    const GOOGLE_PRIVATE_KEY = GOOGLE_PRIVATE_KEY_RAW.replace(/\\n/g, "\n");

    // ✅ JWT auth bằng object config (tránh lỗi TS constructor)
    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: SCOPES,
    });

    const sheets = google.sheets({ version: "v4", auth });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z`,
    });

    const rows = result.data.values || [];
    if (rows.length < 2) {
      return res.status(200).json({ ok: true, data: [] });
    }

    const headers = rows[0].map((h) => String(h).trim());

    const data = rows.slice(1).map((row) => {
      const item: any = {};
      headers.forEach((key, i) => {
        item[key] = row[i] ?? "";
      });
      return item;
    });

    return res.status(200).json({ ok: true, data });
  } catch (err: any) {
    console.error("CONTACT API ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
