const GROQ_SYSTEM_INSTRUCTION =
  "Assistente de leitura de documentos (PDF, planilhas, Word). " +
  "Responda em português do Brasil, de forma clara e objetiva. " +
  "Use listas quando ajudar. Se faltar informação no trecho enviado, diga.";

function estimateTokens(text) {
  return Math.ceil((text || "").length / 3.5);
}

/** Garante que o payload total caiba no orçamento Groq */
function trimTextForGroq(text, maxChars = GROQ_BUDGET.maxDocumentChars) {
  if (!text || text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    "\n\n[... documento truncado para caber no limite da API Groq ...]"
  );
}

function buildCompactUserMessage(fileName, fileType, text, prompt) {
  const body = trimTextForGroq(text);
  return (
    `Documento: ${fileName} (${fileType})\n\n` +
    `${body}\n\n` +
    `---\nPergunta: ${prompt}`
  );
}

function buildCompactFilteredText(selection, fileName, query, limits = {}) {
  const notice = limits.isLarge ? largeDocNotice(limits) : "";
  const parts = selection.chunks.map((c) => {
    const head = c.page ? `[p.${c.page}]` : "";
    const snippet =
      c.text.length > 4_500 ? c.text.slice(0, 4_500) + "…" : c.text;
    return head ? `${head}\n${snippet}` : snippet;
  });

  let body = parts.join("\n\n---\n\n");
  body = trimTextForGroq(body, GROQ_BUDGET.maxCharsFiltered - 400);

  return (
    notice +
    `Arquivo: ${fileName} (trechos relevantes — API Groq)\n` +
    `Pergunta: ${query.intent === "full" ? "resumo / visão geral" : "busca direcionada"}\n\n` +
    body +
    `\n\n---\nResponda à pergunta do usuário com base só nos trechos acima.`
  );
}

function formatGroqTokenError(message) {
  const lower = (message || "").toLowerCase();
  if (
    lower.includes("token") ||
    lower.includes("context") ||
    lower.includes("too large") ||
    lower.includes("request too large")
  ) {
    return (
      "Limite de tokens da Groq nesta requisição. A extensão já envia menos texto que antes; " +
      "tente uma pergunta mais específica, use gemini-2.5-flash no Gemini, ou o modelo Llama 3.1 8B na Groq."
    );
  }
  return message;
}
