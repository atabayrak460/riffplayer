import path from 'path';
import { fileURLToPath } from 'url';
import sharp, { type Metadata, type OverlayOptions, type Sharp } from 'sharp';

// Renders the "share" images (a song card, and a playlist as one or more tall pages) as PNGs.
// Text is drawn through pango with a font file bundled in server/assets/share (Noto Sans, SIL OFL),
// so the output never depends on fonts installed on the server — the Docker image has none.
// Noto Sans covers Latin (incl. Turkish), Greek and Cyrillic; CJK titles would show missing-glyph boxes.

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'share');
const FONT = { regular: path.join(ASSETS, 'NotoSans-Regular.ttf'), bold: path.join(ASSETS, 'NotoSans-Bold.ttf') };
const LOGO = path.join(ASSETS, 'logo-mark.png');

export type CardSize = 'story' | 'post';
export const CARD_SIZES: Record<CardSize, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 }, // 9:16 — Stories
  post: { width: 1080, height: 1350 }, // 4:5 — feed posts
};

export interface SongCardInput {
  title: string;
  artist: string;
  /** Left out when the file has no album tag. */
  album?: string | null;
  coverPath: string | null;
  size: CardSize;
}

export interface PlaylistItem {
  title: string;
  artist: string;
  coverPath: string | null;
}

export interface PlaylistCardInput {
  name: string;
  description?: string | null;
  owner: string;
  songCount: number;
  coverPath: string | null;
  items: PlaylistItem[];
}

const WHITE = '#ffffff';
const SOFT = '#d6dbe6';

// ── text ─────────────────────────────────────────────────────────────────────

const escapeMarkup = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Tag text is untrusted: no control characters in anything that is drawn.
const clean = (t: string) =>
  [...t].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();

interface TextOptions {
  size: number;
  bold?: boolean;
  color?: string;
  width: number;
  maxLines: number;
  align?: 'left' | 'center';
}

async function drawText(text: string, o: TextOptions): Promise<Buffer> {
  const render = (value: string, size: number) =>
    sharp({
      text: {
        text: `<span font_weight="${o.bold ? 700 : 400}" font_size="${size * 1024}" foreground="${o.color ?? WHITE}">${escapeMarkup(value)}</span>`,
        font: 'Noto Sans',
        fontfile: o.bold ? FONT.bold : FONT.regular,
        width: o.width,
        rgba: true,
        dpi: 72,
        wrap: 'word-char',
        align: o.align === 'center' ? 'centre' : 'left',
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });

  const fits = (height: number, size: number) => height <= Math.ceil(size * 1.3) * o.maxLines + 4;
  let value = clean(text) || ' ';
  let size = o.size;
  let out = await render(value, size);
  // Shrink a little first (down to 80 %), then cut the text and add an ellipsis.
  while (!fits(out.info.height, size) && size > o.size * 0.8) {
    size = Math.max(Math.floor(size * 0.92), Math.floor(o.size * 0.8));
    out = await render(value, size);
  }
  if (!fits(out.info.height, size)) {
    let lo = 1;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const r = await render(`${value.slice(0, mid).trimEnd()}…`, size);
      if (fits(r.info.height, size)) lo = mid;
      else hi = mid - 1;
    }
    value = `${value.slice(0, lo).trimEnd()}…`;
    out = await render(value, size);
  }
  return out.data;
}

async function textHeight(png: Buffer): Promise<number> {
  return (await sharp(png).metadata()).height ?? 0;
}

// ── pieces ───────────────────────────────────────────────────────────────────

function hashHue(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

/** A soft, darkened, blurred copy of the cover fills the page — or a gradient from the title when there is none. */
async function background(coverPath: string | null, width: number, height: number, seed: string): Promise<Buffer> {
  let base: Sharp;
  if (coverPath) {
    try {
      // Blur a small version and scale it up: same look, far less work.
      const small = await sharp(coverPath)
        .resize(Math.round(width / 6), Math.round(height / 6), { fit: 'cover' })
        .blur(14)
        .modulate({ brightness: 0.6, saturation: 1.25 })
        .png()
        .toBuffer();
      base = sharp(small).resize(width, height, { fit: 'fill' });
    } catch {
      base = sharp(await gradient(width, height, seed));
    }
  } else {
    base = sharp(await gradient(width, height, seed));
  }
  // A darkening ramp keeps white text readable whatever the cover looks like.
  const shade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0" stop-color="#000" stop-opacity="0.25"/>
         <stop offset="0.55" stop-color="#000" stop-opacity="0.35"/>
         <stop offset="1" stop-color="#000" stop-opacity="0.7"/>
       </linearGradient></defs>
       <rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );
  return base.composite([{ input: shade }]).png().toBuffer();
}

