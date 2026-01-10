// api/contact.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "contact";

function safeTrim(x) {
  return String(x ?? "").trim();
}

function normalizeHeader(h) {
  return safeTrim(h);
}

function rowsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map(normalizeHeader);

  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    // giữ lại rowIndex để PATCH/DELETE tìm nhanh (row number trên sheet)
    obj.__rowIndex = idx + 2; // vì header là dòng 1, data bắt đầu dòng 2
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  // Map theo đúng thứ tự cột trong sheet
  return headers.map((h) => payload[h] ?? "");
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = safeTrim(process.env.SPREADSHEET_ID);
    if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID");

    const sheets = await getSheetsClient();

    // đọc toàn bộ sheet để lấy headers + dữ liệu
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A:Z`,
    });

    const values = resp.data.values || [];
    const headers = (values[0] || []).map(normalizeHeader);

    // Debug nhanh: /api/contact?debug=1
    if (safeTrim(req.query?.debug) === "1") {
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

    // ✅ GET: list stores
    if (req.method === "GET") {
      const items = rowsToObjects(values)
        .map((x) => ({
          id: safeTrim(x.id),
          name: safeTrim(x.name),
          address: safeTrim(x.address),
          phone: safeTrim(x.phone),
          email: safeTrim(x.email),
          hours: safeTrim(x.hours),
          googleMapsUrl: safeTrim(x.googleMapsUrl),
        }))
        .filter((x) =>
          Object.values(x).some((v) => safeTrim(v) !== "")
        );

      return json(res, 200, { ok: true, data: items });
    }

    // Từ đây trở xuống là thao tác ghi → cần admin
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized" });
    }

    // ✅ POST: add store
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

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

      // Nếu sheet chưa có header (sheet mới)
      if (!headers.length) {
        return json(res, 500, {
          ok: false,
          message:
            "Sheet contact chưa có header. Hãy tạo hàng tiêu đề trước (id,name,address,phone,email,hours,googleMapsUrl).",
        });
      }

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
        range: `${SHEET_NAME}!A:Z`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ✅ PATCH: update store by id  (/api/contact?id=store_123)
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) {
        return json(res, 400, { ok: false, message: "Missing query: id" });
      }

      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      // đọc lại objects để tìm rowIndex
      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);

      if (!found) {
        return json(res, 404, { ok: false, message: "Not found" });
      }

      // merge: giữ data cũ, update field mới
      const merged = {};
      headers.forEach((h) => {
        merged[h] = found[h] ?? "";
      });

      // chỉ cập nhật các field bạn cho phép
      const updatable = [
        "name",
        "address",
        "phone",
        "email",
        "hours",
        "googleMapsUrl",
      ];
      updatable.forEach((k) => {
        if (k in (body || {})) merged[k] = safeTrim(body[k]);
      });

      // đảm bảo id không đổi
      merged.id = id;

      const rowIndex = found.__rowIndex; // số dòng trong sheet
      const row = buildRowFromPayload(merged, headers);

      // update cả row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ✅ DELETE: delete row by id (shift lên)  (/api/contact?id=store_123)
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) {
        return json(res, 400, { ok: false, message: "Missing query: id" });
      }

      // tìm rowIndex
      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);

      if (!found) {
        return json(res, 404, { ok: false, message: "Not found" });
      }

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

      const rowIndex = found.__rowIndex; // dòng thực trên sheet
      const startIndex = rowIndex - 1; // 0-based
      const endIndex = rowIndex; // delete đúng 1 dòng

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
