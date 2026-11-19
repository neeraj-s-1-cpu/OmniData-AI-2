#!/usr/bin/env python3
"""
Omni Data AI — Python + SQLite Data Cleaning, Profiling, Sorting,
Chart Recommendation, and Quantitative Insight Engine.
"""

import json
import math
import os
import re
import sqlite3
import statistics
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


MONTH_ORDER = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}

NULL_MARKERS = {"", "na", "n/a", "null", "none", "nan", "nil", "-", "--", "undefined", "missing"}


def get_conn(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS datasets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            table_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            original_row_count INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            column_count INTEGER NOT NULL,
            cleanliness_score REAL NOT NULL,
            cleaning_summary_json TEXT NOT NULL,
            columns_json TEXT NOT NULL,
            charts_json TEXT NOT NULL,
            insights_json TEXT NOT NULL,
            summary_text TEXT NOT NULL,
            folder_id TEXT
        )
        """
    )
    # Safe migration if datasets table already existed without folder_id
    cur.execute("PRAGMA table_info(datasets)")
    existing_cols = {r[1] for r in cur.fetchall()}
    if "folder_id" not in existing_cols:
        cur.execute("ALTER TABLE datasets ADD COLUMN folder_id TEXT")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL,
            organization TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    # Seed default profile if missing
    cur.execute("SELECT COUNT(*) FROM user_profile WHERE id = 1")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO user_profile (id, name, email, role, organization, updated_at)
            VALUES (1, 'User', 'analyst@omnidata.ai', 'Data Analyst', 'Omni Workspace', ?)
            """,
            (datetime.utcnow().isoformat() + "Z",),
        )
    # Seed default settings if missing
    defaults = {
        "auto_clean": "true",
        "auto_sort": "true",
        "max_charts": "2",
        "default_theme": "light",
        "language": "auto",
    }
    for k, v in defaults.items():
        cur.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", (k, v))
    conn.commit()


def sanitize_identifier(name: str, fallback: str = "col") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", str(name or "").strip()).strip("_").lower()
    if not cleaned:
        cleaned = fallback
    if cleaned[0].isdigit():
        cleaned = "c_" + cleaned
    return cleaned[:48]


def prettify_label(name: str) -> str:
    s = str(name or "").strip()
    if not s:
        return "Column"
    s = re.sub(r"[_]+", " ", s)
    return " ".join(w.capitalize() if w.islower() else w for w in s.split())


def is_null_value(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, float) and math.isnan(val):
        return True
    s = str(val).strip().lower()
    return s in NULL_MARKERS


def try_parse_number(val: Any) -> Optional[float]:
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        if math.isnan(val) or math.isinf(val):
            return None
        return float(val)
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in NULL_MARKERS:
        return None

    # Convert Devanagari digits (०-९) to ASCII (0-9)
    s = s.translate(str.maketrans("०१२३४५६७८९", "0123456789"))

    # Handle parentheses negative: (1,234.50) -> -1234.50
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1].strip()

    # Strip currency symbols, Rs./INR/-, commas, spaces, percent
    s_clean = re.sub(r"(?:rs\.?|inr|rupees|/-)", "", s, flags=re.IGNORECASE)
    s_clean = re.sub(r"[$€£¥₹,\s%]", "", s_clean)
    # Handle suffix k / m / b only if strictly numeric before it
    mult = 1.0
    m = re.match(r"^([+-]?\d+(?:\.\d+)?)([kKmMbB])$", s_clean)
    if m:
        s_clean = m.group(1)
        suf = m.group(2).lower()
        mult = {"k": 1e3, "m": 1e6, "b": 1e9}[suf]

    if re.match(r"^[+-]?\d+(?:\.\d+)?$", s_clean):
        try:
            num = float(s_clean) * mult
            return -num if neg else num
        except ValueError:
            return None
    return None


