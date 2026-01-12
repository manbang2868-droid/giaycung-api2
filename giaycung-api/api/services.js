// api/services.js
import { google } from "googleapis";

const SHEET_NAME = "services";
const RANGE = `${SHEET_NAME}!A:Z`;

function getAuth() {
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const email = process.env.GOOGLE_CLIENT_EMAIL;

  if (!key || !email) throw new Error("Missing Google credentials");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(200).end();
    }

    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, message: "Method not allowed" });
    }

    const spreadsheetId =
      process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("Missing spreadsheet id");

    const auth = getAuth();
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
    });

    const values = resp.data.values || [];
    const headers = values[0] || [];

    const data = values.slice(1)
      .map((row) => {
        const obj = {};
        headers.forEach((h, i) => (obj[h] = row[i] || ""));
        return obj;
      })
      .filter((x) => x.status === "published");

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("SERVICES ERROR:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({
      ok: false,
      message: err.message,
    });
  }
}
