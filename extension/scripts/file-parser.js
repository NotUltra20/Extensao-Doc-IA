const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".xls", ".csv"];
const MAX_TEXT_CHARS = 120000;
/** Só PDFs bem pequenos usam inline; demais vão pela File API (centenas de páginas) */
const MAX_INLINE_PDF_BYTES = 2 * 1024 * 1024;

function getExtension(filename) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function isSupportedFile(file) {
  return SUPPORTED_EXTENSIONS.includes(getExtension(file.name));
}

function truncateText(text, max = MAX_TEXT_CHARS) {
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    `\n\n[... conteúdo truncado em ${max} caracteres ...]`
  );
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function readFileAsText(file, encoding = "UTF-8") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, encoding);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { text: "", metadata: { rows: 0 } };

  const rows = lines.map((line) => {
    const parts = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current.trim());
    return parts;
  });

  const colCount = Math.max(...rows.map((r) => r.length));
  const header = rows[0] || [];
  const body = rows.slice(1);
  const tableLines = [
    `=== Dados CSV === (${body.length} linhas x ${colCount} colunas)`,
    header.join(" | "),
    ...body.map((r) => r.join(" | ")),
  ];

  return {
    text: truncateText(tableLines.join("\n")),
    metadata: { rows: body.length, columns: header, extraction: "csv" },
    mode: "text",
  };
}

async function parseXlsx(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });
  const parts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const lineCount = rows.length;
    const preview = rows.slice(0, 500);
    let block = `=== Planilha: ${sheetName} === (${lineCount} linhas)\n`;
    block += preview.map((row) => row.join(" | ")).join("\n");
    if (lineCount > 500) {
      block += `\n\n[... truncado: 500 de ${lineCount} linhas ...]`;
    }
    parts.push(block);
  }

  return {
    text: truncateText(parts.join("\n\n")),
    metadata: {
      sheetCount: workbook.SheetNames.length,
      sheets: workbook.SheetNames,
      extraction: "xlsx",
    },
    mode: "text",
  };
}

async function parseDocx(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = (result.value || "").trim();

  if (!text) {
    throw new Error("Não foi possível extrair texto do DOCX.");
  }

  return {
    text: truncateText(text),
    metadata: { extraction: "docx", messages: result.messages?.length || 0 },
    mode: "text",
  };
}

/**
 * PDFs grandes usam File API (upload resumível no Gemini).
 * PDFs pequenos podem usar inline para resposta mais rápida.
 */
async function parsePdf(file) {
  const useInline = file.size <= MAX_INLINE_PDF_BYTES;

  if (useInline) {
    const buffer = await readFileAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(buffer);
    return {
      text: "",
      metadata: {
        size: file.size,
        extraction: "pdf-inline",
        strategy: "inline",
      },
      mode: "pdf",
      pdfStrategy: "inline",
      pdfBase64: base64,
      mimeType: "application/pdf",
    };
  }

  return {
    text: "",
    metadata: {
      size: file.size,
      extraction: "pdf-file-api",
      strategy: "upload",
    },
    mode: "pdf",
    pdfStrategy: "upload",
    mimeType: "application/pdf",
  };
}

/**
 * @returns {Promise<object>}
 */
async function parseDocument(file) {
  if (!isSupportedFile(file)) {
    throw new Error(
      `Formato não suportado. Use: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }

  const ext = getExtension(file.name);

  if (ext === ".csv") {
    let text;
    try {
      text = await readFileAsText(file, "UTF-8");
    } catch {
      text = await readFileAsText(file, "ISO-8859-1");
    }
    return parseCsv(text);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    return parseXlsx(file);
  }

  if (ext === ".docx") {
    return parseDocx(file);
  }

  if (ext === ".pdf") {
    return parsePdf(file);
  }

  throw new Error(`Tipo não tratado: ${ext}`);
}
