import React, { useEffect, useMemo, useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { ArrowLeftRight, ChevronDown, EyeOff, Filter, Palette, Search, SlidersHorizontal, X } from "lucide-react";
import type {
  ChartColorTheme,
  ChartConfig,
  ChartType,
  ColumnNumberFormat,
  ColumnProfile,
  CrossFilterSelection,
} from "../types/analytics";
import {
  NUMBER_FORMAT_OPTIONS,
  formatNumericValue,
  getPlotlyAxisFormat,
  resolveEffectiveFormat,
} from "../utils/numberFormat";
import { useLanguage } from "../utils/i18n";

interface PlotlyChartProps {
  chart: ChartConfig;
  rows: Record<string, string | number | null>[];
  columns: ColumnProfile[];
  onChangeConfig: (updated: ChartConfig) => void;
  onChangeColumnFormat?: (columnName: string, format: ColumnNumberFormat) => void;
  canRemove?: boolean;
  onRemove?: () => void;
  onToggleHide?: () => void;
  heightClass?: string;
  crossFilter?: CrossFilterSelection | null;
  isCrossFilterSource?: boolean;
  onCrossFilterSelect?: (
    selection: { column: string; columnLabel: string; value: string } | null
  ) => void;
}

const PALETTE = [
  "#1E88E5",
  "#F57C20",
  "#10B981",
  "#6366F1",
  "#0EA5E9",
  "#F59E0B",
  "#14B8A6",
  "#8B5CF6",
  "#E11D48",
  "#84CC16",
];

const COLOR_THEMES: Record<
  ChartColorTheme,
  { label: string; primary: string; palette: string[] }
> = {
  multi: {
    label: "Multi-Color",
    primary: "#1E88E5",
    palette: PALETTE,
  },
  ocean: {
    label: "Ocean Blue",
    primary: "#1E88E5",
    palette: ["#1E88E5", "#0284C7", "#38BDF8", "#0369A1", "#60A5FA", "#1D4ED8"],
  },
  emerald: {
    label: "Emerald",
    primary: "#10B981",
    palette: ["#10B981", "#059669", "#34D399", "#0D9488", "#14B8A6", "#047857"],
  },
  amber: {
    label: "Sunset Amber",
    primary: "#F57C20",
    palette: ["#F57C20", "#EA580C", "#F59E0B", "#FB923C", "#D97706", "#FBBF24"],
  },
  indigo: {
    label: "Indigo",
    primary: "#6366F1",
    palette: ["#6366F1", "#4F46E5", "#818CF8", "#7C3AED", "#8B5CF6", "#4338CA"],
  },
  rose: {
    label: "Crimson Rose",
    primary: "#E11D48",
    palette: ["#E11D48", "#BE123C", "#F43F5E", "#FB7185", "#DB2777", "#9F1239"],
  },
  slate: {
    label: "Charcoal Slate",
    primary: "#334155",
    palette: ["#1E293B", "#334155", "#475569", "#64748B", "#0F172A", "#94A3B8"],
  },
  custom: {
    label: "Custom",
    primary: "#1E88E5",
    palette: ["#1E88E5"],
  },
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `rgba(30, 136, 229, ${alpha})`;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CHART_TYPE_OPTIONS: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar Chart" },
  { value: "line", label: "Line Graph" },
  { value: "pie", label: "Pie Chart" },
  { value: "area", label: "Area Chart" },
  { value: "scatter", label: "Scatter Plot" },
  { value: "horizontal_bar", label: "Horizontal Bar" },
];

export function formatAxisFilterKey(
  val: string | number | null | undefined,
  blankLabel = "Unknown"
): string {
  if (val === null || val === undefined) return blankLabel;
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return blankLabel;
    return Number.isInteger(val) ? String(val) : String(Number(val.toFixed(4)));
  }
  const s = String(val).trim();
  return s === "" ? blankLabel : s;
}

interface FilterPopoverProps {
  title: string;
  buttonText: string;
  isFiltered: boolean;
  items: string[];
  selectedItems: string[] | undefined;
  formatItem?: (item: string) => string;
  onApply: (next: string[] | undefined) => void;
}

