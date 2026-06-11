'use strict';

const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    tessedit_pageseg_mode: '1',
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
 */
async function extractFromPdf(filePath, language) {
  const worker = await getWorker(language);
  const result = await withTimeout(worker.recognize(filePath), OCR_TIMEOUT_MS, 'PDF-OCR:');
  return {
    text: result.data.text || '',
    confidence: Math.round(result.data.confidence || 0),
  };
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

module.exports = { extractText, hasEnoughText, cleanOcrText };
