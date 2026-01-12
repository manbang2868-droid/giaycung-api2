// api/service-orders/[...slug].js
// ✅ HƯỚNG B: 2 SHEETS (orders + shoes) - join theo orderId
// ✅ Giữ nguyên endpoints để frontend không đổi

import {
  getSheetsClient,
  getSheetIdByTitle,
  getSpreadsheetId,
  json,
  allowCors,
  requireAdmin,
} from "../_lib/gsheets.js";

const ORDERS_SHEET = "service_orders";
const SHOES_SHEET = "service_order_shoes";

const ORDERS_RANGE_ALL = `${ORDERS_SHEET}!A:Z`;
const SHOES_RANGE_ALL = `${SHOES_SHEET}!A:Z`;

const DEFAULT_ORDER_HEADERS = [
  "id",
  "orderNumber",
  "customerName",
  "customerPhone",
  "createdDate",
  "totalAmount",
  "status",
  "assignedTo",
  // (có thể sheet bạn còn shoesJson, backend sẽ bỏ qua)
  "shoesJson",
];

const DEFAULT_SHOE_HEADERS = [
  "id",
  "orderId",
  "name",
  "service",
  "status",
  "images",
  "notes",
  "deleted",
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

function normalizeStatus(status, type) {
  const s = safeTrim(status);
  if (type === "order") {
    const ok = ["pending", "processing", "completed", "cancelled"];
    return ok.includes(s) ? s : "pending";
  }
  const ok = ["received", "processing", "completed"];
  return ok.includes(s) ? s : "received";
}

async function getValues(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function ensureHeaderRow(sheets, spreadsheetId, sheetName, values, defaultHeaders) {
  const firstRow = values[0] || [];
  const headers = firstRow.map((h) => safeTrim(h)).filter(Boolean);
  if (headers.length) return headers;

  // tạo header nếu sheet trống
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${String.fromCharCode(64 + defaultHeaders.length)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [defaultHeaders] },
  });

  return defaultHeaders;
}

function rowsToObjects(values, headers) {
  if (!values || values.length < 2) return [];
  return values.slice(1).map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    obj.__rowIndex = idx + 2; // header = row 1
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  const p = payload || {};
  return headers.map((h) => p[h] ?? "");
}

function parseImagesCell(v) {
  const raw = safeTrim(v);
  if (!raw) return [];
  try {
    const x = JSON.parse(raw);
    return Array.isArray(x) ? x.map((s) => safeTrim(s)).filter(Boolean) : [];
  } catch {
    // nếu trước đó bạn lỡ lưu dạng "url1,url2"
    return raw.split(",").map((s) => safeTrim(s)).filter(Boolean);
  }
}

