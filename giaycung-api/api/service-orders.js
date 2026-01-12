// api/service-orders.js
// Single-function router for ALL service-orders endpoints.
// This keeps the number of Vercel Serverless Functions low (Hobby plan limit).

import {
  getSheetsClient,
  getSheetIdByTitle,
  getSpreadsheetId,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "service_orders";
const RANGE_ALL = `${SHEET_NAME}!A:Z`;

// Header columns (row 1). If sheet is empty, we'll create this header.
const DEFAULT_HEADERS = [
  "id",
  "orderNumber",
  "customerName",
  "customerPhone",
  "createdDate",
  "totalAmount",
  "status",
  "assignedTo",
  "shoesJson",
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

function toNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHeader(h) {
  return safeTrim(h);
}

function normalizeStatus(status, type) {
  const s = safeTrim(status);
  if (type === "order") {
    const ok = ["pending", "processing", "completed", "cancelled"];
    return ok.includes(s) ? s : "pending";
  }
  // shoe
  const ok = ["received", "processing", "completed"];
  return ok.includes(s) ? s : "received";
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
  if (headers.length) return headers;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:I1`,
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
    obj.__rowIndex = idx + 2; // header row=1, data starts at row 2
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  const p = payload || {};
  return headers.map((h) => p[h] ?? "");
}

function parseShoesJson(v) {
  const raw = safeTrim(v);
  if (!raw) return [];
  try {
    const x = JSON.parse(raw);
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

function normalizeShoe(x) {
  return {
    id: safeTrim(x?.id) || `shoe_${Date.now()}`,
    name: safeTrim(x?.name),
    service: safeTrim(x?.service),
    status: normalizeStatus(x?.status, "shoe"),
    images: Array.isArray(x?.images) ? x.images.map((s) => safeTrim(s)).filter(Boolean) : [],
    notes: safeTrim(x?.notes),
  };
}

function normalizeOrder(row) {
  const shoes = parseShoesJson(row?.shoesJson).map(normalizeShoe);
  return {
    id: safeTrim(row?.id),
    orderNumber: safeTrim(row?.orderNumber),
    customerName: safeTrim(row?.customerName),
    customerPhone: safeTrim(row?.customerPhone),
    createdDate: safeTrim(row?.createdDate),
    totalAmount: toNumber(row?.totalAmount, 0),
    status: normalizeStatus(row?.status, "order"),
    assignedTo: safeTrim(row?.assignedTo),
    shoes,
  };
}

function nextOrderNumber(existingOrders) {
  // Find max numeric part from ORD-XXX
  let max = 0;
  for (const o of existingOrders) {
    const m = safeTrim(o.orderNumber).match(/^(?:ORD-)?(\d+)$/i) || safeTrim(o.orderNumber).match(/^ORD-(\d+)$/i);
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ORD-${String(max + 1).padStart(3, "0")}`;
}

function getPathParts(req) {
  // req.url in Vercel includes the original path.
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);
  // Expect: ["api","service-orders", ...]
  const idx = parts.indexOf("service-orders");
  const rest = idx >= 0 ? parts.slice(idx + 1) : [];
  return { url, rest };
}

export default async function handler(req, res) {
  // 1) Always handle OPTIONS first
  if (allowCors(req, res)) return;

  const { url, rest } = getPathParts(req);

  try {
    const spreadsheetId = getSpreadsheetId();
    const sheets = await getSheetsClient();

    // Always load values + headers once per request
    let values = await getValues(sheets, spreadsheetId);
    const headers = await ensureHeaderRow(sheets, spreadsheetId, values);
    values = await getValues(sheets, spreadsheetId);

    const rows = rowsToObjects(values, headers);
    const orders = rows
      .map((r) => ({ ...r, shoes: parseShoesJson(r.shoesJson) }))
      .filter((r) => Object.values(r).some((v) => safeTrim(v) !== ""))
      .map((r) => normalizeOrder(r));

    // -------- GET (PUBLIC) --------
    if (req.method === "GET") {
      // GET /api/service-orders
      if (rest.length === 0) {
        // newest first by createdDate (YYYY-MM-DD) then by orderNumber
        const sorted = [...orders].sort((a, b) => {
          const tb = Date.parse(b.createdDate || "") || 0;
          const ta = Date.parse(a.createdDate || "") || 0;
          if (tb !== ta) return tb - ta;
          return safeTrim(b.orderNumber).localeCompare(safeTrim(a.orderNumber));
        });
        return json(res, 200, { ok: true, orders: sorted });
      }

      // GET /api/service-orders/track?order=ORD-001 or ?orderNumber=...
      if (rest[0] === "track") {
        const code = safeTrim(url.searchParams.get("order") || url.searchParams.get("orderNumber") || url.searchParams.get("code"));
        if (!code) return json(res, 400, { ok: false, message: "Missing query: order / orderNumber" });
        const found = orders.find((o) => safeTrim(o.orderNumber).toUpperCase() === code.toUpperCase());
        if (!found) return json(res, 404, { ok: false, message: "Not found" });
        return json(res, 200, { ok: true, order: found });
      }

      // GET /api/service-orders/:id
      const orderId = safeTrim(rest[0]);
      const found = orders.find((o) => o.id === orderId);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });
      return json(res, 200, { ok: true, order: found });
    }

    // -------- From here: ADMIN only (POST/PATCH/DELETE) --------
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized (missing/invalid token)" });
    }

    const body = parseBody(req);

    // Helper: find row by orderId
    const findOrderRow = (orderId) => {
      const row = rows.find((r) => safeTrim(r.id) === orderId);
      return row || null;
    };

    // POST /api/service-orders  (create order)
    if (req.method === "POST" && rest.length === 0) {
      const customerName = safeTrim(body.customerName);
      const customerPhone = safeTrim(body.customerPhone);
      const totalAmount = toNumber(body.totalAmount, 0);
      const assignedTo = safeTrim(body.assignedTo);

      if (!customerName || !customerPhone) {
        return json(res, 400, { ok: false, message: "Missing: customerName / customerPhone" });
      }

      const id = `ord_${Date.now()}`;
      const orderNumber = safeTrim(body.orderNumber) || nextOrderNumber(orders);
      const createdDate = safeTrim(body.createdDate) || new Date().toISOString().slice(0, 10);
      const status = normalizeStatus(body.status, "order");
      const shoesJson = JSON.stringify([]);

      const payload = {
        id,
        orderNumber,
        customerName,
        customerPhone,
        createdDate,
        totalAmount,
        status,
        assignedTo,
        shoesJson,
      };

      const row = buildRowFromPayload(payload, headers);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE_ALL,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id, orderNumber } });
    }

    // POST /api/service-orders/:id/shoes  (add shoe)
    if (req.method === "POST" && rest.length === 2 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      const shoe = normalizeShoe({
        id: safeTrim(body.id) || `shoe_${Date.now()}`,
        name: body.name,
        service: body.service,
        status: body.status,
        images: body.images,
        notes: body.notes,
      });

      if (!shoe.name || !shoe.service) {
        return json(res, 400, { ok: false, message: "Missing: shoe.name / shoe.service" });
      }

      const shoes = parseShoesJson(row.shoesJson);
      shoes.push(shoe);

      row.shoesJson = JSON.stringify(shoes);

      const rowIndex = row.__rowIndex;
      const outRow = buildRowFromPayload(row, headers);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: shoe.id } });
    }

    // PATCH /api/service-orders/:id  (update order fields)
    if (req.method === "PATCH" && rest.length === 1) {
      const orderId = safeTrim(rest[0]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      const updatable = [
        "customerName",
        "customerPhone",
        "createdDate",
        "totalAmount",
        "status",
        "assignedTo",
        "orderNumber",
      ];

      for (const k of updatable) {
        if (k in (body || {})) {
          if (k === "totalAmount") row[k] = toNumber(body[k], 0);
          else if (k === "status") row[k] = normalizeStatus(body[k], "order");
          else row[k] = safeTrim(body[k]);
        }
      }

      const rowIndex = row.__rowIndex;
      const outRow = buildRowFromPayload(row, headers);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: orderId } });
    }

    // PATCH /api/service-orders/:id/shoes/:shoeId  (update shoe)
    if (req.method === "PATCH" && rest.length === 3 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);
      const shoeId = safeTrim(rest[2]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      const shoes = parseShoesJson(row.shoesJson);
      const idx = shoes.findIndex((s) => safeTrim(s.id) === shoeId);
      if (idx < 0) return json(res, 404, { ok: false, message: "Shoe not found" });

      const current = normalizeShoe(shoes[idx]);
      const merged = { ...current };
      const updatable = ["name", "service", "status", "images", "notes"];
      for (const k of updatable) {
        if (k in (body || {})) {
          if (k === "images") {
            merged.images = Array.isArray(body.images)
              ? body.images.map((s) => safeTrim(s)).filter(Boolean)
              : merged.images;
          } else if (k === "status") {
            merged.status = normalizeStatus(body.status, "shoe");
          } else {
            merged[k] = safeTrim(body[k]);
          }
        }
      }
      merged.id = shoeId;

      shoes[idx] = merged;
      row.shoesJson = JSON.stringify(shoes);

      const rowIndex = row.__rowIndex;
      const outRow = buildRowFromPayload(row, headers);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: shoeId } });
    }

    // DELETE /api/service-orders/:id  (delete order row)
    if (req.method === "DELETE" && rest.length === 1) {
      const orderId = safeTrim(rest[0]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);
      const rowIndex = row.__rowIndex;
      const startIndex = rowIndex - 1;
      const endIndex = rowIndex;

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

      return json(res, 200, { ok: true, data: { id: orderId } });
    }

    // DELETE /api/service-orders/:id/shoes/:shoeId
    if (req.method === "DELETE" && rest.length === 3 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);
      const shoeId = safeTrim(rest[2]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      const shoes = parseShoesJson(row.shoesJson);
      const next = shoes.filter((s) => safeTrim(s.id) !== shoeId);
      if (next.length === shoes.length) {
        return json(res, 404, { ok: false, message: "Shoe not found" });
      }

      row.shoesJson = JSON.stringify(next);

      const rowIndex = row.__rowIndex;
      const outRow = buildRowFromPayload(row, headers);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: shoeId } });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("SERVICE_ORDERS API ERROR:", err);
    return json(res, 500, { ok: false, message: err?.message || "Internal server error" });
  }
}
