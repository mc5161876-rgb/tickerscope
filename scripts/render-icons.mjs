// Render the TickerScope icon set from the one master SVG (MAR-51):
//   assets/icon-512.png, assets/icon.ico (16..256), frontend/public/icon-192.png, frontend/public/apple-touch-icon.png
import sharp from "sharp";
import pngToIco from "png-to-ico";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets", "tickerscope-mark.svg");
const svg = await fs.readFile(source);

const render = async (size, file) => {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(root, file));
};

await render(512, "assets/icon-512.png");
await render(256, "assets/icon-256.png");
await render(192, "frontend/public/icon-192.png");
// iOS home-screen icon: opaque square, iOS rounds it itself
await sharp(svg, { density: 384 })
  .resize(180, 180)
  .flatten({ background: "#0B0D10" })
  .png()
  .toFile(path.join(root, "frontend", "public", "apple-touch-icon.png"));

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoBuffers = await Promise.all(icoSizes.map((size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()));
await fs.writeFile(path.join(root, "assets", "icon.ico"), await pngToIco(icoBuffers));

console.log("Rendered TickerScope icons from assets/tickerscope-mark.svg (512/256/192/180 png + ico", icoSizes.join("/"), ")");