function isDeletedCell(v) {
  const s = safeTrim(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function normalizeShoeRow(row) {
  return {
    id: safeTrim(row?.id),
    orderId: safeTrim(row?.orderId),
    name: safeTrim(row?.name),
    service: safeTrim(row?.service),
    status: normalizeStatus(row?.status, "shoe"),
    images: parseImagesCell(row?.images),
    notes: safeTrim(row?.notes),
    deleted: isDeletedCell(row?.deleted),
    __rowIndex: row?.__rowIndex,
  };
}

function normalizeOrderRow(row) {
  return {
    id: safeTrim(row?.id),
    orderNumber: safeTrim(row?.orderNumber),
    customerName: safeTrim(row?.customerName),
    customerPhone: safeTrim(row?.customerPhone),
    createdDate: safeTrim(row?.createdDate),
    totalAmount: toNumber(row?.totalAmount, 0),
    status: normalizeStatus(row?.status, "order"),
    assignedTo: safeTrim(row?.assignedTo),
    __rowIndex: row?.__rowIndex,
  };
}

function nextOrderNumber(existingOrders) {
  let max = 0;
  for (const o of existingOrders) {
    const code = safeTrim(o.orderNumber);
    const m = code.match(/^ORD-(\d+)$/i) || code.match(/^(?:ORD-)?(\d+)$/i);
    if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ORD-${String(max + 1).padStart(3, "0")}`;
}

function getRestFromReq(req) {
  const slug = req?.query?.slug;
  if (Array.isArray(slug)) return slug.map((s) => safeTrim(s)).filter(Boolean);
  if (typeof slug === "string" && slug) return [safeTrim(slug)];

  // fallback parse url
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("service-orders");
    return idx >= 0 ? parts.slice(idx + 1) : [];
  } catch {
    return [];
  }
}

function getUrlObj(req) {
  try {
    return new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return { searchParams: new URLSearchParams() };
  }
}

function groupShoesByOrderId(shoes) {
  const map = new Map();
  for (const s of shoes) {
    if (!s.orderId) continue;
    if (!map.has(s.orderId)) map.set(s.orderId, []);
    map.get(s.orderId).push(s);
  }
  return map;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  const rest = getRestFromReq(req);
  const url = getUrlObj(req);

  try {
    const spreadsheetId = getSpreadsheetId();
    const sheets = await getSheetsClient();

    // ---- LOAD ORDERS ----
    let orderValues = await getValues(sheets, spreadsheetId, ORDERS_RANGE_ALL);
    const orderHeaders = await ensureHeaderRow(
      sheets,
      spreadsheetId,
      ORDERS_SHEET,
      orderValues,
      DEFAULT_ORDER_HEADERS
    );
    orderValues = await getValues(sheets, spreadsheetId, ORDERS_RANGE_ALL);

    const orderRows = rowsToObjects(orderValues, orderHeaders);
    const orders = orderRows
      .filter((r) => Object.values(r).some((v) => safeTrim(v) !== ""))
      .map((r) => normalizeOrderRow(r));

    // ---- LOAD SHOES ----
    let shoeValues = await getValues(sheets, spreadsheetId, SHOES_RANGE_ALL);
    const shoeHeaders = await ensureHeaderRow(
      sheets,
      spreadsheetId,
      SHOES_SHEET,
      shoeValues,
      DEFAULT_SHOE_HEADERS
    );
    shoeValues = await getValues(sheets, spreadsheetId, SHOES_RANGE_ALL);

    const shoeRows = rowsToObjects(shoeValues, shoeHeaders);
    const shoesAll = shoeRows
      .filter((r) => Object.values(r).some((v) => safeTrim(v) !== ""))
      .map((r) => normalizeShoeRow(r))
      .filter((s) => !s.deleted); // chỉ lấy chưa deleted

    const shoesByOrderId = groupShoesByOrderId(shoesAll);

    const attachShoes = (o) => ({
      ...o,
      shoes: shoesByOrderId.get(o.id) || [],
    });

    // ============== GET (PUBLIC) ==============
    if (req.method === "GET") {
      // GET /api/service-orders
      if (rest.length === 0) {
        const sorted = orders
          .map(attachShoes)
          .sort((a, b) => {
            const tb = Date.parse(b.createdDate || "") || 0;
            const ta = Date.parse(a.createdDate || "") || 0;
            if (tb !== ta) return tb - ta;
            return safeTrim(b.orderNumber).localeCompare(safeTrim(a.orderNumber));
          });
        return json(res, 200, { ok: true, orders: sorted });
      }

      // GET /api/service-orders/track?order=ORD-001
      if (rest[0] === "track") {
        const code = safeTrim(
          url.searchParams.get("order") ||
            url.searchParams.get("orderNumber") ||
            url.searchParams.get("code")
        );
        if (!code) {
          return json(res, 400, { ok: false, message: "Missing query: order / orderNumber" });
        }
        const found = orders.find(
          (o) => safeTrim(o.orderNumber).toUpperCase() === code.toUpperCase()
        );
        if (!found) return json(res, 404, { ok: false, message: "Not found" });
        return json(res, 200, { ok: true, order: attachShoes(found) });
      }

      // GET /api/service-orders/:id
      const orderId = safeTrim(rest[0]);
      const found = orders.find((o) => o.id === orderId);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });
      return json(res, 200, { ok: true, order: attachShoes(found) });
    }

    // ============== ADMIN ONLY ==============
    if (!requireAdmin(req)) {
      return json(res, 401, { ok: false, message: "Unauthorized (missing/invalid token)" });
    }

    const body = parseBody(req);

    const findOrderRow = (orderId) => {
      const row = orderRows.find((r) => safeTrim(r.id) === orderId);
      return row || null;
    };

    const findShoeRow = (orderId, shoeId) => {
      // endpoint có orderId + shoeId -> ưu tiên match cả 2
      const row = shoeRows.find(
        (r) => safeTrim(r.orderId) === orderId && safeTrim(r.id) === shoeId
      );
      return row || null;
    };

    // -------- POST /api/service-orders (create order) --------
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

      const payload = {
        id,
        orderNumber,
        customerName,
        customerPhone,
        createdDate,
        totalAmount,
        status,
        assignedTo,
        shoesJson: "", // để tương thích sheet cũ nếu còn cột
      };

      const row = buildRowFromPayload(payload, orderHeaders);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: ORDERS_RANGE_ALL,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id, orderNumber } });
    }

    // -------- PATCH /api/service-orders/:id (update order) --------
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
      const outRow = buildRowFromPayload(row, orderHeaders);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${ORDERS_SHEET}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: orderId } });
    }

    // -------- DELETE /api/service-orders/:id (delete order row) --------
    if (req.method === "DELETE" && rest.length === 1) {
      const orderId = safeTrim(rest[0]);
      const row = findOrderRow(orderId);
      if (!row) return json(res, 404, { ok: false, message: "Order not found" });

      // 1) delete order row
      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, ORDERS_SHEET);
      const rowIndex = row.__rowIndex;

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

      // 2) soft-delete all shoes of this order (best effort)
      const deletedColExists = shoeHeaders.includes("deleted");
      if (deletedColExists) {
        const related = shoeRows.filter((r) => safeTrim(r.orderId) === orderId);
        for (const sr of related) {
          sr.deleted = "true";
          const out = buildRowFromPayload(sr, shoeHeaders);
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHOES_SHEET}!A${sr.__rowIndex}:Z${sr.__rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [out] },
          });
        }
      }

      return json(res, 200, { ok: true, data: { id: orderId } });
    }

    // -------- POST /api/service-orders/:id/shoes (add shoe) --------
    if (req.method === "POST" && rest.length === 2 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);

      // đảm bảo order tồn tại
      const orderExists = orders.some((o) => o.id === orderId);
      if (!orderExists) return json(res, 404, { ok: false, message: "Order not found" });

      const name = safeTrim(body.name);
      const service = safeTrim(body.service);
      if (!name || !service) {
        return json(res, 400, { ok: false, message: "Missing: shoe.name / shoe.service" });
      }

      const shoeId = safeTrim(body.id) || `shoe_${Date.now()}`;
      const status = normalizeStatus(body.status, "shoe");
      const imagesArr = Array.isArray(body.images) ? body.images.map((s) => safeTrim(s)).filter(Boolean) : [];
      const notes = safeTrim(body.notes);

      const payload = {
        id: shoeId,
        orderId,
        name,
        service,
        status,
        images: JSON.stringify(imagesArr),
        notes,
        deleted: "false",
      };

      const row = buildRowFromPayload(payload, shoeHeaders);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: SHOES_RANGE_ALL,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id: shoeId } });
    }

    // -------- PATCH /api/service-orders/:id/shoes/:shoeId (update shoe) --------
    if (req.method === "PATCH" && rest.length === 3 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);
      const shoeId = safeTrim(rest[2]);

      const row = findShoeRow(orderId, shoeId);
      if (!row) return json(res, 404, { ok: false, message: "Shoe not found" });

      const updatable = ["name", "service", "status", "images", "notes", "deleted"];

      for (const k of updatable) {
        if (k in (body || {})) {
          if (k === "status") row.status = normalizeStatus(body.status, "shoe");
          else if (k === "images") {
            const arr = Array.isArray(body.images)
              ? body.images.map((s) => safeTrim(s)).filter(Boolean)
              : parseImagesCell(row.images);
            row.images = JSON.stringify(arr);
          } else if (k === "deleted") {
            row.deleted = safeTrim(body.deleted) ? safeTrim(body.deleted) : row.deleted;
          } else {
            row[k] = safeTrim(body[k]);
          }
        }
      }

      // cố định id/orderId
      row.id = shoeId;
      row.orderId = orderId;

      const outRow = buildRowFromPayload(row, shoeHeaders);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHOES_SHEET}!A${row.__rowIndex}:Z${row.__rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [outRow] },
      });

      return json(res, 200, { ok: true, data: { id: shoeId } });
    }

    // -------- DELETE /api/service-orders/:id/shoes/:shoeId (soft delete shoe) --------
    if (req.method === "DELETE" && rest.length === 3 && rest[1] === "shoes") {
      const orderId = safeTrim(rest[0]);
      const shoeId = safeTrim(rest[2]);

      const row = findShoeRow(orderId, shoeId);
      if (!row) return json(res, 404, { ok: false, message: "Shoe not found" });

      row.deleted = "true";

      const outRow = buildRowFromPayload(row, shoeHeaders);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHOES_SHEET}!A${row.__rowIndex}:Z${row.__rowIndex}`,
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
