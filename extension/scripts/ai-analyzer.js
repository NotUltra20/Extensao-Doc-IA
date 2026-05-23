const GROQ_MAX_TEXT_CHARS = 100_000;

async function convertPdfToTextForGroq(file, fileName, prompt, onProgress) {
  onProgress?.("Extraindo texto do PDF para Groq...");

  const query = understandQuery(prompt);
  let pages;
  let numPages;

  if (query.intent === "full") {
    const full = await extractPdfTextPerPage(file);
    pages = full.pages;
    numPages = full.numPages;
    if (full.totalChars < 100) {
      throw new Error(
        "Este PDF não tem texto selecionável. Para PDFs escaneados, use o provedor Google Gemini."
      );
    }
  } else {
    const sampled = await extractPdfTextForSearch(file, query, onProgress);
    pages = sampled.pages;
    numPages = sampled.numPages;
    if (sampled.totalChars < 100) {
      throw new Error(
        "Este PDF não tem texto selecionável. Para PDFs escaneados, use o provedor Google Gemini."
      );
    }
  }

  let text = pages
    .map((p) => `--- Página ${p.page} ---\n${p.text}`)
    .join("\n\n");

  if (text.length > GROQ_MAX_TEXT_CHARS) {
    text =
      text.slice(0, GROQ_MAX_TEXT_CHARS) +
      `\n\n[... texto truncado em ${GROQ_MAX_TEXT_CHARS} caracteres (${numPages} páginas no total) ...]`;
  }

  return {
    mode: "text",
    text,
    metadata: {
      extraction: "pdf-text-groq",
      pagesIncluded: pages.length,
      totalPages: numPages,
    },
  };
}

async function analyzeTextWithProvider({
  provider,
  apiKey,
  model,
  fileName,
  fileType,
  parsed,
  prompt,
}) {
  const userText = buildTextUserMessage(
    fileName,
    fileType,
    parsed.metadata,
    parsed.text,
    prompt
  );

  if (provider === "groq") {
    return groqGenerateFromText({ apiKey, model, userText });
  }

  return geminiGenerate({
    apiKey,
    model,
    parts: [{ text: userText }],
  });
}

async function synthesizeWithProvider({
  provider,
  apiKey,
  model,
  fileName,
  prompt,
  partialAnswers,
  onProgress,
}) {
  if (shouldSkipSynthesis(prompt, partialAnswers)) {
    onProgress?.("Finalizando resposta...");
    return mergePartAnswersDirect(partialAnswers);
  }

  onProgress?.("Unificando respostas...");

  const sections = partialAnswers
    .map(
      (p) =>
        `### Parte ${p.partIndex} (páginas ${p.pageFrom}–${p.pageTo})\n${p.answer}`
    )
    .join("\n\n");

  const synthesisText =
    `O documento "${fileName}" foi analisado em ${partialAnswers.length} partes.\n\n` +
    `Solicitação original do usuário:\n${prompt}\n\n` +
    `--- Análises por parte ---\n\n${sections}\n\n` +
    `---\nCom base em todas as partes acima, responda à solicitação original ` +
    `de forma unificada, completa e sem repetir blocos inteiros.`;

  if (provider === "groq") {
    return groqGenerateFromText({ apiKey, model, userText: synthesisText });
  }

  return geminiGenerate({
    apiKey,
    model,
    parts: [{ text: synthesisText }],
  });
}

/**
 * Ponto de entrada unificado (Gemini ou Groq).
 */
async function analyzeWithAI({
  provider,
  apiKey,
  model,
  file,
  fileName,
  fileType,
  parsed,
  prompt,
  onProgress,
}) {
  const p = normalizeProvider(provider);

  if (!apiKey?.trim()) {
    const name = getProviderConfig(p).name;
    throw new Error(
      `Configure sua chave da API (${name}) em Configurações antes de enviar.`
    );
  }

  onProgress?.("Interpretando sua pergunta...");

  const ctx = await applySmartContext({
    file,
    fileName,
    fileType,
    parsed,
    prompt,
    onProgress,
  });

  file = ctx.file ?? file;
  parsed = ctx.parsed;
  const smartMeta = ctx.smartMeta ?? null;

  if (p === "groq" && parsed.mode === "pdf") {
    if (!file) {
      throw new Error("Arquivo PDF não disponível para extração de texto.");
    }
    parsed = await convertPdfToTextForGroq(file, fileName, prompt, onProgress);
    file = null;
  }

  if (parsed.mode === "pdf") {
    if (p !== "gemini") {
      throw new Error("PDF multimodal requer o provedor Google Gemini.");
    }
    return analyzePdfWithGemini({
      apiKey,
      model,
      file,
      fileName,
      prompt,
      parsed,
      smartMeta,
      onProgress,
      provider: p,
    });
  }

  if (!parsed.text?.trim()) {
    throw new Error("Não foi possível obter conteúdo do arquivo.");
  }

  return analyzeTextWithProvider({
    provider: p,
    apiKey,
    model,
    fileName,
    fileType,
    parsed,
    prompt,
  });
}
