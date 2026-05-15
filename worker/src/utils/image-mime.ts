const GENERIC_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/x-binary',
  'binary/octet-stream',
  'unknown/unknown'
]);

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/svg': 'image/svg+xml',
  'image/ico': 'image/vnd.microsoft.icon',
  'image/x-icon': 'image/vnd.microsoft.icon',
  'image/x-ms-bmp': 'image/bmp',
  'image/x-bmp': 'image/bmp'
};

const IMAGE_EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  pjp: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/vnd.microsoft.icon',
  cur: 'image/x-icon',
  heic: 'image/heic',
  heics: 'image/heic-sequence',
  heif: 'image/heif',
  heifs: 'image/heif-sequence',
  jp2: 'image/jp2',
  jpg2: 'image/jp2',
  j2k: 'image/jp2',
  jpf: 'image/jpx',
  jpx: 'image/jpx',
  jpm: 'image/jpm',
  jxl: 'image/jxl',
  jls: 'image/jls',
  jxr: 'image/jxr',
  hdp: 'image/vnd.ms-photo',
  wdp: 'image/vnd.ms-photo',
  psd: 'image/vnd.adobe.photoshop',
  dds: 'image/vnd-ms.dds',
  exr: 'image/x-exr',
  hdr: 'image/vnd.radiance',
  tga: 'image/x-tga',
  pnm: 'image/x-portable-anymap',
  pbm: 'image/x-portable-bitmap',
  pgm: 'image/x-portable-graymap',
  ppm: 'image/x-portable-pixmap',
  pam: 'image/x-portable-arbitrarymap',
  qoi: 'image/qoi',
  xbm: 'image/x-xbitmap',
  xpm: 'image/x-xpixmap',
  pcx: 'image/x-pcx',
  ras: 'image/x-cmu-raster',
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  nrw: 'image/x-nikon-nrw',
  arw: 'image/x-sony-arw',
  srf: 'image/x-sony-srf',
  sr2: 'image/x-sony-sr2',
  orf: 'image/x-olympus-orf',
  rw2: 'image/x-panasonic-rw2',
  raf: 'image/x-fuji-raf',
  pef: 'image/x-pentax-pef',
  rwl: 'image/x-leica-rwl',
  '3fr': 'image/x-hasselblad-3fr',
  erf: 'image/x-epson-erf',
  kdc: 'image/x-kodak-kdc',
  mos: 'image/x-leaf-mos',
  mrw: 'image/x-minolta-mrw',
  x3f: 'image/x-sigma-x3f',
  raw: 'image/x-raw'
};

export function normalizeMimeType(raw?: string | null): string | null {
  const value = String(raw || '').split(';')[0].trim().toLowerCase();
  if (!value || value === 'image/*' || !value.includes('/')) return null;
  const normalized = MIME_ALIASES[value] || value;
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\+[a-z0-9!#$&^_.+-]+)?$/.test(normalized)
    ? normalized
    : null;
}

export function inferImageMimeType(source?: string | null, bytes?: Uint8Array | ArrayBuffer | null): string | null {
  return detectImageMimeFromBytes(bytes) || getImageMimeFromExtension(source);
}

export function resolveUploadMimeType(params: {
  fileName?: string | null;
  declaredMime?: string | null;
  contentMime?: string | null;
  bytes?: Uint8Array | ArrayBuffer | null;
}): string {
  const declared = normalizeMimeType(params.declaredMime) || normalizeMimeType(params.contentMime);
  const inferred = inferImageMimeType(params.fileName, params.bytes);

  if (!declared || GENERIC_MIME_TYPES.has(declared)) {
    return inferred || 'application/octet-stream';
  }

  return declared;
}

export function resolveFetchedImageMimeType(params: {
  source?: string | null;
  declaredMime?: string | null;
  bytes?: Uint8Array | ArrayBuffer | null;
}): string {
  const inferred = inferImageMimeType(params.source, params.bytes);
  if (inferred) return inferred;
  return normalizeMimeType(params.declaredMime) || 'application/octet-stream';
}

function getImageMimeFromExtension(source?: string | null): string | null {
  let text = String(source || '').trim();
  if (!text) return null;

  try {
    text = new URL(text).pathname;
  } catch {
    text = text.split(/[?#]/)[0];
  }

  const fileName = text.split('/').pop() || '';
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  if (!match) return null;
  return IMAGE_EXTENSION_MIME[match[1].toLowerCase()] || null;
}

function detectImageMimeFromBytes(input?: Uint8Array | ArrayBuffer | null): string | null {
  const bytes = input instanceof Uint8Array
    ? input
    : input
      ? new Uint8Array(input)
      : null;
  if (!bytes || bytes.length < 2) return null;

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  const gifHeader = ascii(bytes, 0, 6);
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp';
  if (
    bytes.length >= 4 &&
    ((ascii(bytes, 0, 4) === 'II*\u0000') || (ascii(bytes, 0, 4) === 'MM\u0000*'))
  ) {
    return 'image/tiff';
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return 'image/vnd.microsoft.icon';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) return 'image/jxl';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x0c &&
    ascii(bytes, 4, 8) === 'JXL \r\n\x87\n'
  ) {
    return 'image/jxl';
  }

  const isoMime = detectIsoBmffImageMime(bytes);
  if (isoMime) return isoMime;

  const text = ascii(bytes, 0, Math.min(bytes.length, 512)).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return null;
}

function detectIsoBmffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== 'ftyp') return null;

  const brands = new Set<string>([ascii(bytes, 8, 4).toLowerCase()]);
  for (let i = 16; i + 4 <= Math.min(bytes.length, 64); i += 4) {
    brands.add(ascii(bytes, i, 4).toLowerCase());
  }

  if (brands.has('avif') || brands.has('avis')) return 'image/avif';
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm'].some(brand => brands.has(brand))) {
    return 'image/heic';
  }
  if (brands.has('mif1') || brands.has('msf1')) return 'image/heif';
  if (brands.has('jp2 ')) return 'image/jp2';
  if (brands.has('jpx ')) return 'image/jpx';
  if (brands.has('jpm ')) return 'image/jpm';
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}
