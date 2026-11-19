import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = path.resolve(process.cwd(), "data", "omni_data.db");
const PYTHON_SCRIPT = path.resolve(process.cwd(), "python", "analyzer.py");

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function runPythonAnalyzer(payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [PYTHON_SCRIPT], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(stderr || `Python process exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!parsed.ok) {
          return reject(new Error(parsed.error || "Python analysis failed"));
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Invalid Python response: ${stdout.slice(0, 300)} ${stderr}`));
      }
    });

    child.stdin.write(JSON.stringify({ ...payload, db_path: DB_PATH }));
    child.stdin.end();
  });
}

function extractDocxText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const py = spawn(
      "python3",
      [
        "-c",
        `
import sys, zipfile, xml.etree.ElementTree as ET, io
data = sys.stdin.buffer.read()
with zipfile.ZipFile(io.BytesIO(data)) as z:
    xml_content = z.read("word/document.xml")
root = ET.fromstring(xml_content)
lines = []
for elem in root.iter():
    if elem.tag.endswith('}p'):
        texts = [t.text for t in elem.iter() if t.tag.endswith('}t') and t.text]
        if texts:
            lines.append("".join(texts))
print("\\n".join(lines))
`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    py.stdout.on("data", (d) => (out += d.toString()));
    py.stderr.on("data", (d) => (err += d.toString()));
    py.on("close", (code) => {
      if (code !== 0) reject(new Error(err || "Failed to read DOCX"));
      else resolve(out);
    });
    py.stdin.write(buffer);
    py.stdin.end();
  });
}

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    datasetTitle: {
      type: Type.STRING,
      description: "Concise, descriptive title for this dataset or report.",
    },
    summaryText: {
      type: Type.STRING,
      description: "1-2 sentence executive summary of what this data represents.",
    },
    headers: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Clean column header names for the extracted structured table.",
    },
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      description:
        "Extracted tabular data rows. Every inner array MUST have the exact same length as headers.",
    },
    insights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 key analytical insights, trends, anomalies, or takeaways observed.",
    },
    primaryX: {
      type: Type.STRING,
      description: "Best column header name for X-axis / category / timeline.",
    },
    primaryY: {
      type: Type.STRING,
      description: "Best numeric column header name for primary metric / Y-axis.",
    },
    primaryChartType: {
      type: Type.STRING,
      description: "Recommended primary chart type: one of bar, line, pie, scatter, area.",
    },
  },
  required: ["datasetTitle", "summaryText", "headers", "rows", "insights"],
};

const TABULAR_INSIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    datasetTitle: {
      type: Type.STRING,
      description: "Clean human-readable title for the dataset.",
    },
    summaryText: {
      type: Type.STRING,
      description: "1-2 sentence summary describing what this dataset measures.",
    },
    insights: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 to 4 crisp, domain-specific insights based on the sample data.",
    },
    primaryX: {
      type: Type.STRING,
      description: "Exact SQL/normalized column name best suited for X-axis.",
    },
    primaryY: {
      type: Type.STRING,
      description: "Exact SQL/normalized column name best suited for primary numeric Y-axis.",
    },
    primaryChartType: {
      type: Type.STRING,
      description: "Best primary chart type: one of bar, line, pie, scatter, area.",
    },
  },
  required: ["datasetTitle", "summaryText", "insights"],
};

function zipHeadersAndRows(headers: string[], rows: string[][]): Record<string, string>[] {
  if (!headers.length || !rows.length) return [];
  return rows
    .filter((r) => Array.isArray(r) && r.some((cell) => String(cell ?? "").trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        const key = String(h || `Column ${i + 1}`).trim() || `Column ${i + 1}`;
        obj[key] = r[i] !== undefined && r[i] !== null ? String(r[i]) : "";
      });
      return obj;
    });
}

