const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

const SYSTEM_INSTRUCTION =
  "Você é um assistente especializado em leitura e análise de documentos " +
  "(PDF, planilhas e Word). Responda em português do Brasil, de forma clara " +
  "e objetiva. Quando citar dados de planilhas, indique linhas/colunas quando possível.";

function buildTextUserMessage(fileName, fileType, metadata, text, prompt) {
  const meta = Object.entries(metadata || {})
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");

  return (
    `Arquivo: ${fileName}\n` +
    `Tipo: ${fileType}\n` +
    `Metadados: ${meta}\n\n` +
    `--- CONTEÚDO DO DOCUMENTO ---\n${text}\n` +
    `--- FIM DO CONTEÚDO ---\n\n` +
    `Solicitação do usuário:\n${prompt}`
  );
}

function buildPdfPrompt(fileName, prompt, partInfo = null, smartMeta = null) {
  let header = `Analise o arquivo '${fileName}' (PDF).`;
  if (smartMeta?.mode === "filtered-pdf" && smartMeta.pages?.length) {
    header +=
      `\n\n[Contexto] Foram enviadas apenas ${smartMeta.pages.length} página(s) ` +
      `pré-selecionadas localmente como mais relevantes para a pergunta ` +
      `(de ${smartMeta.totalPages} no original: páginas ${smartMeta.pages.join(", ")}). ` +
      `Responda com base neste recorte; se faltar informação, avise.`;
  }
  if (partInfo) {
    header +=
      `\nEsta é a parte ${partInfo.partIndex} de ${partInfo.totalParts}` +
      ` (páginas ${partInfo.pageFrom} a ${partInfo.pageTo} do documento original).`;
  }
  return `${header}\n\nSolicitação do usuário:\n${prompt}`;
}

