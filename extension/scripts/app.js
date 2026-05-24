let currentFile = null;

const $ = (sel) => document.querySelector(sel);

const dropZone = $("#drop-zone");
const fileInput = $("#file-input");
const fileInfo = $("#file-info");
const fileNameEl = $("#file-name");
const promptInput = $("#prompt-input");
const btnAnalyze = $("#btn-analyze");
const btnBrowse = $("#btn-browse");
const btnRemoveFile = $("#btn-remove-file");
const btnClearOutput = $("#btn-clear-output");
const outputEl = $("#output");
const statusBadge = $("#status-badge");

const tabs = document.querySelectorAll(".tab");
const panelLeitor = $("#panel-leitor");
const panelConfig = $("#panel-config");

const providerSelect = $("#provider-select");
const providerHint = $("#provider-hint");
const geminiKeyBlock = $("#gemini-key-block");
const groqKeyBlock = $("#groq-key-block");
const geminiApiKeyInput = $("#gemini-api-key");
const groqApiKeyInput = $("#groq-api-key");
const modelSelect = $("#model-select");
const btnSaveSettings = $("#btn-save-settings");
const settingsMessage = $("#settings-message");

const OUTPUT_PLACEHOLDER =
  '<p class="output-placeholder">A resposta aparecerá aqui após você enviar uma pergunta.</p>';

function setStatus(text, type = "") {
  statusBadge.textContent = text;
  statusBadge.className = "status-badge";
  if (type) statusBadge.classList.add(type);
  statusBadge.classList.toggle("hidden", !text);
}

function setOutputLoading(active) {
  if (!active) {
    outputEl.classList.remove("is-loading");
    return;
  }
  outputEl.classList.add("is-loading");
  outputEl.innerHTML =
    '<div class="spinner" role="status" aria-label="Carregando"></div>' +
    '<p class="output-loading-text">Aguarde, a IA está analisando...</p>';
}

function setOutput(text, isError = false) {
  outputEl.classList.remove("is-loading");
  if (isError) {
    outputEl.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text;
    p.classList.add("error-text");
    outputEl.appendChild(p);
    return;
  }
  outputEl.innerHTML = renderMarkdown(text);
}

function resetOutput() {
  outputEl.classList.remove("is-loading");
  outputEl.innerHTML = OUTPUT_PLACEHOLDER;
}

/** Texto sem HTML — colar no Word/Excel mantém cor e estilo padrão do destino */
function getOutputPlainText() {
  if (outputEl.classList.contains("is-loading")) return "";
  if (outputEl.querySelector(".output-placeholder")) return "";
  return outputEl.innerText.replace(/\r\n/g, "\n").trim();
}

function getTextForClipboard() {
  const sel = window.getSelection();
  if (
    sel &&
    !sel.isCollapsed &&
    sel.rangeCount > 0 &&
    outputEl.contains(sel.getRangeAt(0).commonAncestorContainer)
  ) {
    const div = document.createElement("div");
    div.appendChild(sel.getRangeAt(0).cloneContents());
    return div.innerText.replace(/\r\n/g, "\n").trim();
  }
  return getOutputPlainText();
}

outputEl.addEventListener("copy", (e) => {
  const text = getTextForClipboard();
  if (!text) return;
  e.preventDefault();
  e.clipboardData.setData("text/plain", text);
});

function friendlyProgress(msg) {
  if (!msg) return "Processando...";
  const lower = msg.toLowerCase();
  if (lower.includes("interpretando")) return "Interpretando pergunta...";
  if (lower.includes("localizando") || lower.includes("buscando páginas")) {
    return "Buscando trechos...";
  }
  if (lower.includes("trechos selecionados")) return "Trechos localizados";
  if (lower.includes("página(s) mais relevantes")) return "Selecionando páginas...";
  if (lower.includes("dividindo") || lower.includes("montando pdf")) {
    return "Preparando documento...";
  }
  if (lower.includes("enviando")) return "Enviando ao Gemini...";
  if (lower.includes("analisando parte") || lower.includes("em paralelo")) {
    return "Consultando IA...";
  }
  if (lower.includes("unificando") || lower.includes("finalizando")) {
    return "Finalizando...";
  }
  if (lower.includes("aguardando processamento")) return "Processando no servidor...";
  return "Processando...";
}

function updateAnalyzeButton() {
  const hasFile = !!currentFile;
  const hasPrompt = promptInput.value.trim().length > 0;
  btnAnalyze.disabled = !(hasFile && hasPrompt);
}

function setFile(file) {
  if (!isSupportedFile(file)) {
    setOutput(
      `Formato não suportado: ${file.name}. Use PDF, DOCX, XLSX ou CSV.`,
      true
    );
    return;
  }

  currentFile = file;
  dropZone.classList.add("has-file");
  fileInfo.classList.remove("hidden");
  fileNameEl.textContent = `${file.name} (${formatSize(file.size)})`;
  updateAnalyzeButton();
}