function sheetToSmartRecords(
  sheet: XLSX.WorkSheet,
  isCsv: boolean
): Record<string, unknown>[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: isCsv,
  });

  if (!Array.isArray(matrix) || matrix.length === 0) {
    return [];
  }

  // Locate the real header row (skip blank rows & single-cell banner titles at the top)
  const nonEmptyRows = matrix
    .map((row, idx) => ({
      idx,
      cells: Array.isArray(row) ? row : [],
      nonEmpty: Array.isArray(row)
        ? row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "").length
        : 0,
    }))
    .filter((r) => r.nonEmpty > 0);

  if (nonEmptyRows.length === 0) {
    return [];
  }

  let headerRowInfo = nonEmptyRows[0];
  if (headerRowInfo.nonEmpty === 1) {
    const betterHeader = nonEmptyRows
      .slice(1, 12)
      .find((r) => r.nonEmpty >= 2);
    if (betterHeader) {
      headerRowInfo = betterHeader;
    }
  }

  const headerRow = headerRowInfo.cells;
  const maxCols = Math.max(
    headerRow.length,
    ...matrix.slice(headerRowInfo.idx + 1).map((r) => (Array.isArray(r) ? r.length : 0))
  );

  // Keep column indices that have a non-empty header OR any non-empty data below
  const colDefs: Array<{ colIdx: number; key: string }> = [];
  const usedKeys = new Set<string>();
  for (let c = 0; c < maxCols; c++) {
    const rawHeader = headerRow[c];
    const headerStr = rawHeader !== null && rawHeader !== undefined ? String(rawHeader).trim() : "";
    const hasDataBelow = matrix
      .slice(headerRowInfo.idx + 1)
      .some((r) => Array.isArray(r) && r[c] !== null && r[c] !== undefined && String(r[c]).trim() !== "");

    if (!headerStr && !hasDataBelow) continue;

    let key = headerStr || `Column ${colDefs.length + 1}`;
    const base = key;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${base} (${suffix})`;
      suffix++;
    }
    usedKeys.add(key);
    colDefs.push({ colIdx: c, key });
  }

  if (colDefs.length === 0) {
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: isCsv,
    });
  }

  const records: Record<string, unknown>[] = [];
  for (let rIdx = headerRowInfo.idx + 1; rIdx < matrix.length; rIdx++) {
    const rowArr = matrix[rIdx];
    if (!Array.isArray(rowArr)) continue;
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    for (const { colIdx, key } of colDefs) {
      const val = colIdx < rowArr.length ? rowArr[colIdx] : null;
      const cleaned =
        typeof val === "string" ? val.trim() : val;
      if (cleaned !== null && cleaned !== undefined && cleaned !== "") {
        hasValue = true;
      }
      obj[key] = cleaned === "" ? null : cleaned;
    }
    if (hasValue) {
      records.push(obj);
    }
  }

  return records;
}

function sanitizeColumnHint(name?: string): string | undefined {
  if (!name) return undefined;
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

let hydrogenQuotaCooldownUntil = 0;

function extractCleanErrorMessage(err: any): string {
  let msg = err?.message || String(err) || "Analysis failed";
  try {
    const jsonStart = msg.indexOf("{");
    if (jsonStart !== -1) {
      const maybeJson = JSON.parse(msg.slice(jsonStart));
      if (maybeJson?.error?.message) {
        msg = String(maybeJson.error.message);
      }
    }
  } catch {
    // not json
  }
  return msg.replace(/\s+/g, " ").trim();
}

function isDailyQuotaError(msg: string): boolean {
  return (
    msg.includes("PerDay") ||
    msg.includes("FreeTier") ||
    msg.includes("exceeded your current quota")
  );
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err || "");
      // Never sleep-retry daily quota exhaustion; fail fast to fallback model
      if (isDailyQuotaError(msg)) {
        throw err;
      }
      const isTransient =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("ECONNRESET");
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = attempt === 0 ? 800 : 1800;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

const SERVER_LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi (हिन्दी, written in natural Devanagari script)",
  hinglish: "Hinglish (natural conversational Hindi written in English/Roman letters)",
  bn: "Bengali (বাংলা)",
  mr: "Marathi (मराठी)",
  te: "Telugu (తెలుగు)",
  ta: "Tamil (தமிழ்)",
  gu: "Gujarati (ગુજરાતી)",
  kn: "Kannada (ಕನ್ನಡ)",
  ml: "Malayalam (മലയാളം)",
  pa: "Punjabi (ਪੰਜਾਬੀ)",
  ur: "Urdu (اردو)",
  es: "Spanish (Español)",
  fr: "French (Français)",
  de: "German (Deutsch)",
  ar: "Arabic (العربية)",
  zh: "Chinese (中文)",
  ja: "Japanese (日本語)",
};

function getLanguageInstruction(targetLanguage?: string): string {
  const code = String(targetLanguage || "").trim().toLowerCase();
  if (!code || code === "auto" || code === "en") {
    return "Respond in English for datasetTitle, summaryText, and concise insights.";
  }
  const label = SERVER_LANGUAGE_LABELS[code] || code;
  return `Write datasetTitle, summaryText, and all insights in ${label} so the user can read the analysis in their mother tongue. Keep extracted numbers exact and column headers clean and readable.`;
}

async function resolveRequestLanguage(req: express.Request): Promise<string> {
  const fromBody =
    typeof req.body?.language === "string" ? req.body.language.trim() : "";
  if (fromBody && fromBody !== "auto") return fromBody;
  try {
    const sRes = await runPythonAnalyzer({ command: "get_settings" });
    const dbLang = sRes?.settings?.language;
    if (typeof dbLang === "string" && dbLang.trim() && dbLang !== "auto") {
      return dbLang.trim();
    }
  } catch {
    // ignore settings read errors
  }
  return fromBody || "en";
}

async function extractStructuredWithGemini(
  parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  >,
  fallbackTitle: string,
  targetLanguage?: string
) {
  const ai = getGeminiClient();
  const langInstruction = getLanguageInstruction(targetLanguage);
  const systemInstruction =
    `You are Omni Data AI, an expert data extraction and analysis engine. Extract ALL metrics, items, dates, categories, and records from the provided input (handwritten notes, receipts, bills, registers, PDFs, images, spoken transcripts, or unstructured text) into a clean rectangular table. You accurately read handwritten Hindi/Devanagari, Indian regional scripts, English, Hinglish, and international languages. If an item is written in regional script (e.g. 'किराना'), preserve clear readable labels. Ignore crossed-out/scribbled-out numbers and use the corrected final number. If a single document-level date is written at the top (e.g. '6/11/26'), mention it in summaryText and focus table rows on each item and its value. If a row has a word or sentence in place of a number (e.g., 'Out of stock', 'Pending', 'Order placed'), keep that exact word or sentence verbatim in the cell and print it verbatim in insights instead of counting occurrences. If the headings clearly represent a simple item-quantity list (e.g., Items & Piece/Qty without prices/amounts), do NOT calculate averages, medians, or ranges — simply summarize the items and any verbatim notes. Ensure every row in \`rows\` has the exact same number of elements as \`headers\`. ${langInstruction}`;

  const callLite = () =>
    withTimeout(
      ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: { parts },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_SCHEMA,
        },
      }),
      20000,
      "Gemini extraction"
    );

  let response;
  if (Date.now() < hydrogenQuotaCooldownUntil) {
    response = await callLite();
  } else {
    try {
      response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: { parts },
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: EXTRACTION_SCHEMA,
          },
        }),
        20000,
        "Gemini extraction"
      );
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      const canFallback =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("timed out") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED");
      if (!canFallback) {
        throw err;
      }
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        hydrogenQuotaCooldownUntil = Date.now() + 30 * 60 * 1000;
      }
      console.log("Primary model quota/load reached; using gemini-3.1-flash-lite.");
      response = await callLite();
    }
  }

  const text = (response.text ?? "{}").trim();
  const parsed = JSON.parse(text);
  const headers: string[] = Array.isArray(parsed.headers) ? parsed.headers : [];
  const rows: string[][] = Array.isArray(parsed.rows) ? parsed.rows : [];
  const rawRows = zipHeadersAndRows(headers, rows);

  if (rawRows.length === 0) {
    throw new Error(
      "Could not extract structured records from this input. Try providing clearer tabular data, numbers, or categories."
    );
  }

  return {
    title: parsed.datasetTitle || fallbackTitle,
    summaryText: parsed.summaryText || "",
    rawRows,
    aiInsights: Array.isArray(parsed.insights) ? parsed.insights : [],
    aiHints: {
      primary_x: sanitizeColumnHint(parsed.primaryX),
      primary_y: sanitizeColumnHint(parsed.primaryY),
      primary_chart_type: parsed.primaryChartType,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function enrichTabularWithGemini(
  sampleRows: Record<string, unknown>[],
  fileName: string,
  targetLanguage?: string
) {
  const ai = getGeminiClient();
  const colNames = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];
  const preview = sampleRows.slice(0, 25);
  const langInstruction = getLanguageInstruction(targetLanguage);

  const response = await withTimeout(
    withGeminiRetry(
      () =>
        ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: `Dataset filename: "${fileName}"\nColumns: ${JSON.stringify(colNames)}\nSample rows (up to 25 of ${sampleRows.length}):\n${JSON.stringify(preview)}`,
          config: {
            systemInstruction:
              `You are Omni Data AI. Observe this tabular dataset sample, understand the domain, and return a clean title, 1-2 sentence summary, 3-4 crisp insights, and the best primary chart configuration. IMPORTANT: (1) If the headings show this is simply an item-count / inventory list (e.g., 'Items' and 'Piece' / 'Qty' / 'Stock' with no prices or financial metrics), do NOT compute averages, medians, ranges, or statistical calculations — summarize the listed items directly. (2) Whenever a cell in a numeric/quantity column contains a word or sentence instead of a number (e.g. 'Out of stock', 'Pending', etc.), quote/print that word or sentence verbatim in insights for that item instead of counting occurrences. (3) ${langInstruction}`,
            responseMimeType: "application/json",
            responseSchema: TABULAR_INSIGHT_SCHEMA,
          },
        }),
      1
    ),
    12000,
    "Gemini tabular enrichment"
  );

  const parsed = JSON.parse((response.text ?? "{}").trim());
  return {
    title: parsed.datasetTitle || fileName,
    summaryText: parsed.summaryText || "",
    aiInsights: Array.isArray(parsed.insights) ? parsed.insights : [],
    aiHints: {
      primary_x: sanitizeColumnHint(parsed.primaryX),
      primary_y: sanitizeColumnHint(parsed.primaryY),
      primary_chart_type: parsed.primaryChartType,
    },
  };
}

