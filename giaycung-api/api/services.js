// api/services.js
import {
  getSheetsClient,
  getSpreadsheetId,
  allowCors,
  json,
  requireAdmin,
  getSheetIdByTitle,
} from "./_lib/gsheets.js";

const SHEET_NAME = "services";
const RANGE_ALL = `${SHEET_NAME}!A:Z`;

const DEFAULT_HEADERS = [
  "id",
  "title",
  "description",
  "price",
  "duration",
  "imageUrl",
  "features",
  "status",
];

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

async function getValues(sheets, spreadsheetId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: RANGE_ALL,
  });
  return resp.data.values || [];
}

async function ensureHeaderRow(sheets, spreadsheetId, values) {
  const firstRow = values[0] || [];
  const headers = firstRow.map(normalizeHeader).filter(Boolean);

  if (headers.length > 0) return headers;

  // nếu sheet chưa có header -> set header mặc định
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:H1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [DEFAULT_HEADERS] },
  });

  return DEFAULT_HEADERS;
}

function rowsToObjects(values, headers) {
  if (!values || values.length < 2) return [];

  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    obj.__rowIndex = idx + 2; // header dòng 1
    return obj;
  });
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
    status: safeTrim(x.status) || "published",
  };
}

function buildRowFromPayload(payload, headers) {
  const p = payload || {};
  return headers.map((h) => p[h] ?? "");
}

export default async function handler(req, res) {
  // 1) OPTIONS luôn đi trước
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = getSpreadsheetId();
    const sheets = await getSheetsClient();

    // đọc sheet để lấy headers + data
    let values = await getValues(sheets, spreadsheetId);
    const headers = await ensureHeaderRow(sheets, spreadsheetId, values);
    values = await getValues(sheets, spreadsheetId);

    // debug nhanh
    if (safeTrim(req.query?.debug) === "1") {
      return json(req, res, 200, {
        ok: true,
        debug: {
          sheetName: SHEET_NAME,
          headers,
          rowsCountRaw: values.length,
          sampleFirst3: values.slice(0, 3),
          usingSpreadsheetId: spreadsheetId ? "ok" : "missing",
          env: {
            GOOGLE_SHEETS_ID: !!process.env.GOOGLE_SHEETS_ID,
            SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
            GOOGLE_CLIENT_EMAIL: !!process.env.GOOGLE_CLIENT_EMAIL,
            GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
          },
        },
      });
    }

    // 2) GET: USER + ADMIN đều xem được
    if (req.method === "GET") {
      const statusQ = safeTrim(req.query?.status) || "published"; // mặc định published
      const idQ = safeTrim(req.query?.id);

      let items = rowsToObjects(values, headers)
        .map(normalizeService)
        .filter((x) => Object.values(x).some((v) => safeTrim(v) !== ""));

      if (idQ) {
        const found = items.find((x) => x.id === idQ);
        if (!found) return json(req, res, 404, { ok: false, message: "Not found" });
        return json(req, res, 200, { ok: true, data: found });
      }

      // status=published | draft | all
      if (statusQ && statusQ !== "all") {
        items = items.filter((x) => safeTrim(x.status) === statusQ);
      }

      return json(req, res, 200, { ok: true, data: items });
    }

    // 3) từ đây trở xuống mới cần ADMIN
    if (!requireAdmin(req)) {
      return json(req, res, 401, { ok: false, message: "Unauthorized" });
    }

    // =========================
    // POST/PATCH/DELETE (ADMIN)
    // =========================

    // POST /api/services
    if (req.method === "POST") {
      const body = parseBody(req);

      const payload = normalizeService({
        id: safeTrim(body?.id) || `srv_${Date.now()}`,
        title: body?.title,
        description: body?.description,
        price: body?.price,
        duration: body?.duration,
        imageUrl: body?.imageUrl,
        features: body?.features,
        status: body?.status || "published",
      });

      if (!payload.title) {
        return json(req, res, 400, { ok: false, message: "Missing title" });
      }

      const row = buildRowFromPayload(payload, headers);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE_ALL,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(req, res, 200, { ok: true, data: { id: payload.id } });
    }

    // PATCH /api/services?id=srv_1
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(req, res, 400, { ok: false, message: "Missing query: id" });

      const body = parseBody(req);

      const items = rowsToObjects(values, headers);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(req, res, 404, { ok: false, message: "Not found" });

      const merged = {};
      headers.forEach((h) => (merged[h] = found[h] ?? ""));

      const updatable = ["title", "description", "price", "duration", "imageUrl", "features", "status"];
      updatable.forEach((k) => {
        if (k in (body || {})) merged[k] = safeTrim(body[k]);
      });
      merged.id = id;

      const rowIndex = found.__rowIndex;
      const row = buildRowFromPayload(merged, headers);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return json(req, res, 200, { ok: true, data: { id } });
    }

    // DELETE /api/services?id=srv_1
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(req, res, 400, { ok: false, message: "Missing query: id" });

      const items = rowsToObjects(values, headers);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(req, res, 404, { ok: false, message: "Not found" });

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
                range: { sheetId, dimension: "ROWS", startIndex, endIndex },
              },
            },
          ],
        },
      });

      return json(req, res, 200, { ok: true, data: { id } });
    }

    return json(req, res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    // ✅ quan trọng: vẫn trả JSON + CORS
    console.error("SERVICES API ERROR:", err);
    return json(req, res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
