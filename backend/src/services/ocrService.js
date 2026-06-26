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
 * - EXIF-Rotation korrigieren (Handy-Fotos kommen oft auf der Seite an)
 * - Bild auf maximal 2000px begrenzen
 * - Graustufen + Kontrast + Schärfen für bessere Texterkennung
 */
async function preprocessImage(inputPath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_prep_${Date.now()}.png`);
  await sharp(inputPath)
    .rotate()                                                           // EXIF-Rotation auto-korrigieren
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .linear(1.2, -15)                                                   // Kontrast leicht erhöhen
    .sharpen({ sigma: 1.5 })
    .png({ compressionLevel: 1 })
    .toFile(tmpPath);
  return tmpPath;
}

/**
 * Zweiter OCR-Versuch mit aggressiverer Bildaufbereitung für schräge/schlechte Scans.
 */
async function preprocessImageAggressive(inputPath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_prep2_${Date.now()}.png`);
  await sharp(inputPath)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .normalize()
    .linear(1.5, -40)                                                   // Stärkerer Kontrast → hilft bei leichter Schräge
    .median(1)                                                          // Rauschen reduzieren
    .sharpen({ sigma: 2.0 })
    .png({ compressionLevel: 1 })
    .toFile(tmpPath);
  return tmpPath;
}

const OCR_TIMEOUT_MS = 120000; // 2 Minuten pro Dokument maximal

/**
 * Versucht Text direkt aus einem digitalen PDF zu lesen (kein OCR nötig).
 * Gibt null zurück wenn das PDF gescannt ist oder zu wenig Text enthält.
 * Wirft einen verständlichen Fehler bei passwortgeschützten Dateien.
 */
async function tryDirectPdfExtract(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, { max: 5 });
    const cleaned = cleanOcrText(data.text || '');
    if (hasEnoughText(cleaned)) {
      console.log(`[OCR] Digitales PDF erkannt – Text direkt extrahiert (${cleaned.length} Zeichen, kein OCR nötig)`);
      return { text: cleaned, confidence: 99 };
    }
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('password') || msg.includes('encrypt') || msg.includes('permission')) {
      throw new Error(
        'Diese PDF-Datei ist passwortgeschützt und kann nicht verarbeitet werden. ' +
        'Bitte eine unverschlüsselte Version hochladen oder das Passwort beim Absender erfragen.'
      );
    }
  }
  return null;
}

/**
 * Alle Seiten einer PDF als Bilder exportieren (max. MAX_PDF_PAGES).
 * Gibt ein Array von temporären Bildpfaden zurück – Aufrufer muss diese löschen.
 */
const MAX_PDF_PAGES = 5;

async function pdfToImages(pdfPath) {
  if (_pdfTool === undefined) _pdfTool = findPdfTool();
  if (!_pdfTool) throw new Error('Kein PDF-Konvertierer gefunden (weder pdftoppm noch Ghostscript)');

  const stamp = Date.now();

  if (_pdfTool.tool === 'pdftoppm') {
    const tmpBase = path.join(os.tmpdir(), `pdfpages_${stamp}`);
    await execFileAsync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', String(MAX_PDF_PAGES), pdfPath, tmpBase]);
    const results = [];
    for (let i = 1; i <= MAX_PDF_PAGES; i++) {
      for (const suffix of [`-${i}.png`, `-0${i}.png`, `-00${i}.png`]) {
        const candidate = tmpBase + suffix;
        if (fs.existsSync(candidate)) { results.push(candidate); break; }
      }
    }
    if (results.length === 0) throw new Error('pdftoppm: keine Ausgabebilder gefunden');
    return results;
  }

  // Ghostscript: %d Platzhalter für Seitennummern
  const tmpPattern = path.join(os.tmpdir(), `pdfpages_${stamp}_%d.png`);
  await execFileAsync(_pdfTool.exe, [
    '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-sDEVICE=png16m', '-r150',
    `-dFirstPage=1`, `-dLastPage=${MAX_PDF_PAGES}`,
    `-sOutputFile=${tmpPattern}`,
    pdfPath,
  ]);
  const results = [];
  for (let i = 1; i <= MAX_PDF_PAGES; i++) {
    const candidate = path.join(os.tmpdir(), `pdfpages_${stamp}_${i}.png`);
    if (fs.existsSync(candidate)) results.push(candidate);
  }
  if (results.length === 0) throw new Error('Ghostscript: keine Ausgabebilder gefunden');
  return results;
}

/**
 * Text aus einer PDF-Datei extrahieren.
 * Strategie: 1) Direktextraktion (digitales PDF) → 2) Bildbasierte OCR aller Seiten → 3) Tesseract-Fallback
 */