def try_parse_date_sort_key(val: Any) -> Optional[Tuple[int, str]]:
    """
    Returns (sortable_int, normalized_display_str) if val looks like a date,
    month, or quarter; otherwise None.
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in NULL_MARKERS:
        return None

    # Pure 4-digit year (1900..2100)
    if re.match(r"^(19|20)\d{2}$", s):
        y = int(s)
        return (y * 10000 + 101, s)

    # Quarter e.g. Q1 2025 or 2025-Q1 or Q1
    qm = re.match(r"^[Qq]([1-4])[\s\-_/]*((?:19|20)\d{2})?$", s)
    if qm:
        q = int(qm.group(1))
        y = int(qm.group(2)) if qm.group(2) else 2000
        return (y * 10000 + q * 300, f"Q{q} {qm.group(2)}" if qm.group(2) else f"Q{q}")

    qm2 = re.match(r"^((?:19|20)\d{2})[\s\-_/]*[Qq]([1-4])$", s)
    if qm2:
        y = int(qm2.group(1))
        q = int(qm2.group(2))
        return (y * 10000 + q * 300, f"{y}-Q{q}")

    # Month name alone or with year: "Jan", "January 2024", "Feb-24"
    low = s.lower().replace(",", " ").strip()
    parts = re.split(r"[\s\-_/]+", low)
    if len(parts) == 1 and parts[0] in MONTH_ORDER:
        m = MONTH_ORDER[parts[0]]
        return (2000 * 10000 + m * 100 + 1, s.capitalize())
    if len(parts) == 2 and parts[0] in MONTH_ORDER and re.match(r"^\d{2,4}$", parts[1]):
        m = MONTH_ORDER[parts[0]]
        y = int(parts[1])
        if y < 100:
            y += 2000
        return (y * 10000 + m * 100 + 1, f"{parts[0].capitalize()[:3]} {y}")

    # Standard date formats
    date_formats = [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%m-%d-%Y",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%d/%m/%y",
        "%m-%d-%y",
        "%d-%m-%y",
        "%Y-%m",
        "%Y/%m",
        "%b %d %Y",
        "%B %d %Y",
        "%d %b %Y",
        "%d %B %Y",
    ]
    s_norm = re.sub(r"T\d{2}:\d{2}.*$", "", s).replace(",", "").strip()
    for fmt in date_formats:
        try:
            dt = datetime.strptime(s_norm, fmt)
            key = dt.year * 10000 + dt.month * 100 + dt.day
            disp = dt.strftime("%Y-%m-%d") if "%d" in fmt else dt.strftime("%Y-%m")
            return (key, disp)
        except ValueError:
            continue

    return None


INVENTORY_LABEL_TOKENS = {
    "item", "items", "product", "products", "material", "materials",
    "goods", "part", "parts", "piece", "pieces", "pcs", "pc",
    "qty", "quantity", "quantities", "nos", "box", "boxes",
    "packet", "packets", "pack", "packs", "stock", "stocks",
    "unit", "units", "saman", "nag", "count",
}

QUANTITY_COL_TOKENS = {
    "piece", "pieces", "pcs", "pc", "qty", "quantity", "quantities",
    "nos", "box", "boxes", "packet", "packets", "pack", "packs",
    "stock", "stocks", "unit", "units", "nag", "count",
}

NOTE_COL_TOKENS = {
    "note", "notes", "remark", "remarks", "status", "comment",
    "comments", "detail", "details", "description", "info", "message",
}

FINANCIAL_OR_ANALYTICAL_TOKENS = {
    "price", "rate", "cost", "amount", "revenue", "sales", "sale",
    "profit", "loss", "expense", "expenses", "rs", "inr", "usd", "eur",
    "salary", "income", "budget", "margin", "tax", "gst", "discount",
    "total_amount", "grand_total", "fee", "fees", "bill", "payment",
    "score", "marks", "rating", "percentage", "pct", "ratio", "kpi",
    "weight", "height", "temperature", "temp", "age", "duration",
    "distance", "speed", "date", "month", "year", "quarter", "time",
}


def _header_tokens(col_name: str, col_label: str) -> set:
    joined = f"{col_name} {col_label}".lower()
    return {t for t in re.split(r"[^a-z0-9]+", joined) if t}


def detect_column_format(col_name: str, col_label: str, raw_values: List[Any]) -> str:
    """
    Detects display format ('inr', 'usd', 'eur', 'gbp', 'percent', 'hours', 'kg', 'number')
    from raw cell strings and column headers before stripping currency/unit symbols.
    """
    sample_strs = [str(v).strip() for v in raw_values[:100] if v is not None]
    joined = " ".join(sample_strs)
    toks = _header_tokens(col_name, col_label)

    if "₹" in joined or re.search(r"\b(?:rs\.?|inr|rupees?)\b", joined, re.IGNORECASE) or (toks & {"rs", "inr", "rupee", "rupees"}):
        return "inr"
    if "$" in joined or re.search(r"\busd\b", joined, re.IGNORECASE) or (toks & {"usd", "dollar", "dollars"}):
        return "usd"
    if "€" in joined or re.search(r"\beur\b", joined, re.IGNORECASE) or (toks & {"eur", "euro", "euros"}):
        return "eur"
    if "£" in joined or re.search(r"\bgbp\b", joined, re.IGNORECASE) or (toks & {"gbp", "pound", "pounds"}):
        return "gbp"
    if "%" in joined or (toks & {"percent", "percentage", "pct", "satisfaction"}):
        return "percent"
    if re.search(r"\b(?:hrs?|hours?)\b", joined, re.IGNORECASE) or (toks & {"hr", "hrs", "hour", "hours"}):
        return "hours"
    if re.search(r"\bkgs?\b", joined, re.IGNORECASE) or (toks & {"kg", "kgs", "kilogram"}):
        return "kg"
    return "number"


def detect_analysis_mode(
    columns: List[Dict[str, Any]],
    rows: List[Dict[str, Any]],
) -> str:
    """
    Observes column headings and cell composition to classify dataset into:
    - 'inventory': simple item + piece/qty lists where statistical calculations shouldn't run
    - 'text_notes': word/sentence entries without numeric metrics or meaningful category repeats
    - 'analytical': standard quantitative/financial/time-series reporting
    """
    if not columns or not rows:
        return "analytical"

    all_tokens = set()
    has_quantity_col = False
    has_item_col = False
    has_financial_col = False

    for c in columns:
        toks = _header_tokens(c.get("name", ""), c.get("label", ""))
        all_tokens |= toks
        if toks & QUANTITY_COL_TOKENS:
            has_quantity_col = True
        if toks & (INVENTORY_LABEL_TOKENS - QUANTITY_COL_TOKENS):
            has_item_col = True
        if toks & FINANCIAL_OR_ANALYTICAL_TOKENS:
            has_financial_col = True

    date_cols = [c for c in columns if c.get("type") == "date" and c.get("unique_count", 0) >= 2]
    num_cols = [c for c in columns if c.get("type") == "numeric"]
    mixed_cols = [c for c in columns if c.get("type") == "mixed"]
    cat_cols = [c for c in columns if c.get("type") == "categorical"]

    # If headings clearly look like an item + piece/qty list without financial/time-series columns
    if not has_financial_col and not date_cols:
        if has_quantity_col or (has_item_col and (num_cols or mixed_cols)):
            return "inventory"

    # If there are NO numeric or mixed columns at all, check if rows are unique text/sentences
    if not num_cols and not mixed_cols and cat_cols:
        # Check if any categorical column has meaningful repeated groups (count >= 2 for most rows)
        has_repeated_groups = any(
            c.get("unique_count", 0) >= 2
            and c.get("unique_count", 0) <= max(2, len(rows) // 2)
            for c in cat_cols
        )
        if not has_repeated_groups or has_item_col or has_quantity_col or bool(all_tokens & NOTE_COL_TOKENS):
            return "text_notes"

    return "analytical"


def extract_text_notes(
    rows: List[Dict[str, Any]],
    columns: List[Dict[str, Any]],
    analysis_mode: str,
) -> List[Dict[str, str]]:
    """
    Collects exact words or sentences present in value/mixed/text columns so
    they are printed verbatim instead of being erased or counted as '1 times'.
    """
    if not rows or not columns:
        return []

    label_col = next(
        (c for c in columns if c.get("type") in ("categorical", "date")),
        None,
    )
    mixed_cols = [c for c in columns if c.get("type") == "mixed"]
    num_cols = [c for c in columns if c.get("type") == "numeric"]
    notes: List[Dict[str, str]] = []
    seen = set()

    # 1. Any word/sentence sitting inside a mixed numeric+text column
    for mc in mixed_cols:
        for idx, row in enumerate(rows):
            val = row.get(mc["name"])
            if val is not None and str(val).strip() != "" and try_parse_number(val) is None:
                item_name = (
                    str(row.get(label_col["name"])).strip()
                    if (label_col and row.get(label_col["name"]) is not None and label_col["name"] != mc["name"])
                    else f"Row {idx + 1}"
                )
                entry = {
                    "item": item_name,
                    "column": mc["label"],
                    "value": str(val).strip(),
                }
                sig = (entry["item"], entry["column"], entry["value"])
                if sig not in seen:
                    seen.add(sig)
                    notes.append(entry)

    # 2. Value/note/piece columns typed categorical in inventory or text_notes mode
    if analysis_mode in ("inventory", "text_notes"):
        value_cat_cols: List[Dict[str, Any]] = []
        for c in columns:
            if c.get("type") != "categorical":
                continue
            if label_col and c["name"] == label_col["name"] and len(columns) > 1:
                continue
            toks = _header_tokens(c.get("name", ""), c.get("label", ""))
            if (toks & (QUANTITY_COL_TOKENS | NOTE_COL_TOKENS)) or (not num_cols and not mixed_cols):
                value_cat_cols.append(c)

        # Single-column word/sentence list
        if not value_cat_cols and len(columns) == 1 and columns[0].get("type") == "categorical":
            c0 = columns[0]
            for idx, row in enumerate(rows):
                val = row.get(c0["name"])
                if val is not None and str(val).strip() != "" and try_parse_number(val) is None:
                    entry = {
                        "item": f"Entry {idx + 1}",
                        "column": c0["label"],
                        "value": str(val).strip(),
                    }
                    sig = (entry["item"], entry["column"], entry["value"])
                    if sig not in seen:
                        seen.add(sig)
                        notes.append(entry)
        else:
            for cc in value_cat_cols:
                for idx, row in enumerate(rows):
                    val = row.get(cc["name"])
                    if val is not None and str(val).strip() != "" and try_parse_number(val) is None:
                        item_name = (
                            str(row.get(label_col["name"])).strip()
                            if (label_col and row.get(label_col["name"]) is not None)
                            else f"Row {idx + 1}"
                        )
                        entry = {
                            "item": item_name,
                            "column": cc["label"],
                            "value": str(val).strip(),
                        }
                        sig = (entry["item"], entry["column"], entry["value"])
                        if sig not in seen:
                            seen.add(sig)
                            notes.append(entry)

    return notes


def clean_and_profile(
    raw_rows: List[Dict[str, Any]],
    auto_clean: bool = True,
    auto_sort: bool = True,
) -> Dict[str, Any]:
    if not raw_rows:
        return {
            "rows": [],
            "columns": [],
            "cleaning_summary": {
                "original_rows": 0,
                "cleaned_rows": 0,
                "duplicates_removed": 0,
                "empty_rows_removed": 0,
                "empty_cols_removed": 0,
                "values_normalized": 0,
                "missing_imputed": 0,
                "sorted_by": None,
                "cleanliness_score": 100.0,
                "analysis_mode": "analytical",
                "text_notes": [],
                "actions": [],
            },
        }

    original_row_count = len(raw_rows)

    # Collect union of keys preserving appearance order
    raw_keys: List[str] = []
    seen_keys = set()
    for r in raw_rows:
        if isinstance(r, dict):
            for k in r.keys():
                ks = str(k).strip()
                if ks not in seen_keys:
                    seen_keys.add(ks)
                    raw_keys.append(ks)

    # Build unique SQL-safe column names + human labels
    col_map: List[Dict[str, str]] = []
    used_sql_names = set()
    for idx, rk in enumerate(raw_keys):
        sql_name = sanitize_identifier(rk, f"col_{idx+1}")
        base = sql_name
        counter = 2
        while sql_name in used_sql_names:
            sql_name = f"{base}_{counter}"
            counter += 1
        used_sql_names.add(sql_name)
        col_map.append({"raw": rk, "sql": sql_name, "label": prettify_label(rk)})

    # Step 1: Trim whitespace, normalize nulls, drop completely empty rows
    empty_rows_removed = 0
    normalized_rows: List[Dict[str, Any]] = []
    values_normalized = 0

    for r in raw_rows:
        if not isinstance(r, dict):
            empty_rows_removed += 1
            continue
        cleaned_row: Dict[str, Any] = {}
        non_null_count = 0
        for cm in col_map:
            raw_val = r.get(cm["raw"])
            if is_null_value(raw_val):
                if raw_val is not None and str(raw_val).strip() != "":
                    values_normalized += 1
                cleaned_row[cm["sql"]] = None
            else:
                if isinstance(raw_val, str):
                    trimmed = re.sub(r"\s+", " ", raw_val.strip())
                    if trimmed != raw_val:
                        values_normalized += 1
                    cleaned_row[cm["sql"]] = trimmed
                else:
                    cleaned_row[cm["sql"]] = raw_val
                non_null_count += 1
        if non_null_count == 0:
            empty_rows_removed += 1
        else:
            normalized_rows.append(cleaned_row)

    # Step 2: Drop completely empty columns (or >95% empty when multiple cols exist)
    empty_cols_removed = 0
    kept_cols: List[Dict[str, str]] = []
    if normalized_rows and len(col_map) > 1:
        total_n = len(normalized_rows)
        for cm in col_map:
            nn = sum(1 for row in normalized_rows if row.get(cm["sql"]) is not None)
            if nn == 0:
                empty_cols_removed += 1
            else:
                kept_cols.append(cm)
        if not kept_cols:
            kept_cols = col_map
    else:
        kept_cols = col_map

    kept_sql_set = {cm["sql"] for cm in kept_cols}
    if len(kept_sql_set) < len(col_map):
        normalized_rows = [
            {k: v for k, v in row.items() if k in kept_sql_set}
            for row in normalized_rows
        ]

    # Step 3: Remove exact duplicate rows (when auto_clean is enabled)
    duplicates_removed = 0
    if auto_clean and normalized_rows:
        deduped: List[Dict[str, Any]] = []
        seen_sigs = set()
        for row in normalized_rows:
            sig = tuple((cm["sql"], str(row.get(cm["sql"]))) for cm in kept_cols)
            if sig in seen_sigs:
                duplicates_removed += 1
            else:
                seen_sigs.add(sig)
                deduped.append(row)
        normalized_rows = deduped

    # Step 4: Filter out obvious summary/Total footer rows if dataset has >= 4 rows
    summary_rows_removed = 0
    if auto_clean and len(normalized_rows) >= 4:
        first_col = kept_cols[0]["sql"]
        filtered: List[Dict[str, Any]] = []
        for row in normalized_rows:
            v = str(row.get(first_col) or "").strip().lower()
            if re.match(r"^(grand\s+total|total|subtotal|sum)$", v):
                summary_rows_removed += 1
            else:
                filtered.append(row)
        if filtered:
            normalized_rows = filtered

    # Step 5: Infer column types & coerce values
    total_cells = max(1, len(normalized_rows) * max(1, len(kept_cols)))
    missing_before_imputation = 0
    missing_imputed = 0
    column_profiles: List[Dict[str, Any]] = []

    date_sort_keys: Dict[str, List[Optional[int]]] = {}

    for cm in kept_cols:
        sql_col = cm["sql"]
        vals = [row.get(sql_col) for row in normalized_rows]
        non_nulls = [v for v in vals if v is not None]
        missing_before_imputation += len(vals) - len(non_nulls)

        num_parsed = [try_parse_number(v) for v in non_nulls]
        num_valid = [x for x in num_parsed if x is not None]

        date_parsed = [try_parse_date_sort_key(v) for v in non_nulls]
        date_valid = [x for x in date_parsed if x is not None]

        toks = _header_tokens(sql_col, cm["label"])
        is_qty_or_metric_header = bool(toks & (QUANTITY_COL_TOKENS | FINANCIAL_OR_ANALYTICAL_TOKENS))
        is_financial_header = bool(toks & FINANCIAL_OR_ANALYTICAL_TOKENS)

        col_type = "categorical"
        if non_nulls:
            # Prefer date if >= 70% parse as date/month/quarter
            if len(date_valid) / len(non_nulls) >= 0.7:
                col_type = "date"
            elif len(num_valid) == len(non_nulls):
                col_type = "numeric"
            elif num_valid:
                text_non_num_count = len(non_nulls) - len(num_valid)
                num_ratio = len(num_valid) / len(non_nulls)
                # Mixed column: preserves BOTH numbers and words/sentences verbatim
                if num_ratio >= 0.35 or (is_qty_or_metric_header and text_non_num_count > 0):
                    col_type = "mixed"

        if col_type == "numeric":
            # Coerce all numeric values cleanly
            coerced_nums: List[Optional[float]] = []
            for row in normalized_rows:
                raw_v = row.get(sql_col)
                parsed = try_parse_number(raw_v)
                if raw_v is not None and parsed is not None and str(raw_v) != str(parsed):
                    values_normalized += 1
                if parsed is not None and parsed.is_integer():
                    row[sql_col] = int(parsed)
                else:
                    row[sql_col] = round(parsed, 4) if parsed is not None else None
                if parsed is not None:
                    coerced_nums.append(parsed)

            # Impute sparse missing numeric cells ONLY for true analytical/financial cols (never for Piece/Qty inventory)
            if (
                auto_clean
                and coerced_nums
                and len(coerced_nums) < len(normalized_rows)
                and (is_financial_header or not (toks & QUANTITY_COL_TOKENS))
            ):
                missing_ratio = 1.0 - (len(coerced_nums) / len(normalized_rows))
                if missing_ratio <= 0.4:
                    med = statistics.median(coerced_nums)
                    med_clean = int(med) if float(med).is_integer() else round(med, 4)
                    for row in normalized_rows:
                        if row.get(sql_col) is None:
                            row[sql_col] = med_clean
                            missing_imputed += 1
                            coerced_nums.append(float(med_clean))

            stats_obj = {
                "min": round(min(coerced_nums), 4) if coerced_nums else None,
                "max": round(max(coerced_nums), 4) if coerced_nums else None,
                "mean": round(statistics.mean(coerced_nums), 4) if coerced_nums else None,
                "median": round(statistics.median(coerced_nums), 4) if coerced_nums else None,
                "sum": round(sum(coerced_nums), 4) if coerced_nums else None,
                "std_dev": round(statistics.pstdev(coerced_nums), 4) if len(coerced_nums) > 1 else 0.0,
            }
        elif col_type == "mixed":
            # Preserve BOTH parsed numeric entries AND non-numeric words/sentences verbatim!
            coerced_nums = []
            text_entries_count = 0
            for row in normalized_rows:
                raw_v = row.get(sql_col)
                if raw_v is None:
                    continue
                parsed = try_parse_number(raw_v)
                if parsed is not None:
                    if str(raw_v) != str(parsed):
                        values_normalized += 1
                    row[sql_col] = int(parsed) if parsed.is_integer() else round(parsed, 4)
                    coerced_nums.append(parsed)
                else:
                    # Keep the user's exact word or sentence untouched
                    row[sql_col] = str(raw_v)
                    text_entries_count += 1

            stats_obj = {
                "min": round(min(coerced_nums), 4) if coerced_nums else None,
                "max": round(max(coerced_nums), 4) if coerced_nums else None,
                "mean": round(statistics.mean(coerced_nums), 4) if coerced_nums else None,
                "median": round(statistics.median(coerced_nums), 4) if coerced_nums else None,
                "sum": round(sum(coerced_nums), 4) if coerced_nums else None,
                "std_dev": round(statistics.pstdev(coerced_nums), 4) if len(coerced_nums) > 1 else 0.0,
                "numeric_count": len(coerced_nums),
                "text_count": text_entries_count,
            }
        elif col_type == "date":
            keys_for_rows: List[Optional[int]] = []
            for row in normalized_rows:
                dp = try_parse_date_sort_key(row.get(sql_col))
                if dp is not None:
                    keys_for_rows.append(dp[0])
                    if str(row.get(sql_col)) != dp[1]:
                        values_normalized += 1
                    row[sql_col] = dp[1]
                else:
                    keys_for_rows.append(None)
            date_sort_keys[sql_col] = keys_for_rows
            stats_obj = {}
        else:
            stats_obj = {}

        final_vals = [row.get(sql_col) for row in normalized_rows if row.get(sql_col) is not None]
        unique_vals = len(set(str(v) for v in final_vals))
        col_format = (
            detect_column_format(sql_col, cm["label"], non_nulls)
            if col_type in ("numeric", "mixed")
            else "number"
        )
        column_profiles.append(
            {
                "name": sql_col,
                "label": cm["label"],
                "type": col_type,
                "format": col_format,
                "non_null": len(final_vals),
                "unique_count": unique_vals,
                **stats_obj,
            }
        )

    analysis_mode = detect_analysis_mode(column_profiles, normalized_rows)

    # For standard analytical tables only, impute sparse missing categorical cells with "Unknown"
    if auto_clean and analysis_mode == "analytical":
        for cp in column_profiles:
            if cp["type"] == "categorical":
                sql_col = cp["name"]
                for row in normalized_rows:
                    if row.get(sql_col) is None:
                        row[sql_col] = "Unknown"
                        missing_imputed += 1
                final_vals = [row.get(sql_col) for row in normalized_rows if row.get(sql_col) is not None]
                cp["non_null"] = len(final_vals)
                cp["unique_count"] = len(set(str(v) for v in final_vals))

    text_notes = extract_text_notes(normalized_rows, column_profiles, analysis_mode)

    # Step 6: Automatic Sorting
    sorted_by = None
    if auto_sort and normalized_rows:
        date_cols = [c for c in column_profiles if c["type"] == "date"]
        num_cols = [c for c in column_profiles if c["type"] == "numeric"]
        mixed_cols = [c for c in column_profiles if c["type"] == "mixed"]
        if date_cols:
            dc = date_cols[0]["name"]
            indexed = list(enumerate(normalized_rows))
            keys = date_sort_keys.get(dc, [])
            indexed.sort(key=lambda pair: (keys[pair[0]] is None, keys[pair[0]] or 0))
            normalized_rows = [pair[1] for pair in indexed]
            sorted_by = f"{date_cols[0]['label']} (chronological)"
        elif num_cols and analysis_mode == "analytical":
            nc = num_cols[0]["name"]
            normalized_rows.sort(
                key=lambda r: (r.get(nc) is None, -(float(r.get(nc)) if isinstance(r.get(nc), (int, float)) else 0.0))
            )
            sorted_by = f"{num_cols[0]['label']} (highest first)"
        elif (num_cols or mixed_cols) and analysis_mode == "inventory":
            nc = (num_cols[0] if num_cols else mixed_cols[0])["name"]
            normalized_rows.sort(
                key=lambda r: (
                    try_parse_number(r.get(nc)) is None,
                    -(try_parse_number(r.get(nc)) or 0.0),
                )
            )
            sorted_by = f"{(num_cols[0] if num_cols else mixed_cols[0])['label']} (highest first)"

    # Cleanliness / Accuracy score
    valid_cells_after = sum(
        1 for row in normalized_rows for cm in kept_cols if row.get(cm["sql"]) is not None
    )
    final_cells = max(1, len(normalized_rows) * max(1, len(kept_cols)))
    cleanliness_score = round((valid_cells_after / final_cells) * 100.0, 1)

    actions = []
    if duplicates_removed > 0:
        actions.append(f"Removed {duplicates_removed} duplicate row(s)")
    if empty_rows_removed > 0:
        actions.append(f"Removed {empty_rows_removed} blank row(s)")
    if summary_rows_removed > 0:
        actions.append(f"Filtered {summary_rows_removed} summary/total row(s)")
    if empty_cols_removed > 0:
        actions.append(f"Dropped {empty_cols_removed} empty column(s)")
    if values_normalized > 0:
        actions.append(f"Standardized {values_normalized} formatted/whitespace value(s)")
    if missing_imputed > 0:
        actions.append(f"Imputed {missing_imputed} missing cell(s)")
    if text_notes:
        actions.append(f"Preserved {len(text_notes)} word/sentence entry(ies) verbatim")
    if sorted_by:
        actions.append(f"Auto-sorted by {sorted_by}")
    if not actions:
        actions.append("Verified schema, types, and completeness (no anomalies found)")

    return {
        "rows": normalized_rows,
        "columns": column_profiles,
        "cleaning_summary": {
            "original_rows": original_row_count,
            "cleaned_rows": len(normalized_rows),
            "duplicates_removed": duplicates_removed,
            "empty_rows_removed": empty_rows_removed,
            "empty_cols_removed": empty_cols_removed,
            "values_normalized": values_normalized,
            "missing_imputed": missing_imputed,
            "sorted_by": sorted_by,
            "cleanliness_score": cleanliness_score,
            "analysis_mode": analysis_mode,
            "text_notes": text_notes,
            "actions": actions,
        },
    }


def recommend_charts(
    rows: List[Dict[str, Any]],
    columns: List[Dict[str, Any]],
    max_charts: int = 2,
    ai_hints: Optional[Dict[str, Any]] = None,
    analysis_mode: str = "analytical",
) -> List[Dict[str, Any]]:
    """
    Automatically observes data structure and selects 1 or maximum 2 optimal
    charts for immediate visual clarity. Avoids meaningless Count=1 charts for
    text/sentence rows.
    """
    if not rows or not columns:
        return []

    date_cols = [c for c in columns if c["type"] == "date" and c.get("unique_count", 0) >= 2]
    num_cols = [c for c in columns if c["type"] in ("numeric", "mixed")]
    # Ensure a mixed column actually has at least 1 numeric entry before charting it numerically
    chartable_num_cols = [
        c for c in num_cols
        if c["type"] == "numeric" or c.get("numeric_count", 0) >= 1
    ]
    cat_cols = [c for c in columns if c["type"] == "categorical"]

    charts: List[Dict[str, Any]] = []

    hint_primary_x = (ai_hints or {}).get("primary_x")
    hint_primary_y = (ai_hints or {}).get("primary_y")
    hint_primary_type = (ai_hints or {}).get("primary_chart_type")

    primary_num = (
        next((c for c in chartable_num_cols if c["name"] == hint_primary_y), None)
        or (chartable_num_cols[0] if chartable_num_cols else None)
    )
    secondary_num = next(
        (c for c in chartable_num_cols if c["name"] != (primary_num["name"] if primary_num else "")),
        None,
    )

    if analysis_mode == "text_notes" and not primary_num:
        return []

    if date_cols and primary_num:
        dc = date_cols[0]
        c1_type = hint_primary_type if hint_primary_type in {"line", "bar", "area"} else "line"
        charts.append(
            {
                "id": "chart_1",
                "title": f"{primary_num['label']} Over {dc['label']}",
                "chartType": c1_type,
                "xColumn": dc["name"],
                "yColumn": primary_num["name"],
                "aggregation": "sum",
                "reason": f"Detected time dimension ({dc['label']}) paired with numeric metric ({primary_num['label']}).",
            }
        )
        if len(charts) < max_charts:
            suitable_cat = next((c for c in cat_cols if 2 <= c["unique_count"] <= 12), None)
            if suitable_cat:
                c2_type = "pie" if suitable_cat["unique_count"] <= 5 and (primary_num.get("min") or 0) >= 0 else "bar"
                charts.append(
                    {
                        "id": "chart_2",
                        "title": f"{primary_num['label']} by {suitable_cat['label']}",
                        "chartType": c2_type,
                        "xColumn": suitable_cat["name"],
                        "yColumn": primary_num["name"],
                        "aggregation": "sum",
                        "reason": f"Compares {primary_num['label']} across {suitable_cat['unique_count']} {suitable_cat['label']} segments.",
                    }
                )
            elif secondary_num:
                charts.append(
                    {
                        "id": "chart_2",
                        "title": f"{secondary_num['label']} Over {dc['label']}",
                        "chartType": "bar",
                        "xColumn": dc["name"],
                        "yColumn": secondary_num["name"],
                        "aggregation": "sum",
                        "reason": f"Tracks secondary metric ({secondary_num['label']}) across the same timeline.",
                    }
                )

    elif cat_cols and primary_num:
        primary_cat = (
            next((c for c in cat_cols if c["name"] == hint_primary_x), None)
            or next((c for c in cat_cols if 2 <= c["unique_count"] <= 20), None)
            or cat_cols[0]
        )
        secondary_cat = next(
            (
                c for c in cat_cols
                if c["name"] != primary_cat["name"]
                and 2 <= c["unique_count"] <= 15
                and len(rows) > primary_cat["unique_count"]
            ),
            None,
        )
        all_positive = (primary_num.get("min") or 0) >= 0
        is_share_name = any(w in primary_num["name"] for w in ("share", "percent", "pct", "ratio", "mix"))
        c1_type = (
            hint_primary_type
            if hint_primary_type in {"bar", "line", "pie", "area", "scatter", "horizontal_bar"}
            else ("pie" if (is_share_name and primary_cat["unique_count"] <= 7 and all_positive and not secondary_cat) else "bar")
        )
        chart1: Dict[str, Any] = {
            "id": "chart_1",
            "title": (
                f"{primary_num['label']} by {primary_cat['label']} & {secondary_cat['label']}"
                if secondary_cat and c1_type in ("bar", "line", "area", "horizontal_bar")
                else f"{primary_num['label']} by {primary_cat['label']}"
            ),
            "chartType": c1_type,
            "xColumn": primary_cat["name"],
            "yColumn": primary_num["name"],
            "yFormat": primary_num.get("format", "number"),
            "aggregation": "sum",
            "reason": (
                f"Displays numeric {primary_num['label']} values per {primary_cat['label']}."
                if analysis_mode == "inventory"
                else (
                    f"Compares {primary_num['label']} across {primary_cat['label']} broken down by {secondary_cat['label']} (filter 1 or all items anytime)."
                    if secondary_cat and c1_type in ("bar", "line", "area", "horizontal_bar")
                    else f"Compares {primary_num['label']} across {primary_cat['label']} categories."
                )
            ),
        }
        if secondary_cat and c1_type in ("bar", "line", "area", "horizontal_bar") and analysis_mode != "inventory":
            chart1["groupColumn"] = secondary_cat["name"]
            chart1["groupMode"] = "grouped"
        charts.append(chart1)
        if len(charts) < max_charts and analysis_mode != "inventory":
            if c1_type != "pie" and 2 <= primary_cat["unique_count"] <= 10 and all_positive and len(rows) >= 3:
                charts.append(
                    {
                        "id": "chart_2",
                        "title": f"{primary_num['label']} Share ({primary_cat['label']})",
                        "chartType": "pie",
                        "xColumn": primary_cat["name"],
                        "yColumn": primary_num["name"],
                        "aggregation": "sum",
                        "reason": f"Shows proportional share of {primary_num['label']} across {primary_cat['unique_count']} groups.",
                    }
                )
            elif secondary_num:
                charts.append(
                    {
                        "id": "chart_2",
                        "title": f"{secondary_num['label']} by {primary_cat['label']}",
                        "chartType": "bar",
                        "xColumn": primary_cat["name"],
                        "yColumn": secondary_num["name"],
                        "aggregation": "sum",
                        "reason": f"Highlights secondary metric ({secondary_num['label']}) across {primary_cat['label']}.",
                    }
                )

    elif len(chartable_num_cols) >= 2:
        c1, c2 = chartable_num_cols[0], chartable_num_cols[1]
        charts.append(
            {
                "id": "chart_1",
                "title": f"{c1['label']} vs {c2['label']}",
                "chartType": "scatter",
                "xColumn": c1["name"],
                "yColumn": c2["name"],
                "aggregation": "raw",
                "reason": f"Explores relationship between {c1['label']} and {c2['label']}.",
            }
        )
        if len(charts) < max_charts:
            charts.append(
                {
                    "id": "chart_2",
                    "title": f"{c1['label']} Distribution",
                    "chartType": "bar",
                    "xColumn": "_row_index",
                    "yColumn": c1["name"],
                    "aggregation": "raw",
                    "reason": f"Displays record-level values of {c1['label']}.",
                }
            )

    elif primary_num:
        charts.append(
            {
                "id": "chart_1",
                "title": f"{primary_num['label']} Values",
                "chartType": "bar",
                "xColumn": "_row_index",
                "yColumn": primary_num["name"],
                "aggregation": "raw",
                "reason": f"Visualizes all {len(rows)} records of {primary_num['label']}.",
            }
        )

    elif cat_cols:
        # Only build a categorical Count chart if values actually repeat meaningfully
        repeated_cat = next(
            (c for c in cat_cols if 2 <= c.get("unique_count", 0) < len(rows)),
            None,
        )
        if repeated_cat:
            charts.append(
                {
                    "id": "chart_1",
                    "title": f"Distribution of {repeated_cat['label']}",
                    "chartType": "bar",
                    "xColumn": repeated_cat["name"],
                    "yColumn": "_count",
                    "aggregation": "count",
                    "reason": f"Frequency distribution of repeated {repeated_cat['label']} entries.",
                }
            )

    return charts[:max_charts]


def compute_quantitative_insights(
    rows: List[Dict[str, Any]],
    columns: List[Dict[str, Any]],
    analysis_mode: str = "analytical",
    text_notes: Optional[List[Dict[str, str]]] = None,
) -> List[str]:
    if not rows or not columns:
        return ["No structured rows available to summarize."]

    notes = text_notes or []
    insights: List[str] = []
    num_cols = [c for c in columns if c["type"] == "numeric"]
    mixed_cols = [c for c in columns if c["type"] == "mixed"]
    date_cols = [c for c in columns if c["type"] == "date" and c.get("unique_count", 0) >= 2]
    cat_cols = [c for c in columns if c["type"] == "categorical"]

    # Mode 1: Item / Piece Inventory List -> NO unwanted statistical calculations
    if analysis_mode == "inventory":
        label_col = cat_cols[0] if cat_cols else columns[0]
        qty_col = next(
            (c for c in (num_cols + mixed_cols) if c["name"] != label_col["name"]),
            (num_cols or mixed_cols or [None])[0],
        )
        col_headers = ", ".join(c["label"] for c in columns)
        insights.append(
            f"Listed {len(rows)} item entries across {col_headers} (item-quantity list — no statistical calculations applied)."
        )

        if qty_col:
            qty_items = []
            for r in rows:
                item_lbl = str(r.get(label_col["name"]) or "Item").strip()
                raw_q = r.get(qty_col["name"])
                parsed_q = try_parse_number(raw_q)
                if parsed_q is not None:
                    q_disp = str(int(parsed_q)) if parsed_q.is_integer() else str(round(parsed_q, 2))
                    qty_items.append(f"{item_lbl}: {q_disp} {qty_col['label']}")
            if qty_items:
                preview = ", ".join(qty_items[:8])
                extra = f" (+{len(qty_items) - 8} more)" if len(qty_items) > 8 else ""
                insights.append(f"Recorded numeric {qty_col['label']} entries: {preview}{extra}.")

        for note in notes[:10]:
            insights.append(f"{note['item']} ({note['column']}): \"{note['value']}\"")
        if len(notes) > 10:
            insights.append(f"...and {len(notes) - 10} more verbatim word/sentence entries shown below.")
        return insights

    # Mode 2: Words & Sentences only -> Print verbatim instead of counting occurrences
    if analysis_mode == "text_notes":
        insights.append(
            f"{len(rows)} records contain words or sentences in place of numeric values (printed verbatim instead of counting):"
        )
        if notes:
            for note in notes[:12]:
                insights.append(f"{note['item']} ({note['column']}): \"{note['value']}\"")
            if len(notes) > 12:
                insights.append(f"...and {len(notes) - 12} more entries preserved in full.")
        else:
            for idx, r in enumerate(rows[:10]):
                parts = [f"{c['label']}: {r.get(c['name'])}" for c in columns if r.get(c["name"]) is not None]
                if parts:
                    insights.append(" | ".join(parts))
        return insights

    # Mode 3: Standard Analytical / Financial / Time-series mode
    if num_cols:
        p = num_cols[0]
        total = p.get("sum")
        avg = p.get("mean")
        mn = p.get("min")
        mx = p.get("max")
        if total is not None and avg is not None:
            insights.append(
                f"Total {p['label']} is {total:,.2f} across {len(rows)} records (average {avg:,.2f}, range {mn:,.2f} to {mx:,.2f})."
            )

        if date_cols and len(rows) >= 2:
            dc = date_cols[0]
            first_v = rows[0].get(p["name"])
            last_v = rows[-1].get(p["name"])
            if isinstance(first_v, (int, float)) and isinstance(last_v, (int, float)) and first_v != 0:
                pct = ((last_v - first_v) / abs(first_v)) * 100.0
                direction = "increased" if pct >= 0 else "decreased"
                insights.append(
                    f"{p['label']} {direction} by {abs(pct):.1f}% from {rows[0].get(dc['name'])} ({first_v:,.2f}) to {rows[-1].get(dc['name'])} ({last_v:,.2f})."
                )

            best_row = max(
                (r for r in rows if isinstance(r.get(p["name"]), (int, float))),
                key=lambda r: float(r.get(p["name"])),
                default=None,
            )
            if best_row:
                insights.append(
                    f"Peak {p['label']} occurred at {best_row.get(dc['name'])} with {float(best_row.get(p['name'])):,.2f}."
                )

        elif cat_cols:
            cc = cat_cols[0]
            totals_by_cat: Dict[str, float] = {}
            for r in rows:
                k = str(r.get(cc["name"]) or "Unknown")
                v = r.get(p["name"])
                if isinstance(v, (int, float)):
                    totals_by_cat[k] = totals_by_cat.get(k, 0.0) + float(v)
            if totals_by_cat:
                sorted_cats = sorted(totals_by_cat.items(), key=lambda x: x[1], reverse=True)
                top_cat, top_val = sorted_cats[0]
                grand = sum(abs(v) for v in totals_by_cat.values())
                share = (abs(top_val) / grand * 100.0) if grand > 0 else 0.0
                insights.append(
                    f"Top {cc['label']} is '{top_cat}' at {top_val:,.2f} ({share:.1f}% of total {p['label']})."
                )
                if len(sorted_cats) > 1:
                    low_cat, low_val = sorted_cats[-1]
                    insights.append(
                        f"Lowest {cc['label']} is '{low_cat}' at {low_val:,.2f}."
                    )

        if len(num_cols) >= 2 and len(rows) >= 3:
            s = num_cols[1]
            pairs = [
                (float(r[p["name"]]), float(r[s["name"]]))
                for r in rows
                if isinstance(r.get(p["name"]), (int, float)) and isinstance(r.get(s["name"]), (int, float))
            ]
            if len(pairs) >= 3:
                xs = [a for a, _ in pairs]
                ys = [b for _, b in pairs]
                mx_x, mx_y = statistics.mean(xs), statistics.mean(ys)
                num = sum((a - mx_x) * (b - mx_y) for a, b in pairs)
                den = math.sqrt(sum((a - mx_x) ** 2 for a in xs) * sum((b - mx_y) ** 2 for b in ys))
                if den > 0:
                    corr = num / den
                    if abs(corr) >= 0.6:
                        rel = "strong positive" if corr > 0 else "strong inverse"
                        insights.append(
                            f"Detected {rel} correlation (r = {corr:.2f}) between {p['label']} and {s['label']}."
                        )

    elif mixed_cols:
        # Mixed column in analytical mode: highlight verbatim words/sentences alongside numeric summary
        for note in notes[:6]:
            insights.append(f"{note['item']} ({note['column']}): \"{note['value']}\"")

    elif cat_cols:
        cc = cat_cols[0]
        counts: Dict[str, int] = {}
        for r in rows:
            k = str(r.get(cc["name"]) or "Unknown")
            counts[k] = counts.get(k, 0) + 1
        top_k, top_c = max(counts.items(), key=lambda x: x[1])
        if top_c > 1:
            insights.append(
                f"Most frequent {cc['label']} is '{top_k}' appearing {top_c} times ({top_c / len(rows) * 100:.1f}% of records)."
            )
        else:
            for r in rows[:8]:
                parts = [f"{c['label']}: {r.get(c['name'])}" for c in columns if r.get(c["name"]) is not None]
                if parts:
                    insights.append(" | ".join(parts))

    # Always append any preserved non-numeric text notes if not already included
    if analysis_mode == "analytical" and notes:
        for note in notes[:5]:
            line = f"{note['item']} ({note['column']}): \"{note['value']}\""
            if line not in insights:
                insights.append(line)

    return insights


def save_dataset_to_sqlite(
    conn: sqlite3.Connection,
    dataset_id: str,
    name: str,
    source_type: str,
    cleaned: Dict[str, Any],
    charts: List[Dict[str, Any]],
    insights: List[str],
    summary_text: str,
    folder_id: Optional[str] = None,
) -> Dict[str, Any]:
    rows = cleaned["rows"]
    columns = cleaned["columns"]
    cleaning_summary = cleaned["cleaning_summary"]

    safe_id = re.sub(r"[^a-zA-Z0-9_]", "_", dataset_id)
    table_name = f"ds_{safe_id}"
    created_at = datetime.utcnow().isoformat() + "Z"

    cur = conn.cursor()
    cur.execute(f'DROP TABLE IF EXISTS "{table_name}"')

    if columns:
        col_defs = ['"_row_id" INTEGER PRIMARY KEY AUTOINCREMENT']
        for c in columns:
            sql_type = "REAL" if c["type"] == "numeric" else "TEXT"
            col_defs.append(f'"{c["name"]}" {sql_type}')
        cur.execute(f'CREATE TABLE "{table_name}" ({", ".join(col_defs)})')

        col_names = [c["name"] for c in columns]
        placeholders = ", ".join("?" for _ in col_names)
        quoted_cols = ", ".join(f'"{cn}"' for cn in col_names)
        insert_sql = f'INSERT INTO "{table_name}" ({quoted_cols}) VALUES ({placeholders})'
        for r in rows:
            cur.execute(insert_sql, [r.get(cn) for cn in col_names])
    else:
        cur.execute(f'CREATE TABLE "{table_name}" ("_row_id" INTEGER PRIMARY KEY AUTOINCREMENT)')

    cur.execute(
        """
        INSERT OR REPLACE INTO datasets (
            id, name, source_type, table_name, created_at,
            original_row_count, row_count, column_count,
            cleanliness_score, cleaning_summary_json,
            columns_json, charts_json, insights_json, summary_text, folder_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            name,
            source_type,
            table_name,
            created_at,
            cleaning_summary["original_rows"],
            cleaning_summary["cleaned_rows"],
            len(columns),
            cleaning_summary["cleanliness_score"],
            json.dumps(cleaning_summary),
            json.dumps(columns),
            json.dumps(charts),
            json.dumps(insights),
            summary_text,
            folder_id,
        ),
    )
    conn.commit()

    return {
        "id": dataset_id,
        "name": name,
        "sourceType": source_type,
        "tableName": table_name,
        "createdAt": created_at,
        "folderId": folder_id,
        "originalRowCount": cleaning_summary["original_rows"],
        "rowCount": cleaning_summary["cleaned_rows"],
        "columnCount": len(columns),
        "cleanlinessScore": cleaning_summary["cleanliness_score"],
        "cleaningSummary": cleaning_summary,
        "analysisMode": cleaning_summary.get("analysis_mode", "analytical"),
        "textNotes": cleaning_summary.get("text_notes", []),
        "columns": columns,
        "charts": charts,
        "insights": insights,
        "summaryText": summary_text,
        "rows": rows[:5000],
    }


