// api/services.js
export const config = { runtime: "nodejs" };

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
    obj.__rowIndex = idx + 2;
    return obj;
  });
}

function normalizeService(x) {
  const status = safeTrim(x.status) || "published";
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
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "GET") {
      return json(res, 405, { ok: false, message: "Method not allowed" });
    }

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
          "Sheet services chưa có header. Ví dụ header: id,name,price,description,imageUrl,category,status",
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

    // default: published
    const qStatus = safeTrim(req.query?.status) || "published";

    let items = rowsToObjects(values)
      .map(normalizeService)
      .filter((x) => x.id || x.name);

    if (qStatus !== "all") {
      items = items.filter((x) => safeTrim(x.status) === qStatus);
    }

    return json(res, 200, { ok: true, data: items });
  } catch (err) {
    console.error("SERVICES API ERROR:", err);
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
