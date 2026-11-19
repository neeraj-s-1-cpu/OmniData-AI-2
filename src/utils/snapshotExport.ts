import Plotly from "plotly.js-dist-min";
import type {
  ChartConfig,
  ColumnProfile,
  CrossFilterSelection,
} from "../types/analytics";

export interface SnapshotChartItem {
  chart: ChartConfig;
  columns: ColumnProfile[];
  isCrossFilterSource?: boolean;
  crossFilter?: CrossFilterSelection | null;
  extraFilterBadges?: string[];
}

export interface ExportDashboardSnapshotOptions {
  title: string;
  subtitle?: string;
  globalBadges?: string[];
  charts: SnapshotChartItem[];
  chartCardsContainer: HTMLElement | null;
  fileNamePrefix?: string;
}

interface FilterPill {
  text: string;
  tone: "default" | "blue" | "amber" | "indigo";
}

function getColumnLabel(columns: ColumnProfile[], name: string): string {
  if (name === "_count") return "Record Count";
  if (name === "_row_index") return "Record #";
  return columns.find((c) => c.name === name)?.label || name;
}

function summarizeValues(vals: string[], maxPreview = 4): string {
  if (vals.length === 0) return "None (0 selected)";
  if (vals.length <= maxPreview) return vals.join(", ");
  return `${vals.slice(0, maxPreview).join(", ")} +${vals.length - maxPreview} more`;
}

export function buildChartFilterPills(item: SnapshotChartItem): FilterPill[] {
  const { chart, columns, crossFilter, isCrossFilterSource, extraFilterBadges } = item;
  const pills: FilterPill[] = [];

  if (crossFilter) {
    if (isCrossFilterSource) {
      pills.push({
        text: `Selected (Source): ${crossFilter.columnLabel} = "${crossFilter.value}"`,
        tone: "blue",
      });
    } else {
      pills.push({
        text: `Cross-Filtered: ${crossFilter.columnLabel} = "${crossFilter.value}"`,
        tone: "amber",
      });
    }
  }

  if (extraFilterBadges && extraFilterBadges.length > 0) {
    extraFilterBadges.forEach((b) => {
      if (b.trim()) {
        pills.push({ text: b.trim(), tone: "blue" });
      }
    });
  }

  if (chart.xSelectedItems !== undefined) {
    const xLabel = getColumnLabel(columns, chart.xColumn);
    pills.push({
      text: `X Filter (${xLabel}): ${summarizeValues(chart.xSelectedItems)}`,
      tone: "blue",
    });
  }

  if (chart.ySelectedItems !== undefined) {
    const yLabel = getColumnLabel(columns, chart.yColumn);
    pills.push({
      text: `Y Filter (${yLabel}): ${summarizeValues(chart.ySelectedItems)}`,
      tone: "blue",
    });
  }

  if (chart.columnFilters) {
    Object.entries(chart.columnFilters).forEach(([colName, vals]) => {
      const colLabel = getColumnLabel(columns, colName);
      pills.push({
        text: `Filter ${colLabel}: ${summarizeValues(vals)}`,
        tone: "blue",
      });
    });
  }

  if (chart.syncAxis) {
    const hidden = chart.hiddenSeries || [];
    pills.push({
      text:
        hidden.length > 0
          ? `Sync Axis · Hidden: ${summarizeValues(hidden, 3)}`
          : "Sync Axis: All series visible",
      tone: "indigo",
    });
  }

  if (chart.swapAxes) {
    pills.push({ text: "Axes Swapped (X↔Y)", tone: "default" });
  }

  if (chart.separateItems) {
    pills.push({ text: "All Items (Own Column)", tone: "default" });
  }

  if (pills.length === 0) {
    pills.push({ text: "No column filters active (Showing all records)", tone: "default" });
  }

  return pills;
}

