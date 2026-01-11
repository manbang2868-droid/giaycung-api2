// api/data.js
import { allowCors, json } from "./_lib/gsheets.js";

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method !== "GET") {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }

  return json(res, 200, { ok: true, message: "data ok" });
}