function gradient(width: number, height: number, seed: string): Promise<Buffer> {
  const h = hashHue(seed);
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
         <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
           <stop offset="0" stop-color="hsl(${h},55%,38%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},60%,18%)"/>
         </linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

/** A square cover with rounded corners; an empty tile with a note when there is none. */
async function tile(coverPath: string | null, size: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  );
  let image: Buffer;
  try {
    if (!coverPath) throw new Error('no cover');
    image = await sharp(coverPath).resize(size, size, { fit: 'cover' }).png().toBuffer();
  } catch {
    image = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
           <rect width="100%" height="100%" fill="#2b3447"/>
           <g transform="translate(${size / 2 - 27 * (size / 110)},${size / 2 - 25 * (size / 110)}) scale(${size / 110})" fill="#6b7790">
             <path d="M22 4v22.5A10 10 0 1 0 28 36V12h14V4H22z"/></g></svg>`,
      ),
    )
      .png()
      .toBuffer();
  }
  return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function shadow(size: number, radius: number, blur: number): Promise<Buffer> {
  const pad = blur * 3;
  return sharp({
    create: { width: size + pad * 2, height: size + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#000" fill-opacity="0.55"/></svg>`,
        ),
        left: pad,
        top: pad,
      },
    ])
    .blur(blur)
    .png()
    .toBuffer();
}

/** The logo (black on transparent in the repo) turned white, at [height] px. */
async function logo(height: number): Promise<Buffer> {
  return sharp(LOGO).negate({ alpha: false }).resize({ height }).png().toBuffer();
}

/** Small "RiffPlayer" signature centred at the bottom: logo mark + name. */
async function footer(width: number, y: number, extra?: string): Promise<OverlayOptions[]> {
  const mark = await logo(52);
  const markW = (await sharp(mark).metadata()).width ?? 52;
  const name = await drawText('RiffPlayer', { size: 34, bold: true, color: SOFT, width: 400, maxLines: 1 });
  const nameMeta = await sharp(name).metadata();
  const gap = 16;
  const total = markW + gap + (nameMeta.width ?? 0);
  const left = Math.round((width - total) / 2);
  const out: OverlayOptions[] = [
    { input: mark, left, top: y },
    { input: name, left: left + markW + gap, top: y + Math.round((52 - (nameMeta.height ?? 0)) / 2) },
  ];
  if (extra) {
    const t = await drawText(extra, { size: 26, color: SOFT, width: 400, maxLines: 1, align: 'center' });
    const m = await sharp(t).metadata();
    out.push({ input: t, left: Math.round((width - (m.width ?? 0)) / 2), top: y + 70 });
  }
  return out;
}

// ── song card ────────────────────────────────────────────────────────────────

export async function renderSongCard(input: SongCardInput): Promise<Buffer> {
  const { width, height } = CARD_SIZES[input.size];
  const coverSize = input.size === 'story' ? 800 : 700;
  const margin = 90;
  const textWidth = width - margin * 2;
  const footerReserve = 190; // bottom space kept for the signature

  // Lay the text out first, so the whole block (cover + text) can be centred in the free space.
  const title = await drawText(input.title, { size: 66, bold: true, width: textWidth, maxLines: 2, align: 'center' });
  const artist = await drawText(input.artist, { size: 44, color: SOFT, width: textWidth, maxLines: 1, align: 'center' });
  const albumName = input.album ? clean(input.album) : '';
  const album = albumName
    ? await drawText(albumName, { size: 34, color: '#aab3c5', width: textWidth, maxLines: 1, align: 'center' })
    : null;
  const metas = await Promise.all([title, artist, ...(album ? [album] : [])].map((b) => sharp(b).metadata()));
  const textBlock = metas.reduce((sum, m) => sum + (m.height ?? 0), 0) + 18 + (album ? 8 : 0);
  const blockHeight = coverSize + 80 + textBlock;
  const coverTop = Math.max(60, Math.round((height - footerReserve - blockHeight) / 2));

  const layers: OverlayOptions[] = [];
  const blur = 36;
  const pad = blur * 3;
  layers.push({ input: await shadow(coverSize, 36, blur), left: Math.round((width - coverSize) / 2) - pad, top: coverTop - pad + 24 });
  layers.push({ input: await tile(input.coverPath, coverSize, 36), left: Math.round((width - coverSize) / 2), top: coverTop });

  let y = coverTop + coverSize + 80;
  const place = (img: Buffer, meta: Metadata, gap: number) => {
    layers.push({ input: img, left: Math.round((width - (meta.width ?? 0)) / 2), top: y });
    y += (meta.height ?? 0) + gap;
  };
  place(title, metas[0], 18);
  place(artist, metas[1], 8);
  if (album) place(album, metas[2], 0);

  layers.push(...(await footer(width, height - 150)));

  return sharp(await background(input.coverPath, width, height, `${input.title}${input.artist}`))
    .composite(layers)
    .png()
    .toBuffer();
}

