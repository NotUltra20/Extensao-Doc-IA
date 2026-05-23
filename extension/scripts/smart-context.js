/**
 * Pré-seleção inteligente de trechos antes de chamar o Gemini.
 */

const MIN_PDF_TEXT_CHARS = 100;
const MAX_PDF_PAGES_FILTERED = 35;

async function applySmartContext({
  file,
  fileName,
  fileType,
  parsed,
  prompt,
  onProgress,
}) {
  const query = understandQuery(prompt);

  if (query.intent === "full") {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: query.reason },
    };
  }

  onProgress?.("Localizando trechos relevantes...");

  if (parsed.mode === "pdf" && file) {
    return applySmartContextPdf(file, fileName, parsed, query, onProgress);
  }

  if (parsed.text?.trim()) {
    return applySmartContextText(file, fileName, fileType, parsed, query);
  }

  return { file, parsed, smartMeta: { mode: "full", reason: "sem texto local" } };
}

async function applySmartContextText(file, fileName, fileType, parsed, query) {
  const chunks = chunkPlainText(parsed.text, fileType).map((c, i) => ({
    ...c,
    id: c.id || `chunk-${i}`,
  }));

  const selection = selectRelevantChunks(chunks, query);

  if (selection.useFull) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: selection.reason },
    };
  }

  if (selection.fallbackSample) {
    const sample = parsed.text.slice(0, 25000);
    return {
      file: null,
      parsed: {
        ...parsed,
        mode: "text",
        text: sample,
        metadata: { ...parsed.metadata, smartFilter: "sample" },
      },
      smartMeta: { mode: "filtered", reason: selection.reason },
    };
  }

  const filtered = buildFilteredDocumentText(selection, fileName, query);
  if (!filtered) {
    return { file, parsed, smartMeta: { mode: "full" } };
  }

  return {
    file: null,
    parsed: {
      ...parsed,
      mode: "text",
      text: filtered,
      metadata: {
        ...parsed.metadata,
        smartFilter: true,
        chunksSent: selection.chunks?.length,
        queryIntent: query.intent,
        useTextOnly: true,
      },
    },
    smartMeta: {
      mode: "filtered",
      reason: selection.reason,
      stats: selection.stats,
    },
  };
}

async function applySmartContextPdf(file, fileName, parsed, query, onProgress) {
  const { pages, totalChars, numPages } = await extractPdfTextForSearch(
    file,
    query,
    onProgress
  );

  if (totalChars < MIN_PDF_TEXT_CHARS) {
    return {
      file,
      parsed,
      smartMeta: {
        mode: "full",
        reason: "PDF sem texto selecionável (possível scan) — envio completo",
      },
    };
  }

  const pageChunks = pages.map((p) => ({
    id: `page-${p.page}`,
    text: p.text,
    label: `Página ${p.page}`,
    page: p.page,
  }));

  const selection = selectRelevantChunks(pageChunks, query);

  if (selection.useFull) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: selection.reason },
    };
  }

  let selectedChunks = selection.chunks?.length
    ? selection.chunks
    : pageChunks.slice(0, Math.min(15, pageChunks.length));

  if (!selectedChunks.length) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: "não foi possível isolar páginas" },
    };
  }

  const pageNumbers = [
    ...new Set(selectedChunks.filter((c) => c.page).map((c) => c.page)),
  ].sort((a, b) => a - b);

  const indices = pageNumbers.slice(0, MAX_PDF_PAGES_FILTERED);
  const filtered = buildFilteredDocumentText(
    { ...selection, chunks: selectedChunks.filter((c) => indices.includes(c.page)) },
    fileName,
    query
  );

  if (filtered && filtered.length < 120_000) {
    onProgress?.(`Trechos selecionados (${indices.length} páginas de ${numPages})`);

    return {
      file: null,
      parsed: {
        mode: "text",
        text: filtered,
        metadata: {
          smartFilter: true,
          pagesSent: indices,
          totalPages: numPages,
          queryIntent: query.intent,
          useTextOnly: true,
          extraction: "pdf-text-fast",
        },
      },
      smartMeta: {
        mode: "filtered-text",
        pages: indices,
        totalPages: numPages,
        reason: selection.reason,
      },
    };
  }

  onProgress?.("Montando PDF com páginas selecionadas...");
  const partialFile = await buildPdfFromPageIndices(
    file,
    indices.map((p) => p - 1)
  );

  return {
    file: partialFile,
    parsed: {
      ...parsed,
      mode: "pdf",
      pdfStrategy: "upload",
      pdfBase64: null,
      metadata: {
        ...parsed.metadata,
        smartFilter: true,
        pagesSent: indices,
        totalPages: numPages,
        queryIntent: query.intent,
      },
    },
    smartMeta: {
      mode: "filtered-pdf",
      pages: indices,
      totalPages: numPages,
      reason: selection.reason,
    },
  };
}
