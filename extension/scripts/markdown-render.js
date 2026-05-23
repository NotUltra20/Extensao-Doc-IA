/**
 * Renderiza Markdown comum das respostas do Gemini (negrito, listas, títulos).
 * HTML é escapado antes — evita XSS.
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  let s = escapeHtml(text);

  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<em>$1</em>");

  return s;
}

function renderMarkdown(text) {
  if (!text?.trim()) {
    return '<p class="output-placeholder">Sem conteúdo.</p>';
  }

  const lines = text.split("\n");
  const parts = [];
  let listDepth = 0;

  function closeLists(targetDepth) {
    while (listDepth > targetDepth) {
      parts.push("</ul>");
      listDepth -= 1;
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const bullet = line.match(/^(\s*)[*\-]\s+(.*)$/);

    if (bullet) {
      const indent = bullet[1].length;
      const depth = indent >= 4 ? 2 : 1;
      const content = bullet[2].trim();

      closeLists(depth - 1);
      while (listDepth < depth) {
        parts.push('<ul class="md-list">');
        listDepth += 1;
      }
      parts.push(`<li>${inlineFormat(content)}</li>`);
      continue;
    }

    closeLists(0);
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      parts.push("<hr class='md-hr'>");
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      parts.push(`<h${level} class="md-h${level}">${inlineFormat(heading[2])}</h${level}>`);
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      parts.push(`<p class="md-numbered"><span class="md-num">•</span> ${inlineFormat(numbered[1])}</p>`);
      continue;
    }

    parts.push(`<p class="md-p">${inlineFormat(trimmed)}</p>`);
  }

  closeLists(0);

  return `<div class="md-body">${parts.join("\n")}</div>`;
}