function buildChartConfigSubtitle(chart: ChartConfig, columns: ColumnProfile[]): string {
  const typeMap: Record<string, string> = {
    bar: "Bar",
    horizontal_bar: "Horizontal Bar",
    line: "Line",
    area: "Area",
    pie: "Pie / Donut",
    scatter: "Scatter",
  };
  const yCols =
    chart.yColumns && chart.yColumns.length > 0 ? chart.yColumns : [chart.yColumn];
  const xText = getColumnLabel(columns, chart.xColumn);
  const yText = yCols.map((c) => getColumnLabel(columns, c)).join(", ");
  const parts = [
    typeMap[chart.chartType] || chart.chartType,
    `${chart.swapAxes ? "Y" : "X"}: ${xText}`,
    `${chart.swapAxes ? "X" : "Y"}: ${yText}`,
    `Agg: ${(chart.aggregation || "sum").toUpperCase()}`,
  ];
  if (chart.groupColumn) {
    parts.push(`Group: ${getColumnLabel(columns, chart.groupColumn)}`);
  }
  return parts.join("  ·  ");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

interface PillLayoutRow {
  height: number;
  items: { x: number; y: number; w: number; h: number; pill: FilterPill }[];
}

function layoutPills(
  ctx: CanvasRenderingContext2D,
  pills: FilterPill[],
  startX: number,
  maxWidth: number
): PillLayoutRow {
  ctx.font = "600 13px Inter, system-ui, -apple-system, sans-serif";
  const padX = 12;
  const pillH = 26;
  const gapX = 8;
  const gapY = 8;

  let curX = 0;
  let curY = 0;
  const items: PillLayoutRow["items"] = [];

  for (const pill of pills) {
    let label = pill.text;
    const maxPillTextW = Math.max(120, maxWidth - padX * 2);
    if (ctx.measureText(label).width > maxPillTextW) {
      while (label.length > 8 && ctx.measureText(`${label}…`).width > maxPillTextW) {
        label = label.slice(0, -1);
      }
      label = `${label}…`;
    }
    const w = Math.min(maxWidth, ctx.measureText(label).width + padX * 2);
    if (curX > 0 && curX + w > maxWidth) {
      curX = 0;
      curY += pillH + gapY;
    }
    items.push({
      x: startX + curX,
      y: curY,
      w,
      h: pillH,
      pill: { ...pill, text: label },
    });
    curX += w + gapX;
  }

  return {
    height: items.length > 0 ? curY + pillH : 0,
    items,
  };
}

const PILL_STYLES: Record<
  FilterPill["tone"],
  { bg: string; border: string; text: string }
> = {
  default: { bg: "#F1F5F9", border: "#CBD5E1", text: "#334155" },
  blue: { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8" },
  amber: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
  indigo: { bg: "#EEF2FF", border: "#C7D2FE", text: "#4338CA" },
};

export async function exportDashboardSnapshotPng(
  options: ExportDashboardSnapshotOptions
): Promise<void> {
  const {
    title,
    subtitle,
    globalBadges = [],
    charts,
    chartCardsContainer,
    fileNamePrefix,
  } = options;

  if (!charts || charts.length === 0) {
    throw new Error("No active charts are currently visible to export.");
  }

  const cardNodes = chartCardsContainer
    ? Array.from(
        chartCardsContainer.querySelectorAll<HTMLElement>('[data-plotly-chart-card="true"]')
      )
    : [];

  const capturedCharts = await Promise.all(
    charts.map(async (item, idx) => {
      const cardEl = cardNodes[idx];
      const plotEl = cardEl?.querySelector<HTMLElement>('[data-plotly-canvas="true"]') || null;
      let img: HTMLImageElement | null = null;
      if (plotEl) {
        const w = Math.min(1800, Math.max(760, plotEl.scrollWidth || plotEl.clientWidth || 840));
        const h = Math.max(380, plotEl.clientHeight || 420);
        try {
          const dataUrl = await Plotly.toImage(plotEl, {
            format: "png",
            width: w,
            height: h,
            scale: 2,
          });
          img = await loadImage(dataUrl);
        } catch {
          img = null;
        }
      }
      return {
        item,
        pills: buildChartFilterPills(item),
        configSubtitle: buildChartConfigSubtitle(item.chart, item.columns),
        img,
      };
    })
  );

  // Measure layout using a scratch 2D canvas context
  const measureCanvas = document.createElement("canvas");
  const mCtx = measureCanvas.getContext("2d");
  if (!mCtx) {
    throw new Error("Canvas 2D context is not available in this browser.");
  }

  const isTwoCol = capturedCharts.length >= 2;
  const outerPad = 36;
  const colGap = 28;
  const totalWidth = isTwoCol ? 1760 : 1240;
  const cardWidth = isTwoCol
    ? Math.floor((totalWidth - outerPad * 2 - colGap) / 2)
    : totalWidth - outerPad * 2;
  const cardInnerPad = 24;
  const cardContentW = cardWidth - cardInnerPad * 2;

  const headerH = 96;
  const globalPillObjs: FilterPill[] = globalBadges
    .filter((b) => b.trim().length > 0)
    .map((b) => ({
      text: b,
      tone: b.toLowerCase().includes("cross-filter") ? "amber" : "blue",
    }));
  const globalPillsLayout =
    globalPillObjs.length > 0
      ? layoutPills(mCtx, globalPillObjs, outerPad, totalWidth - outerPad * 2)
      : { height: 0, items: [] };
  const globalStripH = globalPillsLayout.height > 0 ? globalPillsLayout.height + 24 : 16;

  const cardLayouts = capturedCharts.map((entry) => {
    mCtx.font = "700 20px Inter, system-ui, -apple-system, sans-serif";
    const titleLines = wrapTextLines(mCtx, entry.item.chart.title || "Chart", cardContentW);
    mCtx.font = "500 13px Inter, system-ui, -apple-system, sans-serif";
    const subLines = wrapTextLines(mCtx, entry.configSubtitle, cardContentW);

    const pillsLayout = layoutPills(mCtx, entry.pills, 0, cardContentW);
    const cardHeaderH =
      cardInnerPad +
      titleLines.length * 26 +
      4 +
      subLines.length * 18 +
      12 +
      pillsLayout.height +
      16;

    let chartAreaH = 400;
    if (entry.img && entry.img.naturalWidth > 0 && entry.img.naturalHeight > 0) {
      const scaledH = Math.round(
        (cardContentW * entry.img.naturalHeight) / entry.img.naturalWidth
      );
      chartAreaH = Math.max(320, Math.min(540, scaledH));
    }

    const totalCardH = cardHeaderH + chartAreaH + cardInnerPad;
    return {
      ...entry,
      titleLines,
      subLines,
      pillsLayout,
      cardHeaderH,
      chartAreaH,
      totalCardH,
    };
  });

  // Compute grid rows (pair side-by-side when 2+ charts)
  const rows: typeof cardLayouts[] = [];
  if (isTwoCol) {
    for (let i = 0; i < cardLayouts.length; i += 2) {
      rows.push(cardLayouts.slice(i, i + 2));
    }
  } else {
    rows.push([cardLayouts[0]]);
  }

  const rowHeights = rows.map((row) => Math.max(...row.map((c) => c.totalCardH)));
  const gridTotalH =
    rowHeights.reduce((acc, h) => acc + h, 0) + Math.max(0, rows.length - 1) * colGap;
  const footerH = 44;
  const totalHeight = headerH + globalStripH + gridTotalH + outerPad + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not initialize PNG export canvas.");
  }

  // Page Background
  ctx.fillStyle = "#F4F6F9";
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Header Banner
  ctx.fillStyle = "#0F213D";
  ctx.fillRect(0, 0, totalWidth, headerH);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 26px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(title || "Dashboard Comparison Snapshot", outerPad, 44);

  ctx.fillStyle = "#CBD5E1";
  ctx.font = "500 14px Inter, system-ui, -apple-system, sans-serif";
  const subText = subtitle
    ? `${subtitle}   ·   Snapshot exported ${new Date().toLocaleString()}`
    : `Snapshot exported ${new Date().toLocaleString()}`;
  ctx.fillText(subText, outerPad, 72);

  // Global Dashboard Filter / Layout Badges
  if (globalPillsLayout.items.length > 0) {
    const stripTop = headerH + 14;
    ctx.font = "600 13px Inter, system-ui, -apple-system, sans-serif";
    for (const p of globalPillsLayout.items) {
      const style = PILL_STYLES[p.pill.tone];
      drawRoundedRect(ctx, p.x, stripTop + p.y, p.w, p.h, 8);
      ctx.fillStyle = style.bg;
      ctx.fill();
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = style.text;
      ctx.fillText(p.pill.text, p.x + 12, stripTop + p.y + 17);
    }
  }

  // Draw Each Active Chart Card
  let curY = headerH + globalStripH + 8;
  rows.forEach((row, rIdx) => {
    const rowH = rowHeights[rIdx];
    row.forEach((card, cIdx) => {
      const cardX = outerPad + cIdx * (cardWidth + colGap);
      const cardY = curY;

      // Card surface + border
      drawRoundedRect(ctx, cardX, cardY, cardWidth, rowH, 16);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      let innerY = cardY + cardInnerPad + 18;
      const contentX = cardX + cardInnerPad;

      // Title
      ctx.fillStyle = "#0F172A";
      ctx.font = "700 20px Inter, system-ui, -apple-system, sans-serif";
      card.titleLines.forEach((line) => {
        ctx.fillText(line, contentX, innerY);
        innerY += 26;
      });

      // Subtitle
      innerY -= 4;
      ctx.fillStyle = "#64748B";
      ctx.font = "500 13px Inter, system-ui, -apple-system, sans-serif";
      card.subLines.forEach((line) => {
        ctx.fillText(line, contentX, innerY);
        innerY += 18;
      });

      // Respective Chart Filters
      innerY += 4;
      ctx.font = "600 13px Inter, system-ui, -apple-system, sans-serif";
      for (const p of card.pillsLayout.items) {
        const style = PILL_STYLES[p.pill.tone];
        drawRoundedRect(ctx, contentX + p.x, innerY + p.y, p.w, p.h, 8);
        ctx.fillStyle = style.bg;
        ctx.fill();
        ctx.strokeStyle = style.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = style.text;
        ctx.fillText(p.pill.text, contentX + p.x + 12, innerY + p.y + 17);
      }

      // Subtle divider above plot
      const plotTop = cardY + card.cardHeaderH;
      ctx.strokeStyle = "#F1F5F9";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(contentX, plotTop - 8);
      ctx.lineTo(contentX + cardContentW, plotTop - 8);
      ctx.stroke();

      const availPlotH = rowH - card.cardHeaderH - cardInnerPad;
      if (card.img && card.img.naturalWidth > 0 && card.img.naturalHeight > 0) {
        const scale = Math.min(
          cardContentW / card.img.naturalWidth,
          availPlotH / card.img.naturalHeight
        );
        const drawW = Math.round(card.img.naturalWidth * scale);
        const drawH = Math.round(card.img.naturalHeight * scale);
        const drawX = contentX + Math.round((cardContentW - drawW) / 2);
        const drawY = plotTop + Math.round((availPlotH - drawH) / 2);
        ctx.drawImage(card.img, drawX, drawY, drawW, drawH);
      } else {
        drawRoundedRect(ctx, contentX, plotTop + 8, cardContentW, Math.max(180, availPlotH - 16), 12);
        ctx.fillStyle = "#F8FAFC";
        ctx.fill();
        ctx.strokeStyle = "#CBD5E1";
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "#64748B";
        ctx.font = "600 14px Inter, system-ui, -apple-system, sans-serif";
        const emptyMsg = "No records match the currently active filters for this chart.";
        const msgW = ctx.measureText(emptyMsg).width;
        ctx.fillText(
          emptyMsg,
          contentX + Math.max(12, (cardContentW - msgW) / 2),
          plotTop + availPlotH / 2
        );
      }
    });
    curY += rowH + colGap;
  });

  // Footer
  ctx.fillStyle = "#64748B";
  ctx.font = "500 12px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `Omni Data AI  ·  Active Charts: ${capturedCharts.length}  ·  Snapshot includes active filters & cross-filtering state`,
    outerPad,
    totalHeight - 16
  );

  // Trigger PNG Download
  const safeBase =
    (fileNamePrefix || title || "dashboard_snapshot")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "dashboard";
  const fileName = `${safeBase}_snapshot.png`;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (blob) {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
