// api/_lib/gsheets.js
import { google } from "googleapis";
import crypto from "crypto";

const ALLOWED_ORIGIN = "https://giay-cung4.vercel.app";

/** ===== Utils ===== */
function safeTrim(x) {
  return String(x ?? "").trim();
}

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

/** ===== ADMIN TOKEN (hỗ trợ cả token == secret và JWT HS256) ===== */
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
  if (parts.length !== 3) return { ok: false, reason: "bad_format" };

  const [h, p, sig] = parts;

  const header = safeJsonParse(base64urlToBuffer(h).toString("utf8"));
  const payload = safeJsonParse(base64urlToBuffer(p).toString("utf8"));

  if (!header || header.alg !== "HS256") return { ok: false, reason: "bad_alg" };
  if (!payload) return { ok: false, reason: "bad_payload" };

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url"); // Node 18+ OK

  if (!timingSafeEqualStr(sig, expectedSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  // exp có thể là seconds (chuẩn JWT) hoặc milliseconds (custom)
  if (payload.exp && typeof payload.exp === "number") {
    const exp = payload.exp;
    const nowMs = Date.now();

    // nếu exp nhỏ hơn 1e12 thì coi là seconds
    const expMs = exp < 1e12 ? exp * 1000 : exp;

    if (nowMs > expMs) return { ok: false, reason: "expired" };
  }

  // role check (optional)
  if (payload.role && payload.role !== "admin") {
    return { ok: false, reason: "not_admin" };
  }

  return { ok: true, payload };
}

function getAdminSecret() {
  // ✅ ƯU TIÊN JWT_SECRET (hay dùng khi login sign JWT)
  const s1 = safeTrim(process.env.JWT_SECRET);
  if (s1) return s1;

  // ✅ fallback theo cách bạn đang dùng
  const s2 = safeTrim(process.env.ADMIN_TOKEN_SECRET);
  if (s2) return s2;

  const s3 = safeTrim(process.env.ADMIN_TOKEN);
  if (s3) return s3;

  return "";
}

export function requireAdmin(req) {
  const secret = getAdminSecret();

  // chưa set secret => bỏ qua auth (giữ behavior cũ của bạn)
  if (!secret) return true;

  const xToken = safeTrim(req.headers?.["x-admin-token"]);
  const auth = safeTrim(req.headers?.authorization);
  const bearer = auth.replace(/^Bearer\s+/i, "");

  const token = xToken || bearer;
  if (!token) return false;

  // ✅ TƯƠNG THÍCH CÁCH CŨ: nếu bạn set admin token = đúng secret
  if (token === secret) return true;

  // ✅ CÁCH MỚI: verify JWT HS256 do /api/login tạo ra
  const v = verifyJwtHs256(token, secret);
  return v.ok === true;
}

/** ===== Get Sheet ID by tab name ===== */
export async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const found = meta.data.sheets?.find((s) => s.properties?.title === title);

  if (!found?.properties?.sheetId) {
    throw new Error(`Sheet tab not found: ${title}`);
  }

  return found.properties.sheetId;
}
