'use strict';

const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');

const db = require('../database/db');

function getOcrLanguage() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ocr_language'").get();
    return row ? row.value : 'deu+eng';
  } catch {
    return 'deu+eng';
  }
}

/**
 * Preprocess an image with sharp to improve OCR quality:
 * - Convert to grayscale
 * - Normalize contrast
 * - Sharpen
 * - Convert to PNG for Tesseract
 */
async function preprocessImage(inputPath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_prep_${Date.now()}.png`);
  await sharp(inputPath)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .png({ compressionLevel: 1 })
    .toFile(tmpPath);
  return tmpPath;
}

/**
 * Extract text from a PDF file.
 * For PDFs, we use Tesseract directly (it handles PDF parsing internally
 * when given the path; alternatively we read the file as a buffer).
 * For production, a pdf-to-image conversion step would be ideal,
 * but here we use Tesseract's built-in PDF support.
 */
async function extractFromPdf(filePath, language) {
  try {
    const worker = await Tesseract.createWorker(language, 1, {
      logger: () => {},
    });

    const result = await worker.recognize(filePath);
    await worker.terminate();

    return {
      text: result.data.text || '',
      confidence: Math.round(result.data.confidence || 0),
    };
  } catch (err) {
    throw new Error(`PDF OCR fehlgeschlagen: ${err.message}`);
  }
}

/**
 * Extract text from image files (jpg, png, tiff, bmp).
 */
async function extractFromImage(filePath, language) {
  let preprocessedPath = null;

  try {
    preprocessedPath = await preprocessImage(filePath);

    const worker = await Tesseract.createWorker(language, 1, {
      logger: () => {},
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '1', // Automatic page segmentation with OSD
      preserve_interword_spaces: '1',
    });

    const result = await worker.recognize(preprocessedPath);
    await worker.terminate();

    return {
      text: result.data.text || '',
      confidence: Math.round(result.data.confidence || 0),
    };
  } catch (err) {
    // Fallback: try without preprocessing
    try {
      const worker = await Tesseract.createWorker(language, 1, {
        logger: () => {},
      });
      const result = await worker.recognize(filePath);
      await worker.terminate();
      return {
        text: result.data.text || '',
        confidence: Math.round(result.data.confidence || 0),
      };
    } catch (fallbackErr) {
      throw new Error(`Bild-OCR fehlgeschlagen: ${fallbackErr.message}`);
    }
  } finally {
    if (preprocessedPath && fs.existsSync(preprocessedPath)) {
      fs.unlink(preprocessedPath, () => {});
    }
  }
}

/**
 * Main OCR entry point.
 * @param {string} filePath - absolute path to the document file
 * @param {string} fileType - extension without dot (pdf, jpg, png, tiff, bmp)
 * @returns {{ text: string, confidence: number }}
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

  // Clean up the extracted text
  result.text = cleanOcrText(result.text);

  return result;
}

/**
 * Clean and normalize OCR output text.
 */
function cleanOcrText(text) {
  if (!text) return '';

  return text
    // Remove excessive whitespace
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Remove non-printable characters except newline
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .trim();
}

/**
 * Check if text has enough content to be useful for analysis.
 * Returns true if text has >= 30 meaningful characters.
 */
function hasEnoughText(text) {
  if (!text) return false;
  const cleaned = text.replace(/\s/g, '');
  return cleaned.length >= 30;
}

module.exports = { extractText, hasEnoughText, cleanOcrText };
