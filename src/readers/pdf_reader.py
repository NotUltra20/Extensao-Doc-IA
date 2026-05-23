from pathlib import Path

from pypdf import PdfReader


def extract_pdf_text(path: Path) -> tuple[str, dict]:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(f"--- Página {i} ---\n{text.strip()}")

    full_text = "\n\n".join(pages)
    metadata = {
        "page_count": len(reader.pages),
        "extraction": "pypdf",
    }
    return full_text, metadata


def should_use_gemini_file_api(text: str, min_chars: int = 80) -> bool:
    """PDFs escaneados ou com pouco texto extraível vão para a File API do Gemini."""
    return len(text.strip()) < min_chars
