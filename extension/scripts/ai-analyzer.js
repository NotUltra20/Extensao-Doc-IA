async function convertPdfToTextForGroq(file, fileName, prompt, onProgress) {
  onProgress?.("Extraindo texto do PDF para Groq...");

  const query = understandQuery(prompt);
  const sampled = await extractPdfTextForSearch(file, query, onProgress);
  const { pages, numPages } = sampled;

  if (sampled.totalChars < 100) {
    throw new Error(
      "Este PDF não tem texto selecionável. Para PDFs escaneados, use o provedor Google Gemini."
    );
  }

  let text = pages
    .map((p) => `[p.${p.page}]\n${p.text}`)
    .join("\n\n");

  text = trimTextForGroq(text);

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
  if (provider === "groq") {
    const compactText = trimTextForGroq(parsed.text);
    const userText = buildCompactUserMessage(
      fileName,
      fileType,
      compactText,
      prompt
    );
    return groqGenerateFromText({
      apiKey,
      model,
      userText,
      systemInstruction: GROQ_SYSTEM_INSTRUCTION,
    });
  }

  const userText = buildTextUserMessage(
    fileName,
    fileType,
    parsed.metadata,
    parsed.text,
    prompt
  );

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
        `### Páginas ${p.pageFrom}–${p.pageTo}\n\n${p.answer}`
    )
    .join("\n\n---\n\n");

  let synthesisText =
    `Documento: ${fileName} (${partialAnswers.length} partes)\n` +
    `Pergunta: ${prompt}\n\n` +
    sections +
    `\n\nUnifique a resposta sem repetir blocos.`;

  if (provider === "groq") {
    synthesisText = trimTextForGroq(synthesisText, GROQ_BUDGET.maxDocumentChars - 500);
    return groqGenerateFromText({
      apiKey,
      model,
      userText: synthesisText,
      systemInstruction: GROQ_SYSTEM_INSTRUCTION,
    });
  }

  synthesisText =
    `O documento "${fileName}" foi analisado em ${partialAnswers.length} partes.\n\n` +
    `Solicitação original do usuário:\n${prompt}\n\n` +
    `--- Análises por parte ---\n\n${sections}\n\n` +
    `---\nCom base em todas as partes acima, responda à solicitação original ` +
    `de forma unificada, completa e sem repetir blocos inteiros.`;

  return geminiGenerate({
    apiKey,
    model,
    parts: [{ text: synthesisText }],
  });
}

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
    provider: p,
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
