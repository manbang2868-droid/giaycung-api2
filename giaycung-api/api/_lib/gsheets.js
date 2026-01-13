// api/_lib/gsheets.js
import { google } from "googleapis";
import crypto from "crypto";

/** ===== Utils ===== */
function safeTrim(x) {
  return String(x ?? "").trim();
}

/** ===== CORS WHITELIST ===== */
// 👉 ƯU TIÊN dùng ENV: ALLOWED_ORIGINS
// ví dụ:
// https://giaycung.vn,https://www.giaycung.vn,https://giay-cung4.vercel.app
const ALLOWED_ORIGINS = safeTrim(process.env.ALLOWED_ORIGINS)
  ? safeTrim(process.env.ALLOWED_ORIGINS)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [
      "https://giaycung.vn",
      "https://www.giaycung.vn",
      "https://giay-cung4.vercel.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ];

function isAllowedOrigin(origin) {
  if (!origin) return false;

  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // ✅ cho phép vercel preview domain
  if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;

  return false;
}

function setCorsHeaders(req, res) {
  const origin = req.headers?.origin;

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

/** ===== CORS HANDLER ===== */
export function allowCors(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

/** ===== JSON RESPONSE ===== */
export function json(res, status, data) {
  const req = res?.req;
  setCorsHeaders(req, res);

  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

/** ===== GOOGLE SHEETS ===== */
function getPrivateKey() {
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

export function getSpreadsheetId() {
  const id = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_ID (or SPREADSHEET_ID)");
  return safeTrim(id);
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

/** ===== ADMIN TOKEN ===== */
function base64urlToBuffer(b64url) {
  const b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64");
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyJwtHs256(tokenRaw, secret) {
  const token = safeTrim(tokenRaw);
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false };

  const [h, p, sig] = parts;
  const header = safeJsonParse(base64urlToBuffer(h).toString("utf8"));
  const payload = safeJsonParse(base64urlToBuffer(p).toString("utf8"));

  if (!header || header.alg !== "HS256") return { ok: false };
  if (!payload) return { ok: false };

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url");

  if (!timingSafeEqualStr(sig, expectedSig)) return { ok: false };

  if (payload.exp) {
    const expMs = payload.exp < 1e12 ? payload.exp * 1000 : payload.exp;
    if (Date.now() > expMs) return { ok: false };
  }

  if (payload.role && payload.role !== "admin") return { ok: false };

  return { ok: true, payload };
}

function getAdminSecret() {
  return (
    safeTrim(process.env.JWT_SECRET) ||
    safeTrim(process.env.ADMIN_TOKEN_SECRET) ||
    safeTrim(process.env.ADMIN_TOKEN) ||
    ""
  );
}

export function requireAdmin(req) {
  const secret = getAdminSecret();
  if (!secret) return true;

  const xToken = safeTrim(req.headers?.["x-admin-token"]);
  const auth = safeTrim(req.headers?.authorization || "");
  const bearer = auth.replace(/^Bearer\s+/i, "");
  const token = xToken || bearer;

  if (!token) return false;
  if (token === secret) return true;

  return verifyJwtHs256(token, secret).ok === true;
}

/** ===== SHEET HELPERS ===== */
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
