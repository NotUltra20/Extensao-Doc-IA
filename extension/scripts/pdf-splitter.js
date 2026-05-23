/** Limite de processamento de PDF na inferência Gemini (~50 MB) */
const GEMINI_PDF_PROCESS_LIMIT = 50 * 1024 * 1024;
/** Margem para cada parte enviada */
const PDF_PART_TARGET_BYTES = 48 * 1024 * 1024;

let splitProgressCallback = null;

function setSplitProgress(fn) {
  splitProgressCallback = fn;
}

function reportProgress(msg) {
  splitProgressCallback?.(msg);
}

async function preparePdfForAnalysis(file) {
  return splitPdfIfNeeded(file);
}

async function splitPdfIfNeeded(file) {
  if (file.size <= GEMINI_PDF_PROCESS_LIMIT) {
    return [
      {
        blob: file,
        fileName: file.name,
        partIndex: 1,
        totalParts: 1,
        pageFrom: 1,
        pageTo: null,
      },
    ];
  }

  if (typeof PDFLib === "undefined") {
    throw new Error(
      "PDF acima de 50 MB: biblioteca de divisão não carregada. Recarregue a extensão."
    );
  }

  reportProgress(
    `PDF com ${formatMb(file.size)} MB — dividindo em partes (limite da API: 50 MB)...`
  );

  const buffer = await file.arrayBuffer();
  const source = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = source.getPageCount();

  if (totalPages === 0) {
    throw new Error("O PDF não contém páginas legíveis.");
  }

  const parts = await buildPartsUnderLimit(source, totalPages, file.name);
  return parts.map((p, i) => ({
    ...p,
    partIndex: i + 1,
    totalParts: parts.length,
  }));
}

async function buildPartsUnderLimit(source, totalPages, originalName) {
  const baseName = originalName.replace(/\.pdf$/i, "") || "documento";
  const fullBytes = await source.save();
  const avgBytesPerPage = fullBytes.byteLength / totalPages || 200000;
  const partsBySize = Math.ceil(fullBytes.byteLength / PDF_PART_TARGET_BYTES);
  const partsByPages = Math.ceil(totalPages / 250);
  let pagesPerPart = Math.ceil(
    totalPages / Math.max(partsBySize, partsByPages, 2)
  );

  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await splitByPageCount(
      source,
      totalPages,
      pagesPerPart,
      baseName
    );
    const oversized = result.find((p) => p.blob.size > PDF_PART_TARGET_BYTES);
    if (!oversized) {
      return result;
    }
    pagesPerPart = Math.max(10, Math.floor(pagesPerPart * 0.6));
  }

  throw new Error(
    "Não foi possível dividir o PDF abaixo de 50 MB por parte. " +
      "Divida o arquivo manualmente ou use um trecho menor."
  );
}

async function splitByPageCount(source, totalPages, pagesPerPart, baseName) {
  const parts = [];
  let partNum = 0;

  for (let start = 0; start < totalPages; start += pagesPerPart) {
    partNum += 1;
    const end = Math.min(start + pagesPerPart, totalPages);
    const indices = Array.from({ length: end - start }, (_, i) => start + i);

    const partDoc = await PDFLib.PDFDocument.create();
    const copied = await partDoc.copyPages(source, indices);
    copied.forEach((page) => partDoc.addPage(page));

    const bytes = await partDoc.save({ useObjectStreams: true });
    parts.push({
      blob: new Blob([bytes], { type: "application/pdf" }),
      fileName: `${baseName}_parte${partNum}.pdf`,
      pageFrom: start + 1,
      pageTo: end,
    });
  }

  return parts;
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}
