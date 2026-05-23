# Extensão Chrome — Leitor de Documentos IA

Painel lateral do Chrome para analisar documentos com **Google Gemini** ou **Groq Cloud**.

Documentação completa do funcionamento do sistema: [README.md](../README.md) na raiz do projeto.

## Instalação rápida

1. `chrome://extensions/` → **Modo do desenvolvedor**
2. **Carregar sem compactação** → pasta `extension`
3. Ícone da extensão → painel lateral

## Configuração

1. Aba **Configurações** → escolha **Gemini** ou **Groq**
2. Cole a chave ([Gemini](https://aistudio.google.com/apikey) · [Groq](https://console.groq.com/keys))
3. Escolha o modelo → **Salvar**

## Resumo das funcionalidades

- Upload por arrastar/soltar ou seletor de arquivo
- Busca inteligente local antes de chamar a IA
- PDFs grandes divididos automaticamente (limite ~50 MB por parte no Gemini)
- Respostas em Markdown renderizado na interface
- Duas APIs configuráveis com chaves separadas

## Permissões

- `storage` — salvar configurações
- `sidePanel` — painel lateral
- `host_permissions` — APIs Gemini e Groq
