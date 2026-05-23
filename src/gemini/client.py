import time
from pathlib import Path

from google import genai
from google.genai import types

from src.config import GEMINI_API_KEY, GEMINI_MODEL, MAX_TEXT_CHARS, MIME_TYPES
from src.models import DocumentContent


class GeminiAnalyzer:
    """Envia documentos ao Gemini para análise, resumo ou perguntas."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        key = (api_key or GEMINI_API_KEY).strip()
        if not key:
            raise ValueError(
                "GEMINI_API_KEY não configurada. "
                "Copie .env.example para .env e defina sua chave."
            )
        self.model = (model or GEMINI_MODEL).strip()
        self.client = genai.Client(api_key=key)

    def analyze(
        self,
        document: DocumentContent,
        prompt: str,
        *,
        system_instruction: str | None = None,
    ) -> str:
        if document.use_gemini_file_api:
            return self._analyze_with_uploaded_file(document, prompt, system_instruction)

        if not document.has_text:
            raise ValueError(
                "Não foi possível extrair texto do arquivo. "
                "Tente outro formato ou um PDF com camada de texto."
            )

        text = document.text
        if len(text) > MAX_TEXT_CHARS:
            text = (
                text[:MAX_TEXT_CHARS]
                + f"\n\n[... conteúdo truncado em {MAX_TEXT_CHARS} caracteres ...]"
            )

        user_message = self._build_text_prompt(document, text, prompt)
        config = None
        if system_instruction:
            config = types.GenerateContentConfig(system_instruction=system_instruction)

        response = self.client.models.generate_content(
            model=self.model,
            contents=user_message,
            config=config,
        )
        return self._response_text(response)

    def _analyze_with_uploaded_file(
        self,
        document: DocumentContent,
        prompt: str,
        system_instruction: str | None,
    ) -> str:
        suffix = document.path.suffix.lower()
        mime = MIME_TYPES.get(suffix, "application/pdf")

        uploaded = self.client.files.upload(
            file=str(document.path),
            config=types.UploadFileConfig(mime_type=mime),
        )
        uploaded = self._wait_until_active(uploaded.name)

        contents: list = [
            uploaded,
            self._build_file_prompt(document, prompt),
        ]

        config = None
        if system_instruction:
            config = types.GenerateContentConfig(system_instruction=system_instruction)

        response = self.client.models.generate_content(
            model=self.model,
            contents=contents,
            config=config,
        )
        return self._response_text(response)

    def _wait_until_active(self, file_name: str, timeout_sec: int = 600):
        deadline = time.time() + timeout_sec
        uploaded = self.client.files.get(name=file_name)
        state = getattr(uploaded, "state", None)
        state_name = getattr(state, "name", None) or str(state)

        while state_name not in ("ACTIVE", "FAILED"):
            if time.time() > deadline:
                raise TimeoutError("Tempo esgotado aguardando processamento do arquivo.")
            time.sleep(2)
            uploaded = self.client.files.get(name=file_name)
            state = getattr(uploaded, "state", None)
            state_name = getattr(state, "name", None) or str(state)

        if state_name == "FAILED":
            raise RuntimeError("Falha ao processar o arquivo no Gemini.")
        return uploaded

    @staticmethod
    def _response_text(response) -> str:
        text = getattr(response, "text", None)
        if text:
            return text.strip()
        return "(Resposta vazia do modelo.)"

    @staticmethod
    def _build_text_prompt(document: DocumentContent, text: str, prompt: str) -> str:
        meta = ", ".join(f"{k}={v}" for k, v in document.metadata.items())
        return (
            f"Arquivo: {document.path.name}\n"
            f"Tipo: {document.file_type}\n"
            f"Metadados: {meta}\n\n"
            f"--- CONTEÚDO DO DOCUMENTO ---\n{text}\n"
            f"--- FIM DO CONTEÚDO ---\n\n"
            f"Solicitação do usuário:\n{prompt}"
        )

    @staticmethod
    def _build_file_prompt(document: DocumentContent, prompt: str) -> str:
        return (
            f"Analise o arquivo '{document.path.name}' (tipo: {document.file_type}).\n\n"
            f"Solicitação do usuário:\n{prompt}"
        )
