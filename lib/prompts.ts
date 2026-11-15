import type { ChatMessage } from "./types";
import type { LLMMessage } from "./llm";

export const REPLY_SYSTEM = `You are Radix64, an AI app builder. The user describes or edits a small web app and you build it for them.
Rules:
- Answer in 1-2 short sentences of plain text.
- Never output code, HTML, bullet lists or markdown headings.
- The build runs separately, so confirm what you built or changed in a friendly way.
- The user only has this chat and the preview. Never mention editors, repositories, publishing or dashboards.`;

export const BUILD_SYSTEM = `You are a senior frontend engineer writing a tiny web app.
Output exactly one complete HTML document and nothing else.
Rules:
- Start with <!DOCTYPE html> and end with </html>.
- Only inline CSS in a <style> tag and inline JavaScript in a <script> tag.
- No external fonts, scripts, stylesheets, images or network requests.
- Responsive, readable layout that works in an iframe at any width.
- Modern look: dark slate background (#0f172a), light text (#f8fafc), green accents (#22c55e, #166534).
- Keep it under 200 lines. No explanations, no markdown code fences.`;

export function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/^(please\s+)?(build|make|create|design|generate)\s+(me\s+)?(a|an|the)?\s*/i, "")
    .trim();
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  const name = words.replace(/[.,;:!?]+$/, "").trim();
  if (!name) return "Untitled app";
  return name.charAt(0).toUpperCase() + name.slice(1).slice(0, 60);
}

// Later turns get a short recap so the model knows what it already built.
export function replyMessages(
  messages: ChatMessage[],
  prompt: string,
  html: string | null,
): LLMMessage[] {
  const history = messages
    .slice(-6)
    .filter((message) => message.role !== "assistant" || message.text.length < 600)
    .map((message) => ({ role: message.role, content: message.text }) as LLMMessage);
  const context = html
    ? "The app already exists; the user is asking for a change."
    : "This is a brand-new app.";
  return [
    { role: "system", content: REPLY_SYSTEM },
    ...history,
    { role: "system", content: context },
    { role: "user", content: prompt },
  ];
}

export function buildMessages(prompt: string, html: string | null): LLMMessage[] {
  const existing = html
    ? `Current app HTML:\n\n${html}\n\nChange requested: ${prompt}\n\nReturn the complete updated HTML document. Keep everything that already works unless the change asks otherwise.`
    : `Build this app: ${prompt}\n\nReturn the complete HTML document.`;
  return [
    { role: "system", content: BUILD_SYSTEM },
    { role: "user", content: existing },
  ];
}

// Models often wrap output in fences or add a sentence around the document.
export function extractHtml(raw: string): string | null {
  let html = raw.trim();
  const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) html = fence[1].trim();
  const start = html.search(/<!DOCTYPE html|<html[\s>]/i);
  if (start > 0) html = html.slice(start);
  if (!/<html[\s>]/i.test(html)) {
    if (!html) return null;
    html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>App</title></head><body>${html}</body></html>`;
  }
  if (!/<\/html>/i.test(html)) {
    html = /<\/body>/i.test(html) ? `${html}</html>` : `${html}</body></html>`;
  }
  return html;
}
