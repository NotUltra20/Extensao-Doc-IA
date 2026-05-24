const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

async function groqChat({ apiKey, model, messages, temperature = 0.35 }) {
  const maxTokens = GROQ_BUDGET.maxOutputTokens;

  const response = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const raw = data?.error?.message || `Erro HTTP ${response.status} na API Groq.`;
    throw new Error(formatGroqTokenError(raw));
  }

  const text = data?.choices?.[0]?.message?.content?.trim() || "";

  if (!text) {
    throw new Error("Resposta vazia do modelo. Tente outra pergunta ou modelo.");
  }

  return text;
}

async function groqGenerateFromText({
  apiKey,
  model,
  userText,
  systemInstruction,
}) {
  const system = systemInstruction || GROQ_SYSTEM_INSTRUCTION;
  const trimmed = trimTextForGroq(userText);

  return groqChat({
    apiKey,
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: trimmed },
    ],
  });
}
