// api/service-orders.js
import { allowCors, json, requireAdmin, getSheetsClient, getSpreadsheetId } from "./_lib/gsheets.js";

const TAB = "ServiceOrders";
const HEADER = [
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

function nowDate() {
  return new Date().toISOString().split("T")[0];
}

function uid(prefix = "") {
  return `${prefix}${Date.now()}${Math.random().toString(16).slice(2)}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseUrl(req) {
  // req.url kiểu: /api/service-orders/... hoặc /service-orders/... tùy môi trường
  const full = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  return full;
}

async function ensureTabAndHeader(sheets, spreadsheetId) {
  // lấy metadata xem có tab chưa
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const exists = meta.data.sheets?.some((s) => s.properties?.title === TAB);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB } } }],
      },
    });
  }

  // set header dòng 1
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

function rowToOrder(row) {
  const [
    id,
    orderNumber,
    customerName,
    customerPhone,
    createdDate,
    totalAmount,
    status,
    assignedTo,
    shoesJson,
  ] = row;

  let shoes = [];
  try {
    shoes = shoesJson ? JSON.parse(shoesJson) : [];
  } catch {
    shoes = [];
  }

  return {
    id: id || "",
    orderNumber: orderNumber || "",
    customerName: customerName || "",
    customerPhone: customerPhone || "",
    createdDate: createdDate || "",
    totalAmount: Number(totalAmount || 0),
    status: status || "pending",
    assignedTo: assignedTo || "",
    shoes: Array.isArray(shoes) ? shoes : [],
  };
}

function orderToRow(order) {
  return [
    order.id,
    order.orderNumber,
    order.customerName,
    order.customerPhone,
    order.createdDate,
    String(order.totalAmount ?? 0),
    order.status,
    order.assignedTo || "",
    JSON.stringify(order.shoes || []),
  ];
}

async function getAllOrders(sheets, spreadsheetId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A2:I`,
  });

  const values = resp.data.values || [];
  const orders = values.map(rowToOrder);

  // sort mới nhất lên đầu (theo createdDate rồi id)
  orders.sort((a, b) => {
    const ad = a.createdDate || "";
    const bd = b.createdDate || "";
    if (ad !== bd) return bd.localeCompare(ad);
    return (b.id || "").localeCompare(a.id || "");
  });

  return { orders, raw: values };
}

