from pathlib import Path

import pandas as pd


def _dataframe_to_text(df: pd.DataFrame, sheet_name: str | None = None) -> str:
    header = f"=== Planilha: {sheet_name} ===" if sheet_name else "=== Dados ==="
    preview = df.to_string(index=False, max_rows=500)
    row_info = f"({len(df)} linhas x {len(df.columns)} colunas)"
    if len(df) > 500:
        preview += f"\n\n[... truncado: exibidas 500 de {len(df)} linhas ...]"
    return f"{header} {row_info}\n{preview}"


def extract_csv_text(path: Path) -> tuple[str, dict]:
    for encoding in ("utf-8", "latin-1", "cp1252"):
        try:
            df = pd.read_csv(path, encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        df = pd.read_csv(path, encoding="utf-8", errors="replace")

    text = _dataframe_to_text(df)
    metadata = {
        "rows": len(df),
        "columns": list(df.columns.astype(str)),
        "extraction": "pandas-csv",
    }
    return text, metadata


def extract_xlsx_text(path: Path) -> tuple[str, dict]:
    sheets = pd.read_excel(path, sheet_name=None, engine="openpyxl")
    parts: list[str] = []
    sheet_meta: dict[str, dict] = {}

    for name, df in sheets.items():
        df = df.fillna("")
        parts.append(_dataframe_to_text(df, sheet_name=str(name)))
        sheet_meta[str(name)] = {"rows": len(df), "columns": len(df.columns)}

    metadata = {
        "sheet_count": len(sheets),
        "sheets": sheet_meta,
        "extraction": "pandas-openpyxl",
    }
    return "\n\n".join(parts), metadata
