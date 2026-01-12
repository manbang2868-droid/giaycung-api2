import { allowCors, json } from "../_lib/gsheets.js";

function requireAdminOrders(req) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) return true;

  const token =
    req.headers["x-admin-token"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return token === secret;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (!requireAdminOrders(req)) {
    return json(res, 401, {
      ok: false,
      message: "Unauthorized (missing/invalid X-Admin-Token)",
    });
  }

  try {
    if (req.method === "PATCH") {
      // update status
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE") {
      // delete order
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    return json(res, 500, { ok: false, message: "Server error" });
  }
}
