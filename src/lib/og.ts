import { Resvg } from "@resvg/resvg-js";

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderOgPng(args: {
  title: string;
  subtitle: string;
  costLabel: string;
  accent: string;
}) {
  const svg = `
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeText(args.title)}">
      <rect width="1200" height="630" fill="#fbfafc" />
      <rect x="40" y="40" width="1120" height="550" rx="18" fill="#f3f1f6" stroke="#d2ccdc" stroke-width="2" />
      <text x="96" y="120" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="34" font-weight="600">CloudEstimate</text>
      <text x="96" y="285" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="64" font-weight="600">${escapeText(args.title)}</text>
      <text x="96" y="350" fill="#575b70" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="34">${escapeText(args.subtitle)}</text>
      <text x="96" y="520" fill="#232433" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="46" font-weight="600">${escapeText(args.costLabel)}</text>
      <rect x="1040" y="490" width="72" height="72" rx="12" fill="${args.accent}" />
    </svg>
  `;

  return new Resvg(svg).render().asPng();
}
