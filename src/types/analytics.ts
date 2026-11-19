export type ChartType = "bar" | "line" | "pie" | "area" | "scatter" | "horizontal_bar";

export type ChartColorTheme =
  | "multi"
  | "ocean"
  | "emerald"
  | "amber"
  | "indigo"
  | "rose"
  | "slate"
  | "custom";

export type ColumnNumberFormat =
  | "auto"
  | "number"
  | "inr"
  | "usd"
  | "eur"
  | "gbp"
  | "percent"
  | "hours"
  | "kg"
  | "compact";

export type ExcelFilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "begins_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "above_avg"
  | "below_avg"
  | "before"
  | "after";

export interface ColumnFilterRule {
  operator: ExcelFilterOperator;
  value?: string;
  value2?: string;
}

export interface ChartConfig {
  id: string;
  title: string;
  chartType: ChartType;
  xColumn: string;
  yColumn: string;
  yColumns?: string[];
  groupColumn?: string;
  groupMode?: "grouped" | "stacked" | "total";
  aggregation: "sum" | "avg" | "count" | "raw";
  reason?: string;
  colorTheme?: ChartColorTheme;
  customColor?: string;
  itemColors?: Record<string, string>;
  xSelectedItems?: string[];
  ySelectedItems?: string[];
  columnFilters?: Record<string, string[]>;
  xFormat?: ColumnNumberFormat;
  yFormat?: ColumnNumberFormat;
  swapAxes?: boolean;
  separateItems?: boolean;
  syncAxis?: boolean;
  hiddenSeries?: string[];
}

export interface CrossFilterSelection {
  sourceChartIndex: number;
  sourceChartTitle: string;
  column: string;
  columnLabel: string;
  value: string;
}

export type AnalysisMode = "analytical" | "inventory" | "text_notes";

export interface TextNoteEntry {
  item: string;
  column: string;
  value: string;
}

export interface ColumnProfile {
  name: string;
  label: string;
  type: "date" | "numeric" | "mixed" | "categorical";
  format?: ColumnNumberFormat;
  non_null: number;
  unique_count: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  median?: number | null;
  sum?: number | null;
  std_dev?: number | null;
  numeric_count?: number;
  text_count?: number;
}

export interface CleaningSummary {
  original_rows: number;
  cleaned_rows: number;
  duplicates_removed: number;
  empty_rows_removed: number;
  empty_cols_removed: number;
  values_normalized: number;
  missing_imputed: number;
  sorted_by: string | null;
  cleanliness_score: number;
  analysis_mode?: AnalysisMode;
  text_notes?: TextNoteEntry[];
  actions: string[];
}

export interface Dataset {
  id: string;
  name: string;
  sourceType: string;
  tableName: string;
  createdAt: string;
  folderId?: string | null;
  originalRowCount: number;
  rowCount: number;
  columnCount: number;
  cleanlinessScore: number;
  cleaningSummary: CleaningSummary;
  analysisMode?: AnalysisMode;
  textNotes?: TextNoteEntry[];
  columns: ColumnProfile[];
  charts: ChartConfig[];
  insights: string[];
  summaryText: string;
  rows?: Record<string, string | number | null>[];
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  datasetCount: number;
}

export type ComparisonPeriod = "all" | "weekly" | "monthly" | "yearly";

export interface FolderComparisonPoint {
  key: string;
  label: string;
  value: number;
  reportCount: number;
  reportNames: string[];
  changePct: number | null;
}

export interface FolderGrowthSummary {
  firstLabel: string;
  firstValue: number;
  latestLabel: string;
  latestValue: number;
  overallGrowthPct: number | null;
  latestChangePct: number | null;
  bestLabel: string;
  bestValue: number;
  periodCount: number;
}

export interface FolderFilterColumnOption {
  name: string;
  label: string;
  items: string[];
}

export interface FolderBreakdownSeries {
  name: string;
  valuesByPeriod: Record<string, number>;
}

export interface FolderComparisonResult {
  folder: Folder;
  datasets: Dataset[];
  period: ComparisonPeriod;
  availableMetrics: { name: string; label: string; format?: ColumnNumberFormat }[];
  selectedMetric: string;
  selectedMetricLabel: string;
  selectedMetricFormat?: ColumnNumberFormat;
  availableFilterColumns?: FolderFilterColumnOption[];
  selectedFilterCol?: string | null;
  selectedFilterValues?: string[];
  breakdownSeries?: FolderBreakdownSeries[];
  periodMultiMetricRows?: Record<string, string | number | null>[];
  itemMultiMetricRows?: Record<string, string | number | null>[];
  points: FolderComparisonPoint[];
  growthSummary: FolderGrowthSummary | null;
}

export interface AppSettings {
  auto_clean: string;
  auto_sort: string;
  max_charts: string;
  default_theme: string;
  language: string;
}

export interface UserProfile {
  name: string;
  email: string;
  role: string;
  organization: string;
  updated_at?: string;
}

export type NavSection =
  | "home"
  | "analysis"
  | "folder"
  | "recent"
  | "history"
  | "settings"
  | "profile";