async function findOrderRowIndexById(sheets, spreadsheetId, id) {
  // lấy cột A (id)
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A2:A`,
  });
  const ids = (resp.data.values || []).map((r) => r[0]);
  const idx = ids.findIndex((x) => x === id);
  if (idx === -1) return -1;
  // rowIndex trên sheet bắt đầu từ 1, và A2 là dòng 2 => idx 0 -> dòng 2
  return idx + 2;
}

function nextOrderNumber(existingOrders) {
  // tìm số lớn nhất trong ORD-xxx
  let max = 0;
  for (const o of existingOrders) {
    const m = String(o.orderNumber || "").match(/ORD-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1] || 0));
  }
  const n = max + 1;
  return `ORD-${String(n).padStart(3, "0")}`;
}

export default async function handler(req, res) {
  try {
    if (allowCors(req, res)) return;

    const url = parseUrl(req);
    const pathname = url.pathname; // /api/service-orders/...
    const base = "/api/service-orders";
    const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
    const parts = rest.split("/").filter(Boolean); // [] | ["track"] | [":id"] | [":id","shoes"] | [":id","shoes",":shoeId"]

    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await ensureTabAndHeader(sheets, spreadsheetId);

    // ======= PUBLIC TRACKING =======
    // GET /api/service-orders/track?order=ORD-001
    if (parts[0] === "track") {
      if (req.method !== "GET") return json(res, 405, { message: "Method Not Allowed" });

      const code = (url.searchParams.get("order") || "").trim().toUpperCase();
      if (!code) return json(res, 400, { message: "Missing order" });

      const { orders } = await getAllOrders(sheets, spreadsheetId);
      const found = orders.find((o) => String(o.orderNumber).toUpperCase() === code);
      if (!found) return json(res, 404, { message: "Order not found" });

      return json(res, 200, { order: found });
    }

    // ======= ADMIN GUARD (mọi thứ còn lại) =======
    const needAdmin = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) || req.method === "GET";
    // list/get chi tiết cũng nên là admin (trang admin)
    if (needAdmin && !requireAdmin(req)) {
      return json(res, 401, { message: "Unauthorized" });
    }

    // ======= /api/service-orders =======
    if (parts.length === 0) {
      if (req.method === "GET") {
        const { orders } = await getAllOrders(sheets, spreadsheetId);
        return json(res, 200, { orders });
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const { customerName, customerPhone, totalAmount, assignedTo } = body || {};

        if (!customerName || !customerPhone || totalAmount === undefined) {
          return json(res, 400, { message: "Missing fields" });
        }

        const { orders } = await getAllOrders(sheets, spreadsheetId);

        const order = {
          id: uid("ord_"),
          orderNumber: nextOrderNumber(orders),
          customerName,
          customerPhone,
          createdDate: nowDate(),
          totalAmount: Number(totalAmount || 0),
          status: "pending",
          assignedTo: assignedTo || "",
          shoes: [],
        };

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${TAB}!A:I`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [orderToRow(order)] },
        });

        return json(res, 201, { order });
      }

      return json(res, 405, { message: "Method Not Allowed" });
    }

    // ======= /api/service-orders/:id =======
    const orderId = parts[0];

    // shoes nested
    if (parts[1] === "shoes") {
      // POST /:id/shoes
      if (parts.length === 2 && req.method === "POST") {
        const body = await readBody(req);
        const { name, service, status, images, notes } = body || {};
        if (!name || !service) return json(res, 400, { message: "Missing fields" });

        const rowIndex = await findOrderRowIndexById(sheets, spreadsheetId, orderId);
        if (rowIndex === -1) return json(res, 404, { message: "Order not found" });

        // đọc order hiện tại
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${TAB}!A${rowIndex}:I${rowIndex}`,
        });
        const row = (resp.data.values || [])[0] || [];
        const order = rowToOrder(row);

        const shoe = {
          id: uid("shoe_"),
          name,
          service,
          status: status || "received",
          images: Array.isArray(images) ? images : [],
          notes: notes || "",
        };
        order.shoes = [...(order.shoes || []), shoe];

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${TAB}!A${rowIndex}:I${rowIndex}`,
          valueInputOption: "RAW",
          requestBody: { values: [orderToRow(order)] },
        });

        return json(res, 201, { shoe, order });
      }

      // PATCH/DELETE /:id/shoes/:shoeId
      if (parts.length === 3) {
        const shoeId = parts[2];

        const rowIndex = await findOrderRowIndexById(sheets, spreadsheetId, orderId);
        if (rowIndex === -1) return json(res, 404, { message: "Order not found" });

        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${TAB}!A${rowIndex}:I${rowIndex}`,
        });
        const row = (resp.data.values || [])[0] || [];
        const order = rowToOrder(row);

        const idx = (order.shoes || []).findIndex((s) => s.id === shoeId);
        if (idx === -1) return json(res, 404, { message: "Shoe not found" });

        if (req.method === "PATCH") {
          const body = await readBody(req);
          const next = { ...(order.shoes[idx] || {}), ...(body || {}) };
          // đảm bảo images là array
          if (body?.images && !Array.isArray(body.images)) next.images = [];
          order.shoes[idx] = next;

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${TAB}!A${rowIndex}:I${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: { values: [orderToRow(order)] },
          });

          return json(res, 200, { shoe: next, order });
        }

        if (req.method === "DELETE") {
          const removed = order.shoes[idx];
          order.shoes = order.shoes.filter((s) => s.id !== shoeId);

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${TAB}!A${rowIndex}:I${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: { values: [orderToRow(order)] },
          });

          return json(res, 200, { removed, order });
        }

        return json(res, 405, { message: "Method Not Allowed" });
      }

      return json(res, 404, { message: "Not Found" });
    }

    // order detail ops
    if (req.method === "GET") {
      const { orders } = await getAllOrders(sheets, spreadsheetId);
      const found = orders.find((o) => o.id === orderId);
      if (!found) return json(res, 404, { message: "Order not found" });
      return json(res, 200, { order: found });
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);

      const rowIndex = await findOrderRowIndexById(sheets, spreadsheetId, orderId);
      if (rowIndex === -1) return json(res, 404, { message: "Order not found" });

      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${TAB}!A${rowIndex}:I${rowIndex}`,
      });
      const row = (resp.data.values || [])[0] || [];
      const order = rowToOrder(row);

      const next = { ...order, ...(body || {}) };
      // shoes không update tại đây (đã có endpoints riêng)
      next.shoes = order.shoes;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TAB}!A${rowIndex}:I${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [orderToRow(next)] },
      });

      return json(res, 200, { order: next });
    }

    if (req.method === "DELETE") {
      const rowIndex = await findOrderRowIndexById(sheets, spreadsheetId, orderId);
      if (rowIndex === -1) return json(res, 404, { message: "Order not found" });

      // xóa bằng cách clear row (đơn giản, không shift dòng)
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${TAB}!A${rowIndex}:I${rowIndex}`,
      });

      return json(res, 200, { ok: true });
    }

    return json(res, 405, { message: "Method Not Allowed" });
  } catch (e) {
    return json(res, 500, { message: e?.message || "Server error" });
  }
}
