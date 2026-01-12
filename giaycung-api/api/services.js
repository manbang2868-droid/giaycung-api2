// api/services.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  getSpreadsheetId,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "services";
const RANGE_READ = `${SHEET_NAME}!A:Z`;

function safeTrim(x) {
  return String(x ?? "").trim();
}

function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function rowsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = (values[0] || []).map((h) => safeTrim(h));

  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    obj.__rowIndex = idx + 2; // header dòng 1, data từ dòng 2
    return obj;
  });
}

function normalizeService(x) {
  const featuresRaw = safeTrim(x.features);
  return {
    id: safeTrim(x.id),
    title: safeTrim(x.title),
    description: safeTrim(x.description),
    price: safeTrim(x.price),
    duration: safeTrim(x.duration),
    imageUrl: safeTrim(x.imageUrl),
    features: featuresRaw,
    status: safeTrim(x.status) || "published",
  };
}

function buildRowFromPayload(payload, headers) {
  return headers.map((h) => payload[h] ?? "");
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = getSpreadsheetId();

    const sheets = await getSheetsClient();

    // Read whole sheet (for headers + rowIndex)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE_READ,
    });

    const values = resp.data.values || [];
    const headers = (values[0] || []).map((h) => safeTrim(h));

    // GET: public
    if (req.method === "GET") {
      const items = rowsToObjects(values)
        .map(normalizeService)
        .filter((x) => x.id && x.title);

      // chỉ trả published cho user (admin vẫn gọi GET cũng được)
      const status = safeTrim(req.query?.status);
      const out = status ? items.filter((x) => x.status === status) : items;

      return json(res, 200, { ok: true, data: out });
    }

    // Write requires admin
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized (missing/invalid X-Admin-Token)" });
    }

    // POST: create
    if (req.method === "POST") {
      const body = parseBody(req);

      const title = safeTrim(body?.title);
      const description = safeTrim(body?.description);
      const price = safeTrim(body?.price);
      const duration = safeTrim(body?.duration);
      const imageUrl = safeTrim(body?.imageUrl);
      const status = safeTrim(body?.status) || "published";

      // features: nhận string hoặc array
      const features =
        Array.isArray(body?.features)
          ? body.features.map((x) => safeTrim(x)).filter(Boolean).join(", ")
          : safeTrim(body?.features);

      if (!title || !description || !price || !imageUrl) {
        return json(res, 400, { ok: false, message: "Thiếu dữ liệu bắt buộc: title / description / price / imageUrl" });
      }

      if (!headers.length) {
        return json(res, 500, {
          ok: false,
          message:
            "Sheet services chưa có header. Hãy tạo hàng tiêu đề: id,title,description,price,duration,imageUrl,features,status",
        });
      }

      const id = safeTrim(body?.id) || `srv_${Date.now()}`;

      const payload = {
        id,
        title,
        description,
        price,
        duration,
        imageUrl,
        features,
        status,
      };

      const row = buildRowFromPayload(payload, headers);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A:Z`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // PATCH: update by id  /api/services?id=...
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const body = parseBody(req);
      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      // merge old -> new
      const merged = {};
      headers.forEach((h) => (merged[h] = found[h] ?? ""));
      merged.id = id;

      const updatable = ["title", "description", "price", "duration", "imageUrl", "features", "status"];
      updatable.forEach((k) => {
        if (k in (body || {})) {
          if (k === "features") {
            merged.features = Array.isArray(body.features)
              ? body.features.map((x) => safeTrim(x)).filter(Boolean).join(", ")
              : safeTrim(body.features);
          } else {
            merged[k] = safeTrim(body[k]);
          }
        }
      });

      const rowIndex = found.__rowIndex;
      const row = buildRowFromPayload(merged, headers);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // DELETE: delete by id /api/services?id=...
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);
      const rowIndex = found.__rowIndex;

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1, // 0-based
                  endIndex: rowIndex,
                },
              },
            },
          ],
        },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("SERVICES API ERROR:", err);
    return json(res, 500, { ok: false, message: err?.message || "Internal server error" });
  }
}
