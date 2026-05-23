#!/usr/bin/env python3
"""CLI — Leitor de documentos com IA (Gemini)."""

import argparse
import sys
from pathlib import Path

from src.analyzer import run_analysis


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Lê PDF, DOCX, XLSX e CSV e responde perguntas com Gemini.",
    )
    parser.add_argument(
        "arquivo",
        type=Path,
        help="Caminho do arquivo (PDF, DOCX, XLSX, CSV)",
    )
    parser.add_argument(
        "-p",
        "--pergunta",
        default="Faça um resumo estruturado deste documento, destacando os pontos principais.",
        help="Pergunta ou instrução para a IA",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Apenas extrai e exibe prévia do texto (sem chamar a API)",
    )
    parser.add_argument(
        "-m",
        "--modelo",
        default=None,
        help="Modelo Gemini (ex.: gemini-2.5-flash)",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.arquivo.exists():
        print(f"Erro: arquivo não encontrado: {args.arquivo}", file=sys.stderr)
        return 1

    try:
        run_analysis(
            args.arquivo,
            args.pergunta,
            preview_only=args.preview,
            model=args.modelo,
        )
    except ValueError as exc:
        print(f"Erro: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Erro inesperado: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
