// Растеризация public/icon.svg → PNG 192/512 для PWA-манифеста.
// Запуск: node scripts/gen-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "icon.svg"), "utf8");

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: true },
    background: "#000000",
  });
  const png = resvg.render().asPng();
  const out = join(root, "public", `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`wrote public/icon-${size}.png (${png.length} bytes)`);
}
