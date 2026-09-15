export function stripHtml(value: string | null | undefined): string {
  if (!value) return "";
  let text = value;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|section|article|header|footer)>/gi, "\n");
  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&#x27;/gi, "'");
  text = text.replace(/&#x2F;/gi, "/");
  text = text.replace(/&#(\d+);/g, (_, n: string) => {
    const code = Number.parseInt(n, 10);
    if (Number.isNaN(code)) return "";
    try {
      return String.fromCharCode(code);
    } catch {
      return "";
    }
  });
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
    const code = Number.parseInt(h, 16);
    if (Number.isNaN(code)) return "";
    try {
      return String.fromCharCode(code);
    } catch {
      return "";
    }
  });
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]*/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
