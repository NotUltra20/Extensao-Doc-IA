from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DocumentContent:
    """Conteúdo extraído ou referenciado de um arquivo."""

    path: Path
    file_type: str
    text: str = ""
    use_gemini_file_api: bool = False
    metadata: dict = field(default_factory=dict)

    @property
    def has_text(self) -> bool:
        return bool(self.text.strip())
