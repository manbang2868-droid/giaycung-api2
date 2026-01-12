// api/_lib/gsheets.js
import { google } from "googleapis";

function getPrivateKey() {
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

// ✅ dùng GOOGLE_SHEETS_ID fallback SPREADSHEET_ID
export function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_ID (or SPREADSHEET_ID)");
  return id;
}

export function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = getPrivateKey();
  if (!email) throw new Error("Missing GOOGLE_CLIENT_EMAIL");
  if (!key) throw new Error("Missing GOOGLE_PRIVATE_KEY");

  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function getSheetsClient() {
  const auth = getAuth();
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

export function allowCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");

  // ✅ luôn kèm CORS kể cả khi error
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  res.end(JSON.stringify(data));
}

// ✅ ADMIN token (đặt trong ENV của API project)
export function requireAdmin(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN || "";
  if (!secret) return true;

  const got =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return got === secret;
}
