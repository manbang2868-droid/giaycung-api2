// api/_lib/gsheets.js
import { google } from "googleapis";

function getPrivateKey() {
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

export function getSpreadsheetId() {
  // hỗ trợ cả 2 tên env để khỏi lỗi
  return process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID || "";
}

export function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = getPrivateKey();
  const spreadsheetId = getSpreadsheetId();

  if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID (or SPREADSHEET_ID)");
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

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export function allowCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

function readBearer(req) {
  const a = req.headers?.authorization || "";
  const m = typeof a === "string" ? a.match(/^Bearer\s+(.+)$/i) : null;
  return m?.[1] || "";
}

// Bảo vệ PUT/PATCH/DELETE/POST bằng token
export function requireAdmin(req) {
  const need = process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN || "";
  if (!need) return true; // chưa set thì bỏ qua

  const gotHeader = req.headers["x-admin-token"];
  const got = (Array.isArray(gotHeader) ? gotHeader[0] : gotHeader) || readBearer(req);

  return got === need;
}
