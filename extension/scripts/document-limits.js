/**
 * Define quando um documento é "grande" e nunca deve ir inteiro à API.
 */

const LARGE_DOC = {
  /** Tamanho do arquivo em disco */
  maxBytes: 3 * 1024 * 1024,
  /** Texto já extraído */
  maxTextChars: 35_000,
  /** Páginas (PDF) */
  maxPages: 35,
};

const GROQ_BUDGET = {
  maxDocumentChars: 22_000,
  maxOutputTokens: 3_072,
  maxChunks: 6,
  maxPdfPages: 10,
  maxCharsFiltered: 20_000,
  fallbackSampleChars: 6_000,
};

const GEMINI_LARGE_BUDGET = {
  maxChars: 55_000,
  maxChunks: 14,
  maxPdfPages: 28,
  fallbackSampleChars: 12_000,
};

const GEMINI_SMALL_BUDGET = {
  maxChars: 100_000,
  maxChunks: 18,
  maxPdfPages: 35,
  fallbackSampleChars: 25_000,
};

function assessDocumentSize({ file, parsed, numPages }) {
  const bytes = file?.size || 0;
  const textLen = parsed?.text?.length || 0;
  const pages =
    numPages ||
    parsed?.metadata?.totalPages ||
    parsed?.metadata?.page_count ||
    0;

  const reasons = [];
  if (bytes > LARGE_DOC.maxBytes) {
    reasons.push(`arquivo ${(bytes / (1024 * 1024)).toFixed(1)} MB`);
  }
  if (textLen > LARGE_DOC.maxTextChars) {
    reasons.push(`texto ${Math.round(textLen / 1000)}k caracteres`);
  }
  if (pages > LARGE_DOC.maxPages) {
    reasons.push(`${pages} páginas`);
  }

  return {
    isLarge: reasons.length > 0,
    reasons,
    bytes,
    textLen,
    pages,
  };
}

function isGroqProvider(provider) {
  return normalizeProvider(provider) === "groq";
}

function getSelectionLimits(provider, docSize = { isLarge: false }) {
  const isGroq = isGroqProvider(provider);
  const isLarge = docSize.isLarge === true;

  if (isGroq) {
    return {
      isGroq: true,
      isLarge,
      forceFilter: true,
      neverFull: true,
      maxChars: GROQ_BUDGET.maxCharsFiltered,
      maxChunks: GROQ_BUDGET.maxChunks,
      maxPages: GROQ_BUDGET.maxPdfPages,
      minScore: 3,
      fallbackSampleChars: GROQ_BUDGET.fallbackSampleChars,
      largeReasons: docSize.reasons,
    };
  }

  if (isLarge) {
    return {
      isGroq: false,
      isLarge: true,
      forceFilter: true,
      neverFull: true,
      maxChars: GEMINI_LARGE_BUDGET.maxChars,
      maxChunks: GEMINI_LARGE_BUDGET.maxChunks,
      maxPages: GEMINI_LARGE_BUDGET.maxPdfPages,
      minScore: 3,
      fallbackSampleChars: GEMINI_LARGE_BUDGET.fallbackSampleChars,
      largeReasons: docSize.reasons,
    };
  }

  return {
    isGroq: false,
    isLarge: false,
    forceFilter: false,
    neverFull: false,
    maxChars: GEMINI_SMALL_BUDGET.maxChars,
    maxChunks: GEMINI_SMALL_BUDGET.maxChunks,
    maxPages: GEMINI_SMALL_BUDGET.maxPdfPages,
    minScore: 4,
    fallbackSampleChars: GEMINI_SMALL_BUDGET.fallbackSampleChars,
    largeReasons: [],
  };
}

function largeDocNotice(limits) {
  if (!limits.isLarge || !limits.largeReasons?.length) return "";
  return (
    `[Documento grande (${limits.largeReasons.join(", ")}): ` +
    `análise com trechos selecionados, não o arquivo inteiro. ` +
    `Se precisar de algo que não aparecer aqui, refine a pergunta ou use partes específicas.]\n\n`
  );
}