function handleApiError(res: express.Response, err: any) {
  const rawMsg = err?.message || String(err) || "Analysis failed";
  let msg = extractCleanErrorMessage(err);
  const status =
    err?.code === "LIMIT_FILE_SIZE" || err?.type === "entity.too.large"
      ? 413
      : err?.name === "MulterError"
      ? 400
      : rawMsg.includes("GEMINI_API_KEY") || rawMsg.includes("API_KEY_INVALID") || rawMsg.includes("400")
      ? 400
      : rawMsg.includes("403") || rawMsg.includes("PERMISSION_DENIED")
      ? 403
      : rawMsg.includes("429") || rawMsg.includes("RESOURCE_EXHAUSTED")
      ? 429
      : rawMsg.includes("503") || rawMsg.includes("UNAVAILABLE") || rawMsg.includes("high demand")
      ? 503
      : 500;

  if (status === 429) {
    msg =
      "Gemini API free-tier rate/daily quota reached. Please wait a moment and try again, or select a billing-enabled API key in Settings > Secrets.";
  }

  console.error("[Omni Data AI Error]:", msg);
  res.status(status).json({ ok: false, error: msg });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // Health
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "omni-data-ai" });
  });

  // Analyze uploaded file (CSV, Excel, JSON, PDF, Photo/Image, DOCX, TXT, etc.)
  app.post("/api/analyze/file", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ ok: false, error: "No file uploaded." });
      }

      const origName = file.originalname || "Uploaded File";
      const ext = path.extname(origName).toLowerCase();
      const mime = (file.mimetype || "").toLowerCase();
      const sourceType =
        (req.body?.sourceType as string) ||
        (mime.startsWith("image/") ? "camera" : ext.replace(".", "") || "file");
      const folderId =
        typeof req.body?.folderId === "string" && req.body.folderId.trim()
          ? req.body.folderId.trim()
          : null;
      const targetLanguage = await resolveRequestLanguage(req);

      const datasetId = randomUUID().replace(/-/g, "").slice(0, 12);

      // 1. Spreadsheet / CSV / TSV
      if ([".csv", ".tsv", ".xlsx", ".xls", ".ods"].includes(ext) || mime.includes("csv") || mime.includes("spreadsheet") || mime.includes("excel")) {
        const isCsv = [".csv", ".tsv"].includes(ext) || mime.includes("csv");
        const workbook = isCsv
          ? XLSX.read(file.buffer.toString("utf-8").replace(/^\uFEFF/, ""), {
              type: "string",
              raw: true,
            })
          : XLSX.read(file.buffer, { type: "buffer", raw: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          return res.status(400).json({ ok: false, error: "Spreadsheet has no sheets." });
        }
        const sheet = workbook.Sheets[firstSheetName];
        const rawRows = sheetToSmartRecords(sheet, isCsv);
        if (!rawRows.length) {
          return res.status(400).json({ ok: false, error: "Uploaded spreadsheet is empty." });
        }

        let enrichment: {
          title: string;
          summaryText: string;
          aiInsights: string[];
          aiHints: Record<string, unknown>;
        } = {
          title: origName.replace(/\.[^.]+$/, ""),
          summaryText: "",
          aiInsights: [],
          aiHints: {},
        };

        if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
          try {
            enrichment = await enrichTabularWithGemini(rawRows, origName, targetLanguage);
          } catch (aiErr: any) {
            const msg = String(aiErr?.message || "");
            if (msg.includes("400") || msg.includes("403") || msg.includes("API_KEY_INVALID")) {
              throw aiErr;
            }
            console.log("Optional tabular enrichment skipped; using Python summary.");
          }
        }

        const pyRes = await runPythonAnalyzer({
          command: "analyze_and_save",
          dataset_id: datasetId,
          name: enrichment.title,
          source_type: sourceType,
          folder_id: folderId,
          raw_rows: rawRows,
          summary_text: enrichment.summaryText,
          ai_insights: enrichment.aiInsights,
          ai_hints: enrichment.aiHints,
        });

        return res.json(pyRes);
      }

      // 2. JSON files
      if (ext === ".json" || mime === "application/json") {
        const parsedJson = JSON.parse(file.buffer.toString("utf-8"));
        let rawRows: Record<string, unknown>[] = [];
        if (Array.isArray(parsedJson)) {
          rawRows = parsedJson.filter((x) => x && typeof x === "object");
        } else if (parsedJson && typeof parsedJson === "object") {
          const firstArr = Object.values(parsedJson).find((v) => Array.isArray(v));
          if (Array.isArray(firstArr)) {
            rawRows = firstArr.filter((x) => x && typeof x === "object");
          } else {
            rawRows = [parsedJson];
          }
        }
        if (!rawRows.length) {
          return res.status(400).json({ ok: false, error: "JSON file contains no tabular records." });
        }
        let enrichment: {
          title: string;
          summaryText: string;
          aiInsights: string[];
          aiHints: Record<string, unknown>;
        } = {
          title: origName.replace(/\.[^.]+$/, ""),
          summaryText: "",
          aiInsights: [],
          aiHints: {},
        };
        if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") {
          try {
            enrichment = await enrichTabularWithGemini(rawRows, origName, targetLanguage);
          } catch (aiErr: any) {
            const msg = String(aiErr?.message || "");
            if (msg.includes("400") || msg.includes("403") || msg.includes("API_KEY_INVALID")) {
              throw aiErr;
            }
            console.log("Optional JSON enrichment skipped; using Python summary.");
          }
        }
        const pyRes = await runPythonAnalyzer({
          command: "analyze_and_save",
          dataset_id: datasetId,
          name: enrichment.title,
          source_type: "json",
          folder_id: folderId,
          raw_rows: rawRows,
          summary_text: enrichment.summaryText,
          ai_insights: enrichment.aiInsights,
          ai_hints: enrichment.aiHints,
        });
        return res.json(pyRes);
      }

      // 3. PDF or Image / Camera Photo Scan -> Multimodal Gemini extraction
      if (
        ext === ".pdf" ||
        mime === "application/pdf" ||
        mime.startsWith("image/") ||
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic"].includes(ext)
      ) {
        let safeMime =
          mime && mime !== "application/octet-stream"
            ? mime
            : ext === ".pdf"
            ? "application/pdf"
            : ext === ".png"
            ? "image/png"
            : ext === ".webp"
            ? "image/webp"
            : "image/jpeg";
        if (safeMime === "image/jpg") safeMime = "image/jpeg";

        const extracted = await extractStructuredWithGemini(
          [
            {
              inlineData: {
                mimeType: safeMime,
                data: file.buffer.toString("base64"),
              },
            },
            {
              text: `Analyze this ${ext === ".pdf" ? "PDF report" : "image/scanned document"} ("${origName}"). Extract all structured data, tables, metrics, figures, categories, and dates into clean tabular headers and rows so they can be cleaned, stored in SQL, and charted.`,
            },
          ],
          origName.replace(/\.[^.]+$/, ""),
          targetLanguage
        );

        const pyRes = await runPythonAnalyzer({
          command: "analyze_and_save",
          dataset_id: datasetId,
          name: extracted.title,
          source_type: sourceType,
          folder_id: folderId,
          raw_rows: extracted.rawRows,
          summary_text: extracted.summaryText,
          ai_insights: extracted.aiInsights,
          ai_hints: extracted.aiHints,
        });

        return res.json(pyRes);
      }

      // 4. DOCX Word documents
      if (ext === ".docx" || mime.includes("wordprocessingml")) {
        const docText = await extractDocxText(file.buffer);
        if (!docText.trim()) {
          return res.status(400).json({ ok: false, error: "Could not extract text from DOCX file." });
        }
        const extracted = await extractStructuredWithGemini(
          [{ text: `Document filename: "${origName}"\n\nContent:\n${docText.slice(0, 60000)}` }],
          origName.replace(/\.[^.]+$/, ""),
          targetLanguage
        );
        const pyRes = await runPythonAnalyzer({
          command: "analyze_and_save",
          dataset_id: datasetId,
          name: extracted.title,
          source_type: "docx",
          folder_id: folderId,
          raw_rows: extracted.rawRows,
          summary_text: extracted.summaryText,
          ai_insights: extracted.aiInsights,
          ai_hints: extracted.aiHints,
        });
        return res.json(pyRes);
      }

      // 5. Any text-based / unknown format (TXT, MD, LOG, HTML, XML, etc.)
      const textContent = file.buffer.toString("utf-8");
      if (!textContent.trim()) {
        return res.status(400).json({ ok: false, error: "Uploaded file is empty." });
      }
      const extracted = await extractStructuredWithGemini(
        [{ text: `File: "${origName}"\n\nContent:\n${textContent.slice(0, 60000)}` }],
        origName.replace(/\.[^.]+$/, ""),
        targetLanguage
      );
      const pyRes = await runPythonAnalyzer({
        command: "analyze_and_save",
        dataset_id: datasetId,
        name: extracted.title,
        source_type: sourceType,
        folder_id: folderId,
        raw_rows: extracted.rawRows,
        summary_text: extracted.summaryText,
        ai_insights: extracted.aiInsights,
        ai_hints: extracted.aiHints,
      });
      return res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Analyze photo/image via JSON base64 payload (avoids multipart proxy issues on mobile/desktop)
  app.post("/api/analyze/image", async (req, res) => {
    try {
      const { fileName, mimeType, base64Data, sourceType, folderId } = req.body || {};
      if (!base64Data || typeof base64Data !== "string") {
        return res.status(400).json({ ok: false, error: "No image data provided." });
      }
      const cleanBase64 = base64Data.includes(",")
        ? base64Data.split(",").pop() || ""
        : base64Data;
      let safeMime = String(mimeType || "image/jpeg").toLowerCase();
      if (safeMime === "image/jpg" || !safeMime.startsWith("image/")) {
        safeMime = "image/jpeg";
      }
      const origName = String(fileName || "photo_scan.jpg");
      const datasetId = randomUUID().replace(/-/g, "").slice(0, 12);
      const cleanFolderId =
        typeof folderId === "string" && folderId.trim() ? folderId.trim() : null;
      const targetLanguage = await resolveRequestLanguage(req);

      const extracted = await extractStructuredWithGemini(
        [
          {
            inlineData: {
              mimeType: safeMime,
              data: cleanBase64,
            },
          },
          {
            text: `Analyze this image/scanned document ("${origName}"). Extract all structured data, items, tables, metrics, figures, categories, and dates into clean tabular headers and rows so they can be cleaned, stored in SQL, and charted.`,
          },
        ],
        origName.replace(/\.[^.]+$/, ""),
        targetLanguage
      );

      const pyRes = await runPythonAnalyzer({
        command: "analyze_and_save",
        dataset_id: datasetId,
        name: extracted.title,
        source_type: sourceType || "camera",
        folder_id: cleanFolderId,
        raw_rows: extracted.rawRows,
        summary_text: extracted.summaryText,
        ai_insights: extracted.aiInsights,
        ai_hints: extracted.aiHints,
      });

      return res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Analyze raw pasted/typed text or spoken transcript
  app.post("/api/analyze/text", async (req, res) => {
    try {
      const { text, title, sourceType, folderId } = req.body || {};
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ ok: false, error: "Please provide text or data to analyze." });
      }

      const datasetId = randomUUID().replace(/-/g, "").slice(0, 12);
      const cleanFolderId =
        typeof folderId === "string" && folderId.trim() ? folderId.trim() : null;
      const targetLanguage = await resolveRequestLanguage(req);
      const extracted = await extractStructuredWithGemini(
        [
          {
            text: `Analyze this user-provided data input (which may be natural language in any language, mother tongue, Hindi, Hinglish, English, bullet notes, or pasted table text) and convert it into clean structured tabular rows:\n\n${text.slice(0, 60000)}`,
          },
        ],
        title || "Text Data Analysis",
        targetLanguage
      );

      const pyRes = await runPythonAnalyzer({
        command: "analyze_and_save",
        dataset_id: datasetId,
        name: extracted.title,
        source_type: sourceType || "text",
        folder_id: cleanFolderId,
        raw_rows: extracted.rawRows,
        summary_text: extracted.summaryText,
        ai_insights: extracted.aiInsights,
        ai_hints: extracted.aiHints,
      });

      return res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Analyze spoken audio via single-pass multimodal Gemini 4 Hydrogen (with Gemini 3.1 Flash Lite fallback)
  app.post("/api/analyze/voice", upload.single("audio"), async (req, res) => {
    try {
      const audioFile = req.file;
      const fallbackTranscript =
        typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
      const cleanFolderId =
        typeof req.body?.folderId === "string" && req.body.folderId.trim()
          ? req.body.folderId.trim()
          : null;
      const targetLanguage = await resolveRequestLanguage(req);
      const langHintLabel =
        SERVER_LANGUAGE_LABELS[targetLanguage.toLowerCase()] || "any mother tongue";

      if ((!audioFile || audioFile.buffer.length === 0) && !fallbackTranscript) {
        return res.status(400).json({
          ok: false,
          error: "No speech detected in the recording. Please speak your data clearly and try again.",
        });
      }

      const datasetId = randomUUID().replace(/-/g, "").slice(0, 12);
      let extracted;

      if (audioFile && audioFile.buffer.length > 0) {
        let mimeType = (audioFile.mimetype || "audio/webm").split(";")[0].trim().toLowerCase();
        if (mimeType === "audio/x-wav") mimeType = "audio/wav";
        if (!mimeType.startsWith("audio/")) mimeType = "audio/webm";

        const promptText = fallbackTranscript
          ? `Listen to this spoken audio (which may be in ${langHintLabel}, English, Hindi, Hinglish, or regional mother tongue). Live browser speech preview: "${fallbackTranscript}". Verify all spoken numbers, currency amounts, dates, and category names from the audio and convert them into a clean structured table.`
          : `Listen to this spoken audio (which may be in ${langHintLabel}, English, Hindi, Hinglish, or regional mother tongue). Extract all spoken metrics, numbers, currency amounts, dates, and categories into a clean structured table.`;

        try {
          extracted = await extractStructuredWithGemini(
            [
              {
                inlineData: {
                  mimeType,
                  data: audioFile.buffer.toString("base64"),
                },
              },
              { text: promptText },
            ],
            "Voice Data Analysis",
            targetLanguage
          );
        } catch (audioErr: any) {
          if (!fallbackTranscript) {
            throw audioErr;
          }
          console.warn("Audio multimodal extraction failed, falling back to live transcript:", audioErr?.message);
          extracted = await extractStructuredWithGemini(
            [
              {
                text: `The user spoke the following data/report aloud (in ${langHintLabel}, English, Hindi, or Hinglish). Convert every spoken metric, category, date, or comparison into a clean structured table:\n\n"${fallbackTranscript}"`,
              },
            ],
            "Voice Data Analysis",
            targetLanguage
          );
        }
      } else {
        extracted = await extractStructuredWithGemini(
          [
            {
              text: `The user spoke the following data/report aloud (in ${langHintLabel}, English, Hindi, or Hinglish). Convert every spoken metric, category, date, or comparison into a clean structured table:\n\n"${fallbackTranscript}"`,
            },
          ],
          "Voice Data Analysis",
          targetLanguage
        );
      }

      const pyRes = await runPythonAnalyzer({
        command: "analyze_and_save",
        dataset_id: datasetId,
        name: extracted.title,
        source_type: "voice",
        folder_id: cleanFolderId,
        raw_rows: extracted.rawRows,
        summary_text: extracted.summaryText,
        ai_insights: extracted.aiInsights,
        ai_hints: extracted.aiHints,
      });

      return res.json({
        ...pyRes,
        transcript: fallbackTranscript || extracted.summaryText,
      });
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // List datasets (Recent / History)
  app.get("/api/datasets", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const pyRes = await runPythonAnalyzer({ command: "list_datasets", limit });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Get single dataset with cleaned rows
  app.get("/api/datasets/:id", async (req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({
        command: "get_dataset",
        dataset_id: req.params.id,
        limit: Number(req.query.limit) || 5000,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Execute safe read-only SQL query on dataset table
  app.post("/api/datasets/:id/sql", async (req, res) => {
    try {
      const { sql } = req.body || {};
      const pyRes = await runPythonAnalyzer({
        command: "run_sql",
        dataset_id: req.params.id,
        sql: String(sql || ""),
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Persist user's updated chart selections (1-2 charts)
  app.put("/api/datasets/:id/charts", async (req, res) => {
    try {
      const { charts } = req.body || {};
      const pyRes = await runPythonAnalyzer({
        command: "update_charts",
        dataset_id: req.params.id,
        charts: Array.isArray(charts) ? charts : [],
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Persist user's custom currency/number display formats per column in SQLite metadata
  app.put("/api/datasets/:id/formats", async (req, res) => {
    try {
      const { formats } = req.body || {};
      const pyRes = await runPythonAnalyzer({
        command: "update_column_formats",
        dataset_id: req.params.id,
        formats: formats && typeof formats === "object" ? formats : {},
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Assign or unassign dataset to a folder
  app.put("/api/datasets/:id/folder", async (req, res) => {
    try {
      const folderId =
        typeof req.body?.folderId === "string" && req.body.folderId.trim()
          ? req.body.folderId.trim()
          : null;
      const pyRes = await runPythonAnalyzer({
        command: "assign_dataset_folder",
        dataset_id: req.params.id,
        folder_id: folderId,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Delete dataset
  app.delete("/api/datasets/:id", async (req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({
        command: "delete_dataset",
        dataset_id: req.params.id,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Folders CRUD & Cross-Time Growth Comparison
  app.get("/api/folders", async (_req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({ command: "list_folders" });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  app.post("/api/folders", async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      if (!name) {
        return res.status(400).json({ ok: false, error: "Folder name is required." });
      }
      const folderId = randomUUID().replace(/-/g, "").slice(0, 12);
      const pyRes = await runPythonAnalyzer({
        command: "create_folder",
        folder_id: folderId,
        name,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  app.delete("/api/folders/:id", async (req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({
        command: "delete_folder",
        folder_id: req.params.id,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  app.get("/api/folders/:id/compare", async (req, res) => {
    try {
      const period = String(req.query.period || "all").toLowerCase();
      const metric = typeof req.query.metric === "string" ? req.query.metric : undefined;
      const filterCol = typeof req.query.filterCol === "string" && req.query.filterCol.trim()
        ? req.query.filterCol.trim()
        : undefined;
      let filterValues: string[] | undefined = undefined;
      if (typeof req.query.filterValues === "string" && req.query.filterValues.trim() !== "") {
        const raw = req.query.filterValues.trim();
        if (raw.startsWith("[")) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) filterValues = parsed.map(String);
          } catch {
            filterValues = raw.split(",").map((s) => s.trim()).filter(Boolean);
          }
        } else {
          filterValues = raw.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } else if (req.query.filterValues === "") {
        filterValues = [];
      }
      const pyRes = await runPythonAnalyzer({
        command: "compare_folder",
        folder_id: req.params.id,
        period,
        metric,
        filter_col: filterCol,
        filter_values: filterValues,
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Settings
  app.get("/api/settings", async (_req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({ command: "get_settings" });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({
        command: "save_settings",
        settings: req.body?.settings || req.body || {},
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Profile
  app.get("/api/profile", async (_req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({ command: "get_profile" });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  app.put("/api/profile", async (req, res) => {
    try {
      const pyRes = await runPythonAnalyzer({
        command: "save_profile",
        profile: req.body?.profile || req.body || {},
      });
      res.json(pyRes);
    } catch (err: any) {
      handleApiError(res, err);
    }
  });

  // Guarantee all unknown /api routes & Multer/Express errors return JSON instead of HTML
  app.use("/api", (_req, res) => {
    res.status(404).json({ ok: false, error: "API endpoint not found." });
  });

  app.use(
    "/api",
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      handleApiError(res, err);
    }
  );

  // Vite middleware (dev) or static dist (production)
  // Start initializing Vite concurrently so app.listen binds port 3000 immediately
  let viteReadyPromise: Promise<any> | null = null;
  if (process.env.NODE_ENV !== "production") {
    viteReadyPromise = (async () => {
      const { createServer: createViteServer } = await import("vite");
      return createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
    })();
    viteReadyPromise.catch((err) => {
      console.error("Vite dev middleware failed to initialize:", err);
    });

    app.use(async (req, res, next) => {
      if (!viteReadyPromise) return next();
      try {
        const vite = await viteReadyPromise;
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distDir, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Omni Data AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
