// api/login.js
import crypto from "crypto";
import { allowCors, json } from "./_lib/gsheets.js";

function signToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  // ✅ CORS + preflight
  if (allowCors(req, res)) return;

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }

  try {
    // ✅ Vercel node sometimes req.body may be string
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const { email, password } = body || {};

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
      return json(res, 401, { ok: false, message: "Sai email hoặc mật khẩu" });
    }

    // ✅ dùng cùng secret với requireAdmin() (ưu tiên JWT_SECRET)
    const secret =
      (process.env.JWT_SECRET || "").trim() ||
      (process.env.ADMIN_TOKEN_SECRET || "").trim() ||
      (process.env.ADMIN_TOKEN || "").trim();

    if (!secret) {
      return json(res, 500, { ok: false, message: "Missing JWT_SECRET (or ADMIN_TOKEN_SECRET)" });
    }

    const token = signToken(
      {
        email,
        role: "admin",
        exp: Date.now() + 1000 * 60 * 60 * 24, // 24h (ms)
      },
      secret
    );

    return json(res, 200, { ok: true, token, user: { email, role: "admin" } });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return json(res, 500, { ok: false, message: "Server error" });
  }
}
