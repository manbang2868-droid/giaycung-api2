// api/_lib/gsheets.js
import { google } from "googleapis";
import crypto from "crypto";

function getPrivateKey() {
  // Vercel thường lưu private key dạng có \n
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

export function getSpreadsheetId() {
  // Ưu tiên GOOGLE_SHEETS_ID, fallback SPREADSHEET_ID (nếu bạn lỡ dùng tên cũ)
  const id = process.env.GOOGLE_SHEETS_ID || process.env.SPREADSHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_ID (or SPREADSHEET_ID)");
  return id;
}

export function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = getPrivateKey();
  getSpreadsheetId(); // validate env

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

export function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export function allowCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  // cho phép cả Authorization + X-Admin-Token để tương thích
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

// ===== ADMIN TOKEN (JWT-HMAC) =====
// Token format: header.payload.signature (base64url)
// signature = HMAC_SHA256(ADMIN_TOKEN_SECRET, `${header}.${payload}`) -> base64url
function base64urlToBuffer(str) {
  str = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function timingSafeEqualStr(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export function verifyAdminTokenString(token) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) return { ok: false, message: "Missing ADMIN_TOKEN_SECRET" };
  if (!token) return { ok: false, message: "Missing token" };

  const parts = String(token).split(".");
  if (parts.length !== 3) return { ok: false, message: "Invalid token format" };

  const [h, p, sig] = parts;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url");

  if (!timingSafeEqualStr(sig, expected)) return { ok: false, message: "Invalid signature" };

  let payload;
  try {
    payload = JSON.parse(base64urlToBuffer(p).toString("utf8"));
  } catch {
    return { ok: false, message: "Invalid payload" };
  }

  // exp: ms timestamp (giống logic mình đã dùng)
  if (payload?.exp && Number(payload.exp) < Date.now()) {
    return { ok: false, message: "Token expired" };
  }
  if (payload?.role && payload.role !== "admin") {
    return { ok: false, message: "Not admin" };
  }

  return { ok: true, payload };
}

// Bảo vệ endpoint admin
export function requireAdmin(req, res) {
  // ưu tiên Authorization: Bearer
  const auth = req.headers.authorization || req.headers.Authorization || "";
  let token = "";
  if (String(auth).startsWith("Bearer ")) token = String(auth).slice(7);

  // fallback: x-admin-token (cho tương thích code cũ)
  if (!token) token = req.headers["x-admin-token"];

  const v = verifyAdminTokenString(token);
  if (!v.ok) {
    if (res) json(res, 401, { message: "Unauthorized", detail: v.message });
    return null;
  }
  return v.payload;
}