const FilterChecklistPopover: React.FC<FilterPopoverProps> = ({
  title,
  buttonText,
  isFiltered,
  items,
  selectedItems,
  formatItem,
  onApply,
}) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set(items));
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selectedItems ?? items));
    setSearch("");
  }, [open, items, selectedItems]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const disp = formatItem ? formatItem(it) : it;
      return it.toLowerCase().includes(q) || disp.toLowerCase().includes(q);
    });
  }, [items, search, formatItem]);

  const allDraftVisibleChecked =
    filteredItems.length > 0 && filteredItems.every((it) => draft.has(it));
  const someDraftVisibleChecked =
    filteredItems.some((it) => draft.has(it)) && !allDraftVisibleChecked;

  const toggleSelectAllVisible = () => {
    const next = new Set(draft);
    if (allDraftVisibleChecked) {
      filteredItems.forEach((it) => next.delete(it));
    } else {
      filteredItems.forEach((it) => next.add(it));
    }
    setDraft(next);
  };

  const toggleItem = (item: string) => {
    const next = new Set(draft);
    if (next.has(item)) {
      next.delete(item);
    } else {
      next.add(item);
    }
    setDraft(next);
  };

  const handleApply = () => {
    const chosen = items.filter((it) => draft.has(it));
    if (chosen.length === items.length) {
      onApply(undefined);
    } else {
      onApply(chosen);
    }
    setOpen(false);
  };

  const handleResetAll = () => {
    onApply(undefined);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={items.length === 0}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap disabled:opacity-45 ${
          isFiltered
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
        }`}
      >
        <Filter className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[130px]">{buttonText}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2.5 text-xs text-slate-800">
          <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-100">
            <span className="font-semibold text-slate-900 text-[11px] truncate">
              {title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Close filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search values..."
              className="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-1 text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer font-semibold text-slate-900 border-b border-slate-100 mb-1">
            <input
              type="checkbox"
              checked={allDraftVisibleChecked}
              ref={(el) => {
                if (el) el.indeterminate = someDraftVisibleChecked;
              }}
              onChange={toggleSelectAllVisible}
              className="h-3.5 w-3.5 accent-[#1E88E5]"
            />
            <span className="truncate">
              {search.trim() ? "(Select All Search Results)" : "(Select All)"}
            </span>
          </label>

          <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
            {filteredItems.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-slate-400">
                No matching items
              </div>
            ) : (
              filteredItems.map((item) => {
                const label = formatItem ? formatItem(item) : item;
                return (
                  <label
                    key={item}
                    className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.has(item)}
                      onChange={() => toggleItem(item)}
                      className="h-3.5 w-3.5 accent-[#1E88E5] shrink-0"
                    />
                    <span className="truncate text-slate-700" title={label}>
                      {label}
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-1.5 pt-2 mt-2 border-t border-slate-100">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleResetAll}
                className="rounded-md px-1.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setDraft(new Set())}
                className="rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                {t("clearAllBtn")}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-md bg-[#1E88E5] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1976D2]"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  chart,
  rows,
  columns,
  onChangeConfig,
  onChangeColumnFormat,
  canRemove,
  onRemove,
  onToggleHide,
  heightClass = "h-[330px] sm:h-[370px]",
  crossFilter = null,
  isCrossFilterSource = false,
  onCrossFilterSelect,
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [itemColorsOpen, setItemColorsOpen] = useState(false);
  const itemColorsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!itemColorsOpen) return;
    const handleOut = (e: MouseEvent) => {
      if (itemColorsRef.current && !itemColorsRef.current.contains(e.target as Node)) {
        setItemColorsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOut);
    return () => document.removeEventListener("mousedown", handleOut);
  }, [itemColorsOpen]);

  const numericCols = useMemo(
    () => columns.filter((c) => c.type === "numeric" || c.type === "mixed"),
    [columns]
  );

  const activeYColumns = useMemo(() => {
    if (chart.yColumns && chart.yColumns.length > 0) {
      return chart.yColumns;
    }
    return [chart.yColumn];
  }, [chart.yColumn, chart.yColumns]);

  const primaryYColMeta = useMemo(
    () => columns.find((c) => c.name === activeYColumns[0]),
    [columns, activeYColumns]
  );

  const xColMeta = useMemo(
    () => columns.find((c) => c.name === chart.xColumn),
    [columns, chart.xColumn]
  );

  const isXNumericCol =
    xColMeta?.type === "numeric" ||
    xColMeta?.type === "mixed" ||
    chart.xColumn === "_count";
  const isYNumericCol =
    primaryYColMeta?.type === "numeric" ||
    primaryYColMeta?.type === "mixed" ||
    activeYColumns[0] === "_count";

  // Inverted pair: numeric metric placed on X and category/date/row_index placed on Y
  const isInvertedColumnPair =
    activeYColumns.length === 1 &&
    isXNumericCol &&
    !isYNumericCol &&
    chart.chartType !== "scatter" &&
    chart.aggregation !== "raw";

  const axesInverted = isInvertedColumnPair || Boolean(chart.swapAxes);

  const effectiveYFormat = resolveEffectiveFormat(chart.yFormat, primaryYColMeta?.format);
  const effectiveXFormat = resolveEffectiveFormat(chart.xFormat, xColMeta?.format);

  const xLabel = useMemo(() => {
    if (chart.xColumn === "_row_index") return "Record #";
    if (chart.xColumn === "_count") return "Record Count";
    return xColMeta?.label || chart.xColumn;
  }, [chart.xColumn, xColMeta]);

  const yLabel = useMemo(() => {
    if (activeYColumns.length > 1) {
      return activeYColumns
        .map((yn) =>
          yn === "_count"
            ? "Count"
            : yn === "_row_index"
            ? "Record #"
            : columns.find((c) => c.name === yn)?.label || yn
        )
        .join(" / ");
    }
    if (chart.yColumn === "_count") return "Count";
    if (chart.yColumn === "_row_index") return "Record #";
    return primaryYColMeta?.label || chart.yColumn;
  }, [activeYColumns, chart.yColumn, columns, primaryYColMeta]);

  const parseNumericCell = (val: string | number | null | undefined): number | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") return Number.isFinite(val) ? val : null;
    const trimmed = String(val).trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  };

  // Unique items per column for Excel-style multi-column filtering
  const uniqueValuesByColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    columns.forEach((col) => {
      const seen = new Set<string>();
      const list: string[] = [];
      const blank = col.type === "numeric" || col.type === "mixed" ? "(Blank)" : "Unknown";
      rows.forEach((r) => {
        const key = formatAxisFilterKey(r[col.name], blank);
        if (!seen.has(key)) {
          seen.add(key);
          list.push(key);
        }
      });
      if (col.type === "numeric") {
        const allNum = list.length > 0 && list.every((it) => Number.isFinite(Number(it)));
        if (allNum) list.sort((a, b) => Number(a) - Number(b));
      }
      map[col.name] = list;
    });
    return map;
  }, [rows, columns]);

  // Unique selectable items for X-axis
  const xUniqueItems = useMemo(() => {
    if (
      chart.xColumn !== "_row_index" &&
      chart.xColumn !== "_count" &&
      uniqueValuesByColumn[chart.xColumn]
    ) {
      return uniqueValuesByColumn[chart.xColumn];
    }
    const seen = new Set<string>();
    const list: string[] = [];
    if (chart.xColumn === "_count") {
      const targetDim = activeYColumns[0];
      const counts = new Map<string, number>();
      rows.forEach((r, idx) => {
        const dKey =
          targetDim === "_row_index"
            ? `#${idx + 1}`
            : formatAxisFilterKey(r[targetDim], "Unknown");
        counts.set(dKey, (counts.get(dKey) || 0) + 1);
      });
      counts.forEach((cnt) => {
        const s = String(cnt);
        if (!seen.has(s)) {
          seen.add(s);
          list.push(s);
        }
      });
      return list.sort((a, b) => Number(a) - Number(b));
    }
    rows.forEach((r, idx) => {
      const key =
        chart.xColumn === "_row_index"
          ? chart.chartType === "scatter" || chart.aggregation === "raw"
            ? String(idx + 1)
            : `#${idx + 1}`
          : formatAxisFilterKey(r[chart.xColumn], "Unknown");
      if (!seen.has(key)) {
        seen.add(key);
        list.push(key);
      }
    });
    return list;
  }, [rows, chart.xColumn, chart.chartType, chart.aggregation, activeYColumns, uniqueValuesByColumn]);

  // Unique selectable items for Y-axis
  const yUniqueItems = useMemo(() => {
    const targetY = activeYColumns[0];
    if (targetY !== "_count" && targetY !== "_row_index" && uniqueValuesByColumn[targetY]) {
      return uniqueValuesByColumn[targetY];
    }
    if (targetY === "_row_index") {
      return rows.map((_, idx) =>
        chart.chartType === "scatter" || chart.aggregation === "raw"
          ? String(idx + 1)
          : `#${idx + 1}`
      );
    }
    const seen = new Set<string>();
    const list: string[] = [];
    const counts = new Map<string, number>();
    rows.forEach((r, idx) => {
      const xKey =
        chart.xColumn === "_row_index"
          ? `#${idx + 1}`
          : formatAxisFilterKey(r[chart.xColumn], "Unknown");
      counts.set(xKey, (counts.get(xKey) || 0) + 1);
    });
    counts.forEach((cnt) => {
      const s = String(cnt);
      if (!seen.has(s)) {
        seen.add(s);
        list.push(s);
      }
    });
    return list.sort((a, b) => Number(a) - Number(b));
  }, [rows, chart.xColumn, chart.chartType, chart.aggregation, activeYColumns, uniqueValuesByColumn]);

  // Apply all column filters + X/Y axis item filters
  const filteredRows = useMemo(() => {
    const colFilterEntries = Object.entries(chart.columnFilters || {}).filter(
      ([, arr]) => Array.isArray(arr)
    );
    const xSet =
      chart.xSelectedItems !== undefined ? new Set(chart.xSelectedItems) : null;
    const ySet =
      chart.ySelectedItems !== undefined ? new Set(chart.ySelectedItems) : null;
    const primaryY = activeYColumns[0];
    const xBlank =
      xColMeta?.type === "numeric" || xColMeta?.type === "mixed" ? "(Blank)" : "Unknown";
    const yBlank =
      primaryYColMeta?.type === "numeric" || primaryYColMeta?.type === "mixed"
        ? "(Blank)"
        : "Unknown";

    return rows.filter((r, idx) => {
      // 0. Incoming Cross-Filter from another visible chart (do not self-filter source chart)
      if (crossFilter && !isCrossFilterSource) {
        const cfColDef = columns.find((c) => c.name === crossFilter.column);
        const cfBlank =
          cfColDef?.type === "numeric" || cfColDef?.type === "mixed" ? "(Blank)" : "Unknown";
        const cfKey = formatAxisFilterKey(r[crossFilter.column], cfBlank);
        if (cfKey !== crossFilter.value) return false;
      }

      // 1. All column filters
      for (const [colName, allowed] of colFilterEntries) {
        const colDef = columns.find((c) => c.name === colName);
        const blank =
          colDef?.type === "numeric" || colDef?.type === "mixed" ? "(Blank)" : "Unknown";
        const valKey = formatAxisFilterKey(r[colName], blank);
        if (!allowed.includes(valKey)) return false;
      }

      // 2. X-axis selected items (for non-_count columns)
      if (xSet && chart.xColumn !== "_count") {
        const xKey =
          chart.xColumn === "_row_index"
            ? chart.chartType === "scatter" || chart.aggregation === "raw"
              ? String(idx + 1)
              : `#${idx + 1}`
            : formatAxisFilterKey(r[chart.xColumn], xBlank);
        if (!xSet.has(xKey)) return false;
      }

      // 3. Y-axis selected items (for non-_count columns)
      if (ySet && primaryY !== "_count") {
        const yKey =
          primaryY === "_row_index"
            ? chart.chartType === "scatter" || chart.aggregation === "raw"
              ? String(idx + 1)
              : `#${idx + 1}`
            : formatAxisFilterKey(r[primaryY], yBlank);
        if (!ySet.has(yKey)) return false;
      }

      return true;
    });
  }, [
    rows,
    columns,
    crossFilter,
    isCrossFilterSource,
    chart.columnFilters,
    chart.xSelectedItems,
    chart.ySelectedItems,
    chart.xColumn,
    chart.chartType,
    chart.aggregation,
    activeYColumns,
    xColMeta,
    primaryYColMeta,
  ]);

  const effectiveDimCol = useMemo(() => {
    const primaryY = activeYColumns[0];
    if (
      (chart.chartType === "scatter" || chart.aggregation === "raw") &&
      xColMeta?.type === "numeric" &&
      primaryYColMeta &&
      primaryYColMeta.type !== "numeric"
    ) {
      return primaryY;
    }
    return isInvertedColumnPair ? primaryY : chart.xColumn;
  }, [activeYColumns, chart.chartType, chart.aggregation, chart.xColumn, isInvertedColumnPair, xColMeta, primaryYColMeta]);

  const effectiveDimColMeta = useMemo(
    () => columns.find((c) => c.name === effectiveDimCol),
    [columns, effectiveDimCol]
  );

  const effectiveDimLabel = useMemo(() => {
    if (effectiveDimCol === "_row_index") return "Record #";
    if (effectiveDimCol === "_count") return "Record Count";
    return effectiveDimColMeta?.label || effectiveDimCol;
  }, [effectiveDimCol, effectiveDimColMeta]);

  // Build chart series (supports Single Series, Multi-Y Metrics, and Grouped-By-Category like Subject!)
  const builtSeries = useMemo(() => {
    const empty = {
      mode: "single" as "single" | "multi_series",
      xs: [] as (string | number)[],
      ys: [] as number[],
      rawDimKeys: [] as string[],
      seriesList: [] as { name: string; xs: (string | number)[]; ys: number[] }[],
      colorKeys: [] as string[],
      skippedTextRows: 0,
    };

    if (!filteredRows.length) return empty;

    let skippedTextRows = 0;
    const isMultiY = activeYColumns.length > 1;
    const primaryY = activeYColumns[0];
    const dimCol = isInvertedColumnPair ? primaryY : chart.xColumn;
    const metricCol = isInvertedColumnPair ? chart.xColumn : primaryY;
    const useGrouping =
      !chart.separateItems &&
      !isMultiY &&
      Boolean(chart.groupColumn) &&
      chart.groupMode !== "total" &&
      chart.chartType !== "pie" &&
      chart.chartType !== "scatter";

    // Helper: pick an informative secondary label column if two items share the same X value
    const secondaryItemLabelCol =
      chart.groupColumn ||
      columns.find(
        (c) =>
          c.name !== dimCol &&
          c.name !== metricCol &&
          (c.type === "categorical" || c.type === "date")
      )?.name;

    const buildSeparateRowLabels = (): string[] => {
      const counts = new Map<string, number>();
      return filteredRows.map((r, idx) => {
        const base =
          dimCol === "_row_index"
            ? `#${idx + 1}`
            : formatAxisFilterKey(r[dimCol], "Unknown");
        const secVal = secondaryItemLabelCol
          ? r[secondaryItemLabelCol] !== null &&
            r[secondaryItemLabelCol] !== undefined &&
            String(r[secondaryItemLabelCol]).trim() !== ""
            ? String(r[secondaryItemLabelCol]).trim()
            : ""
          : "";
        const combined = secVal && secVal !== base ? `${base} · ${secVal}` : base;
        const seenN = (counts.get(combined) || 0) + 1;
        counts.set(combined, seenN);
        return seenN === 1 ? combined : `${combined} (${seenN})`;
      });
    };

    // Case 0: "All Items (Own Column)" mode — every filtered record gets its own separate bar/column
    if (chart.separateItems && !isMultiY && chart.chartType !== "scatter") {
      const labels = buildSeparateRowLabels();
      const xs: string[] = [];
      const ys: number[] = [];
      const rawDimKeys: string[] = [];
      const dimBlank =
        effectiveDimColMeta?.type === "numeric" || effectiveDimColMeta?.type === "mixed"
          ? "(Blank)"
          : "Unknown";
      filteredRows.forEach((r, idx) => {
        const label = labels[idx];
        const rawKey =
          dimCol === "_row_index"
            ? `#${idx + 1}`
            : formatAxisFilterKey(r[dimCol], dimBlank);
        if (metricCol === "_count" || chart.aggregation === "count") {
          xs.push(label);
          ys.push(1);
          rawDimKeys.push(rawKey);
        } else {
          const rawM = r[metricCol];
          const num = parseNumericCell(rawM);
          if (num !== null) {
            xs.push(label);
            ys.push(num);
            rawDimKeys.push(rawKey);
          } else if (rawM !== null && rawM !== undefined && String(rawM).trim() !== "") {
            skippedTextRows++;
          }
        }
      });
      return {
        mode: "single" as const,
        xs,
        ys,
        rawDimKeys,
        seriesList: [],
        colorKeys: xs,
        skippedTextRows,
      };
    }

    // Case A: Multiple Y columns selected (e.g. Jan + Feb + Mar, or Budget + Actual)
    if (isMultiY && chart.chartType !== "pie") {
      const xsOrder: string[] = [];
      const xSeen = new Set<string>();
      const bucketsBySeries: Record<string, Map<string, { sum: number; count: number }>> = {};

      activeYColumns.forEach((yn) => {
        bucketsBySeries[yn] = new Map();
      });

      filteredRows.forEach((r, idx) => {
        const xKey =
          chart.xColumn === "_row_index"
            ? `#${idx + 1}`
            : formatAxisFilterKey(r[chart.xColumn], "Unknown");
        if (!xSeen.has(xKey)) {
          xSeen.add(xKey);
          xsOrder.push(xKey);
        }
        activeYColumns.forEach((yn) => {
          if (yn === "_count") {
            const cur = bucketsBySeries[yn].get(xKey) || { sum: 0, count: 0 };
            cur.sum += 1;
            cur.count += 1;
            bucketsBySeries[yn].set(xKey, cur);
          } else {
            const num = parseNumericCell(r[yn]);
            if (num !== null) {
              const cur = bucketsBySeries[yn].get(xKey) || { sum: 0, count: 0 };
              cur.sum += num;
              cur.count += 1;
              bucketsBySeries[yn].set(xKey, cur);
            }
          }
        });
      });

      const seriesList = activeYColumns.map((yn) => {
        const label =
          yn === "_count" ? "Record Count" : columns.find((c) => c.name === yn)?.label || yn;
        const ys = xsOrder.map((xKey) => {
          const entry = bucketsBySeries[yn].get(xKey);
          if (!entry) return 0;
          return chart.aggregation === "avg" && entry.count > 0
            ? entry.sum / entry.count
            : entry.sum;
        });
        return { name: label, xs: xsOrder, ys };
      });

      return {
        mode: "multi_series" as const,
        xs: xsOrder,
        ys: seriesList[0]?.ys || [],
        rawDimKeys: xsOrder,
        seriesList,
        colorKeys: seriesList.map((s) => s.name),
        skippedTextRows,
      };
    }

    // Case B: Breakdown / Group-by column (e.g. Subject across Monday vs Tuesday!)
    if (useGrouping && chart.groupColumn) {
      const grpCol = chart.groupColumn;
      const xsOrder: string[] = [];
      const xSeen = new Set<string>();
      const grpOrder: string[] = [];
      const grpSeen = new Set<string>();
      const grid = new Map<string, Map<string, { sum: number; count: number }>>();

      filteredRows.forEach((r, idx) => {
        const dKey =
          dimCol === "_row_index"
            ? `#${idx + 1}`
            : formatAxisFilterKey(r[dimCol], "Unknown");
        const gKey = formatAxisFilterKey(r[grpCol], "Unknown");

        if (!xSeen.has(dKey)) {
          xSeen.add(dKey);
          xsOrder.push(dKey);
        }
        if (!grpSeen.has(gKey)) {
          grpSeen.add(gKey);
          grpOrder.push(gKey);
        }

        if (!grid.has(gKey)) grid.set(gKey, new Map());
        const grpMap = grid.get(gKey)!;

        if (metricCol === "_count" || chart.aggregation === "count") {
          const cur = grpMap.get(dKey) || { sum: 0, count: 0 };
          cur.sum += 1;
          cur.count += 1;
          grpMap.set(dKey, cur);
        } else {
          const rawM = r[metricCol];
          const num = parseNumericCell(rawM);
          if (num !== null) {
            const cur = grpMap.get(dKey) || { sum: 0, count: 0 };
            cur.sum += num;
            cur.count += 1;
            grpMap.set(dKey, cur);
          } else if (rawM !== null && rawM !== undefined && String(rawM).trim() !== "") {
            skippedTextRows++;
          }
        }
      });

      const seriesList = grpOrder.slice(0, 100).map((gKey) => {
        const grpMap = grid.get(gKey)!;
        const ys = xsOrder.map((dKey) => {
          const entry = grpMap.get(dKey);
          if (!entry) return 0;
          return chart.aggregation === "avg" && entry.count > 0
            ? entry.sum / entry.count
            : entry.sum;
        });
        return { name: gKey, xs: xsOrder, ys };
      });

      return {
        mode: "multi_series" as const,
        xs: xsOrder,
        ys: seriesList[0]?.ys || [],
        rawDimKeys: xsOrder,
        seriesList,
        colorKeys: seriesList.map((s) => s.name),
        skippedTextRows,
      };
    }

    // Case C: Raw / Scatter single series (supports numeric or categorical on either X or Y)
    if (chart.chartType === "scatter" || chart.aggregation === "raw") {
      const xs: (string | number)[] = [];
      const ys: (string | number)[] = [];
      const xIsStrictlyNum = xColMeta?.type === "numeric";
      const yIsStrictlyNum = primaryYColMeta?.type === "numeric";

      filteredRows.forEach((r, idx) => {
        let xv: string | number | null = null;
        if (chart.xColumn === "_row_index") {
          xv = idx + 1;
        } else if (chart.xColumn === "_count") {
          xv = 1;
        } else if (xIsStrictlyNum) {
          xv = parseNumericCell(r[chart.xColumn]);
        } else {
          const raw = r[chart.xColumn];
          xv = raw !== null && raw !== undefined && String(raw).trim() !== "" ? raw : null;
        }

        let yv: string | number | null = null;
        if (primaryY === "_row_index") {
          yv = idx + 1;
        } else if (primaryY === "_count") {
          yv = 1;
        } else if (yIsStrictlyNum) {
          yv = parseNumericCell(r[primaryY]);
        } else {
          const raw = r[primaryY];
          yv = raw !== null && raw !== undefined && String(raw).trim() !== "" ? raw : null;
        }

        if (xv !== null && yv !== null) {
          xs.push(xv);
          ys.push(yv);
        } else if (
          (r[primaryY] !== null &&
            r[primaryY] !== undefined &&
            String(r[primaryY]).trim() !== "" &&
            yv === null) ||
          (r[chart.xColumn] !== null &&
            r[chart.xColumn] !== undefined &&
            String(r[chart.xColumn]).trim() !== "" &&
            xv === null)
        ) {
          skippedTextRows++;
        }
      });

      const useYForRawDim = xIsStrictlyNum && primaryYColMeta && primaryYColMeta.type !== "numeric";
      return {
        mode: "single" as const,
        xs,
        ys,
        rawDimKeys: (useYForRawDim ? ys : xs).map((v) => formatAxisFilterKey(v, "Unknown")),
        seriesList: [],
        colorKeys: xs.map((x) => String(x)),
        skippedTextRows,
      };
    }

    // Case D: Standard aggregated single series (handles both normal & X/Y inverted orientation)
    const countFilterSet =
      metricCol === "_count"
        ? isInvertedColumnPair
          ? chart.xSelectedItems !== undefined
            ? new Set(chart.xSelectedItems)
            : null
          : chart.ySelectedItems !== undefined
          ? new Set(chart.ySelectedItems)
          : null
        : null;
    const buckets = new Map<string, { sum: number; count: number }>();

    filteredRows.forEach((r, idx) => {
      const key =
        dimCol === "_row_index"
          ? `#${idx + 1}`
          : formatAxisFilterKey(r[dimCol], "Unknown");

      if (metricCol === "_count" || chart.aggregation === "count") {
        const entry = buckets.get(key) || { sum: 0, count: 0 };
        entry.sum += 1;
        entry.count += 1;
        buckets.set(key, entry);
      } else {
        const rawM = r[metricCol];
        const num = parseNumericCell(rawM);
        if (num !== null) {
          const entry = buckets.get(key) || { sum: 0, count: 0 };
          entry.sum += num;
          entry.count += 1;
          buckets.set(key, entry);
        } else if (rawM !== null && rawM !== undefined && String(rawM).trim() !== "") {
          skippedTextRows++;
        }
      }
    });

    const xs: string[] = [];
    const ys: number[] = [];
    buckets.forEach((val, key) => {
      const finalVal =
        chart.aggregation === "avg" && val.count > 0 ? val.sum / val.count : val.sum;
      if (metricCol === "_count" && countFilterSet) {
        if (!countFilterSet.has(formatAxisFilterKey(finalVal, "(Blank)"))) return;
      }
      xs.push(key);
      ys.push(finalVal);
    });

    if (chart.chartType === "pie" && !chart.separateItems && xs.length > 12) {
      const pairs = xs
        .map((x, i) => ({ x, y: Math.max(0, ys[i]) }))
        .sort((a, b) => b.y - a.y);
      const top = pairs.slice(0, 11);
      const restSum = pairs.slice(11).reduce((acc, item) => acc + item.y, 0);
      const pieXs = [...top.map((p) => p.x), "Other"];
      return {
        mode: "single" as const,
        xs: pieXs,
        ys: [...top.map((p) => p.y), restSum],
        rawDimKeys: [...top.map((p) => p.x), ""],
        seriesList: [],
        colorKeys: pieXs,
        skippedTextRows,
      };
    }

    return {
      mode: "single" as const,
      xs,
      ys,
      rawDimKeys: xs,
      seriesList: [],
      colorKeys: xs,
      skippedTextRows,
    };
  }, [filteredRows, activeYColumns, chart, columns, isInvertedColumnPair, xColMeta, primaryYColMeta, effectiveDimColMeta]);

  const themeKey: ChartColorTheme = chart.colorTheme || "multi";
  const activePrimary =
    themeKey === "custom" && chart.customColor
      ? chart.customColor
      : COLOR_THEMES[themeKey]?.primary || "#1E88E5";
  const activePalette =
    themeKey === "custom" && chart.customColor
      ? [chart.customColor]
      : COLOR_THEMES[themeKey]?.palette || PALETTE;

  const getColorForKey = (key: string, idx: number): string => {
    if (chart.itemColors && chart.itemColors[key]) {
      return chart.itemColors[key];
    }
    if (themeKey === "custom" && chart.customColor) {
      return chart.customColor;
    }
    return activePalette[idx % activePalette.length];
  };

  const validSeriesNames = useMemo(
    () => new Set(builtSeries.seriesList.map((s) => s.name)),
    [builtSeries.seriesList]
  );

  const hiddenSeriesSet = useMemo(() => {
    if (!chart.syncAxis) return new Set<string>();
    return new Set((chart.hiddenSeries || []).filter((n) => validSeriesNames.has(n)));
  }, [chart.syncAxis, chart.hiddenSeries, validSeriesNames]);

  const toggleSeriesVisibility = (seriesName: string) => {
    if (!chart.syncAxis) return;
    const nextHidden = new Set(hiddenSeriesSet);
    if (nextHidden.has(seriesName)) {
      nextHidden.delete(seriesName);
    } else {
      nextHidden.add(seriesName);
    }
    const nextArr = Array.from(nextHidden);
    onChangeConfig({
      ...chart,
      hiddenSeries: nextArr.length > 0 ? nextArr : undefined,
    });
  };

  const handleShowAllSeries = () => {
    onChangeConfig({
      ...chart,
      hiddenSeries: undefined,
    });
  };

  const handleHideAllSeries = () => {
    const allNames = builtSeries.seriesList.map((s) => s.name);
    onChangeConfig({
      ...chart,
      hiddenSeries: allNames.length > 0 ? allNames : undefined,
    });
  };

  const legendClickHandlerRef = useRef<(seriesName: string) => void>(() => {});
  legendClickHandlerRef.current = (seriesName: string) => {
    toggleSeriesVisibility(seriesName);
  };

  const crossFilterClickRef = useRef<(evData: any) => void>(() => {});
  crossFilterClickRef.current = (evData: {
    points?: {
      customdata?: unknown;
      label?: unknown;
      x?: unknown;
      y?: unknown;
      pointNumber?: number;
      data?: { customdata?: unknown[] };
    }[];
  }) => {
    if (!onCrossFilterSelect || !effectiveDimColMeta) return;
    const pt = evData?.points?.[0];
    if (!pt) return;

    let clickedKey = "";
    const cd =
      pt.customdata !== undefined
        ? pt.customdata
        : typeof pt.pointNumber === "number"
        ? pt.data?.customdata?.[pt.pointNumber]
        : undefined;

    if (typeof cd === "string") {
      clickedKey = cd.trim();
    } else if (Array.isArray(cd) && typeof cd[0] === "string") {
      clickedKey = cd[0].trim();
    } else if (chart.chartType === "pie") {
      const lbl = pt.label !== undefined ? String(pt.label).trim() : "";
      const idx = builtSeries.xs.findIndex((x) => String(x) === lbl);
      clickedKey = idx >= 0 ? builtSeries.rawDimKeys[idx] ?? lbl : lbl;
    } else {
      const isHoriz = chart.chartType === "horizontal_bar" || axesInverted;
      const useY =
        isHoriz ||
        ((chart.chartType === "scatter" || chart.aggregation === "raw") &&
          xColMeta?.type === "numeric" &&
          primaryYColMeta &&
          primaryYColMeta.type !== "numeric");
      const rawVal = useY ? pt.y : pt.x;
      clickedKey = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : "";
    }

    if (!clickedKey) return;
    onCrossFilterSelect({
      column: effectiveDimCol,
      columnLabel: effectiveDimLabel,
      value: clickedKey,
    });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || builtSeries.xs.length === 0) return;

    const { mode, xs, ys, rawDimKeys, seriesList } = builtSeries;
    const emptyFmt = { tickprefix: "", ticksuffix: "", hoverPrefix: "", hoverSuffix: "" };
    const yAxisFmt =
      isYNumericCol || activeYColumns.length > 1
        ? getPlotlyAxisFormat(effectiveYFormat)
        : emptyFmt;
    const xAxisFmt = isXNumericCol ? getPlotlyAxisFormat(effectiveXFormat) : emptyFmt;

    const metricFmt = isInvertedColumnPair ? xAxisFmt : yAxisFmt;
    const dimFmt = isInvertedColumnPair ? yAxisFmt : xAxisFmt;
    const metricLabel = isInvertedColumnPair ? xLabel : yLabel;

    const plotHorizontal =
      chart.chartType === "horizontal_bar" || axesInverted;

    const activeSelectedVal =
      crossFilter && isCrossFilterSource && crossFilter.column === effectiveDimCol
        ? crossFilter.value
        : null;

    let traces: Record<string, unknown>[] = [];
    const baseFont = {
      family: "Plus Jakarta Sans, sans-serif",
      size: 11,
      color: "#475569",
    };

    if (mode === "multi_series" && seriesList.length > 0) {
      if (chart.chartType === "line" || chart.chartType === "area") {
        traces = seriesList.map((ser, sIdx) => {
          const c = getColorForKey(ser.name, sIdx);
          const isVisible = !chart.syncAxis || !hiddenSeriesSet.has(ser.name);
          const serKeys = ser.xs.map((x) => String(x));
          return {
            type: "scatter",
            mode: "lines+markers",
            name: ser.name,
            visible: isVisible ? true : "legendonly",
            x: axesInverted ? ser.ys : ser.xs,
            y: axesInverted ? ser.xs : ser.ys,
            customdata: serKeys,
            fill:
              chart.chartType === "area"
                ? axesInverted
                  ? "tozerox"
                  : "tozeroy"
                : "none",
            fillcolor: hexToRgba(c, 0.14),
            line: { color: c, width: 2.5, shape: "spline" },
            marker: {
              color: c,
              size: activeSelectedVal
                ? serKeys.map((k) => (k === activeSelectedVal ? 10 : 5))
                : 6,
              opacity: activeSelectedVal
                ? serKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
                : 1,
            },
            hovertemplate: axesInverted
              ? `<b>${ser.name}</b><br>%{y}: ${metricFmt.hoverPrefix}%{x:,.2f}${metricFmt.hoverSuffix}<extra></extra>`
              : `<b>${ser.name}</b><br>%{x}: ${metricFmt.hoverPrefix}%{y:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
          };
        });
      } else if (plotHorizontal) {
        traces = seriesList.map((ser, sIdx) => {
          const c = getColorForKey(ser.name, sIdx);
          const isVisible = !chart.syncAxis || !hiddenSeriesSet.has(ser.name);
          const revKeys = [...ser.xs].reverse().map((x) => String(x));
          return {
            type: "bar",
            orientation: "h",
            name: ser.name,
            visible: isVisible ? true : "legendonly",
            y: [...ser.xs].reverse(),
            x: [...ser.ys].reverse(),
            customdata: revKeys,
            marker: {
              color: c,
              cornerradius: 4,
              opacity: activeSelectedVal
                ? revKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
                : 1,
            },
            hovertemplate: `<b>${ser.name}</b><br>%{y}: ${metricFmt.hoverPrefix}%{x:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
          };
        });
      } else {
        traces = seriesList.map((ser, sIdx) => {
          const c = getColorForKey(ser.name, sIdx);
          const isVisible = !chart.syncAxis || !hiddenSeriesSet.has(ser.name);
          const serKeys = ser.xs.map((x) => String(x));
          return {
            type: "bar",
            name: ser.name,
            visible: isVisible ? true : "legendonly",
            x: ser.xs,
            y: ser.ys,
            customdata: serKeys,
            marker: {
              color: c,
              cornerradius: 4,
              opacity: activeSelectedVal
                ? serKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
                : 1,
            },
            hovertemplate: `<b>${ser.name}</b><br>%{x}: ${metricFmt.hoverPrefix}%{y:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
          };
        });
      }
    } else if (chart.chartType === "pie") {
      const pieColors = xs.map((label, i) => {
        const baseColor = getColorForKey(String(label), i);
        if (!activeSelectedVal) return baseColor;
        return rawDimKeys[i] === activeSelectedVal ? baseColor : hexToRgba(baseColor, 0.28);
      });
      traces = [
        {
          type: "pie",
          labels: xs,
          values: ys.map((v) => Math.max(0, Number(v) || 0)),
          customdata: rawDimKeys,
          pull: activeSelectedVal
            ? rawDimKeys.map((k) => (k === activeSelectedVal ? 0.08 : 0))
            : undefined,
          hole: 0.36,
          marker: { colors: pieColors },
          textinfo: "percent",
          hovertemplate: `<b>%{label}</b><br>${metricFmt.hoverPrefix}%{value:,.2f}${metricFmt.hoverSuffix} (%{percent})<extra></extra>`,
        },
      ];
    } else if (chart.chartType === "scatter") {
      const pointColors = xs.map((label, i) => getColorForKey(String(label), i));
      const xValFmt = isXNumericCol ? ",.2f" : "";
      const yValFmt = isYNumericCol ? ",.2f" : "";
      traces = [
        {
          type: "scatter",
          mode: "markers",
          x: xs,
          y: ys,
          customdata: rawDimKeys,
          marker: {
            color:
              chart.itemColors && Object.keys(chart.itemColors).length > 0
                ? pointColors
                : activePrimary,
            size: activeSelectedVal
              ? rawDimKeys.map((k) => (k === activeSelectedVal ? 13 : 7))
              : 9,
            opacity: activeSelectedVal
              ? rawDimKeys.map((k) => (k === activeSelectedVal ? 1 : 0.25))
              : 0.88,
            line: { color: "#FFFFFF", width: 1 },
          },
          hovertemplate: `${xLabel}: ${xAxisFmt.hoverPrefix}%{x${xValFmt ? ":" + xValFmt : ""}}${xAxisFmt.hoverSuffix}<br>${yLabel}: ${yAxisFmt.hoverPrefix}%{y${yValFmt ? ":" + yValFmt : ""}}${yAxisFmt.hoverSuffix}<extra></extra>`,
        },
      ];
    } else if (chart.chartType === "line" || chart.chartType === "area") {
      const pointColors = xs.map((label, i) => getColorForKey(String(label), i));
      traces = [
        {
          type: "scatter",
          mode: "lines+markers",
          x: axesInverted ? ys : xs,
          y: axesInverted ? xs : ys,
          customdata: rawDimKeys,
          fill:
            chart.chartType === "area"
              ? axesInverted
                ? "tozerox"
                : "tozeroy"
              : "none",
          fillcolor: hexToRgba(activePrimary, 0.16),
          line: { color: activePrimary, width: 2.5, shape: "spline" },
          marker: {
            color:
              chart.itemColors && Object.keys(chart.itemColors).length > 0
                ? pointColors
                : activePrimary,
            size: activeSelectedVal
              ? rawDimKeys.map((k) => (k === activeSelectedVal ? 11 : 5))
              : 7,
            opacity: activeSelectedVal
              ? rawDimKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
              : 1,
          },
          hovertemplate: axesInverted
            ? `<b>%{y}</b><br>${metricLabel}: ${metricFmt.hoverPrefix}%{x:,.2f}${metricFmt.hoverSuffix}<extra></extra>`
            : `<b>%{x}</b><br>${metricLabel}: ${metricFmt.hoverPrefix}%{y:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
        },
      ];
    } else if (plotHorizontal) {
      const revXs = [...xs].reverse();
      const revDimKeys = [...rawDimKeys].reverse();
      const revColors = revXs.map((label, idx) =>
        getColorForKey(String(label), xs.length - 1 - idx)
      );
      traces = [
        {
          type: "bar",
          orientation: "h",
          y: revXs,
          x: [...ys].reverse(),
          customdata: revDimKeys,
          marker: {
            color: revColors,
            cornerradius: 4,
            opacity: activeSelectedVal
              ? revDimKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
              : 1,
          },
          hovertemplate: `<b>%{y}</b><br>${metricLabel}: ${metricFmt.hoverPrefix}%{x:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
        },
      ];
    } else {
      const barColors = xs.map((label, idx) => getColorForKey(String(label), idx));
      traces = [
        {
          type: "bar",
          x: xs,
          y: ys,
          customdata: rawDimKeys,
          marker: {
            color: barColors,
            cornerradius: 4,
            opacity: activeSelectedVal
              ? rawDimKeys.map((k) => (k === activeSelectedVal ? 1 : 0.28))
              : 1,
          },
          hovertemplate: `<b>%{x}</b><br>${metricLabel}: ${metricFmt.hoverPrefix}%{y:,.2f}${metricFmt.hoverSuffix}<extra></extra>`,
        },
      ];
    }

    const hasManyItems = xs.length > 8;
    const showLegend = chart.chartType === "pie" || mode === "multi_series";
    const isHorizontalLayout =
      chart.chartType !== "pie" && chart.chartType !== "scatter" && plotHorizontal;

    const layout: Record<string, unknown> = {
      margin:
        chart.chartType === "pie"
          ? { l: 12, r: 12, t: 12, b: 36 }
          : isHorizontalLayout
          ? { l: 112, r: 20, t: 12, b: showLegend ? 54 : 38 }
          : { l: 58, r: 16, t: 12, b: (hasManyItems ? 72 : 52) + (showLegend ? 22 : 0) },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: baseFont,
      autosize: true,
      clickmode: "event",
      showlegend: showLegend,
      barmode: chart.groupMode === "stacked" ? "stack" : "group",
    };

    if (showLegend) {
      layout.legend = {
        orientation: "h",
        y: -0.14,
        x: 0.5,
        xanchor: "center",
        font: { size: 10 },
        itemclick: chart.syncAxis && mode === "multi_series" ? "toggle" : false,
        itemdoubleclick: false,
      };
    }

    const syncAutorange = Boolean(chart.syncAxis && mode === "multi_series");

    if (chart.chartType !== "pie") {
      if (chart.chartType === "scatter") {
        layout.xaxis = {
          gridcolor: "#F1F5F9",
          zeroline: false,
          automargin: true,
          ...(syncAutorange ? { autorange: true } : {}),
          tickangle: hasManyItems ? -30 : 0,
          tickprefix: xAxisFmt.tickprefix,
          ticksuffix: xAxisFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
        layout.yaxis = {
          gridcolor: "#E2E8F0",
          zeroline: false,
          automargin: true,
          ...(syncAutorange ? { autorange: true } : {}),
          tickprefix: yAxisFmt.tickprefix,
          ticksuffix: yAxisFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
      } else if (isHorizontalLayout) {
        layout.xaxis = {
          gridcolor: "#E2E8F0",
          zeroline: false,
          automargin: true,
          ...(syncAutorange ? { autorange: true } : {}),
          tickprefix: metricFmt.tickprefix,
          ticksuffix: metricFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
        layout.yaxis = {
          gridcolor: "#F1F5F9",
          zeroline: false,
          automargin: true,
          ...(xs.length <= 80 && !isYNumericCol ? { dtick: 1 } : {}),
          tickprefix: dimFmt.tickprefix,
          ticksuffix: dimFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
      } else {
        layout.xaxis = {
          gridcolor: "#F1F5F9",
          zeroline: false,
          automargin: true,
          ...(xs.length <= 80 && (!isXNumericCol || isInvertedColumnPair) ? { dtick: 1 } : {}),
          tickangle: hasManyItems ? -35 : 0,
          tickprefix: dimFmt.tickprefix,
          ticksuffix: dimFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
        layout.yaxis = {
          gridcolor: "#E2E8F0",
          zeroline: false,
          automargin: true,
          ...(syncAutorange ? { autorange: true } : {}),
          tickprefix: metricFmt.tickprefix,
          ticksuffix: metricFmt.ticksuffix,
          tickfont: { size: 10, color: "#64748B" },
        };
      }
    }

    // Automatically widen container with horizontal scroll when there are many items so every column is crisp & labeled
    const activeSeriesCount =
      mode === "multi_series" ? Math.max(1, Math.min(seriesList.length, 8)) : 1;
    const totalBarsNeeded =
      !isHorizontalLayout && chart.chartType !== "pie" && chart.chartType !== "scatter"
        ? xs.length * activeSeriesCount
        : 0;
    if (totalBarsNeeded > 10 && xs.length > 7) {
      const perSlotPx = mode === "multi_series" ? Math.max(54, activeSeriesCount * 18) : 48;
      const targetPx = Math.min(5400, Math.max(680, xs.length * perSlotPx));
      el.style.minWidth = `${targetPx}px`;
    } else {
      el.style.minWidth = "";
    }

    const config = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
    };

    Plotly.react(el, traces, layout, config);

    const plotlyEl = el as unknown as {
      on?: (
        event: string,
        cb: (data: any) => boolean | void
      ) => void;
      removeAllListeners?: (event: string) => void;
    };
    plotlyEl.removeAllListeners?.("plotly_legendclick");
    plotlyEl.removeAllListeners?.("plotly_legenddoubleclick");
    plotlyEl.removeAllListeners?.("plotly_click");
    plotlyEl.on?.("plotly_legendclick", (evData: { curveNumber?: number; data?: { name?: string }[] }) => {
      if (!chart.syncAxis || mode !== "multi_series") {
        return false;
      }
      const idx = typeof evData?.curveNumber === "number" ? evData.curveNumber : -1;
      const seriesName = evData?.data?.[idx]?.name;
      if (seriesName) {
        legendClickHandlerRef.current(seriesName);
      }
      return false;
    });
    plotlyEl.on?.("plotly_legenddoubleclick", () => false);
    plotlyEl.on?.("plotly_click", (evData) => {
      crossFilterClickRef.current(evData);
    });

    const handleResize = () => {
      if (containerRef.current) {
        Plotly.Plots.resize(containerRef.current);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      plotlyEl.removeAllListeners?.("plotly_legendclick");
      plotlyEl.removeAllListeners?.("plotly_legenddoubleclick");
      plotlyEl.removeAllListeners?.("plotly_click");
    };
  }, [
    chart,
    builtSeries,
    hiddenSeriesSet,
    crossFilter,
    isCrossFilterSource,
    effectiveDimCol,
    xLabel,
    yLabel,
    effectiveYFormat,
    effectiveXFormat,
    isXNumericCol,
    isYNumericCol,
    isInvertedColumnPair,
    axesInverted,
    activeYColumns.length,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    return () => {
      if (el) {
        try {
          Plotly.purge(el);
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  const handleTypeChange = (newType: ChartType) => {
    onChangeConfig({
      ...chart,
      chartType: newType,
    });
  };

  const handleXChange = (xCol: string) => {
    const colMeta = columns.find((c) => c.name === xCol);
    const colLabel =
      xCol === "_count" ? "Record Count" : xCol === "_row_index" ? "Record #" : colMeta?.label || xCol;
    onChangeConfig({
      ...chart,
      xColumn: xCol,
      xSelectedItems: undefined,
      hiddenSeries: undefined,
      xFormat: colMeta?.format || "auto",
      swapAxes: false,
      groupColumn: chart.groupColumn === xCol ? undefined : chart.groupColumn,
      title: `${yLabel} by ${colLabel}`,
    });
  };

  const handleYChange = (yCol: string) => {
    const colMeta = columns.find((c) => c.name === yCol);
    const colLabel =
      yCol === "_count" ? "Count" : yCol === "_row_index" ? "Record #" : colMeta?.label || yCol;
    onChangeConfig({
      ...chart,
      yColumn: yCol,
      yColumns: [yCol],
      ySelectedItems: undefined,
      hiddenSeries: undefined,
      yFormat: colMeta?.format || "auto",
      swapAxes: false,
      groupColumn: chart.groupColumn === yCol ? undefined : chart.groupColumn,
      aggregation:
        yCol === "_count"
          ? "count"
          : chart.aggregation === "count"
          ? "sum"
          : chart.aggregation,
      title: `${colLabel} by ${xLabel}`,
    });
  };

  const handleSwapAxes = () => {
    if (activeYColumns.length > 1) {
      onChangeConfig({
        ...chart,
        swapAxes: !chart.swapAxes,
      });
      return;
    }

    if (chart.chartType === "horizontal_bar" && !isInvertedColumnPair) {
      onChangeConfig({
        ...chart,
        chartType: "bar",
        swapAxes: false,
      });
      return;
    }

    const oldX = chart.xColumn;
    const oldY = activeYColumns[0] || chart.yColumn;
    const newXLabel =
      oldY === "_count"
        ? "Record Count"
        : oldY === "_row_index"
        ? "Record #"
        : columns.find((c) => c.name === oldY)?.label || oldY;
    const newYLabel =
      oldX === "_count"
        ? "Record Count"
        : oldX === "_row_index"
        ? "Record #"
        : columns.find((c) => c.name === oldX)?.label || oldX;

    const nextChartType =
      chart.chartType === "horizontal_bar" && isInvertedColumnPair ? "bar" : chart.chartType;

    onChangeConfig({
      ...chart,
      chartType: nextChartType,
      xColumn: oldY,
      yColumn: oldX,
      yColumns: [oldX],
      xSelectedItems: chart.ySelectedItems,
      ySelectedItems: chart.xSelectedItems,
      xFormat: chart.yFormat,
      yFormat: chart.xFormat,
      swapAxes: false,
      groupColumn:
        chart.groupColumn === oldX || chart.groupColumn === oldY
          ? undefined
          : chart.groupColumn,
      title:
        nextChartType === "scatter"
          ? `${newYLabel} vs ${newXLabel}`
          : `${newYLabel} by ${newXLabel}`,
    });
  };

  const isAllNumericYSelected =
    numericCols.length >= 2 &&
    numericCols.every((c) => activeYColumns.includes(c.name));

  const handleMultiYApply = (selectedCols: string[] | undefined) => {
    const allNumNames = [
      ...numericCols.map((c) => c.name),
      "_count",
    ];
    const nextList =
      selectedCols === undefined
        ? numericCols.map((c) => c.name)
        : selectedCols.length > 0
        ? selectedCols
        : [chart.yColumn || allNumNames[0]];
    const primary = nextList[0];
    const colMeta = columns.find((c) => c.name === primary);
    const nextTitle =
      nextList.length > 1
        ? `${nextList.length} Values by ${xLabel}`
        : `${primary === "_count" ? "Count" : colMeta?.label || primary} by ${xLabel}`;

    onChangeConfig({
      ...chart,
      chartType: nextList.length > 1 && chart.chartType === "pie" ? "bar" : chart.chartType,
      yColumn: primary,
      yColumns: nextList,
      ySelectedItems: undefined,
      hiddenSeries: undefined,
      separateItems: nextList.length > 1 ? false : chart.separateItems,
      syncAxis: nextList.length > 1 ? true : chart.syncAxis,
      groupColumn: nextList.length > 1 ? undefined : chart.groupColumn,
      title: nextTitle,
    });
  };

  const handleToggleAllYValues = () => {
    if (numericCols.length < 2) return;
    if (isAllNumericYSelected) {
      const primary = numericCols[0].name;
      onChangeConfig({
        ...chart,
        yColumn: primary,
        yColumns: [primary],
        ySelectedItems: undefined,
        hiddenSeries: undefined,
        title: `${numericCols[0].label} by ${xLabel}`,
      });
    } else {
      const allCols = numericCols.map((c) => c.name);
      onChangeConfig({
        ...chart,
        chartType: chart.chartType === "pie" ? "bar" : chart.chartType,
        yColumn: allCols[0],
        yColumns: allCols,
        ySelectedItems: undefined,
        hiddenSeries: undefined,
        separateItems: false,
        syncAxis: true,
        groupColumn: undefined,
        title: `${allCols.length} Values by ${xLabel}`,
      });
    }
  };

  const handleGroupColumnChange = (gCol: string) => {
    onChangeConfig({
      ...chart,
      groupColumn: gCol || undefined,
      groupMode: gCol ? chart.groupMode || "grouped" : undefined,
      hiddenSeries: undefined,
      yColumns: gCol ? [chart.yColumn] : chart.yColumns,
    });
  };

  const handleColorThemeChange = (theme: ChartColorTheme) => {
    onChangeConfig({
      ...chart,
      colorTheme: theme,
      customColor:
        theme === "custom"
          ? chart.customColor || "#1E88E5"
          : COLOR_THEMES[theme]?.primary,
    });
  };

  const handleCustomColorChange = (hex: string) => {
    onChangeConfig({
      ...chart,
      colorTheme: "custom",
      customColor: hex,
    });
  };

  const handleItemColorChange = (key: string, hex: string) => {
    onChangeConfig({
      ...chart,
      itemColors: {
        ...(chart.itemColors || {}),
        [key]: hex,
      },
    });
  };

  const handleResetItemColors = () => {
    onChangeConfig({
      ...chart,
      itemColors: undefined,
    });
  };

  const handleFormatChange = (fmt: ColumnNumberFormat) => {
    if (isInvertedColumnPair) {
      onChangeConfig({
        ...chart,
        xFormat: fmt,
      });
      if (chart.xColumn && chart.xColumn !== "_count" && chart.xColumn !== "_row_index" && onChangeColumnFormat) {
        onChangeColumnFormat(chart.xColumn, fmt);
      }
      return;
    }
    onChangeConfig({
      ...chart,
      yFormat: fmt,
    });
    if (activeYColumns[0] && activeYColumns[0] !== "_count" && activeYColumns[0] !== "_row_index" && onChangeColumnFormat) {
      onChangeColumnFormat(activeYColumns[0], fmt);
    }
  };

  const handleColumnFilterApply = (colName: string, next: string[] | undefined) => {
    const nextFilters = { ...(chart.columnFilters || {}) };
    if (next === undefined) {
      delete nextFilters[colName];
    } else {
      nextFilters[colName] = next;
    }
    onChangeConfig({
      ...chart,
      columnFilters: Object.keys(nextFilters).length > 0 ? nextFilters : undefined,
    });
  };

  const handleResetAllFilters = () => {
    onChangeConfig({
      ...chart,
      xSelectedItems: undefined,
      ySelectedItems: undefined,
      columnFilters: undefined,
    });
  };

  const pickerColor =
    chart.customColor || COLOR_THEMES[themeKey]?.primary || "#1E88E5";

  const hideHandler = onToggleHide || (canRemove ? onRemove : undefined);
  const activeColFilterCount = Object.keys(chart.columnFilters || {}).length;
  const hasActiveFilter =
    chart.xSelectedItems !== undefined ||
    chart.ySelectedItems !== undefined ||
    activeColFilterCount > 0;

  const groupableCols = useMemo(
    () =>
      columns.filter(
        (c) =>
          c.name !== chart.xColumn &&
          c.name !== activeYColumns[0] &&
          (c.type === "categorical" || c.type === "date") &&
          c.unique_count >= 1
      ),
    [columns, chart.xColumn, activeYColumns]
  );

  const nonNumericCols = useMemo(
    () => columns.filter((c) => c.type !== "numeric" && c.type !== "mixed"),
    [columns]
  );

  const customItemColorCount = Object.keys(chart.itemColors || {}).length;
  const multiYAvailableNames = useMemo(
    () => [...numericCols.map((c) => c.name), "_count"],
    [numericCols]
  );

  return (
    <div className="flex flex-col rounded-xl border border-slate-200/90 bg-slate-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900 truncate">{chart.title}</h4>
          {chart.reason && (
            <p className="text-[11px] text-slate-500 truncate">{chart.reason}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            aria-label="Chart Type"
            value={chart.chartType}
            onChange={(e) => handleTypeChange(e.target.value as ChartType)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {CHART_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {hideHandler && (
            <button
              type="button"
              onClick={hideHandler}
              title={t("hide")}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>{t("hide")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 1: X-Axis, Y-Axis (Single + Multi-Metric), Group By, Number Format & Colors */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          {/* X-Axis column + item multi-select */}
          <div className="flex items-center gap-1">
            <span className="text-slate-400 font-medium">X:</span>
            <select
              aria-label="X axis column"
              value={chart.xColumn}
              onChange={(e) => handleXChange(e.target.value)}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 max-w-[120px] truncate focus:outline-none"
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.label}
                </option>
              ))}
              <option value="_row_index">Record #</option>
              <option value="_count">Record Count</option>
            </select>
            <FilterChecklistPopover
              title={`Filter X: ${xLabel}`}
              buttonText={
                chart.xSelectedItems === undefined
                  ? "All"
                  : `${chart.xSelectedItems.length}/${xUniqueItems.length}`
              }
              isFiltered={chart.xSelectedItems !== undefined}
              items={xUniqueItems}
              selectedItems={chart.xSelectedItems}
              formatItem={
                isXNumericCol && effectiveXFormat !== "number"
                  ? (val) => formatNumericValue(val, effectiveXFormat)
                  : undefined
              }
              onApply={(next) =>
                onChangeConfig({
                  ...chart,
                  xSelectedItems: next,
                })
              }
            />
          </div>

          {/* Swap X <-> Y Axis Button */}
          <button
            type="button"
            onClick={handleSwapAxes}
            title="Interchange X and Y axes"
            aria-label="Swap X and Y axes"
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
              axesInverted
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
            }`}
          >
            <ArrowLeftRight className="w-3 h-3" />
            <span>{t("swapAxes")}</span>
          </button>

          {/* Y-Axis primary metric + Multi-Y + Y value filter */}
          <div className="flex items-center gap-1">
            <span className="text-slate-400 font-medium">Y:</span>
            <select
              aria-label="Y axis metric"
              value={chart.yColumn}
              onChange={(e) => handleYChange(e.target.value)}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 max-w-[120px] truncate focus:outline-none"
            >
              {numericCols.length > 0 && (
                <optgroup label="Numeric Metrics">
                  {numericCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {nonNumericCols.length > 0 && (
                <optgroup label="Categories & Dates">
                  {nonNumericCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="_count">Record Count</option>
              <option value="_row_index">Record #</option>
            </select>

            {numericCols.length >= 2 && (
              <>
                <FilterChecklistPopover
                  title="Select 1 or Multiple Values (Y)"
                  buttonText={
                    activeYColumns.length > 1 ? `${activeYColumns.length} Y cols` : "+Y"
                  }
                  isFiltered={activeYColumns.length > 1}
                  items={multiYAvailableNames}
                  selectedItems={activeYColumns}
                  formatItem={(name) =>
                    name === "_count"
                      ? "Record Count"
                      : columns.find((c) => c.name === name)?.label || name
                  }
                  onApply={handleMultiYApply}
                />
                <button
                  type="button"
                  onClick={handleToggleAllYValues}
                  title="Compare all numeric values together in one chart"
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    isAllNumericYSelected
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
                  }`}
                >
                  <span>{t("allValuesBtn")}</span>
                </button>
              </>
            )}

            <FilterChecklistPopover
              title={`Filter Y: ${yLabel}`}
              buttonText={
                chart.ySelectedItems === undefined
                  ? "All"
                  : `${chart.ySelectedItems.length}/${yUniqueItems.length}`
              }
              isFiltered={chart.ySelectedItems !== undefined}
              items={yUniqueItems}
              selectedItems={chart.ySelectedItems}
              formatItem={
                isYNumericCol && effectiveYFormat !== "number"
                  ? (val) => formatNumericValue(val, effectiveYFormat)
                  : undefined
              }
              onApply={(next) =>
                onChangeConfig({
                  ...chart,
                  ySelectedItems: next,
                })
              }
            />
          </div>

          {/* Group By (e.g., Subject across Day) */}
          {groupableCols.length > 0 && activeYColumns.length <= 1 && chart.chartType !== "pie" && chart.chartType !== "scatter" && !chart.separateItems && (
            <div className="flex items-center gap-1">
              <span className="text-slate-400 font-medium">Group:</span>
              <select
                aria-label="Group or split series by column"
                value={chart.groupColumn || ""}
                onChange={(e) => handleGroupColumnChange(e.target.value)}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 max-w-[115px] truncate focus:outline-none"
              >
                <option value="">None (Total)</option>
                {groupableCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label}
                  </option>
                ))}
              </select>
              {chart.groupColumn && (
                <select
                  aria-label="Group display mode"
                  value={chart.groupMode || "grouped"}
                  onChange={(e) =>
                    onChangeConfig({
                      ...chart,
                      groupMode: e.target.value as "grouped" | "stacked" | "total",
                    })
                  }
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none"
                >
                  <option value="grouped">Side-by-Side</option>
                  <option value="stacked">Stacked</option>
                  <option value="total">Sum Total</option>
                </select>
              )}
            </div>
          )}

          {/* Give every item/record its own separate column on X-axis without merging */}
          {activeYColumns.length <= 1 && chart.chartType !== "scatter" && (
            <button
              type="button"
              onClick={() =>
                onChangeConfig({
                  ...chart,
                  separateItems: !chart.separateItems,
                })
              }
              title="Show every item/record in its own separate column without grouping or merging"
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                chart.separateItems
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
              }`}
            >
              <span>{t("allItemsOwnCol")}</span>
            </button>
          )}

          {/* Sync Axis: toggle individual series visibility via legend click or panel toggles */}
          <button
            type="button"
            onClick={() =>
              onChangeConfig({
                ...chart,
                syncAxis: !chart.syncAxis,
                hiddenSeries: !chart.syncAxis ? chart.hiddenSeries : undefined,
              })
            }
            aria-pressed={Boolean(chart.syncAxis)}
            title="Enable Sync Axis to show/hide individual series from the legend or toggle list and auto-rescale the axis"
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
              chart.syncAxis
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>
              {t("syncAxis")}
              {chart.syncAxis &&
              builtSeries.mode === "multi_series" &&
              builtSeries.seriesList.length > 0
                ? ` (${builtSeries.seriesList.length - hiddenSeriesSet.size}/${builtSeries.seriesList.length})`
                : ""}
            </span>
          </button>
        </div>

        {/* Currency/Number Format + Theme + Per-Column Custom Colors */}
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1">
            <span className="text-slate-400">Fmt:</span>
            <select
              aria-label="Value number or currency format"
              value={
                isInvertedColumnPair
                  ? chart.xFormat || xColMeta?.format || "auto"
                  : chart.yFormat || primaryYColMeta?.format || "auto"
              }
              onChange={(e) => handleFormatChange(e.target.value as ColumnNumberFormat)}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none"
            >
              {NUMBER_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <span className="text-slate-400">Color:</span>
          <select
            aria-label="Chart color palette"
            value={themeKey}
            onChange={(e) => handleColorThemeChange(e.target.value as ChartColorTheme)}
            className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none"
          >
            {(Object.keys(COLOR_THEMES) as ChartColorTheme[]).map((key) => (
              <option key={key} value={key}>
                {COLOR_THEMES[key].label}
              </option>
            ))}
          </select>
          <input
            type="color"
            aria-label="Pick custom chart color"
            title="Pick main color"
            value={pickerColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            className="w-6 h-5 rounded border border-slate-200 bg-white p-0.5 cursor-pointer"
          />

          {/* Per-Column / Per-Item Color Customizer */}
          {builtSeries.colorKeys.length > 0 && (
            <div ref={itemColorsRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setItemColorsOpen((o) => !o)}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  customItemColorCount > 0
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
                }`}
                title="Customize color for each individual column/item/slice"
              >
                <Palette className="w-3 h-3" />
                <span>
                  {t("barColors")}{customItemColorCount > 0 ? ` (${customItemColorCount})` : ""}
                </span>
              </button>

              {itemColorsOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2.5 text-xs text-slate-800">
                  <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-100">
                    <span className="font-semibold text-slate-900 text-[11px]">
                      Color Each Column / Item
                    </span>
                    <button
                      type="button"
                      onClick={() => setItemColorsOpen(false)}
                      className="text-slate-400 hover:text-slate-700"
                      aria-label="Close color customizer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {builtSeries.colorKeys.map((key, idx) => {
                      const currentHex = getColorForKey(key, idx);
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-50"
                        >
                          <span className="text-[11px] text-slate-700 truncate" title={key}>
                            {key}
                          </span>
                          <input
                            type="color"
                            aria-label={`Color for ${key}`}
                            value={currentHex}
                            onChange={(e) => handleItemColorChange(key, e.target.value)}
                            className="w-7 h-5 rounded border border-slate-200 bg-white p-0.5 cursor-pointer shrink-0"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {customItemColorCount > 0 && (
                    <div className="pt-2 mt-2 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        onClick={handleResetItemColors}
                        className="text-[11px] font-medium text-blue-600 hover:underline"
                      >
                        Reset All Colors
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Excel-Style Multi-Column Filter Bar (Filter ANY & ALL columns/values!) */}
      {columns.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-slate-200/70 text-[11px]">
          <span className="text-slate-500 font-semibold whitespace-nowrap mr-0.5">
            {t("filtersLabel")}
          </span>
          {columns.map((col) => {
            const colItems = uniqueValuesByColumn[col.name] || [];
            const selected = chart.columnFilters?.[col.name];
            const isFiltered = selected !== undefined;
            const colFmt = resolveEffectiveFormat(undefined, col.format);
            return (
              <FilterChecklistPopover
                key={col.name}
                title={`Filter ${col.label}`}
                buttonText={
                  isFiltered
                    ? `${col.label}: ${selected.length}/${colItems.length}`
                    : `${col.label}: All`
                }
                isFiltered={isFiltered}
                items={colItems}
                selectedItems={selected}
                formatItem={
                  col.type === "numeric" && colFmt !== "number"
                    ? (v) => formatNumericValue(v, colFmt)
                    : undefined
                }
                onApply={(next) => handleColumnFilterApply(col.name, next)}
              />
            );
          })}

          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="text-[11px] font-semibold text-blue-600 hover:underline ml-1 whitespace-nowrap"
            >
              {t("resetAllFilters")}
            </button>
          )}
        </div>
      )}

      {/* Sync Axis Configuration Panel: Interactive list of series toggles */}
      {chart.syncAxis && (
        <div className="mb-2.5 rounded-lg border border-blue-200/80 bg-blue-50/40 px-3 py-2 text-[11px]">
          {builtSeries.mode === "multi_series" && builtSeries.seriesList.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-slate-900">
                    Sync Axis · Series Visibility
                  </span>
                  <span className="text-slate-500">
                    Click a toggle or legend label to show/hide &amp; rescale axis (
                    {builtSeries.seriesList.length - hiddenSeriesSet.size}/
                    {builtSeries.seriesList.length} shown)
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hiddenSeriesSet.size > 0 && (
                    <button
                      type="button"
                      onClick={handleShowAllSeries}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {t("showAll")}
                    </button>
                  )}
                  {builtSeries.seriesList.length - hiddenSeriesSet.size > 0 && (
                    <button
                      type="button"
                      onClick={handleHideAllSeries}
                      className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
                    >
                      {t("hideAll")}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-0.5">
                {builtSeries.seriesList.map((ser, sIdx) => {
                  const isVisible = !hiddenSeriesSet.has(ser.name);
                  const serColor = getColorForKey(ser.name, sIdx);
                  return (
                    <button
                      key={ser.name}
                      type="button"
                      role="switch"
                      aria-checked={isVisible}
                      aria-label={`Toggle series ${ser.name}`}
                      onClick={() => toggleSeriesVisibility(ser.name)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                        isVisible
                          ? "border-slate-200 bg-white text-slate-800 shadow-2xs hover:border-blue-400"
                          : "border-slate-200/70 bg-slate-100/80 text-slate-400 hover:border-slate-300"
                      }`}
                      title={
                        isVisible
                          ? `Hide "${ser.name}" and rescale axis`
                          : `Show "${ser.name}" and rescale axis`
                      }
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-sm shrink-0 transition-opacity ${
                          isVisible ? "opacity-100" : "opacity-35"
                        }`}
                        style={{ backgroundColor: serColor }}
                      />
                      <span
                        className={`max-w-[130px] truncate ${
                          isVisible ? "font-medium" : "line-through"
                        }`}
                      >
                        {ser.name}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors ${
                          isVisible ? "bg-[#1E88E5]" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow-2xs transition-transform ${
                            isVisible ? "translate-x-3" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-slate-600">
              <span>
                <strong className="text-slate-800">Sync Axis enabled:</strong> Select multiple
                Y metrics (<span className="font-semibold">+Y</span>) or a{" "}
                <span className="font-semibold">Group</span> column to toggle individual series
                here or in the legend.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active Cross-Filter Banner on Source or Target Chart */}
      {crossFilter && !isCrossFilterSource && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-1.5 text-[11px] text-amber-900">
          <span>
            <strong>Cross-Filtered:</strong> Showing records where{" "}
            <span className="font-semibold">{crossFilter.columnLabel}</span> ={" "}
            <span className="font-semibold">"{crossFilter.value}"</span>
          </span>
          {onCrossFilterSelect && (
            <button
              type="button"
              onClick={() => onCrossFilterSelect(null)}
              className="font-semibold text-amber-800 hover:underline whitespace-nowrap"
            >
              {t("clearFilter")}
            </button>
          )}
        </div>
      )}

      {crossFilter && isCrossFilterSource && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-1.5 text-[11px] text-blue-900">
          <span>
            <strong>Selected:</strong> {crossFilter.columnLabel} ={" "}
            <span className="font-semibold">"{crossFilter.value}"</span> (cross-filtering other
            chart)
          </span>
          {onCrossFilterSelect && (
            <button
              type="button"
              onClick={() => onCrossFilterSelect(null)}
              className="font-semibold text-blue-700 hover:underline whitespace-nowrap"
            >
              {t("clearSelection")}
            </button>
          )}
        </div>
      )}

      {builtSeries.skippedTextRows > 0 && (
        <p className="text-[11px] text-slate-500 mb-1.5">
          {builtSeries.skippedTextRows} non-numeric word/sentence entry(ies) preserved verbatim in Insights.
        </p>
      )}

      {builtSeries.xs.length === 0 ? (
        <div
          className={`w-full ${heightClass} flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-white text-center px-4`}
        >
          <p className="text-xs font-medium text-slate-600">
            {crossFilter && !isCrossFilterSource
              ? `No records match ${crossFilter.columnLabel} = "${crossFilter.value}" with current filters.`
              : "No items match the current column/axis filter selection."}
          </p>
          <div className="flex items-center gap-2">
            {crossFilter && !isCrossFilterSource && onCrossFilterSelect && (
              <button
                type="button"
                onClick={() => onCrossFilterSelect(null)}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                {t("clearCrossFilter")}
              </button>
            )}
            <button
              type="button"
              onClick={handleResetAllFilters}
              className="rounded-lg bg-[#1E88E5] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1976D2]"
            >
              {t("selectAllItems")}
            </button>
          </div>
        </div>
      ) : (
        <div className={`w-full overflow-x-auto pb-1 ${onCrossFilterSelect ? "cursor-pointer" : ""}`}>
          <div ref={containerRef} className={`w-full ${heightClass}`} />
        </div>
      )}
    </div>
  );
};
