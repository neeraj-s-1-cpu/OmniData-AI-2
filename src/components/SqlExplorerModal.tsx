import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Database,
  Download,
  FilterX,
  Play,
  Search,
  X,
} from "lucide-react";
import type {
  ColumnFilterRule,
  ColumnNumberFormat,
  ColumnProfile,
  Dataset,
} from "../types/analytics";
import {
  NUMBER_FORMAT_OPTIONS,
  formatNumericValue,
  resolveEffectiveFormat,
} from "../utils/numberFormat";
import {
  ExcelColumnMenu,
  computeColumnNumericAverage,
  evaluateColumnFilterRule,
  formatAxisFilterKey,
} from "./ExcelFilterMenu";

interface SqlExplorerModalProps {
  dataset: Dataset | null;
  isOpen: boolean;
  onClose: () => void;
  onChangeColumnFormat?: (columnName: string, format: ColumnNumberFormat) => void;
}

export const SqlExplorerModal: React.FC<SqlExplorerModalProps> = ({
  dataset,
  isOpen,
  onClose,
  onChangeColumnFormat,
}) => {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [colValueFilters, setColValueFilters] = useState<Record<string, string[]>>({});
  const [colRuleFilters, setColRuleFilters] = useState<Record<string, ColumnFilterRule>>({});
  const [showRawSqlValues, setShowRawSqlValues] = useState(false);
  const [sqlInput, setSqlInput] = useState("SELECT * FROM data LIMIT 50");
  const [sqlResult, setSqlResult] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
  } | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [runningSql, setRunningSql] = useState(false);

  const rows = dataset?.rows || [];
  const columns = dataset?.columns || [];

  const numericColumns = useMemo(
    () => columns.filter((c) => c.type === "numeric" || c.type === "mixed"),
    [columns]
  );

  const colFormatMap = useMemo(() => {
    const map: Record<string, ColumnNumberFormat> = {};
    columns.forEach((c) => {
      map[c.name] = resolveEffectiveFormat(undefined, c.format);
    });
    return map;
  }, [columns]);

  // Unique values & averages per column for Excel AutoFilter menus
  const uniqueValuesByCol = useMemo(() => {
    const map: Record<string, string[]> = {};
    columns.forEach((col) => {
      const seen = new Set<string>();
      const list: string[] = [];
      const blank =
        col.type === "numeric" || col.type === "mixed" ? "(Blank)" : "Unknown";
      rows.forEach((r) => {
        const k = formatAxisFilterKey(r[col.name], blank);
        if (!seen.has(k)) {
          seen.add(k);
          list.push(k);
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

  const averagesByCol = useMemo(() => {
    const map: Record<string, number | null> = {};
    columns.forEach((col) => {
      if (col.type === "numeric" || col.type === "mixed") {
        map[col.name] = computeColumnNumericAverage(rows, col.name);
      } else {
        map[col.name] = null;
      }
    });
    return map;
  }, [rows, columns]);

  const filteredAndSortedRows = useMemo(() => {
    const valEntries = Object.entries(colValueFilters).filter(([, arr]) =>
      Array.isArray(arr)
    );
    const ruleEntries = Object.entries(colRuleFilters);

    let out = rows.filter((r) => {
      for (const [colName, allowed] of valEntries) {
        const colDef = columns.find((c) => c.name === colName);
        const blank =
          colDef?.type === "numeric" || colDef?.type === "mixed"
            ? "(Blank)"
            : "Unknown";
        const key = formatAxisFilterKey(r[colName], blank);
        if (!allowed.includes(key)) return false;
      }

      for (const [colName, rule] of ruleEntries) {
        const colDef = columns.find((c) => c.name === colName);
        if (
          !evaluateColumnFilterRule(
            r[colName],
            rule,
            colDef?.type || "categorical",
            averagesByCol[colName] ?? null
          )
        ) {
          return false;
        }
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matches = Object.values(r).some((v) =>
          String(v ?? "").toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      return true;
    });

    if (sortCol) {
      out = [...out].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number") {
          return sortAsc ? av - bv : bv - av;
        }
        return sortAsc
          ? String(av).localeCompare(String(bv), undefined, { numeric: true })
          : String(bv).localeCompare(String(av), undefined, { numeric: true });
      });
    }

    return out;
  }, [
    rows,
    columns,
    colValueFilters,
    colRuleFilters,
    averagesByCol,
    search,
    sortCol,
    sortAsc,
  ]);

  if (!isOpen || !dataset) return null;

  const handleHeaderSortToggle = (colName: string) => {
    if (sortCol === colName) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(colName);
      setSortAsc(true);
    }
  };

  const handleExcelSort = (colName: string, direction: "asc" | "desc" | null) => {
    if (direction === null) {
      if (sortCol === colName) setSortCol(null);
      return;
    }
    setSortCol(colName);
    setSortAsc(direction === "asc");
  };

  const handleExcelFilterApply = (
    colName: string,
    nextItems: string[] | undefined,
    nextRule?: ColumnFilterRule | undefined
  ) => {
    setColValueFilters((prev) => {
      const next = { ...prev };
      if (nextItems === undefined) delete next[colName];
      else next[colName] = nextItems;
      return next;
    });
    setColRuleFilters((prev) => {
      const next = { ...prev };
      if (!nextRule) delete next[colName];
      else next[colName] = nextRule;
      return next;
    });
  };

  const hasActiveFiltersOrSort =
    Boolean(sortCol) ||
    Boolean(search.trim()) ||
    Object.keys(colValueFilters).length > 0 ||
    Object.keys(colRuleFilters).length > 0;

  const clearAllFiltersAndSort = () => {
    setSearch("");
    setSortCol(null);
    setSortAsc(true);
    setColValueFilters({});
    setColRuleFilters({});
  };

  const handleExportFilteredCsv = () => {
    const colsToExport = sqlResult
      ? sqlResult.columns.map((c) => ({ name: c, label: c }))
      : columns;
    const rowsToExport = sqlResult ? sqlResult.rows : filteredAndSortedRows;

    const escapeCsv = (val: unknown) => {
      const s = val === null || val === undefined ? "" : String(val);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [
      colsToExport.map((c) => escapeCsv(c.label)).join(","),
      ...rowsToExport.map((r) =>
        colsToExport
          .map((c) => {
            const val = (r as Record<string, unknown>)[c.name];
            if (typeof val === "number" && !showRawSqlValues) {
              const fmt = colFormatMap[c.name] || "number";
              return escapeCsv(fmt !== "number" ? formatNumericValue(val, fmt) : val);
            }
            return escapeCsv(val);
          })
          .join(",")
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}_filtered.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const runSqlQuery = async () => {
    setRunningSql(true);
    setSqlError(null);
    try {
      const resp = await fetch(`/api/datasets/${dataset.id}/sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlInput }),
      });
      const text = await resp.text();
      if (text.trim().startsWith("<")) {
        throw new Error(`Server returned HTML instead of JSON (HTTP ${resp.status}).`);
      }
      const data = JSON.parse(text);
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || "SQL query failed");
      }
      setSqlResult({ columns: data.columns || [], rows: data.rows || [] });
    } catch (err: any) {
      setSqlError(err?.message || "Failed to run SQL query");
    } finally {
      setRunningSql(false);
    }
  };

  const activeColumns: { name: string; label: string; meta?: ColumnProfile }[] =
    sqlResult
      ? sqlResult.columns.map((c) => ({
          name: c,
          label: c,
          meta: columns.find((col) => col.name === c),
        }))
      : columns.map((c) => ({ name: c.name, label: c.label, meta: c }));

  const activeRows = sqlResult ? sqlResult.rows : filteredAndSortedRows;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Excel Data Sheet & SQL Explorer"
    >
      <div className="flex flex-col w-full max-w-6xl max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top Modal Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5 min-w-0">
            <Database className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 truncate">
                {dataset.name} — Excel Sheet &amp; SQL Explorer ({dataset.tableName})
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Click any column header dropdown for Excel Sort, Number/Text/Date Filters, and Value Checklists
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SQL Query Bar + Excel Controls + Quick Search */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <span className="text-xs font-mono font-semibold text-blue-600 shrink-0">
                SQL
              </span>
              <input
                type="text"
                value={sqlInput}
                onChange={(e) => setSqlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSqlQuery();
                }}
                placeholder="SELECT * FROM data LIMIT 50"
                className="w-full text-xs font-mono text-slate-800 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={runSqlQuery}
              disabled={runningSql}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              {runningSql ? "Running..." : "Run SQL"}
            </button>
            {sqlResult && (
              <button
                type="button"
                onClick={() => setSqlResult(null)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                Back to Excel Sheet
              </button>
            )}
            <button
              type="button"
              onClick={handleExportFilteredCsv}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Export CSV
            </button>
          </div>

          {sqlError && <p className="text-xs text-rose-600">{sqlError}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {!sqlResult && (
                <div className="relative w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search across sheet..."
                    className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                Showing {activeRows.length.toLocaleString()} of{" "}
                {rows.length.toLocaleString()} row(s)
              </span>

              {!sqlResult && hasActiveFiltersOrSort && (
                <button
                  type="button"
                  onClick={clearAllFiltersAndSort}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors whitespace-nowrap"
                >
                  <FilterX className="w-3 h-3" />
                  Clear All Filters &amp; Sort
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {numericColumns.length > 0 && onChangeColumnFormat && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-500 font-medium">Column Format:</span>
                  {numericColumns.slice(0, 3).map((nc) => (
                    <label key={nc.name} className="inline-flex items-center gap-1">
                      <span className="text-slate-600">{nc.label}:</span>
                      <select
                        aria-label={`Format for ${nc.label}`}
                        value={nc.format || "number"}
                        onChange={(e) =>
                          onChangeColumnFormat(
                            nc.name,
                            e.target.value as ColumnNumberFormat
                          )
                        }
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:outline-none"
                      >
                        {NUMBER_FORMAT_OPTIONS.filter((o) => o.value !== "auto").map(
                          (opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              <label className="inline-flex items-center gap-1.5 text-slate-600 cursor-pointer ml-1">
                <input
                  type="checkbox"
                  checked={showRawSqlValues}
                  onChange={(e) => setShowRawSqlValues(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#1E88E5]"
                />
                <span>Show Raw SQL Numbers</span>
              </label>
            </div>
          </div>
        </div>

        {/* Excel-Style Spreadsheet Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-400 border-r border-slate-200/70 w-10 text-center">
                  #
                </th>
                {activeColumns.map((col, cIdx) => {
                  const isSorted = !sqlResult && sortCol === col.name;
                  const colFmt = colFormatMap[col.name] || "number";
                  const colType = col.meta?.type || "categorical";
                  const alignRight = cIdx >= activeColumns.length - 2 && activeColumns.length >= 3;

                  return (
                    <th
                      key={col.name}
                      className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap border-r border-slate-200/60 select-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => !sqlResult && handleHeaderSortToggle(col.name)}
                          className="inline-flex items-center gap-1 hover:text-blue-700 transition-colors"
                          title={!sqlResult ? `Sort by ${col.label}` : col.label}
                        >
                          <span>{col.label}</span>
                          {!sqlResult && (
                            isSorted ? (
                              sortAsc ? (
                                <ArrowUp className="w-3 h-3 text-blue-600" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-blue-600" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-slate-400" />
                            )
                          )}
                        </button>

                        {!sqlResult && (
                          <ExcelColumnMenu
                            title={`Filter & Sort: ${col.label}`}
                            compactIconOnly
                            colType={colType}
                            items={uniqueValuesByCol[col.name] || []}
                            selectedItems={colValueFilters[col.name]}
                            filterRule={colRuleFilters[col.name]}
                            sortDirection={
                              sortCol === col.name ? (sortAsc ? "asc" : "desc") : null
                            }
                            align={alignRight ? "right" : "left"}
                            formatItem={
                              colType === "numeric" && colFmt !== "number"
                                ? (v) => formatNumericValue(v, colFmt)
                                : undefined
                            }
                            onSort={(dir) => handleExcelSort(col.name, dir)}
                            onApply={(nextItems, nextRule) =>
                              handleExcelFilterApply(col.name, nextItems, nextRule)
                            }
                          />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(1, activeColumns.length + 1)}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No matching records found.{" "}
                    {!sqlResult && hasActiveFiltersOrSort && (
                      <button
                        type="button"
                        onClick={clearAllFiltersAndSort}
                        className="ml-2 text-blue-600 font-semibold hover:underline"
                      >
                        Clear Filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                activeRows.slice(0, 1000).map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-slate-400 border-r border-slate-100 text-center">
                      {rIdx + 1}
                    </td>
                    {activeColumns.map((col) => {
                      const val = (row as Record<string, unknown>)[col.name];
                      const isNum = typeof val === "number";
                      const fmt = colFormatMap[col.name] || "number";
                      return (
                        <td
                          key={col.name}
                          className={`px-3.5 py-2 text-slate-700 whitespace-nowrap border-r border-slate-100/70 ${
                            isNum ? "font-mono tabular-nums text-right" : ""
                          }`}
                        >
                          {val === null || val === undefined
                            ? "—"
                            : isNum
                            ? showRawSqlValues
                              ? String(val)
                              : formatNumericValue(val, fmt)
                            : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
