/**
 * Interpreta a pergunta do usuário (PT-BR) para busca local de trechos relevantes.
 */

const PT_STOPWORDS = new Set([
  "a", "o", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "por", "para", "com", "sem", "sob", "sobre", "ao",
  "aos", "à", "às", "que", "se", "ou", "mas", "como", "mais", "menos", "muito",
  "ja", "já", "ainda", "tambem", "também", "esse", "essa", "isso", "este", "esta",
  "ele", "ela", "eles", "elas", "meu", "minha", "seu", "sua", "nos", "nós", "você",
  "voce", "tem", "ter", "foi", "ser", "está", "esta", "são", "sao", "the", "and",
  "arquivo", "documento", "planilha", "texto", "dizer", "falar", "mostrar", "diz",
  "pedido", "pergunta", "resposta", "encontrar", "ache", "achar", "quero", "preciso",
]);

/** Sinônimos / termos relacionados por tema (expansão leve da busca) */
const TERM_EXPANSIONS = {
  prazo: ["prazo", "prazos", "deadline", "vencimento", "limite", "dias", "data limite"],
  valor: ["valor", "valores", "preco", "preço", "custo", "total", "montante", "r$"],
  data: ["data", "datas", "dia", "mes", "mês", "ano", "quando", "periodo", "período"],
  nome: ["nome", "nomes", "autor", "requerente", "requerido", "parte", "cliente"],
  venda: ["venda", "vendas", "faturamento", "receita"],
  entrega: ["entrega", "entregas", "envio", "recebimento", "frete"],
  clausula: ["clausula", "cláusula", "clausulas", "cláusulas", "item", "artigo"],
  assinatura: ["assinatura", "assinado", "assinam", "rubrica"],
  processo: ["processo", "procedimento", "tramitação", "tramitacao", "protocolo"],
  multa: ["multa", "penalidade", "sanção", "sancao"],
  pagamento: ["pagamento", "pagar", "parcela", "boleto", "fatura"],
};

const FULL_DOC_PATTERNS = [
  /\bresumo\b/i,
  /\bsum[aá]rio\b/i,
  /\bvis[aã]o geral\b/i,
  /\ban[aá]lise completa\b/i,
  /\bdocumento inteiro\b/i,
  /\btodo(s)? o(s)? documento\b/i,
  /\bde forma completa\b/i,
  /\bprincipais pontos\b/i,
  /\bo que (esse|este) (arquivo|documento) (fala|diz|conta|trata)\b/i,
  /\btema(s)? (principal|geral)\b/i,
  /\bexplique (o|este|esse) documento\b/i,
];

const SEARCH_PATTERNS = [
  /\bonde\b/i,
  /\bqual(is)?\b/i,
  /\bquando\b/i,
  /\bquanto(s)?\b/i,
  /\bquem\b/i,
  /\bencontre\b/i,
  /\bach(e|ar)\b/i,
  /\bprocure\b/i,
  /\blocalize\b/i,
  /\bcite\b/i,
  /\bmencion/i,
  /\btrecho\b/i,
  /\bp[aá]gina\b/i,
  /\blista(r)?\b/i,
  /\bexiste\b/i,
  /\bh[aá] (algum|alguma)\b/i,
];

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractQuotedPhrases(prompt) {
  const phrases = [];
  const re = /["“”'‘']([^"“”'‘']{3,120})["“”'‘']/g;
  let m;
  while ((m = re.exec(prompt)) !== null) {
    phrases.push(m[1].trim());
  }
  return phrases;
}

/** Frases após gatilhos: "sobre X", "referente a X", "relacionado a X" */
function extractTriggeredPhrases(prompt) {
  const phrases = [];
  const triggers = [
    /(?:sobre|referente a|relacionad[oa] a|a respeito de|mencionando|citando)\s+(.{3,80}?)(?:[?.!,]|$)/gi,
    /(?:valor(?:es)?|dados?|informa[cç][oõ]es?)\s+(?:de|da|do|das|dos)\s+(.{2,60}?)(?:[?.!,]|$)/gi,
    /(?:coluna|campo|linha)\s+(.{2,40}?)(?:[?.!,]|$)/gi,
  ];
  for (const re of triggers) {
    let m;
    while ((m = re.exec(prompt)) !== null) {
      const p = m[1].trim();
      if (p.length >= 3) phrases.push(p);
    }
  }
  return phrases;
}

/** Palavras com 4+ letras que parecem termos de busca */
function extractKeywords(prompt) {
  const normalized = normalizeText(prompt);
  const words = normalized.match(/[a-z0-9]{3,}/g) || [];
  const terms = [];
  for (const w of words) {
    if (w.length < 3 || PT_STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w) && w.length < 4) continue;
    terms.push(w);
  }
  return [...new Set(terms)];
}

function expandTerms(terms) {
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const group of Object.values(TERM_EXPANSIONS)) {
      const normalizedGroup = group.map(normalizeText);
      if (normalizedGroup.some((g) => g.includes(term) || term.includes(g))) {
        group.forEach((g) => expanded.add(normalizeText(g)));
      }
    }
  }
  return [...expanded];
}

/**
 * @returns {{ intent: 'full'|'search'|'extract', terms: string[], phrases: string[], reason: string }}
 */
function understandQuery(prompt) {
  const trimmed = (prompt || "").trim();
  if (!trimmed) {
    return {
      intent: "full",
      terms: [],
      phrases: [],
      reason: "pergunta vazia",
    };
  }

  if (FULL_DOC_PATTERNS.some((re) => re.test(trimmed))) {
    return {
      intent: "full",
      terms: [],
      phrases: [],
      reason: "pedido de visão geral ou resumo",
    };
  }

  const quoted = extractQuotedPhrases(trimmed);
  const triggered = extractTriggeredPhrases(trimmed);
  const keywords = extractKeywords(trimmed);
  const terms = expandTerms(keywords);
  const phrases = [...new Set([...quoted, ...triggered])];

  const isSearch =
    SEARCH_PATTERNS.some((re) => re.test(trimmed)) ||
    phrases.length > 0 ||
    terms.length >= 2;

  if (!isSearch && trimmed.length < 40) {
    return {
      intent: "full",
      terms: [],
      phrases: [],
      reason: "pergunta curta sem foco de busca",
    };
  }

  return {
    intent: isSearch ? "search" : "extract",
    terms,
    phrases,
    reason: isSearch ? "busca direcionada" : "extração pontual",
  };
}
