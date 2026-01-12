// api/orders/[id].js
import { google } from "googleapis";
import { allowCors, json, requireAdmin } from "../_lib/gsheets.js";

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  // admin-only
  if (req.method === "PATCH" || req.method === "DELETE") {
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized (missing/invalid X-Admin-Token)" });
    }
  }

  try {
    // ... logic PATCH/DELETE của bạn ...
    // trả về json(res,...)

    if (req.method === "PATCH") {
      // ...
      return json(res, 200, { ok: true, data: { id, status } });
    }

    if (req.method === "DELETE") {
      // ...
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders [id] error:", err);
    return json(res, 500, { ok: false, message: err?.message || "Server error" });
  }
}
