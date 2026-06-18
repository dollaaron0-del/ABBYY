'use strict';

const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const db = require('../database/db');

// Sprachdaten lokal zwischenspeichern, damit sie nur EINMAL geladen werden
// und im abgeschotteten Netzwerk nicht wiederholt aus dem Internet kommen müssen.
const TESS_CACHE = process.env.TESSDATA_PATH || path.join(__dirname, '../../../data/tessdata');
try { fs.mkdirSync(TESS_CACHE, { recursive: true }); } catch (_) {}

function getOcrLanguage() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ocr_language'").get();
    return row ? row.value : 'deu';
  } catch {
    return 'deu';
  }
}

// --- Worker-Singleton -------------------------------------------------------
// Tesseract-Worker sind teuer in der Erstellung (WASM-Init + Sprachdaten laden).
// Wir erstellen den Worker EINMAL pro Sprache und verwenden ihn wieder.
const workers = new Map(); // language -> { worker, ready }

async function getWorker(language) {
  if (workers.has(language)) {
    return workers.get(language);
  }

  const worker = await Tesseract.createWorker(language, 1, {
    logger: () => {},
    cachePath: TESS_CACHE,
    langPath: TESS_CACHE,
    gzip: true,
  });

  await worker.setParameters({
    tessedit_pageseg_mode: '3',  // auto without OSD (avoids osd.traineddata requirement)
    preserve_interword_spaces: '1',
  });

  workers.set(language, worker);
  return worker;
}

/**
 * Hilfsfunktion: bricht eine Operation nach n Millisekunden ab,
 * damit OCR niemals endlos hängen kann.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} Zeitüberschreitung nach ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Bild vorverarbeiten für bessere OCR-Qualität.
 * Sehr große Bilder werden verkleinert (beschleunigt OCR deutlich).
 */
async function preprocessImage(inputPath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_prep_${Date.now()}.png`);
  await sharp(inputPath)
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .png({ compressionLevel: 1 })
    .toFile(tmpPath);
  return tmpPath;
}

const OCR_TIMEOUT_MS = 120000; // 2 Minuten pro Dokument maximal

/**
 * Text aus einer PDF-Datei extrahieren.
 * Converts the first page to an image via Ghostscript (or pdftoppm), then OCRs it.
 */
async function extractFromPdf(filePath, language) {
  let imgPath = null;
  try {
    imgPath = await pdfFirstPageToImage(filePath);
    return await extractFromImage(imgPath, language);
  } catch (convErr) {
    // Fallback: try Tesseract directly on PDF (slower but sometimes works)
    console.warn(`[OCR] PDF-Bildkonvertierung fehlgeschlagen, direkter Fallback: ${convErr.message}`);
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(filePath), OCR_TIMEOUT_MS, 'PDF-OCR:');
    return {
      text: result.data.text || '',
      confidence: Math.round(result.data.confidence || 0),
    };
  } finally {
    if (imgPath && fs.existsSync(imgPath)) fs.unlink(imgPath, () => {});
  }
}

/**
 * Text aus Bilddateien extrahieren (jpg, png, tiff, bmp).
 */
async function extractFromImage(filePath, language) {
  let preprocessedPath = null;
  try {
    preprocessedPath = await preprocessImage(filePath);
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(preprocessedPath), OCR_TIMEOUT_MS, 'Bild-OCR:');
    return {
      text: result.data.text || '',
      confidence: Math.round(result.data.confidence || 0),
    };
  } catch (err) {
    // Fallback: ohne Vorverarbeitung direkt erkennen
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(filePath), OCR_TIMEOUT_MS, 'Bild-OCR (Fallback):');
    return {
      text: result.data.text || '',
      confidence: Math.round(result.data.confidence || 0),
    };
  } finally {
    if (preprocessedPath && fs.existsSync(preprocessedPath)) {
      fs.unlink(preprocessedPath, () => {});
    }
  }
}

/**
 * Haupteinstieg OCR.
 */
async function extractText(filePath, fileType) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Datei nicht gefunden: ${filePath}`);
  }

  const language = getOcrLanguage();
  const type = (fileType || '').toLowerCase().replace('.', '');

  let result;
  if (type === 'pdf') {
    result = await extractFromPdf(filePath, language);
  } else if (['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp'].includes(type)) {
    result = await extractFromImage(filePath, language);
  } else {
    throw new Error(`Nicht unterstützter Dateityp für OCR: ${type}`);
  }

  result.text = cleanOcrText(result.text);
  return result;
}

function cleanOcrText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .trim();
}

function hasEnoughText(text) {
  if (!text) return false;
  const cleaned = text.replace(/\s/g, '');
  return cleaned.length >= 30;
}

/**
 * Find the best available PDF-to-image tool on this system.
 * Returns { tool: 'pdftoppm'|'ghostscript', exe: string } or null.
 */
