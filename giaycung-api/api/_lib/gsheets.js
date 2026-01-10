// api/_lib/gsheets.js
import { google } from "googleapis";

function getPrivateKey() {
  // Vercel thường lưu private key dạng có \n
  const k = process.env.GOOGLE_PRIVATE_KEY || "";
  return k.replace(/\\n/g, "\n");
}

export function getAuth() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = getPrivateKey();

  if (!process.env.SPREADSHEET_ID) throw new Error("Missing SPREADSHEET_ID");
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
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

// OPTIONAL: bảo vệ PUT/PATCH/DELETE bằng token
export function requireAdmin(req) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return true; // nếu bạn chưa set ADMIN_TOKEN thì bỏ qua
  const got = req.headers["x-admin-token"];
  return got === need;
}
