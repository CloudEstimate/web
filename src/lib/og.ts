import fs from "node:fs";
import { Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

const SANS_CANDIDATES = [
  "/System/Library/Fonts/SFNS.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
];

const MONO_CANDIDATES = [
  "/System/Library/Fonts/SFNSMono.ttf",
  "/System/Library/Fonts/Menlo.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
];

const resolvedSans = SANS_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const resolvedMono = MONO_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const fontFiles = [resolvedSans, resolvedMono].filter((value): value is string => Boolean(value));

const resvgFontOptions: ResvgRenderOptions["font"] =
  fontFiles.length > 0
    ? {
        fontFiles,
        loadSystemFonts: false,
        defaultFontFamily: "DejaVu Sans"
      }
    : {
        loadSystemFonts: true
      };

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapTitleLines(title: string, maxChars = 28): string[] {
  const trimmed = title.trim();
  if (trimmed.length <= 24) {
    return [trimmed];
  }

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  if (lines.length <= 2) {
    return lines;
  }

  const first = lines[0];
  const rest = lines.slice(1).join(" ");
  const clippedRest = rest.length > maxChars + 2 ? `${rest.slice(0, maxChars - 1).trimEnd()}…` : rest;
  return [first, clippedRest];
}

export function renderOgPng(args: {
  title: string;
  subtitle: string;
  costLabel: string;
  accent: string;
}) {
  const titleLines = wrapTitleLines(args.title);
  const isTwoLine = titleLines.length > 1;
  const titleFontSize = isTwoLine ? 50 : 60;
  const titleMarkup = isTwoLine
    ? `
      <text x="96" y="236" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'DejaVu Sans', Helvetica, Arial, sans-serif" font-size="${titleFontSize}" font-weight="600">${escapeText(titleLines[0])}</text>
      <text x="96" y="298" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'DejaVu Sans', Helvetica, Arial, sans-serif" font-size="${titleFontSize}" font-weight="600">${escapeText(titleLines[1])}</text>
    `
    : `<text x="96" y="275" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'DejaVu Sans', Helvetica, Arial, sans-serif" font-size="${titleFontSize}" font-weight="600">${escapeText(titleLines[0])}</text>`;
  const subtitleY = isTwoLine ? 360 : 342;

  const svg = `
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeText(args.title)}">
      <rect width="1200" height="630" fill="#fbfafc" />
      <rect x="40" y="40" width="1120" height="550" rx="18" fill="#f3f1f6" stroke="#d2ccdc" stroke-width="2" />
      <text x="96" y="120" fill="#232433" font-family="-apple-system, BlinkMacSystemFont, 'DejaVu Sans', Helvetica, Arial, sans-serif" font-size="34" font-weight="600">CloudEstimate</text>
      ${titleMarkup}
      <text x="96" y="${subtitleY}" fill="#575b70" font-family="-apple-system, BlinkMacSystemFont, 'DejaVu Sans', Helvetica, Arial, sans-serif" font-size="32">${escapeText(args.subtitle)}</text>
      <text x="96" y="520" fill="#232433" font-family="ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', Consolas, monospace" font-size="46" font-weight="600">${escapeText(args.costLabel)}</text>
      <rect x="1040" y="490" width="72" height="72" rx="12" fill="${args.accent}" />
    </svg>
  `;

  return new Resvg(svg, { font: resvgFontOptions }).render().asPng();
}
