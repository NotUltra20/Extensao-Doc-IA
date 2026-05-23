import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()

MAX_TEXT_CHARS = int(os.getenv("MAX_TEXT_CHARS", "120000"))

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".csv"}

MIME_TYPES = {
    ".pdf": "application/pdf",
}
