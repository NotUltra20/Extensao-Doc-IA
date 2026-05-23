/**
 * Pontua e seleciona trechos do documento com base na pergunta interpretada.
 */

const MAX_CHARS_FILTERED = 100_000;
const MAX_CHUNKS = 18;
const MIN_SCORE_THRESHOLD = 4;
const CONTEXT_NEIGHBORS = 1;

function scoreChunkAgainstQuery(chunkText, query) {
  const text = normalizeText(chunkText);
  if (!text.trim()) return 0;

  let score = 0;

  for (const phrase of query.phrases || []) {
    const p = normalizeText(phrase);
    if (p.length < 3) continue;
    if (text.includes(p)) {
      score += 20 + p.split(/\s+/).length * 5;
    } else {
      const phraseWords = p.split(/\s+/).filter((w) => w.length >= 3);
      const found = phraseWords.filter((w) => text.includes(w)).length;
      if (found >= Math.ceil(phraseWords.length * 0.6)) {
        score += 10 + found * 3;
      }
    }
  }

  for (const term of query.terms || []) {
    if (term.length < 3) continue;
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    const matches = text.match(re);
    if (matches) {
      score += matches.length * (2 + Math.min(term.length / 4, 4));
    }
  }

  const uniqueTermsFound = (query.terms || []).filter((t) =>
    text.includes(t)
  ).length;
  if (uniqueTermsFound >= 3) {
    score += uniqueTermsFound * 3;
  }

  return score;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chunkPlainText(text, fileType) {
  const chunks = [];
  if (!text?.trim()) return chunks;

  if (fileType === "csv" || fileType === "xlsx") {
    const blocks = text.split(/\n=== .+ ===\n/);
    blocks.forEach((block, i) => {
      const lines = block.trim().split("\n");
      const batch = 40;
      for (let j = 0; j < lines.length; j += batch) {
        const slice = lines.slice(j, j + batch).join("\n");
        if (slice.trim()) {
          chunks.push({
            id: `sheet-${i}-rows-${j}`,
            text: slice,
            label: `Linhas ${j + 1}–${j + batch}`,
          });
        }
      }
    });
    return chunks;
  }

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  let buffer = "";
  let part = 0;

  for (const para of paragraphs) {
    if (buffer.length + para.length > 3500 && buffer.trim()) {
      chunks.push({ id: `p-${part++}`, text: buffer.trim(), label: `Trecho ${part}` });
      buffer = "";
    }
    buffer += (buffer ? "\n\n" : "") + para;
  }
  if (buffer.trim()) {
    chunks.push({ id: `p-${part}`, text: buffer.trim(), label: `Trecho ${part + 1}` });
  }

  return chunks;
}

/**
 * @param {Array<{id: string, text: string, label?: string, page?: number}>} chunks
 * @param {ReturnType<typeof understandQuery>} query
 */
function selectRelevantChunks(chunks, query) {
  if (query.intent === "full" || !chunks.length) {
    return { useFull: true, chunks: [], reason: query.reason };
  }

  const scored = chunks
    .map((c) => ({ ...c, score: scoreChunkAgainstQuery(c.text, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return {
      useFull: false,
      chunks: [],
      reason: "nenhum trecho com correspondência — enviando amostra inicial",
      fallbackSample: true,
    };
  }

  const bestScore = scored[0].score;
  if (bestScore < MIN_SCORE_THRESHOLD) {
    return {
      useFull: false,
      chunks: scored.slice(0, 5),
      reason: "correspondência fraca — trechos mais prováveis",
      weakMatch: true,
    };
  }

  const selected = [];
  const selectedIds = new Set();
  let totalChars = 0;

  for (const item of scored) {
    if (selected.length >= MAX_CHUNKS) break;
    if (totalChars + item.text.length > MAX_CHARS_FILTERED) break;
    if (item.score < bestScore * 0.25 && selected.length >= 3) break;

    selected.push(item);
    selectedIds.add(item.id);
    totalChars += item.text.length;
  }

  const chunkIndex = new Map(chunks.map((c, i) => [c.id, i]));
  for (const item of [...selected]) {
    const idx = chunkIndex.get(item.id);
    if (idx === undefined) continue;
    for (let d = 1; d <= CONTEXT_NEIGHBORS; d++) {
      const prev = chunks[idx - d];
      const next = chunks[idx + d];
      for (const neighbor of [prev, next]) {
        if (
          neighbor &&
          !selectedIds.has(neighbor.id) &&
          totalChars + neighbor.text.length < MAX_CHARS_FILTERED
        ) {
          selected.push({ ...neighbor, score: item.score * 0.5, isContext: true });
          selectedIds.add(neighbor.id);
          totalChars += neighbor.text.length;
        }
      }
    }
  }

  selected.sort((a, b) => {
    const ia = chunkIndex.get(a.id) ?? 0;
    const ib = chunkIndex.get(b.id) ?? 0;
    return ia - ib;
  });

  const fullTextLen = chunks.reduce((s, c) => s + c.text.length, 0);
  const selectedLen = selected.reduce((s, c) => s + c.text.length, 0);

  if (selectedLen > fullTextLen * 0.85) {
    return { useFull: true, chunks: [], reason: "trechos cobrem quase todo o arquivo" };
  }

  return {
    useFull: false,
    chunks: selected,
    reason: query.reason,
    stats: {
      matched: scored.length,
      sent: selected.length,
      total: chunks.length,
    },
  };
}

function buildFilteredDocumentText(selection, fileName, query) {
  if (selection.fallbackSample) {
    return null;
  }

  const header =
    `[Busca inteligente local — ${selection.reason}]\n` +
    `Arquivo: ${fileName}\n` +
    `A pergunta foi interpretada como: ${query.intent === "search" ? "busca direcionada" : "extração pontual"}.\n` +
    (query.phrases?.length
      ? `Frases-chave: ${query.phrases.join(" | ")}\n`
      : "") +
    (query.terms?.length
      ? `Termos relacionados: ${query.terms.slice(0, 12).join(", ")}\n`
      : "") +
    (selection.stats
      ? `Trechos enviados: ${selection.stats.sent} de ${selection.stats.total} (mais relevantes primeiro).\n`
      : "") +
    `\nSe a informação não estiver nos trechos abaixo, diga claramente.\n\n`;

  const body = selection.chunks
    .map((c) => {
      const label = c.page
        ? `--- Página ${c.page} ---`
        : c.label
          ? `--- ${c.label} ---`
          : "--- Trecho ---";
      return `${label}\n${c.text}`;
    })
    .join("\n\n");

  return header + body;
}
