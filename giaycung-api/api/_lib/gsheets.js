// api/_lib/gsheets.js
import { google } from "googleapis";

const ALLOWED_ORIGIN = "https://giay-cung4.vercel.app";

/** ===== Utils ===== */
function getPrivateKey() {
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

/** ===== Spreadsheet ID ===== */
export function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_ID (or SPREADSHEET_ID)");
  return String(id).trim();
}

/** ===== Google Auth ===== */
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

/** ===== CORS ===== */
export function allowCors(req, res) {
  const origin = req.headers?.origin;

  if (!origin || origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

/** ===== JSON RESPONSE (FIX LỖI origin undefined) ===== */
export function json(res, status, data) {
  const origin = res?.req?.headers?.origin;

  if (!origin || origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Content-Type", "application/json");

  res.statusCode = status;
  res.end(JSON.stringify(data));
}

/** ===== ADMIN TOKEN ===== */
export function requireAdmin(req) {
  const secret =
    process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN || "";

  if (!secret) return true; // cho phép nếu chưa set token

  const got =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return got === secret;
}

/** ===== Get Sheet ID by tab name ===== */
export async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const found = meta.data.sheets?.find(
    (s) => s.properties?.title === title
  );

  if (!found?.properties?.sheetId) {
    throw new Error(`Sheet tab not found: ${title}`);
  }

  return found.properties.sheetId;
}