/** Converte parts do app para o formato REST (snake_case) da API Gemini */
function toApiParts(parts) {
  return parts.map((part) => {
    if (part.text) return { text: part.text };
    if (part.inlineData) {
      return {
        inline_data: {
          mime_type: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      };
    }
    if (part.fileData) {
      return {
        file_data: {
          mime_type: part.fileData.mimeType,
          file_uri: part.fileData.fileUri,
        },
      };
    }
    return part;
  });
}

async function geminiGenerate({ apiKey, model, parts, systemInstruction }) {
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: {
      parts: [{ text: systemInstruction || SYSTEM_INSTRUCTION }],
    },
    contents: [{ role: "user", parts: toApiParts(parts) }],
    generation_config: {
      temperature: 0.4,
      max_output_tokens: 8192,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(formatApiError(data, response.status));
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n") || "";

  if (!text.trim()) {
    throw new Error("Resposta vazia do modelo. Tente outra pergunta ou modelo.");
  }

  return text.trim();
}

function formatApiError(data, status) {
  const msg = data?.error?.message || `Erro HTTP ${status} na API Gemini.`;
  const details = data?.error?.details || [];
  const detailText = details
    .map((d) => d.detail || d.message || "")
    .filter(Boolean)
    .join(" ");

  if (
    msg.includes("invalid argument") ||
    detailText.includes("52428800") ||
    detailText.includes("exceeds supported limit")
  ) {
    return (
      "O Gemini não processa este PDF no tamanho atual (limite ~50 MB por arquivo na análise). " +
      "A extensão tenta dividir automaticamente; se o erro persistir, comprima o PDF ou use gemini-2.5-pro."
    );
  }

  return detailText ? `${msg} (${detailText})` : msg;
}

async function waitUntilFileActive(fileResourceName, apiKey, onProgress) {
  const timeoutMs = 10 * 60 * 1000;
  const started = Date.now();
  const pollMs = 2000;

  while (Date.now() - started < timeoutMs) {
    const url = `${GEMINI_BASE}/${fileResourceName}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(
        data?.error?.message || "Erro ao verificar status do PDF no Gemini."
      );
    }

    const state = data?.state || data?.file?.state;
    const stateName =
      typeof state === "string" ? state : state?.name || String(state || "");

    if (stateName === "ACTIVE") {
      return data;
    }
    if (stateName === "FAILED") {
      throw new Error("O Gemini não conseguiu processar esta parte do PDF.");
    }

    onProgress?.("Aguardando processamento no servidor...");
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    "Tempo esgotado aguardando o processamento do PDF. Tente novamente."
  );
}

async function uploadPdfBlobToGemini(blob, fileName, apiKey, onProgress) {
  const mimeType = "application/pdf";
  const startUrl = `${UPLOAD_BASE}/files?key=${encodeURIComponent(apiKey)}`;

  onProgress?.("Enviando documento...");

  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: { display_name: fileName },
    }),
  });

  if (!startRes.ok) {
    let msg = `Erro ${startRes.status} ao iniciar upload.`;
    try {
      const err = await startRes.json();
      msg = err?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) {
    throw new Error("Resposta inválida ao iniciar upload do PDF.");
  }

  let offset = 0;
  let uploadedFile = null;

  while (offset < blob.size) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, blob.size);
    const chunk = blob.slice(offset, end);
    const isLast = end >= blob.size;

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": isLast ? "upload, finalize" : "upload",
        "X-Goog-Upload-Offset": String(offset),
        "Content-Type": mimeType,
      },
      body: chunk,
    });

    if (!uploadRes.ok) {
      let msg = `Erro ${uploadRes.status} durante upload.`;
      try {
        const err = await uploadRes.json();
        msg = err?.error?.message || msg;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    if (isLast) {
      const data = await uploadRes.json();
      uploadedFile = data.file || data;
    }

    offset = end;
  }

  if (!uploadedFile?.uri || !uploadedFile?.name) {
    throw new Error("Upload concluído, mas resposta do arquivo está incompleta.");
  }

  await waitUntilFileActive(uploadedFile.name, apiKey, onProgress);
  return uploadedFile;
}

async function analyzePdfPart({
  apiKey,
  model,
  blob,
  fileName,
  originalName,
  prompt,
  partInfo,
  smartMeta,
  onProgress,
}) {
  const uploaded = await uploadPdfBlobToGemini(blob, fileName, apiKey, onProgress);
  const pdfPrompt = buildPdfPrompt(originalName, prompt, partInfo, smartMeta);

  return geminiGenerate({
    apiKey,
    model,
    parts: [
      {
        fileData: {
          mimeType: "application/pdf",
          fileUri: uploaded.uri,
        },
      },
      { text: pdfPrompt },
    ],
  });
}

function shouldSkipSynthesis(prompt, partialAnswers) {
  const query = understandQuery(prompt);
  if (query.intent === "search" && partialAnswers.length <= 3) {
    return true;
  }
  const totalLen = partialAnswers.reduce((s, p) => s + p.answer.length, 0);
  return partialAnswers.length <= 2 && totalLen < 14_000;
}

function mergePartAnswersDirect(partialAnswers) {
  return partialAnswers
    .map(
      (p) =>
        `### Páginas ${p.pageFrom}–${p.pageTo}\n\n${p.answer}`
    )
    .join("\n\n---\n\n");
}

async function synthesizePartAnswers({
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
    `O documento "${fileName}" foi analisado em ${partialAnswers.length} partes ` +
    `(limite de 50 MB por parte na API Gemini).\n\n` +
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

async function analyzePdfWithGemini({
  apiKey,
  model,
  file,
  fileName,
  prompt,
  parsed,
  smartMeta,
  onProgress,
}) {
  if (parsed.pdfStrategy === "inline" && parsed.pdfBase64) {
    return geminiGenerate({
      apiKey,
      model,
      parts: [
        {
          inlineData: {
            mimeType: parsed.mimeType || "application/pdf",
            data: parsed.pdfBase64,
          },
        },
        { text: buildPdfPrompt(fileName, prompt, null, smartMeta) },
      ],
    });
  }

  if (!file) {
    throw new Error("Arquivo PDF não disponível para envio.");
  }

  setSplitProgress(onProgress);
  const pdfParts = await preparePdfForAnalysis(file);

  if (pdfParts.length === 1) {
    const part = pdfParts[0];
    return analyzePdfPart({
      apiKey,
      model,
      blob: part.blob,
      fileName: part.fileName,
      originalName: fileName,
      prompt,
      partInfo:
        part.totalParts > 1
          ? {
              partIndex: part.partIndex,
              totalParts: part.totalParts,
              pageFrom: part.pageFrom,
              pageTo: part.pageTo,
            }
          : null,
      smartMeta: part.totalParts === 1 ? smartMeta : null,
      onProgress,
    });
  }

  onProgress?.(`Analisando ${pdfParts.length} partes em paralelo...`);

  const partialAnswers = await runWithConcurrency(
    pdfParts,
    2,
    async (part) => {
      onProgress?.(
        `Analisando parte ${part.partIndex} de ${part.totalParts}...`
      );
      const answer = await analyzePdfPart({
        apiKey,
        model,
        blob: part.blob,
        fileName: part.fileName,
        originalName: fileName,
        prompt,
        partInfo: {
          partIndex: part.partIndex,
          totalParts: part.totalParts,
          pageFrom: part.pageFrom,
          pageTo: part.pageTo,
        },
        smartMeta: null,
        onProgress,
      });
      return {
        partIndex: part.partIndex,
        pageFrom: part.pageFrom,
        pageTo: part.pageTo,
        answer,
      };
    }
  );

  return synthesizePartAnswers({
    apiKey,
    model,
    fileName,
    prompt,
    partialAnswers,
    onProgress,
  });
}