def format_dataset_meta(row: sqlite3.Row) -> Dict[str, Any]:
    cleaning_summary = json.loads(row["cleaning_summary_json"])
    keys = row.keys()
    return {
        "id": row["id"],
        "name": row["name"],
        "sourceType": row["source_type"],
        "tableName": row["table_name"],
        "createdAt": row["created_at"],
        "folderId": row["folder_id"] if "folder_id" in keys else None,
        "originalRowCount": row["original_row_count"],
        "rowCount": row["row_count"],
        "columnCount": row["column_count"],
        "cleanlinessScore": row["cleanliness_score"],
        "cleaningSummary": cleaning_summary,
        "analysisMode": cleaning_summary.get("analysis_mode", "analytical"),
        "textNotes": cleaning_summary.get("text_notes", []),
        "columns": json.loads(row["columns_json"]),
        "charts": json.loads(row["charts_json"]),
        "insights": json.loads(row["insights_json"]),
        "summaryText": row["summary_text"],
    }


def _parse_iso_dt(ts: str) -> datetime:
    try:
        clean = ts.replace("Z", "")
        return datetime.fromisoformat(clean)
    except Exception:
        return datetime.utcnow()


def _infer_dataset_period_dt(
    created_at: str,
    columns: List[Dict[str, Any]],
    rows: List[Dict[str, Any]],
) -> datetime:
    """
    Uses a dataset's own date column if it represents a clear report date/month,
    otherwise falls back to created_at timestamp.
    """
    date_cols = [c for c in columns if c.get("type") == "date"]
    if date_cols and rows:
        dc_name = date_cols[0]["name"]
        parsed_dates: List[datetime] = []
        for r in rows:
            dp = try_parse_date_sort_key(r.get(dc_name))
            if dp is not None:
                key_int = dp[0]
                yr = max(1970, min(2100, key_int // 10000))
                mo = max(1, min(12, (key_int % 10000) // 100))
                dy = max(1, min(28, key_int % 100))
                try:
                    parsed_dates.append(datetime(yr, mo, dy))
                except ValueError:
                    pass
        if parsed_dates:
            return max(parsed_dates)
    return _parse_iso_dt(created_at)


def compare_folder_datasets(
    conn: sqlite3.Connection,
    folder_id: str,
    period: str = "all",
    metric: Optional[str] = None,
    filter_col: Optional[str] = None,
    filter_values: Optional[List[str]] = None,
) -> Dict[str, Any]:
    cur = conn.cursor()
    cur.execute("SELECT id, name, created_at FROM folders WHERE id = ?", (folder_id,))
    f_row = cur.fetchone()
    if not f_row:
        return {"ok": False, "error": "Folder not found."}

    cur.execute(
        "SELECT * FROM datasets WHERE folder_id = ? ORDER BY created_at ASC",
        (folder_id,),
    )
    ds_rows = cur.fetchall()
    datasets_meta = [format_dataset_meta(r) for r in ds_rows]

    if not datasets_meta:
        return {
            "ok": True,
            "folder": {"id": f_row["id"], "name": f_row["name"], "createdAt": f_row["created_at"]},
            "datasets": [],
            "period": period,
            "availableMetrics": [{"name": "_row_count", "label": "Record / Item Count", "format": "number"}],
            "selectedMetric": "_row_count",
            "selectedMetricLabel": "Record / Item Count",
            "selectedMetricFormat": "number",
            "availableFilterColumns": [],
            "selectedFilterCol": None,
            "selectedFilterValues": [],
            "breakdownSeries": [],
            "points": [],
            "growthSummary": None,
        }

    # Gather available numeric/mixed metrics & filterable categorical columns across datasets
    metric_counts: Dict[str, Dict[str, Any]] = {}
    filter_col_map: Dict[str, Dict[str, Any]] = {}
    raw_records: List[Dict[str, Any]] = []

    for meta in datasets_meta:
        tbl = meta["tableName"]
        cols = meta["columns"]
        cur.execute(f'SELECT * FROM "{tbl}" ORDER BY "_row_id" ASC')
        tbl_rows = [{k: r[k] for k in r.keys() if k != "_row_id"} for r in cur.fetchall()]

        for c in cols:
            if c.get("type") in ("numeric", "mixed"):
                has_any_num = any(try_parse_number(row.get(c["name"])) is not None for row in tbl_rows)
                if has_any_num:
                    if c["name"] not in metric_counts:
                        metric_counts[c["name"]] = {
                            "name": c["name"],
                            "label": c["label"],
                            "format": c.get("format", "number"),
                            "freq": 0,
                        }
                    metric_counts[c["name"]]["freq"] += 1
                    if metric_counts[c["name"]].get("format") in (None, "number") and c.get("format") not in (None, "number"):
                        metric_counts[c["name"]]["format"] = c["format"]
            elif c.get("type") == "categorical":
                cn = c["name"]
                if cn not in filter_col_map:
                    filter_col_map[cn] = {
                        "name": cn,
                        "label": c["label"],
                        "items_set": set(),
                        "items": [],
                    }
                for row in tbl_rows:
                    val = row.get(cn)
                    if val is not None and str(val).strip() != "":
                        s_val = str(val).strip()
                        if s_val not in filter_col_map[cn]["items_set"]:
                            filter_col_map[cn]["items_set"].add(s_val)
                            filter_col_map[cn]["items"].append(s_val)

        eff_dt = _infer_dataset_period_dt(meta["createdAt"], cols, tbl_rows)
        raw_records.append({
            "meta": meta,
            "cols": cols,
            "rows": tbl_rows,
            "effectiveDt": eff_dt,
        })

    available_filter_columns = [
        {"name": fc["name"], "label": fc["label"], "items": fc["items"]}
        for fc in filter_col_map.values()
        if len(fc["items"]) >= 1
    ]

    valid_filter_col_names = {fc["name"] for fc in available_filter_columns}
    active_filter_col = filter_col if (filter_col and filter_col in valid_filter_col_names) else None
    active_filter_set = (
        {str(v).strip() for v in filter_values}
        if (active_filter_col and filter_values is not None)
        else None
    )

    sorted_metrics = sorted(metric_counts.values(), key=lambda m: -m["freq"])
    available_metrics = [
        {"name": m["name"], "label": m["label"], "format": m.get("format", "number")}
        for m in sorted_metrics
    ]
    available_metrics.append({"name": "_row_count", "label": "Record / Item Count", "format": "number"})

    valid_metric_names = {m["name"] for m in available_metrics}
    selected_metric = metric if (metric and metric in valid_metric_names) else available_metrics[0]["name"]
    selected_metric_obj = next(
        (m for m in available_metrics if m["name"] == selected_metric),
        available_metrics[-1],
    )
    selected_metric_label = selected_metric_obj["label"]
    selected_metric_format = selected_metric_obj.get("format", "number")

    # Sort chronologically by effective date (then createdAt)
    raw_records.sort(key=lambda item: (item["effectiveDt"], item["meta"]["createdAt"]))

    buckets: List[Dict[str, Any]] = []
    bucket_map: Dict[str, Dict[str, Any]] = {}

    # Track ALL numeric metrics simultaneously per period & per item
    all_numeric_metric_names = [m["name"] for m in available_metrics if m["name"] != "_row_count"]
    period_multi_map: Dict[str, Dict[str, Any]] = {}
    item_multi_map: Dict[tuple, Dict[str, Any]] = {}
    item_multi_order: List[tuple] = []

    # Optional per-item / per-subject breakdown across periods
    breakdown_col = active_filter_col or (
        available_filter_columns[0]["name"]
        if available_filter_columns
        else None
    )
    breakdown_items_map: Dict[str, Dict[str, float]] = {}

    for rec in raw_records:
        dt: datetime = rec["effectiveDt"]
        tbl_rows = rec["rows"]

        if active_filter_col and active_filter_set is not None:
            filtered_rows = [
                r for r in tbl_rows
                if r.get(active_filter_col) is not None and str(r.get(active_filter_col)).strip() in active_filter_set
            ]
        else:
            filtered_rows = tbl_rows

        if selected_metric == "_row_count":
            val = float(len(filtered_rows))
        else:
            val = 0.0
            for r in filtered_rows:
                num = try_parse_number(r.get(selected_metric))
                if num is not None:
                    val += num
            val = round(val, 2)

        if period == "weekly":
            iso_yr, iso_wk, _ = dt.isocalendar()
            b_key = f"{iso_yr}-W{iso_wk:02d}"
            b_label = f"Week {iso_wk}, {iso_yr}"
        elif period == "monthly":
            b_key = dt.strftime("%Y-%m")
            b_label = dt.strftime("%b %Y")
        elif period == "yearly":
            b_key = dt.strftime("%Y")
            b_label = dt.strftime("%Y")
        else:
            b_key = rec["meta"]["id"]
            b_label = f"{rec['meta']['name']} ({dt.strftime('%d %b %Y')})"

        if b_key not in bucket_map:
            entry = {
                "key": b_key,
                "label": b_label,
                "value": 0.0,
                "reportCount": 0,
                "reportNames": [],
            }
            bucket_map[b_key] = entry
            buckets.append(entry)
        bucket_map[b_key]["value"] = round(bucket_map[b_key]["value"] + val, 2)
        bucket_map[b_key]["reportCount"] += 1
        bucket_map[b_key]["reportNames"].append(rec["meta"]["name"])

        if b_key not in period_multi_map:
            pm_entry: Dict[str, Any] = {"period_key": b_key, "period_label": b_label, "_row_count": 0.0}
            for mn in all_numeric_metric_names:
                pm_entry[mn] = 0.0
            period_multi_map[b_key] = pm_entry

        period_multi_map[b_key]["_row_count"] += float(len(filtered_rows))
        for r in filtered_rows:
            for mn in all_numeric_metric_names:
                n = try_parse_number(r.get(mn))
                if n is not None:
                    period_multi_map[b_key][mn] = round(period_multi_map[b_key][mn] + float(n), 2)

        # Populate per-item breakdown values for this period
        if breakdown_col:
            for r in filtered_rows:
                item_raw = r.get(breakdown_col)
                if item_raw is None or str(item_raw).strip() == "":
                    continue
                item_name = str(item_raw).strip()
                im_key = (b_key, item_name)
                if im_key not in item_multi_map:
                    im_entry: Dict[str, Any] = {
                        "period_key": b_key,
                        "period_label": b_label,
                        "item_name": item_name,
                        "_row_count": 0.0,
                    }
                    for mn in all_numeric_metric_names:
                        im_entry[mn] = 0.0
                    item_multi_map[im_key] = im_entry
                    item_multi_order.append(im_key)
                item_multi_map[im_key]["_row_count"] += 1.0
                for mn in all_numeric_metric_names:
                    n = try_parse_number(r.get(mn))
                    if n is not None:
                        item_multi_map[im_key][mn] = round(item_multi_map[im_key][mn] + float(n), 2)

                if selected_metric == "_row_count":
                    add_v = 1.0
                else:
                    n = try_parse_number(r.get(selected_metric))
                    if n is None:
                        continue
                    add_v = float(n)
                if item_name not in breakdown_items_map:
                    breakdown_items_map[item_name] = {}
                breakdown_items_map[item_name][b_key] = round(
                    breakdown_items_map[item_name].get(b_key, 0.0) + add_v, 2
                )

    breakdown_series = [
        {"name": item_name, "valuesByPeriod": vals_by_period}
        for item_name, vals_by_period in breakdown_items_map.items()
    ]
    period_multi_metric_rows = [period_multi_map[b["key"]] for b in buckets if b["key"] in period_multi_map]
    item_multi_metric_rows = [item_multi_map[k] for k in item_multi_order]

    # Compute period-over-period % changes
    for idx, b in enumerate(buckets):
        if idx == 0:
            b["changePct"] = None
        else:
            prev_v = buckets[idx - 1]["value"]
            if prev_v != 0:
                b["changePct"] = round(((b["value"] - prev_v) / abs(prev_v)) * 100.0, 1)
            else:
                b["changePct"] = None

    growth_summary = None
    if buckets:
        first_b = buckets[0]
        latest_b = buckets[-1]
        best_b = max(buckets, key=lambda x: x["value"])
        overall_pct = (
            round(((latest_b["value"] - first_b["value"]) / abs(first_b["value"])) * 100.0, 1)
            if len(buckets) >= 2 and first_b["value"] != 0
            else None
        )
        latest_change_pct = latest_b["changePct"]
        growth_summary = {
            "firstLabel": first_b["label"],
            "firstValue": first_b["value"],
            "latestLabel": latest_b["label"],
            "latestValue": latest_b["value"],
            "overallGrowthPct": overall_pct,
            "latestChangePct": latest_change_pct,
            "bestLabel": best_b["label"],
            "bestValue": best_b["value"],
            "periodCount": len(buckets),
        }

    return {
        "ok": True,
        "folder": {"id": f_row["id"], "name": f_row["name"], "createdAt": f_row["created_at"]},
        "datasets": datasets_meta,
        "period": period,
        "availableMetrics": available_metrics,
        "selectedMetric": selected_metric,
        "selectedMetricLabel": selected_metric_label,
        "selectedMetricFormat": selected_metric_format,
        "availableFilterColumns": available_filter_columns,
        "selectedFilterCol": active_filter_col,
        "selectedFilterValues": sorted(active_filter_set) if active_filter_set is not None else [],
        "breakdownSeries": breakdown_series,
        "periodMultiMetricRows": period_multi_metric_rows,
        "itemMultiMetricRows": item_multi_metric_rows,
        "points": buckets,
        "growthSummary": growth_summary,
    }


def handle_command(payload: Dict[str, Any]) -> Dict[str, Any]:
    cmd = payload.get("command")
    db_path = payload.get("db_path", "data/omni_data.db")
    conn = get_conn(db_path)

    try:
        if cmd == "analyze_and_save":
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM app_settings")
            settings = {r["key"]: r["value"] for r in cur.fetchall()}
            auto_clean = settings.get("auto_clean", "true") == "true"
            auto_sort = settings.get("auto_sort", "true") == "true"
            max_charts = int(settings.get("max_charts", "2"))

            raw_rows = payload.get("raw_rows") or []
            cleaned = clean_and_profile(raw_rows, auto_clean=auto_clean, auto_sort=auto_sort)
            analysis_mode = cleaned["cleaning_summary"].get("analysis_mode", "analytical")
            text_notes = cleaned["cleaning_summary"].get("text_notes", [])

            charts = recommend_charts(
                cleaned["rows"],
                cleaned["columns"],
                max_charts=min(2, max(1, max_charts)),
                ai_hints=payload.get("ai_hints"),
                analysis_mode=analysis_mode,
            )
            quant_insights = compute_quantitative_insights(
                cleaned["rows"],
                cleaned["columns"],
                analysis_mode=analysis_mode,
                text_notes=text_notes,
            )
            ai_insights = [str(x).strip() for x in (payload.get("ai_insights") or []) if str(x).strip()]

            # In inventory / text_notes modes, prioritize verbatim item & word/sentence output
            # and don't bury them behind generic AI statistical calculations
            merged_insights: List[str] = []
            if analysis_mode in ("inventory", "text_notes"):
                for item in quant_insights:
                    if item not in merged_insights:
                        merged_insights.append(item)
                for item in ai_insights:
                    # Skip AI bullets that force averages/medians/ranges on item-piece lists
                    low = item.lower()
                    if analysis_mode == "inventory" and any(
                        w in low for w in ("average", "mean", "median", "std", "standard deviation", "range")
                    ):
                        continue
                    if item not in merged_insights and len(merged_insights) < 14:
                        merged_insights.append(item)
            else:
                for item in ai_insights + quant_insights:
                    if item not in merged_insights:
                        merged_insights.append(item)
                    if len(merged_insights) >= 8:
                        break

            summary_text = payload.get("summary_text")
            if not summary_text:
                if analysis_mode == "inventory":
                    summary_text = (
                        f"Item-quantity sheet containing {cleaned['cleaning_summary']['cleaned_rows']} listed items "
                        f"across {len(cleaned['columns'])} fields (no unwanted calculations applied)."
                    )
                elif analysis_mode == "text_notes":
                    summary_text = (
                        f"Captured {cleaned['cleaning_summary']['cleaned_rows']} text/word records "
                        f"across {len(cleaned['columns'])} fields with all words and sentences preserved verbatim."
                    )
                else:
                    summary_text = (
                        f"Automatically cleaned {cleaned['cleaning_summary']['original_rows']} input rows into "
                        f"{cleaned['cleaning_summary']['cleaned_rows']} structured SQL records across "
                        f"{len(cleaned['columns'])} fields."
                    )

            result = save_dataset_to_sqlite(
                conn=conn,
                dataset_id=payload["dataset_id"],
                name=payload.get("name", "Analyzed Dataset"),
                source_type=payload.get("source_type", "file"),
                cleaned=cleaned,
                charts=charts,
                insights=merged_insights,
                summary_text=summary_text,
                folder_id=payload.get("folder_id") or None,
            )
            return {"ok": True, "dataset": result}

        elif cmd == "list_datasets":
            limit = int(payload.get("limit", 50))
            cur = conn.cursor()
            cur.execute("SELECT * FROM datasets ORDER BY created_at DESC LIMIT ?", (limit,))
            items = [format_dataset_meta(r) for r in cur.fetchall()]
            return {"ok": True, "datasets": items}

        elif cmd == "get_dataset":
            ds_id = payload["dataset_id"]
            cur = conn.cursor()
            cur.execute("SELECT * FROM datasets WHERE id = ?", (ds_id,))
            meta_row = cur.fetchone()
            if not meta_row:
                return {"ok": False, "error": "Dataset not found"}
            meta = format_dataset_meta(meta_row)
            table_name = meta["tableName"]
            limit = int(payload.get("limit", 5000))
            cur.execute(f'SELECT * FROM "{table_name}" ORDER BY "_row_id" ASC LIMIT ?', (limit,))
            rows = [{k: r[k] for k in r.keys() if k != "_row_id"} for r in cur.fetchall()]
            meta["rows"] = rows
            return {"ok": True, "dataset": meta}

        elif cmd == "run_sql":
            ds_id = payload["dataset_id"]
            sql = str(payload.get("sql", "")).strip()
            cur = conn.cursor()
            cur.execute("SELECT table_name FROM datasets WHERE id = ?", (ds_id,))
            row = cur.fetchone()
            if not row:
                return {"ok": False, "error": "Dataset not found"}
            table_name = row["table_name"]

            if not sql:
                sql = f'SELECT * FROM "{table_name}" LIMIT 100'

            # Strict read-only guard: only allow single SELECT statement
            normalized_sql = sql.strip().rstrip(";")
            if ";" in normalized_sql or not re.match(r"^\s*SELECT\b", normalized_sql, re.IGNORECASE):
                return {"ok": False, "error": "Only single read-only SELECT queries are permitted."}
            if re.search(r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|ATTACH|DETACH|PRAGMA|CREATE|REPLACE)\b", normalized_sql, re.IGNORECASE):
                return {"ok": False, "error": "Write or schema-modifying SQL keywords are blocked."}

            # Replace generic `data` alias if user wrote `FROM data`
            exec_sql = re.sub(r"\bFROM\s+data\b", f'FROM "{table_name}"', normalized_sql, flags=re.IGNORECASE)
            cur.execute(exec_sql)
            fetched = cur.fetchmany(500)
            cols = [desc[0] for desc in cur.description or [] if desc[0] != "_row_id"]
            result_rows = [{c: r[c] for c in cols} for r in fetched]
            return {"ok": True, "columns": cols, "rows": result_rows, "tableName": table_name}

        elif cmd == "update_charts":
            ds_id = payload["dataset_id"]
            charts = payload.get("charts") or []
            cur = conn.cursor()
            cur.execute("UPDATE datasets SET charts_json = ? WHERE id = ?", (json.dumps(charts[:2]), ds_id))
            conn.commit()
            return {"ok": True}

        elif cmd == "update_column_formats":
            ds_id = payload["dataset_id"]
            formats = payload.get("formats") or {}
            cur = conn.cursor()
            cur.execute("SELECT columns_json FROM datasets WHERE id = ?", (ds_id,))
            row = cur.fetchone()
            if not row:
                return {"ok": False, "error": "Dataset not found"}
            cols = json.loads(row["columns_json"])
            for c in cols:
                if c["name"] in formats:
                    c["format"] = str(formats[c["name"]])
            cur.execute("UPDATE datasets SET columns_json = ? WHERE id = ?", (json.dumps(cols), ds_id))
            conn.commit()
            return {"ok": True, "columns": cols}

        elif cmd == "delete_dataset":
            ds_id = payload["dataset_id"]
            cur = conn.cursor()
            cur.execute("SELECT table_name FROM datasets WHERE id = ?", (ds_id,))
            row = cur.fetchone()
            if row:
                cur.execute(f'DROP TABLE IF EXISTS "{row["table_name"]}"')
                cur.execute("DELETE FROM datasets WHERE id = ?", (ds_id,))
                conn.commit()
            return {"ok": True}

        elif cmd == "get_settings":
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM app_settings")
            return {"ok": True, "settings": {r["key"]: r["value"] for r in cur.fetchall()}}

        elif cmd == "save_settings":
            settings = payload.get("settings") or {}
            cur = conn.cursor()
            for k, v in settings.items():
                cur.execute(
                    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                    (str(k), str(v)),
                )
            conn.commit()
            return {"ok": True, "settings": settings}

        elif cmd == "get_profile":
            cur = conn.cursor()
            cur.execute("SELECT name, email, role, organization, updated_at FROM user_profile WHERE id = 1")
            r = cur.fetchone()
            return {"ok": True, "profile": dict(r) if r else {}}

        elif cmd == "save_profile":
            p = payload.get("profile") or {}
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE user_profile
                SET name = ?, email = ?, role = ?, organization = ?, updated_at = ?
                WHERE id = 1
                """,
                (
                    str(p.get("name", "User")).strip() or "User",
                    str(p.get("email", "analyst@omnidata.ai")).strip(),
                    str(p.get("role", "Data Analyst")).strip(),
                    str(p.get("organization", "Omni Workspace")).strip(),
                    datetime.utcnow().isoformat() + "Z",
                ),
            )
            conn.commit()
            return {"ok": True}

        elif cmd == "list_folders":
            cur = conn.cursor()
            cur.execute(
                """
                SELECT f.id, f.name, f.created_at, COUNT(d.id) AS dataset_count
                FROM folders f
                LEFT JOIN datasets d ON d.folder_id = f.id
                GROUP BY f.id
                ORDER BY f.created_at DESC
                """
            )
            folders = [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "createdAt": r["created_at"],
                    "datasetCount": r["dataset_count"],
                }
                for r in cur.fetchall()
            ]
            return {"ok": True, "folders": folders}

        elif cmd == "create_folder":
            folder_id = str(payload.get("folder_id") or "").strip()
            name = str(payload.get("name") or "").strip()
            if not name:
                return {"ok": False, "error": "Folder name is required."}
            created_at = datetime.utcnow().isoformat() + "Z"
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)",
                (folder_id, name[:60], created_at),
            )
            conn.commit()
            return {
                "ok": True,
                "folder": {
                    "id": folder_id,
                    "name": name[:60],
                    "createdAt": created_at,
                    "datasetCount": 0,
                },
            }

        elif cmd == "delete_folder":
            folder_id = payload["folder_id"]
            cur = conn.cursor()
            cur.execute("UPDATE datasets SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
            cur.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
            conn.commit()
            return {"ok": True}

        elif cmd == "assign_dataset_folder":
            ds_id = payload["dataset_id"]
            folder_id = payload.get("folder_id") or None
            cur = conn.cursor()
            cur.execute("UPDATE datasets SET folder_id = ? WHERE id = ?", (folder_id, ds_id))
            conn.commit()
            return {"ok": True, "folderId": folder_id}

        elif cmd == "compare_folder":
            return compare_folder_datasets(
                conn,
                folder_id=payload["folder_id"],
                period=str(payload.get("period") or "all").lower(),
                metric=payload.get("metric"),
                filter_col=payload.get("filter_col"),
                filter_values=payload.get("filter_values"),
            )

        else:
            return {"ok": False, "error": f"Unknown command: {cmd}"}
    finally:
        conn.close()


if __name__ == "__main__":
    raw_input = sys.stdin.read()
    try:
        req = json.loads(raw_input) if raw_input.strip() else {}
        res = handle_command(req)
    except Exception as exc:
        res = {"ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(res))