async function extractFromPdf(filePath, language) {
  // Strategie 1: Digitales PDF – Text direkt lesen ohne OCR
  // Passwort-Fehler werden direkt nach oben weitergegeben (kein Fallback auf OCR sinnvoll)
  const direct = await tryDirectPdfExtract(filePath);
  if (direct) return direct;

  // Strategie 2: Gescanntes PDF – alle Seiten als Bilder, dann OCR
  let imgPaths = [];
  try {
    imgPaths = await pdfToImages(filePath);
    const pageResults = await Promise.all(imgPaths.map((p) => extractFromImage(p, language)));
    const combinedText = pageResults.map((r, i) => `[Seite ${i + 1}]\n${r.text}`).join('\n\n');
    const avgConfidence = Math.round(pageResults.reduce((s, r) => s + r.confidence, 0) / pageResults.length);
    return { text: combinedText, confidence: avgConfidence };
  } catch (convErr) {
    // Strategie 3: Tesseract direkt auf PDF (langsamer, nur Seite 1)
    console.warn(`[OCR] PDF-Seitenkonvertierung fehlgeschlagen, direkter Fallback: ${convErr.message}`);
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(filePath), OCR_TIMEOUT_MS, 'PDF-OCR:');
    return { text: result.data.text || '', confidence: Math.round(result.data.confidence || 0) };
  } finally {
    for (const p of imgPaths) {
      if (fs.existsSync(p)) fs.unlink(p, () => {});
    }
  }
}

const LOW_CONFIDENCE_THRESHOLD = 55; // Unter diesem Wert → zweiter Versuch mit aggressiverer Aufbereitung

/**
 * Text aus Bilddateien extrahieren (jpg, png, tiff, bmp).
 * Bei schlechter OCR-Konfidenz (schräge/schlechte Scans) wird automatisch
 * ein zweiter Versuch mit stärkerem Kontrast gestartet.
 */
async function extractFromImage(filePath, language) {
  let prep1 = null;
  let prep2 = null;
  try {
    // Erster Versuch: Standard-Aufbereitung
    prep1 = await preprocessImage(filePath);
    const worker = await getWorker(language);
    const result1 = await withTimeout(worker.recognize(prep1), OCR_TIMEOUT_MS, 'Bild-OCR:');
    const conf1 = Math.round(result1.data.confidence || 0);

    // Zweiter Versuch bei niedriger Konfidenz (z.B. schräger Scan)
    if (conf1 < LOW_CONFIDENCE_THRESHOLD) {
      console.log(`[OCR] Konfidenz ${conf1}% – zweiter Versuch mit aggressiverer Aufbereitung`);
      prep2 = await preprocessImageAggressive(filePath);
      const result2 = await withTimeout(worker.recognize(prep2), OCR_TIMEOUT_MS, 'Bild-OCR (Versuch 2):');
      const conf2 = Math.round(result2.data.confidence || 0);

      // Besseres Ergebnis gewinnt
      if (conf2 > conf1) {
        console.log(`[OCR] Zweiter Versuch besser: ${conf1}% → ${conf2}%`);
        return { text: result2.data.text || '', confidence: conf2 };
      }
    }

    return { text: result1.data.text || '', confidence: conf1 };
  } catch (err) {
    // Fallback: ohne Vorverarbeitung direkt erkennen
    const worker = await getWorker(language);
    const result = await withTimeout(worker.recognize(filePath), OCR_TIMEOUT_MS, 'Bild-OCR (Fallback):');
    return { text: result.data.text || '', confidence: Math.round(result.data.confidence || 0) };
  } finally {
    if (prep1 && fs.existsSync(prep1)) fs.unlink(prep1, () => {});
    if (prep2 && fs.existsSync(prep2)) fs.unlink(prep2, () => {});
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

  result.text = fixOcrConfusions(cleanOcrText(result.text));
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

/**
 * Korrigiert typische Tesseract-Zeichenverwechslungen in kritischen Feldern.
 * Wendet nur kontextabhängige Korrekturen an – z.B. in IBAN-ähnlichen Mustern.
 */
function fixOcrConfusions(text) {
  if (!text) return text;

  // IBAN: nur Großbuchstaben und Ziffern erlaubt → O→0, I/l→1 in IBAN-Blöcken
  text = text.replace(/\b([A-Z]{2}\d{2}[\s]?)([A-Z0-9\s]{10,30})\b/g, (match) => {
    return match
      .replace(/O/g, '0')
      .replace(/[Il]/g, '1')
      .replace(/B(?=\d)/g, '8');
  });

  // Beträge: Komma-Dezimal-Zahlen – l→1, O→0
  text = text.replace(/\b\d[\d.]*[lI][\d,]*\b/g, (m) => m.replace(/[lI]/g, '1'));
  text = text.replace(/\b\d[\d.]*O[\d,]*\b/g, (m) => m.replace(/O/g, '0'));

  // Rechnungsnummern-Bereich: | → I (häufig am Zeilenanfang)
  text = text.replace(/^\|/gm, 'I');

  return text;
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
 * Convert only the first page of a PDF to a PNG (used for preview/thumbnail).
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