// ── playlist pages ───────────────────────────────────────────────────────────

const PL = {
  width: 1080,
  height: 1920,
  margin: 72,
  gap: 48,
  cover: 132, // song cover in the grid
  row: 176,
  headerHeight: 470,
  topOther: 90,
  footerHeight: 130,
  maxPages: 8,
};

const colWidth = (PL.width - PL.margin * 2 - PL.gap) / 2;

function rowsOnPage(page: number): number {
  const top = page === 0 ? PL.margin + PL.headerHeight : PL.topOther;
  return Math.floor((PL.height - top - PL.footerHeight) / PL.row);
}

/** How the songs are split over pages: the first page also holds the header, so it fits fewer. */
export function playlistPageCount(songCount: number): number {
  let remaining = songCount;
  let pages = 0;
  while (pages < PL.maxPages) {
    remaining -= rowsOnPage(pages) * 2;
    pages++;
    if (remaining <= 0) break;
  }
  return pages;
}

/** The most songs a playlist share can show (the pages are capped); the rest is summarised as "+ N more". */
export function playlistCapacity(): number {
  let total = 0;
  for (let p = 0; p < PL.maxPages; p++) total += rowsOnPage(p) * 2;
  return total;
}

export async function renderPlaylistPage(input: PlaylistCardInput, page: number): Promise<Buffer> {
  const pages = playlistPageCount(input.items.length);
  const layers: OverlayOptions[] = [];
  let top = PL.topOther;

  if (page === 0) {
    const cover = 300;
    layers.push({ input: await shadow(cover, 28, 24), left: PL.margin - 72, top: PL.margin - 72 + 18 });
    layers.push({ input: await tile(input.coverPath, cover, 28), left: PL.margin, top: PL.margin });
    const textLeft = PL.margin + cover + 44;
    const textWidth = PL.width - textLeft - PL.margin;
    let y = PL.margin + 6;
    const name = await drawText(input.name, { size: 58, bold: true, width: textWidth, maxLines: 3 });
    layers.push({ input: name, left: textLeft, top: y });
    y += (await textHeight(name)) + 14;
    const meta = await drawText(`${input.owner} · ${input.songCount} ${input.songCount === 1 ? 'song' : 'songs'}`, {
      size: 30, color: SOFT, width: textWidth, maxLines: 1,
    });
    layers.push({ input: meta, left: textLeft, top: y });
    const description = input.description ? clean(input.description) : '';
    if (description) {
      const d = await drawText(description, { size: 30, color: '#aab3c5', width: PL.width - PL.margin * 2, maxLines: 3 });
      layers.push({ input: d, left: PL.margin, top: PL.margin + cover + 40 });
    }
    top = PL.margin + PL.headerHeight;
  }

  // Which songs belong on this page.
  let start = 0;
  for (let p = 0; p < page; p++) start += rowsOnPage(p) * 2;
  const count = rowsOnPage(page) * 2;
  const slice = input.items.slice(start, start + count);

  const textWidth = colWidth - PL.cover - 20;
  for (const [i, item] of slice.entries()) {
    // Row-major: left, right, left, right…
    const col = i % 2;
    const row = Math.floor(i / 2);
    const left = PL.margin + col * (colWidth + PL.gap);
    const y = top + row * PL.row;
    layers.push({ input: await tile(item.coverPath, PL.cover, 14), left, top: y });
    const t = await drawText(item.title, { size: 30, bold: true, width: textWidth, maxLines: 2 });
    const th = await textHeight(t);
    layers.push({ input: t, left: left + PL.cover + 20, top: y + 4 });
    const a = await drawText(item.artist, { size: 26, color: SOFT, width: textWidth, maxLines: 1 });
    layers.push({ input: a, left: left + PL.cover + 20, top: y + 4 + th + 4 });
  }

  const more = page === pages - 1 && input.songCount > input.items.length ? `+ ${input.songCount - input.items.length} more` : undefined;
  const pageNote = pages > 1 ? `${page + 1} / ${pages}` : undefined;
  layers.push(...(await footer(PL.width, PL.height - PL.footerHeight + 10, more ?? pageNote)));

  return sharp(await background(input.coverPath, PL.width, PL.height, input.name))
    .composite(layers)
    .png()
    .toBuffer();
}
