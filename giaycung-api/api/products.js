// api/products.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "products";

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
    obj.__rowIndex = idx + 2; // header dòng 1, data từ dòng 2
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  return headers.map((h) => payload[h] ?? "");
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = safeTrim(process.env.SPREADSHEET_ID);
    if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID");

    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A:Z`,
    });

    const values = resp.data.values || [];
    const headers = (values[0] || []).map(normalizeHeader);

    // Debug: /api/products?debug=1
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

    // ✅ GET: list products (user/admin đều gọi được)
    if (req.method === "GET") {
      const items = rowsToObjects(values)
        .map((x) => ({
          id: safeTrim(x.id),
          name: safeTrim(x.name),
          description: safeTrim(x.description),
          price: Number(safeTrim(x.price) || 0),
          imageUrl: safeTrim(x.imageUrl),
          category: safeTrim(x.category),
          stock: Number(safeTrim(x.stock) || 0),
          rating: Number(safeTrim(x.rating) || 0),
          status: safeTrim(x.status) || "published",
        }))
        .filter((x) => Object.values(x).some((v) => safeTrim(v) !== ""));

      return json(res, 200, { ok: true, data: items });
    }

    // Từ đây trở xuống là ghi -> cần admin
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized" });
    }

    // ✅ POST: add product
    if (req.method === "POST") {
      const body = parseBody(req);

      if (!headers.length) {
        return json(res, 500, {
          ok: false,
          message:
            "Sheet products chưa có header. Hãy tạo header: id,name,description,price,imageUrl,category,stock,rating,status",
        });
      }

      const name = safeTrim(body?.name);
      const description = safeTrim(body?.description);
      const imageUrl = safeTrim(body?.imageUrl);
      const category = safeTrim(body?.category);
      const price = Number(body?.price || 0);
      const stock = Number(body?.stock || 0);
      const rating = body?.rating === undefined ? "" : Number(body?.rating || 0);
      const status = safeTrim(body?.status) || "published";

      if (!name || !description || !imageUrl || !category) {
        return json(res, 400, {
          ok: false,
          message:
            "Thiếu dữ liệu bắt buộc: name / description / imageUrl / category",
        });
      }

      const id = safeTrim(body?.id) || `prd_${Date.now()}`;

      const payload = {
        id,
        name,
        description,
        price,
        imageUrl,
        category,
        stock,
        rating,
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

    // ✅ PATCH: update product by id  (/api/products?id=prd_123)
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const body = parseBody(req);
      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);

      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      const merged = {};
      headers.forEach((h) => (merged[h] = found[h] ?? ""));

      // update fields
      const updatable = [
        "name",
        "description",
        "price",
        "imageUrl",
        "category",
        "stock",
        "rating",
        "status",
      ];
      updatable.forEach((k) => {
        if (k in (body || {})) merged[k] = body[k];
      });

      merged.id = id; // đảm bảo id không đổi

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

    // ✅ DELETE: delete row by id (/api/products?id=prd_123)
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

      const rowIndex = found.__rowIndex; // dòng thực
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
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
    console.error("PRODUCTS API ERROR:", err);
    return json(res, 500, { ok: false, message: err?.message || "Internal server error" });
  }
}
