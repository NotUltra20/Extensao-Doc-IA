/**
 * Pré-seleção inteligente de trechos antes de chamar a IA.
 * Documentos grandes nunca vão inteiros — só trechos ou amostra.
 */

const MIN_PDF_TEXT_CHARS = 100;

async function applySmartContext({
  file,
  fileName,
  fileType,
  parsed,
  prompt,
  onProgress,
  provider,
}) {
  const query = understandQuery(prompt);
  const sizeHint = assessDocumentSize({ file, parsed });
  const limits = getSelectionLimits(provider, sizeHint);

  const allowFullBypass =
    query.intent === "full" && !limits.forceFilter && !sizeHint.isLarge;

  if (allowFullBypass) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: query.reason },
    };
  }

  if (sizeHint.isLarge) {
    onProgress?.(
      `Documento grande (${sizeHint.reasons.join(", ")}): selecionando trechos...`
    );
  } else {
    onProgress?.(
      limits.isGroq
        ? "Selecionando trechos (limite Groq)..."
        : "Localizando trechos relevantes..."
    );
  }

  if (parsed.mode === "pdf" && file) {
    return applySmartContextPdf(
      file,
      fileName,
      parsed,
      query,
      onProgress,
      provider
    );
  }

  if (parsed.text?.trim()) {
    return applySmartContextText(
      file,
      fileName,
      fileType,
      parsed,
      query,
      limits,
      sizeHint
    );
  }

  if (limits.neverFull) {
    return {
      file: null,
      parsed: {
        ...parsed,
        mode: "text",
        text: "",
        metadata: { ...parsed.metadata, smartFilter: "unavailable" },
      },
      smartMeta: {
        mode: "filtered",
        reason: "documento grande sem texto extraível localmente",
      },
    };
  }

  return { file, parsed, smartMeta: { mode: "full", reason: "sem texto local" } };
}

async function applySmartContextText(
  file,
  fileName,
  fileType,
  parsed,
  query,
  limits,
  sizeHint
) {
  const chunks = chunkPlainText(parsed.text, fileType).map((c, i) => ({
    ...c,
    id: c.id || `chunk-${i}`,
  }));

  const selection = selectRelevantChunks(chunks, query, limits);

  if (selection.useFull && !limits.neverFull) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: selection.reason },
    };
  }

  if (selection.fallbackSample || (selection.useFull && limits.neverFull)) {
    const sample = parsed.text.slice(0, limits.fallbackSampleChars);
    const text = limits.isGroq
      ? buildCompactFilteredText(
          { chunks: [{ text: sample, page: null }], fallbackSample: false },
          fileName,
          query,
          limits
        )
      : largeDocNotice(limits) + sample;
    return {
      file: null,
      parsed: {
        ...parsed,
        mode: "text",
        text,
        metadata: {
          ...parsed.metadata,
          smartFilter: "sample",
          documentLarge: sizeHint.isLarge,
        },
      },
      smartMeta: {
        mode: "filtered",
        reason: selection.reason || "amostra (documento grande)",
      },
    };
  }

  const filtered = limits.isGroq
    ? buildCompactFilteredText(selection, fileName, query, limits)
    : buildFilteredDocumentText(selection, fileName, query, limits);

  if (!filtered) {
    if (limits.neverFull && parsed.text?.trim()) {
      const sample = parsed.text.slice(0, limits.fallbackSampleChars);
      return {
        file: null,
        parsed: {
          ...parsed,
          mode: "text",
          text: largeDocNotice(limits) + sample,
          metadata: { ...parsed.metadata, smartFilter: "sample" },
        },
        smartMeta: { mode: "filtered", reason: "fallback amostra" },
      };
    }
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
        documentLarge: sizeHint.isLarge,
      },
    },
    smartMeta: {
      mode: "filtered",
      reason: selection.reason,
      stats: selection.stats,
    },
  };
}

async function applySmartContextPdf(
  file,
  fileName,
  parsed,
  query,
  onProgress,
  provider
) {
  const { pages, totalChars, numPages } = await extractPdfTextForSearch(
    file,
    query,
    onProgress
  );

  const sizeHint = assessDocumentSize({
    file,
    parsed,
    numPages,
  });
  const limits = getSelectionLimits(provider, sizeHint);

  if (totalChars < MIN_PDF_TEXT_CHARS) {
    if (sizeHint.isLarge && numPages > 1) {
      const pageCount = Math.min(limits.maxPages, numPages);
      onProgress?.(
        `PDF escaneado grande: enviando ${pageCount} de ${numPages} páginas...`
      );
      const indices = Array.from({ length: pageCount }, (_, i) => i);
      const partialFile = await buildPdfFromPageIndices(file, indices);
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
            pagesSent: indices.map((i) => i + 1),
            totalPages: numPages,
            scannedSample: true,
          },
        },
        smartMeta: {
          mode: "filtered-pdf",
          pages: indices.map((i) => i + 1),
          totalPages: numPages,
          reason: "PDF escaneado grande — amostra de páginas",
        },
      };
    }
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

  const selection = selectRelevantChunks(pageChunks, query, limits);

  if (selection.useFull && !limits.neverFull) {
    return {
      file,
      parsed,
      smartMeta: { mode: "full", reason: selection.reason },
    };
  }

  let selectedChunks = selection.chunks?.length
    ? selection.chunks
    : pageChunks.slice(0, Math.min(limits.maxPages, pageChunks.length));

  if (!selectedChunks.length && limits.neverFull) {
    selectedChunks = pageChunks.slice(
      0,
      Math.min(limits.maxPages, pageChunks.length)
    );
  }

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

  const indices = pageNumbers.slice(0, limits.maxPages);
  const chunkSet = selectedChunks.filter((c) => indices.includes(c.page));
  const filtered = limits.isGroq
    ? buildCompactFilteredText(
        { ...selection, chunks: chunkSet },
        fileName,
        query,
        limits
      )
    : buildFilteredDocumentText(
        { ...selection, chunks: chunkSet },
        fileName,
        query,
        limits
      );

  const maxTextLen = limits.isGroq ? limits.maxChars + 500 : 120_000;

  if (filtered && filtered.length < maxTextLen) {
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
          documentLarge: sizeHint.isLarge,
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
        documentLarge: sizeHint.isLarge,
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
