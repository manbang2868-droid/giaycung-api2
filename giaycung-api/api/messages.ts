import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_NAME = "messages"; // ✅ đặt đúng tên tab trong Google Sheet

function cors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function safeTrim(x: any) {
  return String(x ?? "").trim();
}

export default async function handler(req: any, res: any) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

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

    const auth = new google.auth.JWT({
      email: GOOGLE_CLIENT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: SCOPES,
    });

    const sheets = google.sheets({ version: "v4", auth });

    // ✅ GET: lấy danh sách messages (admin sẽ dùng)
    if (req.method === "GET") {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:Z`,
      });

      const rows = result.data.values || [];
      if (rows.length < 2) return res.status(200).json({ ok: true, data: [] });

      const headers = rows[0].map((h) => String(h).trim());
      const data = rows.slice(1).map((row) => {
        const item: any = {};
        headers.forEach((key, i) => {
          item[key] = row[i] ?? "";
        });
        return item;
      });

      return res.status(200).json({ ok: true, data });
    }

    // ✅ POST: nhận form từ Contact.tsx và append 1 dòng
    if (req.method === "POST") {
      const fullName = safeTrim(req.body?.fullName);
      const phone = safeTrim(req.body?.phone);
      const email = safeTrim(req.body?.email);
      const message = safeTrim(req.body?.message);
      const source = safeTrim(req.body?.source) || "contact-page";

      if (!fullName || !phone || !message) {
        return res.status(400).json({
          ok: false,
          message: "Thiếu dữ liệu bắt buộc: fullName / phone / message",
        });
      }

      const createdAt = new Date().toISOString();

      // ✅ Append đúng thứ tự cột: createdAt | fullName | phone | email | message | source
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[createdAt, fullName, phone, email, message, source]],
        },
      });

      return res.status(200).json({ ok: true, message: "Đã lưu tin nhắn" });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed" });
  } catch (err: any) {
    console.error("MESSAGES API ERROR:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
