import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  FolderOpen,
  TrendingDown,
  TrendingUp,
  ExternalLink,
  FolderMinus,
  ArrowRight,
  Filter,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import type {
  ChartConfig,
  ColumnNumberFormat,
  ColumnProfile,
  ComparisonPeriod,
  CrossFilterSelection,
  Folder,
  FolderComparisonResult,
} from "../types/analytics";
import { PlotlyChart } from "./PlotlyChart";
import {
  NUMBER_FORMAT_OPTIONS,
  formatNumericValue,
  resolveEffectiveFormat,
} from "../utils/numberFormat";
import { TranslationKey, useLanguage } from "../utils/i18n";

interface FolderCompareViewProps {
  folder: Folder;
  comparison: FolderComparisonResult | null;
  loading: boolean;
  period: ComparisonPeriod;
  metric: string;
  filterCol: string;
  filterValues: string[] | undefined;
  onChangePeriod: (p: ComparisonPeriod) => void;
  onChangeMetric: (m: string) => void;
  onChangeFilter: (col: string, values: string[] | undefined) => void;
  onOpenDataset: (id: string) => void;
  onRemoveFromFolder: (datasetId: string) => void;
  onBackHome: () => void;
}

const PERIOD_TABS: { id: ComparisonPeriod; labelKey: TranslationKey }[] = [
  { id: "all", labelKey: "allReports" },
  { id: "weekly", labelKey: "weekly" },
  { id: "monthly", labelKey: "monthly" },
  { id: "yearly", labelKey: "yearly" },
];

