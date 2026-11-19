import type { ColumnNumberFormat } from "../types/analytics";

export const NUMBER_FORMAT_OPTIONS: { value: ColumnNumberFormat; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "inr", label: "₹ INR (Rupees)" },
  { value: "usd", label: "$ USD" },
  { value: "eur", label: "€ EUR" },
  { value: "gbp", label: "£ GBP" },
  { value: "percent", label: "% Percent" },
  { value: "hours", label: "hrs (Hours)" },
  { value: "kg", label: "kg" },
  { value: "compact", label: "Compact (K/L/Cr)" },
  { value: "number", label: "Plain Number" },
];

export function resolveEffectiveFormat(
  chartFmt?: ColumnNumberFormat,
  colFmt?: ColumnNumberFormat
): ColumnNumberFormat {
  if (chartFmt && chartFmt !== "auto") return chartFmt;
  if (colFmt && colFmt !== "auto") return colFmt;
  return "number";
}

export function formatNumericValue(
  val: number | string | null | undefined,
  fmt: ColumnNumberFormat = "number"
): string {
  if (val === null || val === undefined || val === "") return "—";
  const num = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(num)) return String(val);

  const isWhole = Math.abs(num - Math.round(num)) < 1e-6;
  const maxFrac = isWhole ? 0 : 2;

  switch (fmt) {
    case "inr": {
      const formatted = new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: maxFrac,
      }).format(num);
      return `₹${formatted}`;
    }
    case "usd": {
      const formatted = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: maxFrac,
      }).format(num);
      return `$${formatted}`;
    }
    case "eur": {
      const formatted = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: maxFrac,
      }).format(num);
      return `€${formatted}`;
    }
    case "gbp": {
      const formatted = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: maxFrac,
      }).format(num);
      return `£${formatted}`;
    }
    case "percent": {
      const formatted = num.toLocaleString(undefined, {
        maximumFractionDigits: maxFrac,
      });
      return `${formatted}%`;
    }
    case "hours": {
      const formatted = num.toLocaleString(undefined, {
        maximumFractionDigits: maxFrac,
      });
      return `${formatted} hrs`;
    }
    case "kg": {
      const formatted = num.toLocaleString(undefined, {
        maximumFractionDigits: maxFrac,
      });
      return `${formatted} kg`;
    }
    case "compact": {
      const abs = Math.abs(num);
      if (abs >= 1e7) return `${(num / 1e7).toFixed(2)} Cr`;
      if (abs >= 1e5) return `${(num / 1e5).toFixed(2)} L`;
      if (abs >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
      return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
    }
    default:
      return num.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
  }
}

export function getPlotlyAxisFormat(fmt: ColumnNumberFormat): {
  tickprefix: string;
  ticksuffix: string;
  hoverPrefix: string;
  hoverSuffix: string;
} {
  switch (fmt) {
    case "inr":
      return { tickprefix: "₹", ticksuffix: "", hoverPrefix: "₹", hoverSuffix: "" };
    case "usd":
      return { tickprefix: "$", ticksuffix: "", hoverPrefix: "$", hoverSuffix: "" };
    case "eur":
      return { tickprefix: "€", ticksuffix: "", hoverPrefix: "€", hoverSuffix: "" };
    case "gbp":
      return { tickprefix: "£", ticksuffix: "", hoverPrefix: "£", hoverSuffix: "" };
    case "percent":
      return { tickprefix: "", ticksuffix: "%", hoverPrefix: "", hoverSuffix: "%" };
    case "hours":
      return { tickprefix: "", ticksuffix: " hrs", hoverPrefix: "", hoverSuffix: " hrs" };
    case "kg":
      return { tickprefix: "", ticksuffix: " kg", hoverPrefix: "", hoverSuffix: " kg" };
    default:
      return { tickprefix: "", ticksuffix: "", hoverPrefix: "", hoverSuffix: "" };
  }
}
