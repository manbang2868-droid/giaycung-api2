// api/services.js
import { getSheetsClient, getSpreadsheetId, allowCors, json } from "./_lib/gsheets.js";

const SHEET_NAME = "services";
const RANGE = `${SHEET_NAME}!A:Z`;

function safeTrim(x) {
  return String(x ?? "").trim();
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
    obj.__rowIndex = idx + 2; // data bắt đầu từ dòng 2
    return obj;
  });
}

function normalizeService(x) {
  // linh hoạt theo header của sheet bạn
  const status = safeTrim(x.status) || "published";

  // cố gắng map các field phổ biến
  return {
    id: safeTrim(x.id) || safeTrim(x.serviceId) || "",
    name: safeTrim(x.name) || safeTrim(x.title) || "",
    price: Number(safeTrim(x.price) || 0),
    description: safeTrim(x.description) || safeTrim(x.desc) || "",
    imageUrl: safeTrim(x.imageUrl) || safeTrim(x.image) || "",
    category: safeTrim(x.category) || "",
    status,
  };
}

export default async function handler(req, res) {
  // 1) CORS + preflight
  if (allowCors(req, res)) return;

  try {
    // 2) GET: user + admin đều xem được
    if (req.method === "GET") {
      const sheets = await getSheetsClient();
      const spreadsheetId = getSpreadsheetId();

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
            "Sheet services chưa có header. Hãy tạo dòng 1 (ví dụ): id,name,price,description,imageUrl,category,status",
        });
      }

      // debug: /api/services?debug=1
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

      // mặc định chỉ lấy published
      // - /api/services            => status=published
      // - /api/services?status=all => lấy tất cả
      // - /api/services?status=draft|published
      const qStatus = safeTrim(req.query?.status) || "published";

      let items = rowsToObjects(values)
        .map(normalizeService)
        .filter((x) => x.id || x.name); // bỏ dòng trống

      if (qStatus !== "all") {
        items = items.filter((x) => safeTrim(x.status) === qStatus);
      }

      return json(res, 200, { ok: true, data: items });
    }

    // 3) POST/PATCH cho admin -> làm ở bước sau
    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("SERVICES API ERROR:", err);
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