export const FolderCompareView: React.FC<FolderCompareViewProps> = ({
  folder,
  comparison,
  loading,
  period,
  metric,
  filterCol,
  filterValues,
  onChangePeriod,
  onChangeMetric,
  onChangeFilter,
  onOpenDataset,
  onRemoveFromFolder,
  onBackHome,
}) => {
  const { t } = useLanguage();
  const [chartLayout, setChartLayout] = useState<1 | 2>(1);
  const [valueScope, setValueScope] = useState<"single" | "all">("single");
  const [folderCrossFilter, setFolderCrossFilter] = useState<CrossFilterSelection | null>(null);

  const [growthChartConfig, setGrowthChartConfig] = useState<ChartConfig>({
    id: "folder_growth_chart",
    title: "Cross-Time Comparison",
    chartType: "bar",
    xColumn: "period_label",
    yColumn: "metric_value",
    aggregation: "sum",
    colorTheme: "multi",
    customColor: "#1E88E5",
  });

  const [itemsChartConfig, setItemsChartConfig] = useState<ChartConfig>({
    id: "folder_items_chart",
    title: "All Items & Related Values",
    chartType: "bar",
    xColumn: "item_name",
    yColumn: "metric_value",
    aggregation: "sum",
    colorTheme: "multi",
    customColor: "#10B981",
    syncAxis: true,
  });

  const [displayFormat, setDisplayFormat] = useState<ColumnNumberFormat>("auto");
  const [breakdownMode, setBreakdownMode] = useState<"total" | "by_period" | "by_item">("total");

  // Multi-select item filter popover state
  const [itemFilterOpen, setItemFilterOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const itemFilterRef = useRef<HTMLDivElement | null>(null);

  const [periodAKey, setPeriodAKey] = useState<string>("");
  const [periodBKey, setPeriodBKey] = useState<string>("");

  const availableFilterColumns = comparison?.availableFilterColumns || [];
  const activeFilterColObj = useMemo(
    () =>
      availableFilterColumns.find((fc) => fc.name === filterCol) ||
      availableFilterColumns[0] ||
      null,
    [availableFilterColumns, filterCol]
  );

  useEffect(() => {
    if (!itemFilterOpen || !activeFilterColObj) return;
    setDraftSelected(new Set(filterValues ?? activeFilterColObj.items));
    setItemSearch("");
  }, [itemFilterOpen, activeFilterColObj, filterValues]);

  useEffect(() => {
    if (!itemFilterOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (itemFilterRef.current && !itemFilterRef.current.contains(e.target as Node)) {
        setItemFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [itemFilterOpen]);

  useEffect(() => {
    const pts = comparison?.points || [];
    if (pts.length >= 2) {
      setPeriodAKey((prev) => (pts.some((p) => p.key === prev) ? prev : pts[0].key));
      setPeriodBKey((prev) =>
        pts.some((p) => p.key === prev) ? prev : pts[pts.length - 1].key
      );
    } else if (pts.length === 1) {
      setPeriodAKey(pts[0].key);
      setPeriodBKey(pts[0].key);
    } else {
      setPeriodAKey("");
      setPeriodBKey("");
    }
  }, [comparison]);

  useEffect(() => {
    setFolderCrossFilter(null);
  }, [folder.id]);

  useEffect(() => {
    if (chartLayout < 2) {
      setFolderCrossFilter(null);
    }
  }, [chartLayout]);

  const effectiveFormat = resolveEffectiveFormat(
    displayFormat,
    comparison?.selectedMetricFormat
  );

  const headToHead = useMemo(() => {
    const pts = comparison?.points || [];
    if (pts.length < 2) return null;
    const a = pts.find((p) => p.key === periodAKey) || pts[0];
    const b = pts.find((p) => p.key === periodBKey) || pts[pts.length - 1];
    const diff = b.value - a.value;
    const pct = a.value !== 0 ? (diff / Math.abs(a.value)) * 100 : null;
    return { a, b, diff, pct };
  }, [comparison, periodAKey, periodBKey]);

  const numericMetrics = useMemo(
    () => (comparison?.availableMetrics || []).filter((m) => m.name !== "_row_count"),
    [comparison]
  );

  const hasMultiMetrics = numericMetrics.length >= 2;
  const hasBreakdownSeries = (comparison?.breakdownSeries?.length || 0) > 0;
  const hasItemRows = (comparison?.itemMultiMetricRows?.length || 0) > 0;
  const useBreakdown = breakdownMode !== "total" && hasBreakdownSeries;

  const activeSingleMetricKey =
    metric || comparison?.selectedMetric || numericMetrics[0]?.name || "_row_count";

  const chartColumns: ColumnProfile[] = useMemo(() => {
    const cols: ColumnProfile[] = [
      {
        name: "period_label",
        label:
          period === "weekly"
            ? "Week"
            : period === "monthly"
            ? "Month"
            : period === "yearly"
            ? "Year"
            : "Report",
        type: "categorical",
        non_null: comparison?.points.length || 0,
        unique_count: comparison?.points.length || 0,
      },
    ];

    if (hasItemRows || (useBreakdown && activeFilterColObj)) {
      cols.push({
        name: "item_name",
        label: activeFilterColObj?.label || "Item",
        type: "categorical",
        non_null: comparison?.breakdownSeries?.length || 0,
        unique_count: comparison?.breakdownSeries?.length || 0,
      });
    }

    if (numericMetrics.length > 0) {
      numericMetrics.forEach((m) => {
        cols.push({
          name: m.name,
          label: m.label,
          type: "numeric",
          format:
            displayFormat !== "auto"
              ? displayFormat
              : resolveEffectiveFormat("auto", m.format),
          non_null: comparison?.points.length || 0,
          unique_count: comparison?.points.length || 0,
        });
      });
    }

    cols.push({
      name: "_row_count",
      label: "Record / Item Count",
      type: "numeric",
      format: "number",
      non_null: comparison?.points.length || 0,
      unique_count: comparison?.points.length || 0,
    });

    return cols;
  }, [
    comparison,
    period,
    displayFormat,
    hasItemRows,
    useBreakdown,
    activeFilterColObj,
    numericMetrics,
  ]);

  const periodMultiRows = useMemo(() => {
    if (comparison?.periodMultiMetricRows && comparison.periodMultiMetricRows.length > 0) {
      return comparison.periodMultiMetricRows;
    }
    return (comparison?.points || []).map((pt) => ({
      period_key: pt.key,
      period_label: pt.label,
      [activeSingleMetricKey]: pt.value,
      _row_count: pt.reportCount,
    }));
  }, [comparison, activeSingleMetricKey]);

  const itemMultiRows = useMemo(() => {
    if (comparison?.itemMultiMetricRows && comparison.itemMultiMetricRows.length > 0) {
      return comparison.itemMultiMetricRows;
    }
    if (hasBreakdownSeries && comparison?.breakdownSeries) {
      const out: Record<string, string | number | null>[] = [];
      comparison.points.forEach((pt) => {
        comparison.breakdownSeries!.forEach((ser) => {
          out.push({
            period_key: pt.key,
            period_label: pt.label,
            item_name: ser.name,
            [activeSingleMetricKey]: ser.valuesByPeriod[pt.key] ?? 0,
          });
        });
      });
      return out;
    }
    return [];
  }, [comparison, hasBreakdownSeries, activeSingleMetricKey]);

  const chart1Rows = useMemo(() => {
    const needsItemRows =
      hasItemRows &&
      (useBreakdown || (chartLayout === 2 && folderCrossFilter?.column === "item_name"));
    return needsItemRows && itemMultiRows.length > 0 ? itemMultiRows : periodMultiRows;
  }, [hasItemRows, useBreakdown, chartLayout, folderCrossFilter, itemMultiRows, periodMultiRows]);

  const chart2Rows = useMemo(() => {
    return itemMultiRows.length > 0 ? itemMultiRows : periodMultiRows;
  }, [itemMultiRows, periodMultiRows]);

  const effectiveYColsChart1 = useMemo(() => {
    if (valueScope === "all" && hasMultiMetrics) {
      return numericMetrics.map((m) => m.name);
    }
    return [activeSingleMetricKey];
  }, [valueScope, hasMultiMetrics, numericMetrics, activeSingleMetricKey]);

  const syncedChartConfig: ChartConfig = useMemo(() => {
    const isSwapped = Boolean(growthChartConfig.swapAxes);
    const dimCol =
      chartLayout === 1 && breakdownMode === "by_item" && hasItemRows
        ? "item_name"
        : "period_label";

    const useAllY = valueScope === "all" && hasMultiMetrics;
    const validColsSet = new Set(chartColumns.map((c) => c.name));
    const userCustomYCols =
      growthChartConfig.yColumns &&
      growthChartConfig.yColumns.length > 0 &&
      growthChartConfig.yColumns.every((c) => validColsSet.has(c) && c !== "metric_value")
        ? growthChartConfig.yColumns
        : null;

    const chosenYCols = useAllY
      ? numericMetrics.map((m) => m.name)
      : userCustomYCols && userCustomYCols.length > 1
      ? userCustomYCols
      : effectiveYColsChart1;

    const grpCol =
      chosenYCols.length > 1 || !useBreakdown
        ? undefined
        : breakdownMode === "by_item"
        ? (comparison?.points?.length || 0) > 1
          ? "period_label"
          : undefined
        : "item_name";

    const periodTitle =
      period === "all"
        ? "By Report"
        : period === "weekly"
        ? "Weekly"
        : period === "monthly"
        ? "Monthly"
        : "Yearly";

    return {
      ...growthChartConfig,
      xColumn: isSwapped ? chosenYCols[0] : dimCol,
      yColumn: isSwapped ? dimCol : chosenYCols[0],
      yColumns: isSwapped ? [dimCol] : chosenYCols,
      groupColumn: grpCol,
      groupMode: grpCol ? growthChartConfig.groupMode || "grouped" : undefined,
      syncAxis: chosenYCols.length > 1 ? true : growthChartConfig.syncAxis,
      aggregation: "sum",
      xFormat: isSwapped ? effectiveFormat : undefined,
      yFormat: isSwapped ? undefined : effectiveFormat,
      title: `${
        chosenYCols.length > 1
          ? `All ${chosenYCols.length} Values`
          : comparison?.selectedMetricLabel || "Metric"
      } Growth (${periodTitle}${
        dimCol === "item_name" && activeFilterColObj
          ? ` · All ${activeFilterColObj.label}s`
          : useBreakdown && activeFilterColObj && chosenYCols.length <= 1
          ? ` · By ${activeFilterColObj.label}`
          : ""
      })`,
    };
  }, [
    growthChartConfig,
    chartLayout,
    breakdownMode,
    hasItemRows,
    valueScope,
    hasMultiMetrics,
    chartColumns,
    numericMetrics,
    effectiveYColsChart1,
    useBreakdown,
    comparison?.points?.length,
    comparison?.selectedMetricLabel,
    period,
    effectiveFormat,
    activeFilterColObj,
  ]);

  const syncedChart2Config: ChartConfig = useMemo(() => {
    const validColsSet = new Set(chartColumns.map((c) => c.name));
    const dimCol =
      itemsChartConfig.xColumn &&
      itemsChartConfig.xColumn !== "metric_value" &&
      validColsSet.has(itemsChartConfig.xColumn)
        ? itemsChartConfig.xColumn
        : hasItemRows
        ? "item_name"
        : "period_label";

    const defaultYCols =
      valueScope === "all" || hasMultiMetrics
        ? numericMetrics.map((m) => m.name)
        : [activeSingleMetricKey];

    const userCustomYCols =
      itemsChartConfig.yColumns &&
      itemsChartConfig.yColumns.length > 0 &&
      itemsChartConfig.yColumns.every((c) => validColsSet.has(c) && c !== "metric_value")
        ? itemsChartConfig.yColumns
        : null;

    const chosenYCols =
      valueScope === "all" && hasMultiMetrics
        ? numericMetrics.map((m) => m.name)
        : userCustomYCols || defaultYCols;

    return {
      ...itemsChartConfig,
      chartType:
        chosenYCols.length > 1 && itemsChartConfig.chartType === "pie"
          ? "bar"
          : itemsChartConfig.chartType || (hasItemRows ? "bar" : "line"),
      xColumn: dimCol,
      yColumn: chosenYCols[0] || activeSingleMetricKey,
      yColumns: chosenYCols,
      syncAxis: chosenYCols.length > 1 ? true : Boolean(itemsChartConfig.syncAxis),
      aggregation: "sum",
      yFormat: effectiveFormat,
      title: hasItemRows
        ? `All ${activeFilterColObj?.label || "Items"} · ${
            chosenYCols.length > 1
              ? `${chosenYCols.length} Related Values`
              : comparison?.selectedMetricLabel || "Comparison"
          }`
        : `All Metrics Trend Comparison`,
    };
  }, [
    itemsChartConfig,
    chartColumns,
    hasItemRows,
    valueScope,
    hasMultiMetrics,
    numericMetrics,
    activeSingleMetricKey,
    effectiveFormat,
    activeFilterColObj,
    comparison?.selectedMetricLabel,
  ]);

  const summary = comparison?.growthSummary;
  const datasets = comparison?.datasets || [];

  const formatPct = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "—";
    return `${val > 0 ? "+" : ""}${val.toFixed(1)}%`;
  };

  const filteredPopoverItems = useMemo(() => {
    if (!activeFilterColObj) return [];
    const q = itemSearch.trim().toLowerCase();
    if (!q) return activeFilterColObj.items;
    return activeFilterColObj.items.filter((it) => it.toLowerCase().includes(q));
  }, [activeFilterColObj, itemSearch]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("dataInput")}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-[#1E88E5] shrink-0" />
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">
                {folder.name}
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {datasets.length} saved report(s) · Compare weekly, monthly, yearly growth &amp;
              filter specific subjects/items
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 space-y-4">
          <div className="h-6 w-1/3 rounded bg-slate-100 animate-pulse" />
          <div className="h-[320px] rounded-xl bg-slate-100 animate-pulse" />
        </div>
      ) : datasets.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200 p-10 text-center space-y-3">
          <FolderOpen className="w-9 h-9 text-blue-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">
            This folder has no reports yet
          </h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            Analyze any file, photo, or voice input, then choose{" "}
            <span className="font-semibold text-slate-700">{folder.name}</span> in the Save
            to Folder selector on the Analysis page or History table to track and compare
            growth over time.
          </p>
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E88E5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1976D2] transition-colors"
          >
            Upload or Analyze Data
          </button>
        </div>
      ) : (
        <>
          {/* Cross-Time Growth Assessment Card */}
          <section className="rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {t("growthComparisonTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  Select Weekly/Monthly/Yearly, filter 1 to All subjects/items, and format
                  values in ₹ INR or units.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs">
                  {PERIOD_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onChangePeriod(tab.id)}
                      className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                        period === tab.id
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {t(tab.labelKey)}
                    </button>
                  ))}
                </div>

                {/* User Choice: 1 Chart vs 2 Charts */}
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setChartLayout(1)}
                    className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                      chartLayout === 1
                        ? "bg-[#1E88E5] text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {t("oneChart")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartLayout(2)}
                    className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                      chartLayout === 2
                        ? "bg-[#1E88E5] text-white shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {t("twoCharts")}
                  </button>
                </div>

                {/* User Choice: All Values Together vs 1 Specific Value */}
                {hasMultiMetrics && (
                  <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setValueScope("single");
                        setGrowthChartConfig((prev) => ({ ...prev, yColumns: undefined }));
                        setItemsChartConfig((prev) => ({ ...prev, yColumns: undefined }));
                      }}
                      className={`px-2.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                        valueScope === "single"
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {t("singleValueMode")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setValueScope("all")}
                      className={`px-2.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                        valueScope === "all"
                          ? "bg-[#1E88E5] text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {t("allValuesBtn")} ({numericMetrics.length})
                    </button>
                  </div>
                )}

                {comparison && comparison.availableMetrics.length > 0 && (
                  <select
                    aria-label="Comparison metric"
                    value={metric || comparison.selectedMetric}
                    onChange={(e) => {
                      setValueScope("single");
                      setGrowthChartConfig((prev) => ({ ...prev, yColumns: undefined }));
                      onChangeMetric(e.target.value);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                  >
                    {comparison.availableMetrics.map((m) => (
                      <option key={m.name} value={m.name}>
                        Metric: {m.label}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label="Display number or currency format"
                  value={displayFormat}
                  onChange={(e) => setDisplayFormat(e.target.value as ColumnNumberFormat)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                >
                  {NUMBER_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Fmt: {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Subject / Item Multi-Select Filter + Total vs Per-Subject Breakdown */}
            {activeFilterColObj && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700">Filter Items:</span>
                  {availableFilterColumns.length > 1 && (
                    <select
                      aria-label="Filter category column"
                      value={activeFilterColObj.name}
                      onChange={(e) => onChangeFilter(e.target.value, undefined)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none"
                    >
                      {availableFilterColumns.map((fc) => (
                        <option key={fc.name} value={fc.name}>
                          {fc.label}
                        </option>
                      ))}
                    </select>
                  )}

                  <div ref={itemFilterRef} className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setItemFilterOpen((o) => !o)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        filterValues !== undefined
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-400"
                      }`}
                    >
                      <Filter className="w-3.5 h-3.5" />
                      <span>
                        {activeFilterColObj.label}:{" "}
                        {filterValues === undefined
                          ? `All (${activeFilterColObj.items.length})`
                          : `${filterValues.length} / ${activeFilterColObj.items.length} selected`}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>

                    {itemFilterOpen && (
                      <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2.5 text-xs text-slate-800">
                        <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-100">
                          <span className="font-semibold text-slate-900">
                            Select 1 to All {activeFilterColObj.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => setItemFilterOpen(false)}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="relative mb-2">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            placeholder="Search..."
                            className="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer font-semibold border-b border-slate-100 mb-1">
                          <input
                            type="checkbox"
                            checked={
                              filteredPopoverItems.length > 0 &&
                              filteredPopoverItems.every((it) => draftSelected.has(it))
                            }
                            onChange={() => {
                              const next = new Set(draftSelected);
                              const allChecked = filteredPopoverItems.every((it) =>
                                next.has(it)
                              );
                              if (allChecked) {
                                filteredPopoverItems.forEach((it) => next.delete(it));
                              } else {
                                filteredPopoverItems.forEach((it) => next.add(it));
                              }
                              setDraftSelected(next);
                            }}
                            className="h-3.5 w-3.5 accent-[#1E88E5]"
                          />
                          <span>(Select All)</span>
                        </label>

                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {filteredPopoverItems.map((it) => (
                            <label
                              key={it}
                              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={draftSelected.has(it)}
                                onChange={() => {
                                  const next = new Set(draftSelected);
                                  if (next.has(it)) next.delete(it);
                                  else next.add(it);
                                  setDraftSelected(next);
                                }}
                                className="h-3.5 w-3.5 accent-[#1E88E5]"
                              />
                              <span className="truncate">{it}</span>
                            </label>
                          ))}
                        </div>

                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onChangeFilter(activeFilterColObj.name, undefined);
                                setItemFilterOpen(false);
                              }}
                              className="text-blue-600 font-medium hover:underline px-1.5 py-1"
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              onClick={() => setDraftSelected(new Set())}
                              className="text-slate-500 font-medium hover:text-slate-800 hover:underline px-1.5 py-1"
                            >
                              {t("clearAllBtn")}
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setItemFilterOpen(false)}
                              className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50"
                            >
                              {t("cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const chosen = activeFilterColObj.items.filter((it) =>
                                  draftSelected.has(it)
                                );
                                onChangeFilter(
                                  activeFilterColObj.name,
                                  chosen.length === activeFilterColObj.items.length
                                    ? undefined
                                    : chosen
                                );
                                setItemFilterOpen(false);
                              }}
                              className="rounded-md bg-[#1E88E5] px-2.5 py-1 font-semibold text-white hover:bg-[#1976D2]"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {hasBreakdownSeries && (
                  <div className="flex flex-wrap items-center rounded-lg bg-white border border-slate-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setBreakdownMode("total")}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                        breakdownMode === "total"
                          ? "bg-[#1E88E5] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Combined Total
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode("by_period")}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                        breakdownMode === "by_period"
                          ? "bg-[#1E88E5] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      By Period
                    </button>
                    <button
                      type="button"
                      onClick={() => setBreakdownMode("by_item")}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                        breakdownMode === "by_item"
                          ? "bg-[#1E88E5] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      All {activeFilterColObj.label}s (Own Column)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Growth KPIs */}
            {summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="text-xs font-medium text-slate-500">
                    {t("overallGrowth")}
                  </div>
                  <div
                    className={`mt-1 flex items-center gap-1.5 text-xl sm:text-2xl font-bold tabular-nums ${
                      (summary.overallGrowthPct ?? 0) > 0
                        ? "text-emerald-700"
                        : (summary.overallGrowthPct ?? 0) < 0
                        ? "text-rose-600"
                        : "text-slate-900"
                    }`}
                  >
                    {(summary.overallGrowthPct ?? 0) > 0 ? (
                      <TrendingUp className="w-5 h-5 shrink-0" />
                    ) : (summary.overallGrowthPct ?? 0) < 0 ? (
                      <TrendingDown className="w-5 h-5 shrink-0" />
                    ) : null}
                    <span>{formatPct(summary.overallGrowthPct)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {summary.periodCount >= 2
                      ? `From ${summary.firstLabel}`
                      : "Add 2+ periods to assess"}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="text-xs font-medium text-slate-500">
                    {t("latestPeriodChange")}
                  </div>
                  <div
                    className={`mt-1 text-xl sm:text-2xl font-bold tabular-nums ${
                      (summary.latestChangePct ?? 0) > 0
                        ? "text-emerald-700"
                        : (summary.latestChangePct ?? 0) < 0
                        ? "text-rose-600"
                        : "text-slate-900"
                    }`}
                  >
                    {formatPct(summary.latestChangePct)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    Latest: {formatNumericValue(summary.latestValue, effectiveFormat)}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="text-xs font-medium text-slate-500">
                    {t("peakPeriod")}
                  </div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                    {formatNumericValue(summary.bestValue, effectiveFormat)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {summary.bestLabel}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="text-xs font-medium text-slate-500">
                    {t("periodsTracked")}
                  </div>
                  <div className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                    {summary.periodCount}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {datasets.length} report(s) in folder
                  </div>
                </div>
              </div>
            )}

            {/* Direct Head-to-Head Compare: Any 1 Week/Month/Year vs Another */}
            {comparison && comparison.points.length >= 2 && headToHead && (
              <div className="rounded-xl border border-blue-200/80 bg-blue-50/40 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {t("compareTwoPeriods")}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Pick any two weeks, months, years, or reports to measure exact growth.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select
                      aria-label="Base period A"
                      value={headToHead.a.key}
                      onChange={(e) => setPeriodAKey(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      {comparison.points.map((pt) => (
                        <option key={pt.key} value={pt.key}>
                          From: {pt.label}
                        </option>
                      ))}
                    </select>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <select
                      aria-label="Target period B"
                      value={headToHead.b.key}
                      onChange={(e) => setPeriodBKey(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      {comparison.points.map((pt) => (
                        <option key={pt.key} value={pt.key}>
                          To: {pt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-white border border-slate-200/80 px-3 py-2.5">
                    <div className="text-[11px] text-slate-500 truncate">
                      {headToHead.a.label}
                    </div>
                    <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                      {formatNumericValue(headToHead.a.value, effectiveFormat)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200/80 px-3 py-2.5">
                    <div className="text-[11px] text-slate-500 truncate">
                      {headToHead.b.label}
                    </div>
                    <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                      {formatNumericValue(headToHead.b.value, effectiveFormat)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200/80 px-3 py-2.5">
                    <div className="text-[11px] text-slate-500">{t("difference")}</div>
                    <div
                      className={`text-base font-bold tabular-nums mt-0.5 ${
                        headToHead.diff > 0
                          ? "text-emerald-700"
                          : headToHead.diff < 0
                          ? "text-rose-600"
                          : "text-slate-900"
                      }`}
                    >
                      {headToHead.diff > 0 ? "+" : ""}
                      {formatNumericValue(headToHead.diff, effectiveFormat)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200/80 px-3 py-2.5">
                    <div className="text-[11px] text-slate-500">{t("growthPct")}</div>
                    <div
                      className={`text-base font-bold tabular-nums mt-0.5 ${
                        (headToHead.pct ?? 0) > 0
                          ? "text-emerald-700"
                          : (headToHead.pct ?? 0) < 0
                          ? "text-rose-600"
                          : "text-slate-900"
                      }`}
                    >
                      {formatPct(headToHead.pct)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Comparison Chart(s): User choice 1 Unified Chart or 2 Synchronized Charts */}
            {(chart1Rows.length > 0 || chart2Rows.length > 0) && (
              <div className="space-y-3">
                {chartLayout === 2 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    {folderCrossFilter ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-900">
                        <span>
                          Cross-Filter:{" "}
                          <strong className="font-semibold">
                            {folderCrossFilter.columnLabel} = &quot;{folderCrossFilter.value}&quot;
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => setFolderCrossFilter(null)}
                          className="inline-flex items-center gap-1 rounded-md bg-white border border-blue-200 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          <X className="w-3 h-3" />
                          {t("clearCrossFilter")}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded-lg px-2.5 py-1">
                        {t("crossFilterReady")}
                      </span>
                    )}
                  </div>
                )}

                <div
                  className={`grid gap-5 ${
                    chartLayout === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
                  }`}
                >
                  {chart1Rows.length > 0 && (
                    <PlotlyChart
                      chart={syncedChartConfig}
                      rows={chart1Rows}
                      columns={chartColumns}
                      onChangeConfig={(updated) => setGrowthChartConfig(updated)}
                      crossFilter={chartLayout === 2 ? folderCrossFilter : null}
                      isCrossFilterSource={folderCrossFilter?.sourceChartIndex === 0}
                      onCrossFilterSelect={
                        chartLayout === 2
                          ? (sel) => {
                              if (!sel) {
                                setFolderCrossFilter(null);
                                return;
                              }
                              setFolderCrossFilter((prev) =>
                                prev &&
                                prev.sourceChartIndex === 0 &&
                                prev.column === sel.column &&
                                prev.value === sel.value
                                  ? null
                                  : {
                                      ...sel,
                                      sourceChartIndex: 0,
                                      sourceChartTitle: syncedChartConfig.title,
                                    }
                              );
                            }
                          : undefined
                      }
                      heightClass={
                        chartLayout === 1
                          ? "h-[360px] sm:h-[420px]"
                          : "h-[340px] sm:h-[380px]"
                      }
                    />
                  )}

                  {chartLayout === 2 && chart2Rows.length > 0 && (
                    <PlotlyChart
                      chart={syncedChart2Config}
                      rows={chart2Rows}
                      columns={chartColumns}
                      onChangeConfig={(updated) => setItemsChartConfig(updated)}
                      crossFilter={folderCrossFilter}
                      isCrossFilterSource={folderCrossFilter?.sourceChartIndex === 1}
                      onCrossFilterSelect={(sel) => {
                        if (!sel) {
                          setFolderCrossFilter(null);
                          return;
                        }
                        setFolderCrossFilter((prev) =>
                          prev &&
                          prev.sourceChartIndex === 1 &&
                          prev.column === sel.column &&
                          prev.value === sel.value
                            ? null
                            : {
                                ...sel,
                                sourceChartIndex: 1,
                                sourceChartTitle: syncedChart2Config.title,
                              }
                        );
                      }}
                      heightClass="h-[340px] sm:h-[380px]"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Period Breakdown Table */}
            {comparison && comparison.points.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Period</th>
                        <th className="px-4 py-2.5 font-semibold">Reports Combined</th>
                        <th className="px-4 py-2.5 font-semibold text-right">
                          {comparison.selectedMetricLabel}
                        </th>
                        <th className="px-4 py-2.5 font-semibold text-right">
                          Growth vs Prev
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {comparison.points.map((pt) => (
                        <tr key={pt.key} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                            {pt.label}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {pt.reportNames.join(", ")}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900">
                            {formatNumericValue(pt.value, effectiveFormat)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums font-medium ${
                              (pt.changePct ?? 0) > 0
                                ? "text-emerald-700"
                                : (pt.changePct ?? 0) < 0
                                ? "text-rose-600"
                                : "text-slate-500"
                            }`}
                          >
                            {formatPct(pt.changePct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Saved Reports in Folder */}
          <section className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                {t("reportsStoredIn")} {folder.name}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Report Name</th>
                    <th className="px-4 py-3 font-semibold">Source</th>
                    <th className="px-4 py-3 font-semibold text-right">Records</th>
                    <th className="px-4 py-3 font-semibold">Saved On</th>
                    <th className="px-5 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {datasets.map((ds) => (
                    <tr key={ds.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3 font-medium text-slate-900">{ds.name}</td>
                      <td className="px-4 py-3 text-xs uppercase text-slate-600">
                        {ds.sourceType}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {ds.rowCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(ds.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap space-x-3">
                        <button
                          type="button"
                          onClick={() => onOpenDataset(ds.id)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {t("openCharts")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveFromFolder(ds.id)}
                          title="Remove from folder (keeps report in History)"
                          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition-colors"
                        >
                          <FolderMinus className="w-3.5 h-3.5" />
                          {t("remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
