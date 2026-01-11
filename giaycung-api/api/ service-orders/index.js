import {
    setCors,
    getSheetsClient,
    readSheet,
    appendRow,
    ensureHeaderRow,
    safeTrim,
    toNumber,
    buildHeaderIndex,
    jsonParseSafe,
  } from "../_lib/sheets";
  
  import { requireAdmin } from "../_lib/auth";
  
  const ORDERS_SHEET = "service_orders";
  const SHOES_SHEET = "service_order_shoes";
  
  const ORDERS_HEADER = [
    "id",
    "orderNumber",
    "customerName",
    "customerPhone",
    "createdAt",
    "totalAmount",
    "status",
    "assignedTo",
    "deleted",
  ];
  
  const SHOES_HEADER = [
    "id",
    "orderId",
    "name",
    "service",
    "status",
    "images",
    "notes",
    "deleted",
  ];
  
  function makeId(prefix) {
    const s = Math.random().toString(16).slice(2, 8).toUpperCase();
    return `${prefix}-${s}`;
  }
  
  function makeOrderNumber(n) {
    return `ORD-${String(n).padStart(3, "0")}`;
  }
  
  export default async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
  
    try {
      const { sheets, spreadsheetId } = await getSheetsClient();
  
      await ensureHeaderRow({ sheets, spreadsheetId, sheetName: ORDERS_SHEET, header: ORDERS_HEADER });
      await ensureHeaderRow({ sheets, spreadsheetId, sheetName: SHOES_SHEET, header: SHOES_HEADER });
  
      // ===== GET list (ADMIN) =====
      if (req.method === "GET") {
        if (!requireAdmin(req, res)) return;
  
        const ordersValues = await readSheet(sheets, spreadsheetId, `${ORDERS_SHEET}!A:Z`);
        const shoesValues = await readSheet(sheets, spreadsheetId, `${SHOES_SHEET}!A:Z`);
  
        const oh = ordersValues[0] || [];
        const ob = ordersValues.slice(1);
        const sh = shoesValues[0] || [];
        const sb = shoesValues.slice(1);
  
        const oIdx = buildHeaderIndex(oh);
        const sIdx = buildHeaderIndex(sh);
  
        const shoesByOrder = new Map();
  
        for (const r of sb) {
          const deleted = safeTrim(r[sIdx.deleted]) || "0";
          if (deleted === "1") continue;
  
          const orderId = safeTrim(r[sIdx.orderId]);
          if (!orderId) continue;
  
          const imagesRaw = safeTrim(r[sIdx.images]);
          const images = jsonParseSafe(imagesRaw, []);
  
          const shoe = {
            id: safeTrim(r[sIdx.id]),
            name: safeTrim(r[sIdx.name]),
            service: safeTrim(r[sIdx.service]),
            status: safeTrim(r[sIdx.status]) || "received",
            images: Array.isArray(images) ? images : [],
            notes: safeTrim(r[sIdx.notes]) || "",
          };
  
          if (!shoesByOrder.has(orderId)) shoesByOrder.set(orderId, []);
          shoesByOrder.get(orderId).push(shoe);
        }
  
        const data = ob
          .map((r) => {
            const deleted = safeTrim(r[oIdx.deleted]) || "0";
            if (deleted === "1") return null;
  
            const id = safeTrim(r[oIdx.id]);
            if (!id) return null;
  
            return {
              id,
              orderNumber: safeTrim(r[oIdx.orderNumber]),
              customerName: safeTrim(r[oIdx.customerName]),
              customerPhone: safeTrim(r[oIdx.customerPhone]),
              createdDate: safeTrim(r[oIdx.createdAt]),
              totalAmount: toNumber(r[oIdx.totalAmount]),
              status: safeTrim(r[oIdx.status]) || "pending",
              assignedTo: safeTrim(r[oIdx.assignedTo]) || "",
              shoes: shoesByOrder.get(id) || [],
            };
          })
          .filter(Boolean);
  
        data.sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1));
        return res.status(200).json({ data });
      }
  
      // ===== POST create order (ADMIN) =====
      if (req.method === "POST") {
        if (!requireAdmin(req, res)) return;
  
        const body = req.body || {};
        const customerName = safeTrim(body.customerName);
        const customerPhone = safeTrim(body.customerPhone);
        const totalAmount = toNumber(body.totalAmount);
        const assignedTo = safeTrim(body.assignedTo);
  
        if (!customerName || !customerPhone || !totalAmount) {
          return res.status(400).json({ message: "Thiếu thông tin (customerName/customerPhone/totalAmount)" });
        }
  
        // count existing orders to generate ORD-XXX
        const ordersColA = await readSheet(sheets, spreadsheetId, `${ORDERS_SHEET}!A:A`);
        const currentCount = Math.max(0, (ordersColA.length || 1) - 1);
  
        const id = makeId("SO");
        const orderNumber = makeOrderNumber(currentCount + 1);
        const createdAt = new Date().toISOString();
  
        await appendRow(sheets, spreadsheetId, `${ORDERS_SHEET}!A:I`, [
          id,
          orderNumber,
          customerName,
          customerPhone,
          createdAt,
          String(totalAmount),
          "pending",
          assignedTo,
          "0",
        ]);
  
        return res.status(201).json({
          data: {
            id,
            orderNumber,
            customerName,
            customerPhone,
            createdDate: createdAt,
            totalAmount,
            status: "pending",
            assignedTo,
            shoes: [],
          },
        });
      }
  
      return res.status(405).json({ message: "Method not allowed" });
    } catch (err) {
      console.error("service-orders/index error:", err);
      return res.status(500).json({ message: "Server error", detail: String(err?.message || err) });
    }
  }