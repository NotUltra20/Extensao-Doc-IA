from pathlib import Path

from rich.console import Console
from rich.panel import Panel

from src.gemini.client import GeminiAnalyzer
from src.models import DocumentContent
from src.readers.loader import load_document

console = Console()

DEFAULT_SYSTEM = (
    "Você é um assistente especializado em leitura e análise de documentos "
    "(PDF, planilhas e Word). Responda em português do Brasil, de forma clara "
    "e objetiva. Quando citar dados de planilhas, indique linhas/colunas quando possível."
)


def run_analysis(
    file_path: Path,
    prompt: str,
    *,
    preview_only: bool = False,
    api_key: str | None = None,
    model: str | None = None,
) -> str:
    document = load_document(file_path)

    console.print(
        Panel(
            f"[bold]{document.path.name}[/bold]\n"
            f"Tipo: {document.file_type}\n"
            f"Modo Gemini: {'File API (PDF multimodal)' if document.use_gemini_file_api else 'texto extraído'}\n"
            f"Metadados: {document.metadata}",
            title="Documento carregado",
            border_style="cyan",
        )
    )

    if preview_only:
        preview = document.text[:3000] if document.text else "(PDF enviado via File API — sem prévia local)"
        console.print(Panel(preview, title="Prévia do conteúdo", border_style="dim"))
        return preview

    analyzer = GeminiAnalyzer(api_key=api_key, model=model)
    with console.status("[bold green]Consultando Gemini..."):
        result = analyzer.analyze(
            document,
            prompt,
            system_instruction=DEFAULT_SYSTEM,
        )

    console.print(Panel(result, title="Resposta", border_style="green"))
    return result