function clearFile() {
  currentFile = null;
  fileInput.value = "";
  dropZone.classList.remove("has-file");
  fileInfo.classList.add("hidden");
  fileNameEl.textContent = "";
  updateAnalyzeButton();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileType(name) {
  const ext = getExtension(name).replace(".", "");
  return ext || "unknown";
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab ? "true" : "false");
    });
    panelLeitor.classList.toggle("hidden", target !== "leitor");
    panelLeitor.classList.toggle("active", target === "leitor");
    panelConfig.classList.toggle("hidden", target !== "config");
    panelConfig.classList.toggle("active", target === "config");
  });
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) setFile(file);
});

dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

btnBrowse.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) setFile(file);
});

btnRemoveFile.addEventListener("click", clearFile);

promptInput.addEventListener("input", updateAnalyzeButton);

btnClearOutput.addEventListener("click", () => {
  resetOutput();
  setStatus("");
});

btnAnalyze.addEventListener("click", async () => {
  if (!currentFile) return;

  const prompt =
    promptInput.value.trim() ||
    "Faça um resumo estruturado deste documento, destacando os pontos principais.";

  const settings = await loadSettings();
  if (!settings.apiKey) {
    const providerName = getProviderConfig(settings.provider).name;
    setOutput(
      `Configure sua chave da API (${providerName}) na aba Configurações antes de continuar.`,
      true
    );
    tabs[1].click();
    return;
  }

  const analyzeLabel = btnAnalyze.textContent;
  btnAnalyze.disabled = true;
  btnAnalyze.textContent = "Processando...";
  setStatus("Processando...", "loading");
  setOutputLoading(true);

  const onProgress = (msg) => {
    setStatus(friendlyProgress(msg), "loading");
  };

  try {
    const parsed = await parseDocument(currentFile);

    const answer = await analyzeWithAI({
      provider: settings.provider,
      apiKey: settings.apiKey,
      model: settings.model,
      file: currentFile,
      fileName: currentFile.name,
      fileType: getFileType(currentFile.name),
      parsed,
      prompt,
      onProgress,
    });

    setOutput(answer);
    setStatus("Concluído", "success");
  } catch (err) {
    setOutput(err.message || String(err), true);
    setStatus("Erro", "error");
  } finally {
    btnAnalyze.textContent = analyzeLabel;
    updateAnalyzeButton();
  }
});

document.querySelectorAll(".btn-toggle-key").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
    }
  });
});

function populateModelOptions(provider) {
  const config = getProviderConfig(provider);
  modelSelect.innerHTML = "";
  for (const m of config.models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }
}

function updateProviderUI(provider) {
  const config = getProviderConfig(provider);
  const isGroq = provider === "groq";

  geminiKeyBlock.classList.toggle("hidden", isGroq);
  groqKeyBlock.classList.toggle("hidden", !isGroq);

  providerHint.innerHTML =
    `Chave em <a href="${config.keyUrl}" target="_blank" rel="noopener noreferrer">${config.name}</a>.` +
    (isGroq
      ? " Groq usa texto extraído localmente (PDFs escaneados: use Gemini)."
      : " Gemini suporta PDF multimodal e arquivos grandes.");

  populateModelOptions(provider);
}

providerSelect.addEventListener("change", async () => {
  const provider = normalizeProvider(providerSelect.value);
  updateProviderUI(provider);
  const saved = await loadSettings();
  modelSelect.value =
    provider === "groq" ? saved.groqModel : saved.geminiModel;
});

btnSaveSettings.addEventListener("click", async () => {
  const provider = normalizeProvider(providerSelect.value);
  const geminiApiKey = geminiApiKeyInput.value.trim();
  const groqApiKey = groqApiKeyInput.value.trim();
  const model = modelSelect.value;

  const activeKey = provider === "groq" ? groqApiKey : geminiApiKey;
  if (!activeKey) {
    showSettingsMessage("Informe a chave do provedor selecionado.", "error");
    return;
  }

  const current = await loadSettings();
  await saveSettings({
    provider,
    geminiApiKey,
    groqApiKey,
    geminiModel: provider === "gemini" ? model : current.geminiModel,
    groqModel: provider === "groq" ? model : current.groqModel,
    model,
  });

  showSettingsMessage("Configurações salvas com sucesso.", "success");
});

function showSettingsMessage(text, type) {
  settingsMessage.textContent = text;
  settingsMessage.className = `settings-message ${type}`;
}

async function initSettings() {
  const settings = await loadSettings();
  providerSelect.value = settings.provider;
  geminiApiKeyInput.value = settings.geminiApiKey;
  groqApiKeyInput.value = settings.groqApiKey;
  updateProviderUI(settings.provider);
  modelSelect.value = settings.model;
}

initSettings();
updateAnalyzeButton();
