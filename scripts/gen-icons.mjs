/**
 * Renders every raster icon from the hand-written mark in public/favicon.svg.
 *
 *   node scripts/gen-icons.mjs      (or: npm run icons)
 *
 * Outputs (all committed, re-run after changing the SVG):
 *   public/icons/icon-192.png, icon-512.png                    rounded tile, purpose "any"
 *   public/icons/icon-maskable-192.png, icon-maskable-512.png  full-bleed, glyph inside the safe zone
 *   public/apple-touch-icon.png                                180 px, full-bleed, opaque (iOS rounds it)
 *   public/icons/badge-96.png                                  white glyph on transparent (Android badge)
 *   public/favicon.ico                                         16, 32 and 48 px PNG images in one ICO
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(rootDir, 'public');
const iconsDir = join(publicDir, 'icons');

/** Side of the square viewBox of favicon.svg. */
const VIEWBOX = 512;
/** Rasterise at twice the viewBox and scale down, for clean edges at every size. */
const RENDER_DENSITY = 144;
/** Darkest colour of the tile gradient; only used to drop the alpha channel of full-bleed icons. */
const TILE_COLOR = '#0d2a1c';
/** Maskable icons may be cropped to a centred circle with a radius of 40% of the icon. */
const SAFE_ZONE_RADIUS = 0.4;
/** Glyph scale on maskable icons: keeps the glyph comfortably inside the safe zone. */
const MASKABLE_GLYPH_SCALE = 0.82;
const BADGE_SIZE = 96;
const BADGE_PADDING = 8;
const ICO_SIZES = [16, 32, 48];
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** Ids of the gradients in favicon.svg that paint the tile, bottom layer first. */
const TILE_GRADIENTS = ['sb-bg', 'sb-glow'];

const source = await readFile(join(publicDir, 'favicon.svg'), 'utf8');
/** The artwork without XML comments, so prose in a comment can never match a pattern below. */
const artwork = source.replace(/<!--[\s\S]*?-->/g, '');
const defs = extract(/<defs>[\s\S]*?<\/defs>/, 'the <defs> block');
/** The glyph group is flat (no nested groups), so its first closing tag ends it. */
const glyph = extract(/<g id="glyph"[^>]*>[\s\S]*?<\/g>/, 'the <g id="glyph"> group');
for (const id of TILE_GRADIENTS) {
  if (!defs.includes(`id="${id}"`)) {
    throw new Error(`public/favicon.svg: gradient "${id}" is missing from <defs>`);
  }
}

function extract(pattern, description) {
  const match = artwork.match(pattern);
  if (!match) throw new Error(`public/favicon.svg: could not find ${description}`);
  return match[0];
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}">${body}</svg>`;
}

/** The glyph, scaled around the centre of the viewBox. */
function glyphAt(scale) {
  const offset = (VIEWBOX * (1 - scale)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g>`;
}

/** Square tile without rounded corners or edge highlight, for platforms that apply their own mask. */
function fullBleed(glyphScale) {
  const background = TILE_GRADIENTS.map(
    (id) => `<rect width="${VIEWBOX}" height="${VIEWBOX}" fill="url(#${id})"/>`,
  ).join('');
  return svg(defs + background + glyphAt(glyphScale));
}

function rasterise(markup, size) {
  return sharp(Buffer.from(markup), { density: RENDER_DENSITY }).resize(size, size);
}

function renderPng(markup, size) {
  return rasterise(markup, size).png({ compressionLevel: 9 }).toBuffer();
}

/** Full-bleed icons must not carry transparency (iOS would show black, Android a halo). */
function renderOpaquePng(markup, size) {
  return rasterise(markup, size)
    .flatten({ background: TILE_COLOR })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Fails when any part of the glyph would be cut off by a circular maskable crop. */
async function assertInsideSafeZone(markup) {
  const { data, info } = await rasterise(markup, VIEWBOX)
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const centre = (info.width - 1) / 2;
  const limit = info.width * SAFE_ZONE_RADIUS;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] > 0 && Math.hypot(x - centre, y - centre) > limit) {
        throw new Error('The glyph leaves the maskable safe zone; lower MASKABLE_GLYPH_SCALE');
      }
    }
  }
}

/** White glyph on transparent, cropped to its own bounds and centred with a small padding. */
async function renderBadge() {
  const inner = BADGE_SIZE - 2 * BADGE_PADDING;
  const cropped = await sharp(Buffer.from(svg(glyphAt(1))), { density: RENDER_DENSITY })
    .trim()
    .png()
    .toBuffer();
  return sharp(cropped)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .extend({
      top: BADGE_PADDING,
      bottom: BADGE_PADDING,
      left: BADGE_PADDING,
      right: BADGE_PADDING,
      background: TRANSPARENT,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Packs PNG images into an ICO container: a 6-byte ICONDIR header, one 16-byte
 * ICONDIRENTRY per image, then the PNG files themselves.
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // resource type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width in pixels
    entry.writeUInt8(size, 1); // height in pixels
    entry.writeUInt8(0, 2); // palette size: none
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // size of the image data
    entry.writeUInt32LE(offset, 12); // offset of the image data
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

async function write(path, data) {
  await writeFile(path, data);
  process.stdout.write(`${relative(rootDir, path)}  ${data.length} bytes\n`);
}

await mkdir(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  await write(join(iconsDir, `icon-${size}.png`), await renderPng(source, size));
}

await assertInsideSafeZone(svg(glyphAt(MASKABLE_GLYPH_SCALE)));
for (const size of [192, 512]) {
  await write(
    join(iconsDir, `icon-maskable-${size}.png`),
    await renderOpaquePng(fullBleed(MASKABLE_GLYPH_SCALE), size),
  );
}

await write(join(publicDir, 'apple-touch-icon.png'), await renderOpaquePng(fullBleed(1), 180));
await write(join(iconsDir, `badge-${BADGE_SIZE}.png`), await renderBadge());

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, png: await renderPng(source, size) });
}
await write(join(publicDir, 'favicon.ico'), packIco(icoImages));
