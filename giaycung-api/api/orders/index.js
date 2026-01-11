import { google } from "googleapis";

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
  return items.reduce(
    (sum, it) => sum + toNumber(it.quantity) * toNumber(it.price),
    0
  );
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function getSheetsClient() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  if (!spreadsheetId || !client_email || !private_key) {
    const miss = [
      !spreadsheetId ? "SPREADSHEET_ID" : null,
      !client_email ? "GOOGLE_CLIENT_EMAIL" : null,
      !private_key ? "GOOGLE_PRIVATE_KEY" : null,
    ].filter(Boolean);
    throw new Error(`Missing ENV: ${miss.join(", ")}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  return { sheets, spreadsheetId };
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
  setCors(res);

  // ✅ FIX: OPTIONS phải có block
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();
    const ORDERS_SHEET = "orders";
    const ITEMS_SHEET = "order_items";

    if (req.method === "GET") {
      const ordersValues = await readSheet(
        sheets,
        spreadsheetId,
        `${ORDERS_SHEET}!A:Z`
      );
      const itemsValues = await readSheet(
        sheets,
        spreadsheetId,
        `${ITEMS_SHEET}!A:Z`
      );

      const ordersHeader = ordersValues[0] || [];
      const ordersBody = ordersValues.slice(1);

      const itemsHeader = itemsValues[0] || [];
      const itemsBody = itemsValues.slice(1);

      const idx = (header, name) =>
        header.findIndex((h) => safeTrim(h) === name);

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

      return res.status(200).json({ ok: true, data });
    }

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
        return res
          .status(400)
          .json({ ok: false, message: "Thiếu thông tin khách hàng" });
      }
      if (!items.length) {
        return res.status(400).json({ ok: false, message: "Giỏ hàng trống" });
      }

      const id = makeOrderId();
      const createdAt = nowIso();
      const totalAmount = calcTotal(items);

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

      for (const it2 of items) {
        await appendRow(sheets, spreadsheetId, `${ITEMS_SHEET}!A:E`, [
          id,
          it2.productId,
          it2.productName,
          String(it2.quantity),
          String(it2.price),
        ]);
      }

      return res.status(201).json({
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

    return res.status(405).json({ ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("Orders API error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      detail: String(err?.message || err),
    });
  }
}
