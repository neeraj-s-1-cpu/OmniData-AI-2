import { jsPDF } from "jspdf";
import type { Dataset } from "../types/analytics";

export function downloadDatasetPdfReport(dataset: Dataset): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = 50;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 44) {
      doc.addPage();
      y = 48;
    }
  };

  // Header Banner
  doc.setFillColor(15, 33, 61);
  doc.rect(0, 0, pageWidth, 74, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("OMNI DATA AI — Analytical Report", margin, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Generated ${new Date().toLocaleString()}  |  Source: ${dataset.sourceType.toUpperCase()}`,
    margin,
    56
  );

  y = 100;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(dataset.name, maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 20 + 6;

  // Summary text
  if (dataset.summaryText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(51, 65, 85);
    const sumLines = doc.splitTextToSize(dataset.summaryText, maxWidth);
    doc.text(sumLines, margin, y);
    y += sumLines.length * 15 + 14;
  }

  // Metrics Bar
  ensureSpace(64);
  doc.setFillColor(238, 244, 251);
  doc.roundedRect(margin, y, maxWidth, 52, 6, 6, "F");
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Cleaned Records: ${dataset.rowCount.toLocaleString()}`, margin + 16, y + 22);
  doc.text(`Fields: ${dataset.columnCount}`, margin + 195, y + 22);
  doc.text(`Data Quality: ${dataset.cleanlinessScore}%`, margin + 315, y + 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Original Rows: ${dataset.originalRowCount}  |  Auto-Sorted: ${dataset.cleaningSummary.sorted_by || "Default"}`,
    margin + 16,
    y + 40
  );
  y += 72;

  // Key Insights
  ensureSpace(40);
  doc.setTextColor(15, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Important Insights & Summary", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(30, 41, 59);
  for (const insight of dataset.insights) {
    const lines = doc.splitTextToSize(`•  ${insight}`, maxWidth - 8);
    ensureSpace(lines.length * 15 + 6);
    doc.text(lines, margin + 4, y);
    y += lines.length * 15 + 6;
  }

  if (dataset.textNotes && dataset.textNotes.length > 0) {
    y += 8;
    ensureSpace(40);
    doc.setTextColor(15, 33, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Words & Sentences in Data (Printed Verbatim)", margin, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    for (const note of dataset.textNotes) {
      const lines = doc.splitTextToSize(
        `•  ${note.item} (${note.column}): "${note.value}"`,
        maxWidth - 8
      );
      ensureSpace(lines.length * 14 + 4);
      doc.text(lines, margin + 4, y);
      y += lines.length * 14 + 4;
    }
  }

  y += 10;

  // Automatic Data Cleaning Log
  ensureSpace(40);
  doc.setTextColor(15, 33, 61);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Automated Data Cleaning & Preparation", margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  for (const act of dataset.cleaningSummary.actions) {
    const lines = doc.splitTextToSize(`-  ${act}`, maxWidth - 8);
    ensureSpace(lines.length * 14 + 4);
    doc.text(lines, margin + 4, y);
    y += lines.length * 14 + 4;
  }

  y += 14;

  // Column Statistics
  if (dataset.columns.length > 0) {
    ensureSpace(50);
    doc.setTextColor(15, 33, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Field Profiles (Python Statistical Summary)", margin, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    for (const col of dataset.columns) {
      let detail = `${col.label} (${col.type}) — ${col.unique_count} unique`;
      if (col.type === "numeric" && col.sum !== undefined && col.sum !== null) {
        detail += ` | Sum: ${Number(col.sum).toLocaleString()} | Avg: ${Number(col.mean ?? 0).toLocaleString()} | Min: ${Number(col.min ?? 0).toLocaleString()} | Max: ${Number(col.max ?? 0).toLocaleString()}`;
      }
      const lines = doc.splitTextToSize(detail, maxWidth);
      ensureSpace(lines.length * 13 + 4);
      doc.setTextColor(30, 41, 59);
      doc.text(lines, margin, y);
      y += lines.length * 13 + 4;
    }
    y += 12;
  }

  // Cleaned Data Preview Table (top 25 rows)
  const rows = dataset.rows || [];
  if (rows.length > 0 && dataset.columns.length > 0) {
    ensureSpace(60);
    doc.setTextColor(15, 33, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Cleaned Data Preview (Top ${Math.min(25, rows.length)} of ${rows.length} rows)`, margin, y);
    y += 18;

    const visibleCols = dataset.columns.slice(0, 6);
    const colW = maxWidth / visibleCols.length;

    doc.setFillColor(226, 232, 240);
    doc.rect(margin, y - 11, maxWidth, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    visibleCols.forEach((c, idx) => {
      doc.text(c.label.slice(0, 16), margin + idx * colW + 4, y);
    });
    y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    for (const row of rows.slice(0, 25)) {
      ensureSpace(16);
      doc.setTextColor(51, 65, 85);
      visibleCols.forEach((c, idx) => {
        const val = row[c.name];
        const str = val === null || val === undefined ? "-" : String(val);
        doc.text(str.slice(0, 18), margin + idx * colW + 4, y);
      });
      y += 14;
    }
  }

  const safeFile = dataset.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "omni_report";
  doc.save(`${safeFile}_report.pdf`);
}
