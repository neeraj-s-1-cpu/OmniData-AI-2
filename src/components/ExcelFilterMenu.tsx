import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpAZ,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  Filter,
  FilterX,
  Search,
  X,
} from "lucide-react";
import type { ColumnFilterRule, ColumnProfile, ExcelFilterOperator } from "../types/analytics";

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

export function computeColumnNumericAverage(
  rows: Record<string, string | number | null>[],
  colName: string
): number | null {
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const raw = r[colName];
    const num =
      typeof raw === "number"
        ? raw
        : raw !== null && raw !== undefined && String(raw).trim() !== ""
        ? Number(String(raw).replace(/,/g, "").trim())
        : NaN;
    if (Number.isFinite(num)) {
      sum += num;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

function parseNumStrict(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const cleaned = String(val).replace(/[₹$€£,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDateMs(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateColumnFilterRule(
  rawVal: string | number | null | undefined,
  rule: ColumnFilterRule | undefined,
  colType: ColumnProfile["type"] | "mixed" | "categorical" | "numeric" | "date",
  columnAverage: number | null
): boolean {
  if (!rule) return true;
  const op = rule.operator;
  const v1 = (rule.value ?? "").trim();
  const v2 = (rule.value2 ?? "").trim();

  if (op === "above_avg" || op === "below_avg") {
    const cellNum = parseNumStrict(rawVal);
    if (cellNum === null || columnAverage === null) return false;
    return op === "above_avg" ? cellNum > columnAverage : cellNum < columnAverage;
  }

  // Require an input value for value-based rules
  if (!v1 && op !== "between") return true;

  if (colType === "numeric" || (colType === "mixed" && ["gt", "gte", "lt", "lte", "between"].includes(op))) {
    const cellNum = parseNumStrict(rawVal);
    const n1 = parseNumStrict(v1);
    const n2 = parseNumStrict(v2);

    if (op === "equals" && n1 !== null && cellNum !== null) return cellNum === n1;
    if (op === "not_equals" && n1 !== null && cellNum !== null) return cellNum !== n1;
    if (op === "gt") return cellNum !== null && n1 !== null && cellNum > n1;
    if (op === "gte") return cellNum !== null && n1 !== null && cellNum >= n1;
    if (op === "lt") return cellNum !== null && n1 !== null && cellNum < n1;
    if (op === "lte") return cellNum !== null && n1 !== null && cellNum <= n1;
    if (op === "between") {
      if (cellNum === null || n1 === null || n2 === null) return false;
      const lo = Math.min(n1, n2);
      const hi = Math.max(n1, n2);
      return cellNum >= lo && cellNum <= hi;
    }
  }

  if (colType === "date" && ["equals", "before", "after", "between"].includes(op)) {
    const cellMs = parseDateMs(rawVal);
    const d1 = parseDateMs(v1);
    const d2 = parseDateMs(v2);
    if (cellMs === null || d1 === null) return false;
    if (op === "equals") {
      return new Date(cellMs).toDateString() === new Date(d1).toDateString();
    }
    if (op === "before") return cellMs < d1;
    if (op === "after") return cellMs > d1;
    if (op === "between") {
      if (d2 === null) return false;
      return cellMs >= Math.min(d1, d2) && cellMs <= Math.max(d1, d2);
    }
  }

  // Fallback string/text rule comparison
  const cellText = rawVal === null || rawVal === undefined ? "" : String(rawVal).trim().toLowerCase();
  const target = v1.toLowerCase();

  switch (op) {
    case "equals":
      return cellText === target;
    case "not_equals":
      return cellText !== target;
    case "contains":
      return cellText.includes(target);
    case "not_contains":
      return !cellText.includes(target);
    case "begins_with":
      return cellText.startsWith(target);
    case "ends_with":
      return cellText.endsWith(target);
    case "gt":
      return cellText > target;
    case "gte":
      return cellText >= target;
    case "lt":
      return cellText < target;
    case "lte":
      return cellText <= target;
    default:
      return true;
  }
}

const NUMERIC_OPERATORS: { value: ExcelFilterOperator; label: string; needsTwo?: boolean; noInput?: boolean }[] = [
  { value: "equals", label: "Equals..." },
  { value: "not_equals", label: "Does Not Equal..." },
  { value: "gt", label: "Greater Than..." },
  { value: "gte", label: "Greater Than Or Equal To..." },
  { value: "lt", label: "Less Than..." },
  { value: "lte", label: "Less Than Or Equal To..." },
  { value: "between", label: "Between...", needsTwo: true },
  { value: "above_avg", label: "Above Average", noInput: true },
  { value: "below_avg", label: "Below Average", noInput: true },
];

const TEXT_OPERATORS: { value: ExcelFilterOperator; label: string; needsTwo?: boolean; noInput?: boolean }[] = [
  { value: "contains", label: "Contains..." },
  { value: "not_contains", label: "Does Not Contain..." },
  { value: "equals", label: "Equals..." },
  { value: "not_equals", label: "Does Not Equal..." },
  { value: "begins_with", label: "Begins With..." },
  { value: "ends_with", label: "Ends With..." },
];

const DATE_OPERATORS: { value: ExcelFilterOperator; label: string; needsTwo?: boolean; noInput?: boolean }[] = [
  { value: "equals", label: "Equals Date..." },
  { value: "before", label: "Before..." },
  { value: "after", label: "After..." },
  { value: "between", label: "Between Dates...", needsTwo: true },
];

export function describeFilterRule(rule?: ColumnFilterRule): string {
  if (!rule) return "";
  switch (rule.operator) {
    case "equals":
      return `= ${rule.value ?? ""}`;
    case "not_equals":
      return `≠ ${rule.value ?? ""}`;
    case "contains":
      return `contains "${rule.value ?? ""}"`;
    case "not_contains":
      return `!contains "${rule.value ?? ""}"`;
    case "begins_with":
      return `starts "${rule.value ?? ""}"`;
    case "ends_with":
      return `ends "${rule.value ?? ""}"`;
    case "gt":
      return `> ${rule.value ?? ""}`;
    case "gte":
      return `≥ ${rule.value ?? ""}`;
    case "lt":
      return `< ${rule.value ?? ""}`;
    case "lte":
      return `≤ ${rule.value ?? ""}`;
    case "between":
      return `${rule.value ?? ""} – ${rule.value2 ?? ""}`;
    case "above_avg":
      return "> Avg";
    case "below_avg":
      return "< Avg";
    case "before":
      return `< ${rule.value ?? ""}`;
    case "after":
      return `> ${rule.value ?? ""}`;
    default:
      return "";
  }
}

export interface ExcelColumnMenuProps {
  title: string;
  buttonText?: string;
  compactIconOnly?: boolean;
  colType?: ColumnProfile["type"];
  items: string[];
  selectedItems: string[] | undefined;
  filterRule?: ColumnFilterRule;
  sortDirection?: "asc" | "desc" | null;
  align?: "left" | "right";
  formatItem?: (item: string) => string;
  onApply: (nextItems: string[] | undefined, nextRule?: ColumnFilterRule | undefined) => void;
  onSort?: (direction: "asc" | "desc" | null) => void;
}

export const ExcelColumnMenu: React.FC<ExcelColumnMenuProps> = ({
  title,
  buttonText,
  compactIconOnly = false,
  colType = "categorical",
  items,
  selectedItems,
  filterRule,
  sortDirection = null,
  align = "left",
  formatItem,
  onApply,
  onSort,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set(items));
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleOp, setRuleOp] = useState<ExcelFilterOperator>(
    colType === "numeric" ? "gt" : colType === "date" ? "after" : "contains"
  );
  const [ruleVal1, setRuleVal1] = useState("");
  const [ruleVal2, setRuleVal2] = useState("");
  const [ruleCleared, setRuleCleared] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const operators = useMemo(() => {
    if (colType === "numeric") return NUMERIC_OPERATORS;
    if (colType === "date") return DATE_OPERATORS;
    return TEXT_OPERATORS;
  }, [colType]);

  const ruleSectionLabel =
    colType === "numeric"
      ? "Number Filters"
      : colType === "date"
      ? "Date Filters"
      : "Text Filters";

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selectedItems ?? items));
    setSearch("");
    setRuleCleared(false);
    if (filterRule) {
      setRuleOpen(true);
      setRuleOp(filterRule.operator);
      setRuleVal1(filterRule.value ?? "");
      setRuleVal2(filterRule.value2 ?? "");
    } else {
      setRuleOpen(false);
      setRuleOp(colType === "numeric" ? "gt" : colType === "date" ? "after" : "contains");
      setRuleVal1("");
      setRuleVal2("");
    }
  }, [open, items, selectedItems, filterRule, colType]);

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

  const currentOpMeta = operators.find((o) => o.value === ruleOp) || operators[0];

  const handleApply = () => {
    const chosen = items.filter((it) => draft.has(it));
    const nextItems = chosen.length === items.length ? undefined : chosen;

    let nextRule: ColumnFilterRule | undefined = undefined;
    if (!ruleCleared && ruleOpen) {
      if (currentOpMeta?.noInput) {
        nextRule = { operator: ruleOp };
      } else if (currentOpMeta?.needsTwo) {
        if (ruleVal1.trim() !== "" && ruleVal2.trim() !== "") {
          nextRule = {
            operator: ruleOp,
            value: ruleVal1.trim(),
            value2: ruleVal2.trim(),
          };
        }
      } else if (ruleVal1.trim() !== "") {
        nextRule = { operator: ruleOp, value: ruleVal1.trim() };
      }
    }

    onApply(nextItems, nextRule);
    setOpen(false);
  };

  const handleClearFilter = () => {
    onApply(undefined, undefined);
    setOpen(false);
  };

  const isFiltered = selectedItems !== undefined || Boolean(filterRule);
  const sortAscLabel =
    colType === "numeric"
      ? "Sort Smallest to Largest"
      : colType === "date"
      ? "Sort Oldest to Newest"
      : "Sort A to Z";
  const sortDescLabel =
    colType === "numeric"
      ? "Sort Largest to Smallest"
      : colType === "date"
      ? "Sort Newest to Oldest"
      : "Sort Z to A";

  return (
    <div ref={rootRef} className="relative inline-block">
      {compactIconOnly ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-expanded={open}
          aria-label={title}
          title={title}
          className={`inline-flex items-center justify-center rounded border p-1 transition-colors ${
            isFiltered || sortDirection
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-slate-900"
          }`}
        >
          {isFiltered ? (
            <Filter className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={items.length === 0 && !onSort}
          aria-expanded={open}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap disabled:opacity-45 ${
            isFiltered || sortDirection
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-blue-400 hover:text-slate-900"
          }`}
        >
          <Filter className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[140px]">
            {buttonText || "All"}
            {filterRule ? ` · ${describeFilterRule(filterRule)}` : ""}
          </span>
          <ChevronDown className="w-3 h-3 shrink-0" />
        </button>
      )}

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-2xl p-2.5 text-xs text-slate-800`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-100">
            <span className="font-semibold text-slate-900 text-[11px] truncate">
              {title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Close Excel menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Excel Sort Actions */}
          {onSort && (
            <div className="space-y-0.5 pb-2 mb-2 border-b border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onSort("asc");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-left transition-colors ${
                  sortDirection === "asc"
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {colType === "numeric" ? (
                  <ArrowUpNarrowWide className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                ) : (
                  <ArrowUpAZ className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                )}
                <span>{sortAscLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSort("desc");
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-left transition-colors ${
                  sortDirection === "desc"
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {colType === "numeric" ? (
                  <ArrowDownWideNarrow className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                ) : (
                  <ArrowDownAZ className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                )}
                <span>{sortDescLabel}</span>
              </button>
              {sortDirection && (
                <button
                  type="button"
                  onClick={() => {
                    onSort(null);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 text-left"
                >
                  <X className="w-3.5 h-3.5 shrink-0" />
                  <span>Clear Sort</span>
                </button>
              )}
            </div>
          )}

          {/* Clear Filter from Column */}
          {isFiltered && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 mb-2 text-[11px] font-medium text-blue-700 bg-blue-50/70 hover:bg-blue-100 text-left"
            >
              <FilterX className="w-3.5 h-3.5 shrink-0" />
              <span>Clear Filter from Column</span>
            </button>
          )}

          {/* Excel Condition Rule Section (Number / Text / Date Filters) */}
          <div className="pb-2 mb-2 border-b border-slate-100">
            <button
              type="button"
              onClick={() => {
                setRuleCleared(false);
                setRuleOpen((v) => !v);
              }}
              className={`w-full flex items-center justify-between rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                ruleOpen || filterRule
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{ruleSectionLabel}</span>
              <ChevronRight
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                  ruleOpen ? "rotate-90" : ""
                }`}
              />
            </button>

            {ruleOpen && (
              <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1.5">
                <select
                  aria-label="Filter rule operator"
                  value={ruleOp}
                  onChange={(e) => {
                    setRuleCleared(false);
                    setRuleOp(e.target.value as ExcelFilterOperator);
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  {operators.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {!currentOpMeta?.noInput && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type={colType === "date" ? "date" : "text"}
                      value={ruleVal1}
                      onChange={(e) => {
                        setRuleCleared(false);
                        setRuleVal1(e.target.value);
                      }}
                      placeholder={
                        currentOpMeta?.needsTwo ? "Min / From..." : "Enter value..."
                      }
                      className="flex-1 min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                    {currentOpMeta?.needsTwo && (
                      <input
                        type={colType === "date" ? "date" : "text"}
                        value={ruleVal2}
                        onChange={(e) => {
                          setRuleCleared(false);
                          setRuleVal2(e.target.value);
                        }}
                        placeholder="Max / To..."
                        className="flex-1 min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800 focus:border-blue-500 focus:outline-none"
                      />
                    )}
                  </div>
                )}

                {filterRule && (
                  <button
                    type="button"
                    onClick={() => {
                      setRuleCleared(true);
                      setRuleOpen(false);
                      setRuleVal1("");
                      setRuleVal2("");
                    }}
                    className="text-[10px] font-medium text-rose-600 hover:underline"
                  >
                    Remove condition rule
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Search box */}
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

          {/* (Select All) Checkbox */}
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

          {/* Checklist */}
          <div className="max-h-44 overflow-y-auto space-y-0.5 pr-0.5">
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

          {/* Footer Buttons */}
          <div className="flex items-center justify-between gap-1.5 pt-2 mt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleClearFilter}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
            >
              Select All
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="rounded-md bg-[#1E88E5] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1976D2]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
