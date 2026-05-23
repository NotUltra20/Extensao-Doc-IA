const STORAGE_KEYS = {
  provider: "aiProvider",
  geminiApiKey: "geminiApiKey",
  groqApiKey: "groqApiKey",
  geminiModel: "geminiModel",
  groqModel: "groqModel",
  /** legado */
  apiKey: "geminiApiKey",
  model: "geminiModel",
};

const PROVIDERS = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyLabel: "Chave da API Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.5-flash", label: "gemini-2.5-flash (rápido)" },
      { id: "gemini-2.5-pro", label: "gemini-2.5-pro (mais capaz)" },
    ],
  },
  groq: {
    id: "groq",
    name: "Groq Cloud",
    defaultModel: "llama-3.3-70b-versatile",
    keyLabel: "Chave da API Groq",
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recomendado)" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B (muito rápido)" },
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
    ],
  },
};

const DEPRECATED_GEMINI_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);

function normalizeProvider(provider) {
  return provider === "groq" ? "groq" : "gemini";
}

function normalizeModel(provider, model) {
  const p = PROVIDERS[provider] || PROVIDERS.gemini;
  const value = (model || "").trim();
  if (!value) return p.defaultModel;
  if (provider === "gemini" && DEPRECATED_GEMINI_MODELS.has(value)) {
    return p.defaultModel;
  }
  if (p.models.some((m) => m.id === value)) return value;
  return p.defaultModel;
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.provider,
    STORAGE_KEYS.geminiApiKey,
    STORAGE_KEYS.groqApiKey,
    STORAGE_KEYS.geminiModel,
    STORAGE_KEYS.groqModel,
  ]);

  const provider = normalizeProvider(data[STORAGE_KEYS.provider]);
  const geminiApiKey = data[STORAGE_KEYS.geminiApiKey] || "";
  const groqApiKey = data[STORAGE_KEYS.groqApiKey] || "";
  const geminiModel = normalizeModel("gemini", data[STORAGE_KEYS.geminiModel]);
  const groqModel = normalizeModel("groq", data[STORAGE_KEYS.groqModel]);

  const model = provider === "groq" ? groqModel : geminiModel;
  const apiKey = provider === "groq" ? groqApiKey : geminiApiKey;

  return {
    provider,
    geminiApiKey,
    groqApiKey,
    geminiModel,
    groqModel,
    apiKey,
    model,
  };
}

async function saveSettings({
  provider,
  geminiApiKey,
  groqApiKey,
  geminiModel,
  groqModel,
  model,
}) {
  const p = normalizeProvider(provider);
  const current = await loadSettings();

  await chrome.storage.local.set({
    [STORAGE_KEYS.provider]: p,
    [STORAGE_KEYS.geminiApiKey]: (geminiApiKey ?? current.geminiApiKey).trim(),
    [STORAGE_KEYS.groqApiKey]: (groqApiKey ?? current.groqApiKey).trim(),
    [STORAGE_KEYS.geminiModel]: normalizeModel(
      "gemini",
      geminiModel ?? (p === "gemini" ? model : null) ?? current.geminiModel
    ),
    [STORAGE_KEYS.groqModel]: normalizeModel(
      "groq",
      groqModel ?? (p === "groq" ? model : null) ?? current.groqModel
    ),
  });
}

function getProviderConfig(providerId) {
  return PROVIDERS[normalizeProvider(providerId)];
}
