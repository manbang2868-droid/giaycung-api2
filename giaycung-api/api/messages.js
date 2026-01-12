// api/messages.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  getSpreadsheetId,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "messages";

function safeTrim(x) {
  return String(x ?? "").trim();
}

function rowsToObjects(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map((h) => safeTrim(h));

  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row?.[i] ?? "";
    });
    return obj;
  });
}

function colToA1(colNumber1Based) {
  // 1 -> A, 26 -> Z, 27 -> AA ...
  let n = colNumber1Based;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = getSpreadsheetId();

    const sheets = await getSheetsClient();

    // ======================
    // ✅ GET: list messages
    // ======================
    if (req.method === "GET") {
      const status = safeTrim(req.query?.status); // optional: ?status=new

      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!A:Z`,
      });

      let items = rowsToObjects(resp.data.values || []);

      items = items
        .map((x) => ({
          id: safeTrim(x.id),
          createdAt: safeTrim(x.createdAt),
          fullName: safeTrim(x.fullName),
          phone: safeTrim(x.phone),
          email: safeTrim(x.email),
          message: safeTrim(x.message),
          status: safeTrim(x.status) || "new",
          source: safeTrim(x.source),
        }))
        .filter((x) => x.id);

      if (status) items = items.filter((x) => x.status === status);

      items.sort((a, b) => {
        const tb = Date.parse(b.createdAt || "") || 0;
        const ta = Date.parse(a.createdAt || "") || 0;
        return tb - ta;
      });

      return json(res, 200, { ok: true, data: items });
    }

    // ======================
    // ✅ POST: create message
    // ======================
    if (req.method === "POST") {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const fullName = safeTrim(body?.fullName);
      const phone = safeTrim(body?.phone);
      const email = safeTrim(body?.email);
      const message = safeTrim(body?.message);
      const source = safeTrim(body?.source) || "contact-page";

      if (!fullName || !phone || !message) {
        return json(res, 400, {
          ok: false,
          message: "Thiếu dữ liệu: fullName / phone / message",
        });
      }

      const id = `msg_${Date.now()}`;
      const createdAt = new Date().toISOString();
      const status = "new";

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A:Z`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [
            [id, createdAt, fullName, phone, email, message, status, source],
          ],
        },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ======================
    // ✅ PATCH: update message (admin)
    // ======================
    if (req.method === "PATCH") {
      if (!requireAdmin(req)) {
        return json(res, 401, { ok: false, message: "Unauthorized" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const id = safeTrim(req.query?.id || body?.id);
      if (!id) {
        return json(res, 400, { ok: false, message: "Missing id" });
      }

      // field update (bạn có thể PATCH status thôi cũng được)
      const patch = {
        status: body?.status != null ? safeTrim(body.status) : undefined,
        fullName: body?.fullName != null ? safeTrim(body.fullName) : undefined,
        phone: body?.phone != null ? safeTrim(body.phone) : undefined,
        email: body?.email != null ? safeTrim(body.email) : undefined,
        message: body?.message != null ? safeTrim(body.message) : undefined,
        source: body?.source != null ? safeTrim(body.source) : undefined,
      };

      // đọc sheet để tìm dòng theo id + lấy headers
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!A:Z`,
      });

      const values = resp.data.values || [];
      if (values.length < 2) {
        return json(res, 404, { ok: false, message: "No data" });
      }

      const headers = values[0].map((h) => safeTrim(h));
      const idColIndex = headers.indexOf("id");
      if (idColIndex === -1) {
        return json(res, 500, { ok: false, message: "Missing 'id' column" });
      }

      // tìm dòng trong values (values[0] là header)
      let foundRowIndex = -1; // index trong mảng values (0-based)
      for (let r = 1; r < values.length; r++) {
        const row = values[r] || [];
        if (safeTrim(row[idColIndex]) === id) {
          foundRowIndex = r;
          break;
        }
      }

      if (foundRowIndex === -1) {
        return json(res, 404, { ok: false, message: "Message not found" });
      }

      // sheetRowNumber là số dòng thật trong Google Sheet (1-based)
      const sheetRowNumber = foundRowIndex + 1;

      // dựng row mới: giữ cái cũ, override field nào có patch
      const oldRow = values[foundRowIndex] || [];
      const newRow = headers.map((h, i) => oldRow?.[i] ?? "");

      // map header -> value patch
      const setIfProvided = (key, val) => {
        if (val === undefined) return;
        const idx = headers.indexOf(key);
        if (idx !== -1) newRow[idx] = val;
      };

      setIfProvided("status", patch.status);
      setIfProvided("fullName", patch.fullName);
      setIfProvided("phone", patch.phone);
      setIfProvided("email", patch.email);
      setIfProvided("message", patch.message);
      setIfProvided("source", patch.source);

      const lastCol = colToA1(headers.length || 1);
      const range = `${SHEET_NAME}!A${sheetRowNumber}:${lastCol}${sheetRowNumber}`;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [newRow] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ======================
    // ✅ DELETE: delete message row (admin) - HARD DELETE
    // ======================
    if (req.method === "DELETE") {
      if (!requireAdmin(req)) {
        return json(res, 401, { ok: false, message: "Unauthorized" });
      }

      const id = safeTrim(req.query?.id);
      if (!id) {
        return json(res, 400, { ok: false, message: "Missing id" });
      }

      // đọc sheet để tìm dòng theo id + lấy headers
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!A:Z`,
      });

      const values = resp.data.values || [];
      if (values.length < 2) {
        return json(res, 404, { ok: false, message: "No data" });
      }

      const headers = values[0].map((h) => safeTrim(h));
      const idColIndex = headers.indexOf("id");
      if (idColIndex === -1) {
        return json(res, 500, { ok: false, message: "Missing 'id' column" });
      }

      // tìm dòng trong values (values[0] là header)
      let foundRowIndex = -1;
      for (let r = 1; r < values.length; r++) {
        const row = values[r] || [];
        if (safeTrim(row[idColIndex]) === id) {
          foundRowIndex = r;
          break;
        }
      }

      if (foundRowIndex === -1) {
        return json(res, 404, { ok: false, message: "Message not found" });
      }

      const sheetRowNumber = foundRowIndex + 1; // 1-based row in sheet

      // cần sheetId để deleteDimension
      const sheetId = await getSheetIdByTitle(
        sheets,
        spreadsheetId,
        SHEET_NAME
      );

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: sheetRowNumber - 1, // 0-based inclusive
                  endIndex: sheetRowNumber, // 0-based exclusive
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
    console.error("MESSAGES API ERROR:", err);
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
