// api/orders/index.js
import { allowCors, json, getSpreadsheetId, getSheetsClient } from "../_lib/gsheets.js";

function safeTrim(x) {
  return String(x ?? "").trim();
}
function nowIso() {
  return new Date().toISOString();
}
function makeOrderId() {
  const s = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `ORD-${s}`;
}
function toNumber(x, fallback = 0) {
  const n = Number(String(x ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}
function calcTotal(items) {
  return items.reduce((sum, it) => sum + toNumber(it.quantity) * toNumber(it.price), 0);
}

async function readSheet(sheets, spreadsheetId, range) {
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

async function appendRow(sheets, spreadsheetId, range, row) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const sheets = await getSheetsClient(); // ✅ gsheets.js trả về sheets instance
    const spreadsheetId = getSpreadsheetId();

    const ORDERS_SHEET = "orders";
    const ITEMS_SHEET = "order_items";

    // ✅ GET /api/orders
    if (req.method === "GET") {
      const ordersValues = await readSheet(sheets, spreadsheetId, `${ORDERS_SHEET}!A:Z`);
      const itemsValues = await readSheet(sheets, spreadsheetId, `${ITEMS_SHEET}!A:Z`);

      const ordersHeader = ordersValues[0] || [];
      const ordersBody = ordersValues.slice(1);

      const itemsHeader = itemsValues[0] || [];
      const itemsBody = itemsValues.slice(1);

      const idx = (header, name) => header.findIndex((h) => safeTrim(h) === name);

      const o = {
        id: idx(ordersHeader, "id"),
        customerName: idx(ordersHeader, "customerName"),
        customerPhone: idx(ordersHeader, "customerPhone"),
        customerAddress: idx(ordersHeader, "customerAddress"),
        notes: idx(ordersHeader, "notes"),
        totalAmount: idx(ordersHeader, "totalAmount"),
        status: idx(ordersHeader, "status"),
        createdAt: idx(ordersHeader, "createdAt"),
      };

      const it = {
        orderId: idx(itemsHeader, "orderId"),
        productId: idx(itemsHeader, "productId"),
        productName: idx(itemsHeader, "productName"),
        quantity: idx(itemsHeader, "quantity"),
        price: idx(itemsHeader, "price"),
      };

      const itemsByOrder = new Map();
      for (const r of itemsBody) {
        const oid = safeTrim(r[it.orderId]);
        if (!oid) continue;

        const item = {
          productId: safeTrim(r[it.productId]),
          productName: safeTrim(r[it.productName]),
          quantity: toNumber(r[it.quantity]),
          price: toNumber(r[it.price]),
        };

        if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, []);
        itemsByOrder.get(oid).push(item);
      }

      const data = ordersBody
        .map((r) => {
          const id = safeTrim(r[o.id]);
          return {
            id,
            customerName: safeTrim(r[o.customerName]),
            customerPhone: safeTrim(r[o.customerPhone]),
            customerAddress: safeTrim(r[o.customerAddress]),
            notes: safeTrim(r[o.notes]),
            totalAmount: toNumber(r[o.totalAmount]),
            status: safeTrim(r[o.status]) || "pending",
            createdAt: safeTrim(r[o.createdAt]),
            items: itemsByOrder.get(id) || [],
          };
        })
        .filter((x) => x.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      return json(res, 200, { ok: true, data });
    }

    // ✅ POST /api/orders
    if (req.method === "POST") {
      const body = req.body || {};

      const customerName = safeTrim(body.customerName);
      const customerPhone = safeTrim(body.customerPhone);
      const customerAddress = safeTrim(body.customerAddress);
      const notes = safeTrim(body.notes);

      const rawItems = Array.isArray(body.items) ? body.items : [];
      const items = rawItems
        .map((x) => ({
          productId: safeTrim(x.productId),
          productName: safeTrim(x.productName),
          quantity: toNumber(x.quantity),
          price: toNumber(x.price),
        }))
        .filter((it) => it.productName && it.quantity > 0 && it.price >= 0);

      if (!customerName || !customerPhone || !customerAddress) {
        return json(res, 400, { ok: false, message: "Thiếu thông tin khách hàng" });
      }
      if (!items.length) {
        return json(res, 400, { ok: false, message: "Giỏ hàng trống" });
      }

      const id = makeOrderId();
      const createdAt = nowIso();
      const totalAmount = calcTotal(items);

      // orders columns: id, customerName, customerPhone, customerAddress, notes, totalAmount, status, createdAt
      await appendRow(sheets, spreadsheetId, `${ORDERS_SHEET}!A:H`, [
        id,
        customerName,
        customerPhone,
        customerAddress,
        notes,
        String(totalAmount),
        "pending",
        createdAt,
      ]);

      // order_items columns: orderId, productId, productName, quantity, price
      for (const itx of items) {
        await appendRow(sheets, spreadsheetId, `${ITEMS_SHEET}!A:E`, [
          id,
          itx.productId,
          itx.productName,
          String(itx.quantity),
          String(itx.price),
        ]);
      }

      return json(res, 201, {
        ok: true,
        data: {
          id,
          customerName,
          customerPhone,
          customerAddress,
          notes,
          totalAmount,
          status: "pending",
          createdAt,
          items,
        },
      });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders index error:", err);
    return json(res, 500, { ok: false, message: "Server error", detail: String(err?.message || err) });
  }
}
