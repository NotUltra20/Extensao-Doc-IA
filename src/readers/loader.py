from pathlib import Path

from src.config import SUPPORTED_EXTENSIONS
from src.models import DocumentContent
from src.readers.docx_reader import extract_docx_text
from src.readers.pdf_reader import extract_pdf_text, should_use_gemini_file_api
from src.readers.spreadsheet_reader import extract_csv_text, extract_xlsx_text


def load_document(path: Path) -> DocumentContent:
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Arquivo não encontrado: {path}")

    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise ValueError(
            f"Formato não suportado: {suffix}. Use um destes: {supported}"
        )

    if suffix == ".pdf":
        text, meta = extract_pdf_text(path)
        # PDFs grandes ou com pouco texto extraível → File API (multimodal)
        large_pdf = path.stat().st_size > 8 * 1024 * 1024
        use_file_api = large_pdf or should_use_gemini_file_api(text)
        if use_file_api:
            meta = {**meta, "strategy": "file-api"}
        return DocumentContent(
            path=path,
            file_type="pdf",
            text=text if not use_file_api else "",
            use_gemini_file_api=use_file_api,
            metadata=meta,
        )

    if suffix == ".docx":
        text, meta = extract_docx_text(path)
        return DocumentContent(
            path=path, file_type="docx", text=text, metadata=meta
        )

    if suffix == ".csv":
        text, meta = extract_csv_text(path)
        return DocumentContent(
            path=path, file_type="csv", text=text, metadata=meta
        )

    if suffix in (".xlsx", ".xls"):
        text, meta = extract_xlsx_text(path)
        return DocumentContent(
            path=path, file_type="xlsx", text=text, metadata=meta
        )

    raise ValueError(f"Tipo não tratado: {suffix}")
