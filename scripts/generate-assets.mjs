import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = process.cwd();
const publicDir = path.join(root, "public");
const logoPath = path.join(publicDir, "cloudestimate-logo.png");

async function ensureDir() {
  await fs.mkdir(publicDir, { recursive: true });
}

function renderSvg(size, logoDataUri) {
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CloudEstimate favicon">
      <defs>
        <clipPath id="icon-mask">
          <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" />
        </clipPath>
      </defs>
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#dac6e5" />
      <image href="${logoDataUri}" width="${size}" height="${size}" clip-path="url(#icon-mask)" preserveAspectRatio="xMidYMid slice" />
    </svg>
  `;
}

async function writePng(filename, size, logoDataUri) {
  const svg = renderSvg(size, logoDataUri);
  const png = new Resvg(svg).render().asPng();
  await fs.writeFile(path.join(publicDir, filename), png);
}

await ensureDir();
const logo = await fs.readFile(logoPath);
const logoDataUri = `data:image/png;base64,${logo.toString("base64")}`;
await writePng("favicon-16x16.png", 16, logoDataUri);
await writePng("favicon-32x32.png", 32, logoDataUri);
await fs.writeFile(path.join(publicDir, "favicon.svg"), renderSvg(32, logoDataUri));

console.log("Generated favicon assets.");
