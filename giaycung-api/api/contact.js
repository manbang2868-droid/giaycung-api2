// api/contact.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "contact";
const RANGE_ALL = `${SHEET_NAME}!A:Z`;

// Nếu sheet chưa có header, sẽ auto set header này (A1:G1)
const DEFAULT_HEADERS = [
  "id",
  "name",
  "address",
  "phone",
  "email",
  "hours",
  "googleMapsUrl",
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

function rowsToObjects(values, headers) {
  if (!values || values.length < 2) return [];

  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    // header là dòng 1, data bắt đầu dòng 2
    obj.__rowIndex = idx + 2;
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  // Map theo đúng thứ tự cột trong sheet
  const p = payload || {};
  return headers.map((h) => p[h] ?? "");
}

function normalizeContact(x) {
  return {
    id: safeTrim(x.id),
    name: safeTrim(x.name),
    address: safeTrim(x.address),
    phone: safeTrim(x.phone),
    email: safeTrim(x.email),
    hours: safeTrim(x.hours),
    googleMapsUrl: safeTrim(x.googleMapsUrl),
  };
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

  // Sheet chưa có header -> set header mặc định
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:G1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [DEFAULT_HEADERS] },
  });

  return DEFAULT_HEADERS;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = safeTrim(process.env.SPREADSHEET_ID);
    if (!spreadsheetId) {
      return json(res, 500, { ok: false, message: "Missing SPREADSHEET_ID" });
    }

    const sheets = await getSheetsClient();

    // luôn đọc sheet để lấy headers + dữ liệu
    let values = await getValues(sheets, spreadsheetId);
    const headers = await ensureHeaderRow(sheets, spreadsheetId, values);

    // đọc lại sau khi ensure header (phòng trường hợp sheet trống)
    values = await getValues(sheets, spreadsheetId);

    // ===== GET =====
    if (req.method === "GET") {
      const items = rowsToObjects(values, headers)
        .map((x) => normalizeContact(x))
        .filter((x) => Object.values(x).some((v) => safeTrim(v) !== ""));

      return json(res, 200, { ok: true, data: items });
    }

    // từ đây trở xuống là ghi => cần admin
    if (!requireAdmin(req)) {
      return json(res, 401, {
        ok: false,
        message: "Unauthorized (missing/invalid X-Admin-Token)",
      });
    }

    // ===== POST (create) =====
    if (req.method === "POST") {
      const body = parseBody(req);

      const name = safeTrim(body?.name);
      const address = safeTrim(body?.address);
      const phone = safeTrim(body?.phone);
      const email = safeTrim(body?.email);
      const hours = safeTrim(body?.hours);
      const googleMapsUrl = safeTrim(body?.googleMapsUrl);

      if (!name || !address || !phone || !email) {
        return json(res, 400, {
          ok: false,
          message: "Thiếu dữ liệu bắt buộc: name / address / phone / email",
        });
      }

      const id = safeTrim(body?.id) || `store_${Date.now()}`;

      const payload = {
        id,
        name,
        address,
        phone,
        email,
        hours,
        googleMapsUrl,
      };

      const row = buildRowFromPayload(payload, headers);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE_ALL,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ===== PUT / PATCH (update) =====
    // ✅ FIX: frontend bạn đang gọi PUT => backend phải hỗ trợ PUT
    if (req.method === "PUT" || req.method === "PATCH") {
      const body = parseBody(req);

      // nhận id từ body hoặc query
      const id = safeTrim(body?.id) || safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Thiếu id để cập nhật" });

      const items = rowsToObjects(values, headers);
      const found = items.find((x) => safeTrim(x.id) === id);

      if (!found) {
        return json(res, 404, { ok: false, message: `Không tìm thấy cửa hàng id=${id}` });
      }

      // merge: giữ data cũ, update field mới
      const merged = {};
      headers.forEach((h) => {
        merged[h] = found[h] ?? "";
      });

      const updatable = ["name", "address", "phone", "email", "hours", "googleMapsUrl"];

      if (req.method === "PUT") {
        // PUT: cập nhật "đầy đủ" theo payload, nhưng vẫn không tự xóa field nếu bạn không gửi
        // (để tránh lỡ tay làm rỗng dữ liệu)
        updatable.forEach((k) => {
          if (k in (body || {})) merged[k] = safeTrim(body[k]);
        });
      } else {
        // PATCH: chỉ update field nào có gửi lên
        updatable.forEach((k) => {
          if (k in (body || {})) merged[k] = safeTrim(body[k]);
        });
      }

      merged.id = id; // khóa id

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

    // ===== DELETE (delete row by id, shift up) =====
    if (req.method === "DELETE") {
      const body = parseBody(req);
      const id = safeTrim(req.query?.id) || safeTrim(body?.id);
      if (!id) return json(res, 400, { ok: false, message: "Thiếu id để xóa" });

      const items = rowsToObjects(values, headers);
      const found = items.find((x) => safeTrim(x.id) === id);

      if (!found) {
        return json(res, 404, { ok: false, message: `Không tìm thấy cửa hàng id=${id}` });
      }

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

      const rowIndex = found.__rowIndex; // 1-based
      const startIndex = rowIndex - 1;  // 0-based
      const endIndex = rowIndex;        // exclusive

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
    console.error("CONTACT API ERROR:", err);
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
