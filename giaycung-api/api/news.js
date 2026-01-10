// api/news.js
import {
  getSheetsClient,
  getSheetIdByTitle,
  json,
  allowCors,
  requireAdmin,
} from "./_lib/gsheets.js";

const SHEET_NAME = "news";
const RANGE = `${SHEET_NAME}!A:Z`;

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
    // rowIndex thực trên sheet (header dòng 1, data bắt đầu dòng 2)
    obj.__rowIndex = idx + 2;
    return obj;
  });
}

function buildRowFromPayload(payload, headers) {
  return headers.map((h) => payload[h] ?? "");
}

function normalizeArticle(x) {
  return {
    id: safeTrim(x.id),
    title: safeTrim(x.title),
    excerpt: safeTrim(x.excerpt),
    content: safeTrim(x.content),
    imageUrl: safeTrim(x.imageUrl),
    category: safeTrim(x.category) || "news", // tips | news | guide
    author: safeTrim(x.author) || "Admin",
    publishedDate: safeTrim(x.publishedDate), // YYYY-MM-DD
    status: safeTrim(x.status) || "published", // published | draft
  };
}

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    const spreadsheetId = safeTrim(process.env.SPREADSHEET_ID);
    if (!spreadsheetId) throw new Error("Missing SPREADSHEET_ID");

    const sheets = await getSheetsClient();

    // đọc sheet mỗi request để dữ liệu luôn mới
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
    });

    const values = resp.data.values || [];
    const headers = (values[0] || []).map(normalizeHeader);

    // sheet phải có header
    if (!headers.length) {
      return json(res, 500, {
        ok: false,
        message:
          "Sheet news chưa có header. Hãy tạo dòng 1: id,title,excerpt,content,imageUrl,category,author,publishedDate,status",
      });
    }

    // debug nhanh: /api/news?debug=1
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

    // ============ GET ============
    // GET /api/news
    // GET /api/news?id=...
    // GET /api/news?category=tips|news|guide
    // GET /api/news?status=published|draft
    // GET /api/news?q=keyword
    if (req.method === "GET") {
      const id = safeTrim(req.query?.id);
      const category = safeTrim(req.query?.category);
      const status = safeTrim(req.query?.status);
      const q = safeTrim(req.query?.q).toLowerCase();

      let items = rowsToObjects(values)
        .map((x) => normalizeArticle(x))
        .filter((x) =>
          Object.values(x).some((v) => safeTrim(v) !== "")
        );

      // lọc theo id nếu có
      if (id) {
        const found = items.find((x) => x.id === id);
        if (!found) return json(res, 404, { ok: false, message: "Not found" });
        return json(res, 200, { ok: true, data: found });
      }

      // filter
      if (category) items = items.filter((x) => x.category === category);
      if (status) items = items.filter((x) => x.status === status);

      if (q) {
        items = items.filter((x) => {
          const hay = `${x.title} ${x.excerpt} ${x.content}`.toLowerCase();
          return hay.includes(q);
        });
      }

      // sort mới nhất trước (publishedDate desc)
      items.sort((a, b) => {
        const tb = Date.parse(b.publishedDate || "") || 0;
        const ta = Date.parse(a.publishedDate || "") || 0;
        return tb - ta;
      });

      return json(res, 200, { ok: true, data: items });
    }

    // ============ Các method ghi: cần admin ============
    if (!requireAdmin(req)) {
      return json(res, 401, {
        ok: false,
        message: "Unauthorized (missing/invalid X-Admin-Token)",
      });
    }

    // ============ POST (create) ============
    if (req.method === "POST") {
      const body = parseBody(req);

      const title = safeTrim(body?.title);
      const excerpt = safeTrim(body?.excerpt);
      const content = safeTrim(body?.content);
      const imageUrl = safeTrim(body?.imageUrl);
      const category = safeTrim(body?.category) || "news";
      const author = safeTrim(body?.author) || "Admin";
      const status = safeTrim(body?.status) || "published";

      if (!title || !excerpt || !content || !imageUrl) {
        return json(res, 400, {
          ok: false,
          message: "Thiếu dữ liệu: title / excerpt / content / imageUrl",
        });
      }

      const id = safeTrim(body?.id) || `news_${Date.now()}`;

      // publishedDate: nếu không truyền thì lấy hôm nay YYYY-MM-DD
      const publishedDate =
        safeTrim(body?.publishedDate) ||
        new Date().toISOString().slice(0, 10);

      const payload = normalizeArticle({
        id,
        title,
        excerpt,
        content,
        imageUrl,
        category,
        author,
        publishedDate,
        status,
      });

      const row = buildRowFromPayload(payload, headers);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: RANGE,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ============ PATCH (update by id) ============
    // PATCH /api/news?id=news_...
    if (req.method === "PATCH") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const body = parseBody(req);

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      // merge giữ data cũ
      const merged = {};
      headers.forEach((h) => (merged[h] = found[h] ?? ""));

      // field cho phép update
      const updatable = [
        "title",
        "excerpt",
        "content",
        "imageUrl",
        "category",
        "author",
        "publishedDate",
        "status",
      ];

      updatable.forEach((k) => {
        if (k in (body || {})) merged[k] = safeTrim(body[k]);
      });

      merged.id = id;

      const rowIndex = found.__rowIndex;
      const row = buildRowFromPayload(normalizeArticle(merged), headers);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${rowIndex}:Z${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });

      return json(res, 200, { ok: true, data: { id } });
    }

    // ============ DELETE (delete row by id, shift up) ============
    // DELETE /api/news?id=news_...
    if (req.method === "DELETE") {
      const id = safeTrim(req.query?.id);
      if (!id) return json(res, 400, { ok: false, message: "Missing query: id" });

      const items = rowsToObjects(values);
      const found = items.find((x) => safeTrim(x.id) === id);
      if (!found) return json(res, 404, { ok: false, message: "Not found" });

      const sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

      const rowIndex = found.__rowIndex; // dòng thực trên sheet
      const startIndex = rowIndex - 1; // 0-based
      const endIndex = rowIndex; // delete đúng 1 dòng

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

      return json(res, 200, { ok: true, data: { id } });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    console.error("NEWS API ERROR:", err);
    return json(res, 500, {
      ok: false,
      message: err?.message || "Internal server error",
    });
  }
}
