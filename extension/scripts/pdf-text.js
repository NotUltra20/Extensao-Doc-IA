/** Extração de texto por página com PDF.js */

function initPdfJs() {
  if (typeof pdfjsLib === "undefined") return false;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
      "lib/pdf.worker.min.js"
    );
  }
  return true;
}

async function extractSinglePageText(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai texto de todas as páginas (use só em PDFs pequenos).
 */
async function extractPdfTextPerPage(file) {
  if (!initPdfJs()) {
    return { pages: [], totalChars: 0, numPages: 0 };
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  let totalChars = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const text = await extractSinglePageText(pdf, i);
    pages.push({ page: i, text });
    totalChars += text.length;
  }

  return { pages, totalChars, numPages: pdf.numPages };
}

/**
 * Busca rápida: amostra páginas em PDFs grandes, depois lê só as relevantes.
 */
async function extractPdfTextForSearch(file, query, onProgress) {
  if (!initPdfJs()) {
    return { pages: [], totalChars: 0, numPages: 0 };
  }

  onProgress?.("Buscando páginas relevantes...");

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;

  let stride = 1;
  if (numPages > 250) stride = 5;
  else if (numPages > 120) stride = 3;
  else if (numPages > 50) stride = 2;

  const sampled = [];
  for (let i = 1; i <= numPages; i += stride) {
    const text = await extractSinglePageText(pdf, i);
    const score = scoreChunkAgainstQuery(text, query);
    sampled.push({ page: i, text, score });
  }

  const ranked = sampled
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    const fallbackPages = Math.min(12, numPages);
    const pages = [];
    for (let i = 1; i <= fallbackPages; i++) {
      const text = await extractSinglePageText(pdf, i);
      pages.push({ page: i, text });
    }
    const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
    return { pages, totalChars, numPages };
  }

  const pageSet = new Set();
  const topHits = ranked.slice(0, 10);
  for (const hit of topHits) {
    for (let d = -2; d <= 2; d++) {
      const n = hit.page + d;
      if (n >= 1 && n <= numPages) pageSet.add(n);
    }
  }

  const sampledMap = new Map(sampled.map((p) => [p.page, p.text]));
  const pages = [];

  for (const pageNum of [...pageSet].sort((a, b) => a - b)) {
    let text = sampledMap.get(pageNum);
    if (text === undefined) {
      text = await extractSinglePageText(pdf, pageNum);
    }
    pages.push({ page: pageNum, text });
  }

  const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
  return { pages, totalChars, numPages };
}

async function buildPdfFromPageIndices(file, pageIndices) {
  if (typeof PDFLib === "undefined" || !pageIndices.length) {
    return file;
  }

  const buffer = await file.arrayBuffer();
  const source = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
  const newPdf = await PDFLib.PDFDocument.create();
  const copied = await newPdf.copyPages(source, pageIndices);
  copied.forEach((p) => newPdf.addPage(p));
  const bytes = await newPdf.save({ useObjectStreams: true });
  const base = file.name.replace(/\.pdf$/i, "") || "documento";

  return new File([bytes], `${base}_trechos.pdf`, {
    type: "application/pdf",
    lastModified: file.lastModified,
  });
}
