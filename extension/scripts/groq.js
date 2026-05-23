const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

const GROQ_MAX_OUTPUT = 8192;

async function groqChat({ apiKey, model, messages, temperature = 0.4 }) {
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
      max_tokens: GROQ_MAX_OUTPUT,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const msg =
      data?.error?.message || `Erro HTTP ${response.status} na API Groq.`;
    throw new Error(msg);
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
  return groqChat({
    apiKey,
    model,
    messages: [
      { role: "system", content: systemInstruction || SYSTEM_INSTRUCTION },
      { role: "user", content: userText },
    ],
  });
}
