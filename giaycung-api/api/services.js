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
const RANGE = `${SHEET_NAME}!A:Z`;

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

function normalizeHeader(h) {
  return safeTrim(h);
}

function rowsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = (values[0] || []).map(normalizeHeader);

  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    // header dòng 1, data bắt đầu dòng 2
    obj.__rowIndex = idx + 2;
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  return headers.map((h) => payload[h] ?? "");
}

function normalizeService(x) {
  return {
    id: safeTrim(x.id),
    title: safeTrim(x.title),
    description: safeTrim(x.description),
    price: safeTrim(x.price),
    duration: safeTrim(x.duration),
    imageUrl: safeTrim(x.imageUrl),
    features: safeTrim(x.features),
    status: safeTrim(x.status) || "published", // published | draft
  };
}

export default async function handler(req, res) {
  // 1) luôn xử lý preflight trước
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = getSpreadsheetId();
    const sheets = await getSheetsClient();

    // đọc sheet mỗi request
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
    });

    const values = resp.data.values || [];
    const headers = (values[0] || []).map(normalizeHeader).filter(Boolean);

    if (!headers.length) {
      return json(res, 500, {
        ok: false,
        message:
          "Sheet services chưa có header. Hãy tạo dòng 1: id,title,description,price,duration,imageUrl,features,status",
      });
    }

    // debug: /api/services?debug=1
    if (safeTrim(req.query?.debug) === "1" && req.method === "GET") {
      return json(res, 200, {
        ok: true,
        debug: {
          sheetName: SHEET_NAME,
          headers,
          rowsCountRaw: values.length,
          sampleFirst3: values.slice(0, 3),
        },
      });
    }

    // 2) GET: user + admin đều xem được
    if (req.method === "GET") {
      const qStatus = safeTrim(req.query?.status);
      // mặc định user chỉ lấy published
      const status = qStatus || "published";

      let items = rowsToObjects(values)
        .map((x) => normalizeService(x))
        .filter((x) => Object.values(x).some((v) => safeTrim(v) !== ""));

      // nếu truyền status=all thì trả hết
      if (status !== "all") {
        items = items.filter((x) => safeTrim(x.status) === status);
      }

      return json(res, 200, { ok: true, data: items });
    }

    // 3) từ đây trở xuống mới cần ADMIN
    if (!requireAdmin(req)) {
      return json(res, 401, {
        ok: false,
        message: "Unauthorized (missing/invalid X-Admin-Token)",
      });
    }

    // 4) POST (create)
    if (req.method === "POST") {
      const body = parseBody(req);

      const title = safeTrim(body?.title);
      const description = safeTrim(body?.description);
      const price = safeTrim(body?.price);
      const duration = safeTrim(body?.duration);
      const imageUrl = safeTrim(body?.imageUrl);
      const features = safeTrim(body?.features);
      const status = safeTrim(body?.status) || "published";

      if (!title) {
        return json(res, 400, { ok: false, message: "Thiếu title" });
      }

      const id = safeTrim(body?.id) || `srv_${Date.now()}`;

      const payload = normalizeService({
        id,
        title,
        description,
        price,
        duration,
        imageUrl,
        features,
        status,
      });

      const row = buildRowFromPayload(payload, headers);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // 5) PATCH (update by id)  /api/services?id=srv_1
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const body = parseBody(req);

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      // merge giữ data cũ
      const merged = {};
      headers.forEach((h) => (merged[h] = found[h] ?? ""));

      // field cho phép update
      const updatable = [
        "title",
        "description",
        "price",
        "duration",
        "imageUrl",
        "features",
        "status",
      ];

      updatable.forEach((k) => {
        if (k in (body || {})) merged[k] = safeTrim(body[k]);
      });

      merged.id = id;

      const rowIndex = found.__rowIndex;
      const row = buildRowFromPayload(normalizeService(merged), headers);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // 6) DELETE (delete row by id) /api/services?id=srv_1
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

      const rowIndex = found.__rowIndex; // 1-based
      const startIndex = rowIndex - 1; // 0-based
      const endIndex = rowIndex; // exclusive

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex,
                  endIndex,
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
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
