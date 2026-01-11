import {
  setCors,
  getSheetsClient,
  readSheet,
  ensureHeaderRow,
  safeTrim,
  toNumber,
  buildHeaderIndex,
  jsonParseSafe,
} from "../_lib/sheets";

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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const orderNumber = safeTrim(req.query.order).toUpperCase();
  if (!orderNumber)
    return res
      .status(400)
      .json({ message: "Missing order query. Use ?order=ORD-001" });

  try {
    const { sheets, spreadsheetId } = await getSheetsClient();

    await ensureHeaderRow({
      sheets,
      spreadsheetId,
      sheetName: ORDERS_SHEET,
      header: ORDERS_HEADER,
    });
    await ensureHeaderRow({
      sheets,
      spreadsheetId,
      sheetName: SHOES_SHEET,
      header: SHOES_HEADER,
    });

    const ordersValues = await readSheet(
      sheets,
      spreadsheetId,
      `${ORDERS_SHEET}!A:Z`
    );
    const shoesValues = await readSheet(
      sheets,
      spreadsheetId,
      `${SHOES_SHEET}!A:Z`
    );

    const oh = ordersValues[0] || [];
    const ob = ordersValues.slice(1);
    const sh = shoesValues[0] || [];
    const sb = shoesValues.slice(1);

    const oIdx = buildHeaderIndex(oh);
    const sIdx = buildHeaderIndex(sh);

    const orderRow = ob.find((r) => {
      const deleted = safeTrim(r[oIdx.deleted]) || "0";
      if (deleted === "1") return false;
      return safeTrim(r[oIdx.orderNumber]).toUpperCase() === orderNumber;
    });

    if (!orderRow) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    const orderId = safeTrim(orderRow[oIdx.id]);

    const shoes = sb
      .filter((r) => {
        const deleted = safeTrim(r[sIdx.deleted]) || "0";
        if (deleted === "1") return false;
        return safeTrim(r[sIdx.orderId]) === orderId;
      })
      .map((r) => {
        const imagesRaw = safeTrim(r[sIdx.images]);
        const images = jsonParseSafe(imagesRaw, []);
        return {
          id: safeTrim(r[sIdx.id]),
          name: safeTrim(r[sIdx.name]),
          service: safeTrim(r[sIdx.service]),
          status: safeTrim(r[sIdx.status]) || "received",
          images: Array.isArray(images) ? images : [],
          notes: safeTrim(r[sIdx.notes]) || "",
        };
      });

    const data = {
      id: orderId,
      orderNumber: safeTrim(orderRow[oIdx.orderNumber]),
      customerName: safeTrim(orderRow[oIdx.customerName]),
      customerPhone: safeTrim(orderRow[oIdx.customerPhone]),
      createdDate: safeTrim(orderRow[oIdx.createdAt]),
      totalAmount: toNumber(orderRow[oIdx.totalAmount]),
      status: safeTrim(orderRow[oIdx.status]) || "pending",
      shoes,
    };

    return res.status(200).json({ data });
  } catch (err) {
    console.error("service-orders/track error:", err);
    return res
      .status(500)
      .json({ message: "Server error", detail: String(err?.message || err) });
  }
}