function findPdfTool() {
  const { execSync } = require('child_process');
  // Try pdftoppm first (available in Docker with poppler-utils)
  try {
    execSync('pdftoppm -v', { stdio: 'ignore' });
    return { tool: 'pdftoppm', exe: 'pdftoppm' };
  } catch (_) {}
  // Try Ghostscript – check common Windows and Linux paths
  const gsCandidates = [
    'gswin64c', 'gswin32c', 'gs',
    'C:\\Program Files\\gs\\gs9.26\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.04.0\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.03.1\\bin\\gswin64c.exe',
  ];
  // Also scan C:\Program Files\gs\* dynamically
  try {
    const gsDir = 'C:\\Program Files\\gs';
    if (fs.existsSync(gsDir)) {
      for (const ver of fs.readdirSync(gsDir)) {
        const candidate = path.join(gsDir, ver, 'bin', 'gswin64c.exe');
        if (fs.existsSync(candidate)) gsCandidates.unshift(candidate);
      }
    }
  } catch (_) {}
  for (const exe of gsCandidates) {
    try {
      execSync(`"${exe}" --version`, { stdio: 'ignore' });
      return { tool: 'ghostscript', exe };
    } catch (_) {}
  }
  return null;
}

let _pdfTool = undefined; // cached after first call

/**
 * Convert the first page of a PDF to a PNG temp file.
 * Uses pdftoppm if available (Docker), otherwise Ghostscript (Windows).
 * Returns the path to the created PNG. Caller must delete it when done.
 */
async function pdfFirstPageToImage(pdfPath) {
  if (_pdfTool === undefined) _pdfTool = findPdfTool();
  if (!_pdfTool) throw new Error('Kein PDF-Konvertierer gefunden (weder pdftoppm noch Ghostscript)');

  const tmpOut = path.join(os.tmpdir(), `pdfprev_${Date.now()}.png`);

  if (_pdfTool.tool === 'pdftoppm') {
    const tmpBase = tmpOut.replace('.png', '');
    await execFileAsync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', pdfPath, tmpBase]);
    for (const suffix of ['-1.png', '-01.png', '-001.png']) {
      const candidate = tmpBase + suffix;
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error('pdftoppm: kein Ausgabebild gefunden');
  }

  // Ghostscript
  await execFileAsync(_pdfTool.exe, [
    '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-sDEVICE=png16m', '-r150',
    '-dFirstPage=1', '-dLastPage=1',
    `-sOutputFile=${tmpOut}`,
    pdfPath,
  ]);
  if (!fs.existsSync(tmpOut)) throw new Error('Ghostscript: kein Ausgabebild gefunden');
  return tmpOut;
}

/**
 * Get a path to a renderable PNG for any supported document type.
 * For images: returns original path (temp=false).
 * For PDFs: renders page 1 to a temp PNG (temp=true – caller must delete).
 */
async function getPreviewImagePath(filePath, fileType) {
  const type = (fileType || '').toLowerCase().replace('.', '');
  if (type === 'pdf') {
    const imgPath = await pdfFirstPageToImage(filePath);
    return { imgPath, isTemp: true };
  }
  return { imgPath: filePath, isTemp: false };
}

/**
 * OCR a specific rectangular region of a document.
 * @param {string} filePath
 * @param {string} fileType
 * @param {{ x: number, y: number, w: number, h: number }} region  – all values 0-1 fractions
 */
async function extractRegion(filePath, fileType, region) {
  const { imgPath, isTemp } = await getPreviewImagePath(filePath, fileType);
  const tmpCrop = path.join(os.tmpdir(), `crop_${Date.now()}.png`);

  try {
    const meta = await sharp(imgPath).metadata();
    const imgW = meta.width || 1;
    const imgH = meta.height || 1;

    const left   = Math.max(0, Math.round(region.x * imgW));
    const top    = Math.max(0, Math.round(region.y * imgH));
    const width  = Math.min(imgW - left, Math.max(4, Math.round(region.w * imgW)));
    const height = Math.min(imgH - top,  Math.max(4, Math.round(region.h * imgH)));

    // Upscale small regions so Tesseract has enough resolution
    const scale = Math.max(1, Math.ceil(120 / Math.min(width, height)));

    await sharp(imgPath)
      .extract({ left, top, width, height })
      .resize({ width: width * scale, height: height * scale, fit: 'fill', kernel: 'lanczos3' })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .png({ compressionLevel: 1 })
      .toFile(tmpCrop);

    const language = getOcrLanguage();
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(tmpCrop), 30000, 'Region-OCR:');

    return {
      text: cleanOcrText(result.data.text || '').trim(),
      confidence: Math.round(result.data.confidence || 0),
    };
  } finally {
    if (isTemp && fs.existsSync(imgPath)) fs.unlink(imgPath, () => {});
    if (fs.existsSync(tmpCrop)) fs.unlink(tmpCrop, () => {});
  }
}

module.exports = { extractText, hasEnoughText, cleanOcrText, getPreviewImagePath, extractRegion };
