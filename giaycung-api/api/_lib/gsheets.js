// api/_lib/gsheets.js
import { google } from "googleapis";

function getPrivateKey() {
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

export function getSpreadsheetId() {
  // bạn đang dùng GOOGLE_SHEETS_ID trên Vercel
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Admin-Token, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

export function requireAdmin(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET; // bạn hỏi cái này
  if (!secret) return true; // nếu chưa set thì bỏ qua
  const got =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return got === secret;
}
