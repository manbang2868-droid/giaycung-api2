// api/login.js
import crypto from "crypto";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://giay-cung4.vercel.app");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Admin-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function signToken(payload, secret) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url");

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${sig}`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const { email, password } = req.body || {};

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Sai email hoặc mật khẩu" });
    }

    const secret = (process.env.ADMIN_TOKEN_SECRET || "").trim();
    if (!secret) {
      return res.status(500).json({ message: "Missing ADMIN_TOKEN_SECRET" });
    }

    const token = signToken(
      {
        email,
        role: "admin",
        exp: Date.now() + 1000 * 60 * 60 * 24, // ms: 24h
      },
      secret
    );

    return res.status(200).json({
      token,
      user: { email, role: "admin" },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
