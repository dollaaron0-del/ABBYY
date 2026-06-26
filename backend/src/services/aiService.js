'use strict';

const axios = require('axios');
const db = require('../database/db');

function getSettings() {
  const rows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN ('ollama_host', 'ollama_model', 'confidence_threshold', 'claude_api_enabled', 'claude_api_key', 'demo_mode')
  `).all();
  const s = {};
  for (const row of rows) s[row.key] = row.value;
  return {
    ollamaHost: s.ollama_host || 'http://127.0.0.1:11434',
    ollamaModel: s.ollama_model || 'llama3.2-vision',
    confidenceThreshold: parseInt(s.confidence_threshold || '75', 10),
    claudeEnabled: s.claude_api_enabled === 'true',
    claudeApiKey: s.claude_api_key || '',
    demoMode: s.demo_mode === 'true',
  };
}

/**
 * Normalize a German/European date string to DD.MM.YYYY.
 */
function normalizeDate(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, '0');
  const month = m[2].padStart(2, '0');
  const year = m[3].length === 2 ? (parseInt(m[3], 10) > 50 ? '19' : '20') + m[3] : m[3];
  return `${day}.${month}.${year}`;
}

/**
 * Parse German number format "1.234,56" → 1234.56.
 */
function parseEuroAmount(s) {
  if (!s) return null;
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/**
 * Rule-based document analysis for demo mode.
 * Extracts invoice fields via regex – works without Ollama.
 */
function analyzeWithRules(text) {
  const t = text || '';
  const settings = getSettings();
  const threshold = settings.confidenceThreshold;

  if (t.trim().length < 20) {
    return {
      doc_type: 'Unleserlich',
      sender: null,
      confidence: 0,
      reasoning: 'Demo-Modus: Text zu kurz oder nicht lesbar.',
      ampel: 'rot',
      extracted_fields: null,
    };
  }

  // --- Dokumenttyp ---
  let doc_type = 'Sonstiges';
  if (/mahnung|zahlungserinnerung|verzug|zahlungsaufforderung|\d\.\s*mahnung/i.test(t)) {
    doc_type = 'Mahnung';
  } else if (/bescheid|finanzamt|gewerbesteuer|einkommensteuer|umsatzsteuerbescheid|ihk|berufsgenossenschaft/i.test(t)) {
    doc_type = 'Behördenbescheid';
  } else if (/\brechnung\b|invoice|faktura|rechnungs-?nr|rechnungsnummer/i.test(t)) {
    doc_type = 'Rechnung';
  }

  // --- Rechnungsnummer ---
  let rechnungsnummer = null;
  const rnM = t.match(/(?:rechnung[s]?[-_\s]?(?:nr\.?|nummer|no\.?)|re[-_\s]?(?:nr\.?|no\.?)|invoice\s*(?:no\.?|number|nr\.?)|inv\.?\s*(?:nr\.?|no\.?)|belegnummer)\s*:?\s*([A-Z0-9][-A-Z0-9\s/._]{1,24})/i);
  if (rnM) rechnungsnummer = rnM[1].trim().split(/\s{2,}/)[0].trim();

  // --- Dates ---
  const rdM = t.match(/(?:rechnungs?[-\s]?datum|datum(?:\s+der\s+rechnung)?|invoice\s*date|ausgestellt\s*am|erstellt\s*am)\s*:?\s*(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})/i);
  const rechnungsdatum = normalizeDate(rdM ? rdM[1] : null);

  const fdM = t.match(/(?:fällig(?:keit)?(?:s?datum)?(?:\s*(?:am|bis))?|zahlbar\s*(?:bis|am)|due\s*(?:date|by)|zahlungsziel|zu\s*zahlen\s*(?:bis|am))\s*:?\s*(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4})/i);
  const faelligkeitsdatum = normalizeDate(fdM ? fdM[1] : null);

  // --- Amounts (German format: 1.234,56 or plain 1234,56) ---
  const amtPat = /[\d]{1,3}(?:\.\d{3})*,\d{2}/;
  const bruttoM = t.match(new RegExp('(?:gesamt(?:\\s*betrag)?|total(?:\\s*amount)?|rechnungsbetrag|brutto(?:\\s*betrag)?|zu\\s*zahlen(?:der\\s*betrag)?|invoice\\s*total|endbetrag|summe\\s*gesamt|summe\\s*inkl\\.?)\\s*(?:inkl\\.?\\s*(?:mwst\\.?|ust\\.?|vat))?\\s*:?\\s*(' + amtPat.source + ')', 'i'));
  const betrag_brutto = bruttoM ? parseEuroAmount(bruttoM[1]) : null;

  const nettoM = t.match(new RegExp('(?:netto(?:\\s*betrag|\\s*summe)?|zwischensumme|subtotal|netto\\s*gesamt)\\s*:?\\s*(' + amtPat.source + ')', 'i'));
  const betrag_netto = nettoM ? parseEuroAmount(nettoM[1]) : null;

  const steuerM = t.match(new RegExp('(?:mwst\\.?|ust\\.?|mehrwertsteuer|umsatzsteuer|steuer(?:betrag)?|vat)\\s*(?:\\d{1,2}%\\s*)?:?\\s*(' + amtPat.source + ')', 'i'));
  const steuerbetrag = steuerM ? parseEuroAmount(steuerM[1]) : null;

  const satzM = t.match(/(\d{1,2})\s*%\s*(?:mwst\.?|ust\.?|mehrwertsteuer|umsatzsteuer|vat)/i);
  const steuersatz = satzM ? parseFloat(satzM[1]) : null;

  // --- Currency ---
  let waehrung = null;
  if (/\bEUR\b|€/.test(t)) waehrung = 'EUR';
  else if (/\bCHF\b/.test(t)) waehrung = 'CHF';
  else if (/\bUSD\b|\$/.test(t)) waehrung = 'USD';
  else if (/\bGBP\b|£/.test(t)) waehrung = 'GBP';

  // --- IBAN ---
  let iban = null;
  const ibanM = t.match(/\b([A-Z]{2}\d{2}(?:[ ]?\d{4}){4,6}[ ]?\d{0,4})\b/);
  if (ibanM) {
    const raw = ibanM[1].replace(/\s/g, '');
    if (raw.length >= 15 && raw.length <= 34) iban = raw;
  }

  // --- BIC ---
  let bic = null;
  const bicM = t.match(/(?:bic|swift[-\s]?code?|bankleitzahl[-\s]?int\.?)\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i);
  if (bicM) {
    bic = bicM[1];
  } else {
    const bicStd = t.match(/\b([A-Z]{6}[A-Z0-9]{5})\b/);
    if (bicStd) bic = bicStd[1];
  }

  // --- Sender (company name) ---
  let sender = null;
  const compRe = /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\s&.,\-]{2,40}?(?:GmbH|AG|KG|UG|e\.V\.|e\.K\.|GbR|OHG|KGaA|SE|Ltd\.|Corp\.|Inc\.|S\.A\.|S\.r\.l\.|mbH)\s*(?:&\s*Co\.?\s*KG)?)/g;
  let cm;
  while ((cm = compRe.exec(t)) !== null) {
    const c = sanitizeSender(cm[1].trim());
    if (c) { sender = c; break; }
  }

  // --- Address ---
  let absender_strasse = null;
  let absender_plz = null;
  let absender_ort = null;
  let absender_land = null;

  const strM = t.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-\s]{2,40}(?:straße|strasse|str\.|weg|gasse|allee|platz|ring|damm|chaussee|promenade)\s*\d+\s*[a-zA-Z]?)/i);
  if (strM) absender_strasse = strM[1].trim();

  const plzM = t.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\s\-]{2,30}?)(?=\s*[\n,|]|$)/m);
  if (plzM) { absender_plz = plzM[1]; absender_ort = plzM[2].trim(); }

  if (/\bDeutschland\b|\bGermany\b/i.test(t) || absender_plz) absender_land = 'DE';
  else if (/\bÖsterreich\b|\bAustria\b/i.test(t)) absender_land = 'AT';
  else if (/\bSchweiz\b|\bSwitzerland\b/i.test(t)) absender_land = 'CH';

  // --- Confidence ---
  const keyFields = [rechnungsnummer, rechnungsdatum, betrag_brutto, sender, waehrung];
  const foundCount = keyFields.filter(Boolean).length;
  let confidence = Math.round((foundCount / keyFields.length) * 80);
  if (doc_type === 'Unleserlich') confidence = 0;
  else if (doc_type === 'Sonstiges') confidence = Math.min(confidence, 35);

  const knownTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid'];
  let ampel = 'rot';
  if (knownTypes.includes(doc_type)) {
    ampel = (confidence >= threshold && sender) ? 'gruen' : 'gelb';
  }

  const totalExtracted = [rechnungsnummer, rechnungsdatum, faelligkeitsdatum, betrag_brutto, betrag_netto, steuerbetrag, iban, bic, absender_strasse, absender_plz].filter(Boolean).length;

  return {
    doc_type,
    sender,
    confidence,
    reasoning: `Demo-Modus (regelbasiert): Typ "${doc_type}" erkannt. ${totalExtracted} Felder extrahiert.`,
    ampel,
    extracted_fields: {
      absender_strasse,
      absender_plz,
      absender_ort,
      absender_land,
      rechnungsnummer,
      rechnungsdatum,
      faelligkeitsdatum,
      betrag_brutto,
      betrag_netto,
      steuerbetrag,
      steuersatz,
      waehrung,
      iban,
      bic,
    },
  };
}

/**
 * Build the analysis prompt for document classification.
 * @param {string} text - extracted document text
 * @param {number} threshold - confidence threshold from settings
 */
function buildPrompt(text, threshold, hints = null) {
  const truncated = text.slice(0, 8000);
  const hintsSection = hints
    ? `\nHINWEISE AUS FRÜHEREN KORREKTUREN FÜR DIESEN LIEFERANTEN:\n${hints}\nBerücksichtige diese Hinweise bevorzugt bei der Feldextraktion.\n`
    : '';
  return `Du bist ein Experte für die Analyse von Geschäftsdokumenten in einem Hotelbetrieb.
Analysiere das folgende Dokument und antworte NUR mit einem JSON-Objekt.
${hintsSection}

WICHTIG ZUM ABSENDER:
Der Absender ist das Unternehmen, das die Rechnung AUSSTELLT und Geld bekommt
(der Lieferant / Rechnungssteller). Das ist meist die Firma im Briefkopf ganz oben
oder bei "Sitz der Gesellschaft" / der Firma mit der Bankverbindung und Steuernummer.
Der EMPFÄNGER ist NICHT der Absender. Empfänger sind unsere eigenen Hotels, z.B.
"AMERON", "Althoff", oder eine Adresse die nach "An:" bzw. als Anschrift steht.
Gib als "absender" niemals den Empfänger/das Hotel zurück, sondern immer den Lieferanten.

WICHTIG: "absender" ist IMMER ein Firmenname, z.B. "Nexi Germany GmbH" oder "FoodConnection GmbH".
NIEMALS eine Nummer, eine Bezeichnung wie "Lieferscheinnummer", "Bestellnummer",
"Rechnungsnummer", "Kundennummer", "Weferscheinnummer" oder ähnliches als Absender angeben.
Wenn kein eindeutiger Firmenname erkennbar ist, setze absender auf null.

TABELLEN UND POSITIONEN:
Der Text stammt aus OCR und kann Tabellen als unstrukturierten Text enthalten – Spalten
erscheinen als Leerzeichen-getrennte Werte in einer Zeile. Suche Beträge am ENDE des Textes
oder nach Schlüsselwörtern wie "Gesamt", "Total", "Summe", "Endbetrag", "zu zahlen".
Bei mehrseitigen Dokumenten ist der Gesamtbetrag oft auf der letzten Seite ([Seite X]).
Ignoriere Einzelpositionsbeträge und extrahiere nur den finalen Gesamtbetrag.

Dokumenttext:
${truncated}

Antworte mit folgendem JSON-Format (alle Felder außer dokumenttyp, absender, konfidenz, begruendung, ampel sind optional – setze null wenn nicht gefunden):
{
  "dokumenttyp": "Rechnung" | "Mahnung" | "Behördenbescheid" | "Unleserlich" | "Sonstiges",
  "absender": "Name des rechnungsstellenden Unternehmens (Lieferant) oder null",
  "absender_strasse": "Straße und Hausnummer des Absenders oder null",
  "absender_plz": "PLZ des Absenders oder null",
  "absender_ort": "Ort des Absenders oder null",
  "absender_land": "Länderkürzel z.B. DE, AT, CH oder null",
  "rechnungsnummer": "Rechnungsnummer oder null",
  "rechnungsdatum": "Datum im Format DD.MM.YYYY oder null",
  "faelligkeitsdatum": "Fälligkeitsdatum im Format DD.MM.YYYY oder null",
  "betrag_brutto": "Bruttobetrag als Zahl z.B. 1234.56 oder null",
  "betrag_netto": "Nettobetrag als Zahl oder null",
  "steuerbetrag": "Steuerbetrag als Zahl oder null",
  "steuersatz": "Steuersatz z.B. 19 für 19% oder null",
  "waehrung": "Währungskürzel z.B. EUR, CHF oder null",
  "iban": "IBAN des Absenders oder null",
  "bic": "BIC/SWIFT des Absenders oder null",
  "konfidenz": 0-100,
  "begruendung": "Kurze Begründung der Klassifizierung",
  "ampel": "gruen" | "gelb" | "rot"
}

Regeln:
- Rechnung: Enthält Rechnungsnummer, Betrag, Zahlungsziel
- Mahnung: Mahnung, Zahlungserinnerung, Verzug
- Behördenbescheid: Von Finanzamt, IHK, Gemeinde, Berufsgenossenschaft etc.
- Unleserlich: Text nicht erkennbar oder zu wenig Text
- Sonstiges: Keines der obigen
- Ampel gruen: Konfidenz >= ${threshold} UND Absender bekannt
- Ampel gelb: Konfidenz < ${threshold} ODER Absender unbekannt
- Ampel rot: Unleserlich ODER kein Rechnungsdokument`;
}

/**
 * Prüft, ob ein erkannter "Absender" in Wahrheit keine Firma ist,
 * sondern z.B. eine Lieferscheinnummer, Bestellnummer o.ä.
 * Solche Werte werden verworfen (→ null), damit nie eine Nummer als Absender erscheint.
 */
function sanitizeSender(sender) {
  if (!sender) return null;
  const s = String(sender).trim();
  if (s.length < 3) return null;

  // Bezeichnungen, die typischerweise mit einer Nummer verwechselt werden
  const labelPattern = /(liefer|wefer)?schein|nummer|nr\.?|bestell|rechnungs|kunden|auftrags|beleg|referenz|datum|betrag|summe|ust|steuer/i;
  // Wenn der Wert hauptsächlich aus einer solchen Bezeichnung + Ziffern besteht → keine Firma
  const digitCount = (s.match(/\d/g) || []).length;
  const letterCount = (s.match(/[a-zäöüß]/gi) || []).length;

  // Reine bzw. überwiegend numerische Werte sind keine Firma
  if (letterCount === 0) return null;
  if (digitCount > 0 && digitCount >= letterCount) return null;

  // Enthält eine "Nummern-Bezeichnung" und Ziffern → vermutlich eine Nummer, keine Firma
  if (labelPattern.test(s) && digitCount > 0) return null;

  return s;
}

/**
 * Parse the AI response JSON, handling common LLM quirks.
 */
function parseAiResponse(responseText) {
  if (!responseText) throw new Error('Leere Antwort vom KI-Modell');

  // Try to extract JSON from the response (models sometimes add extra text)
  let jsonStr = responseText.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find the first { and last } to extract JSON object
  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    jsonStr = jsonStr.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`KI-Antwort konnte nicht als JSON geparst werden: ${err.message}. Antwort: ${responseText.slice(0, 200)}`);
  }

  // Normalize fields with fallbacks
  const docType = parsed.dokumenttyp || parsed.doc_type || parsed.type || 'Sonstiges';
  const rawSender = parsed.absender || parsed.sender || parsed.absender_name || null;
  const sender = sanitizeSender(rawSender);
  const confidence = Math.min(100, Math.max(0, parseInt(parsed.konfidenz ?? parsed.confidence ?? 0, 10)));
  const reasoning = parsed.begruendung || parsed.reasoning || parsed.begründung || '';
  const ampel = parsed.ampel || 'rot';

  const validDocTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid', 'Unleserlich', 'Sonstiges'];
  const validAmpel = ['gruen', 'gelb', 'rot'];

  // Extended invoice fields
  const extractedFields = {
    absender_strasse: parsed.absender_strasse || null,
    absender_plz: parsed.absender_plz || null,
    absender_ort: parsed.absender_ort || null,
    absender_land: parsed.absender_land || null,
    rechnungsnummer: parsed.rechnungsnummer || null,
    rechnungsdatum: parsed.rechnungsdatum || null,
    faelligkeitsdatum: parsed.faelligkeitsdatum || null,
    betrag_brutto: parsed.betrag_brutto != null ? parseFloat(parsed.betrag_brutto) || null : null,
    betrag_netto: parsed.betrag_netto != null ? parseFloat(parsed.betrag_netto) || null : null,
    steuerbetrag: parsed.steuerbetrag != null ? parseFloat(parsed.steuerbetrag) || null : null,
    steuersatz: parsed.steuersatz != null ? parseFloat(parsed.steuersatz) || null : null,
    waehrung: parsed.waehrung || null,
    iban: parsed.iban || null,
    bic: parsed.bic || null,
  };

  return {
    doc_type: validDocTypes.includes(docType) ? docType : 'Sonstiges',
    sender: sender || null,
    confidence,
    reasoning,
    ampel: validAmpel.includes(ampel) ? ampel : 'rot',
    extracted_fields: extractedFields,
  };
}

/**
 * Analyze document text using the local Ollama instance.
 */
async function analyzeWithOllama(text, hints = null) {
  const settings = getSettings();
  const prompt = buildPrompt(text, settings.confidenceThreshold, hints);

  const os = require('os');
  const cpuCount = Math.max(2, os.cpus().length);

  try {
    const response = await axios.post(
      `${settings.ollamaHost}/api/generate`,
      {
        model: settings.ollamaModel,
        prompt,
        stream: false,
        keep_alive: '30m',
        options: {
          temperature: 0.1,
          num_predict: 400,
          top_p: 0.9,
          num_thread: cpuCount,
        },
      },
      {
        // Erstes Laden des Modells auf der CPU kann etwas dauern, aber nicht 10 Min.
        // 4 Minuten reichen sicher; danach lieber Fehler als endloses Warten.
        timeout: 240000,
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const rawResponse = response.data.response || '';
    return parseAiResponse(rawResponse);
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      throw new Error(`Ollama nicht erreichbar unter ${settings.ollamaHost}. Bitte sicherstellen, dass Ollama läuft.`);
    }
    if (err.response && err.response.status === 404) {
      throw new Error(`Ollama-Modell '${settings.ollamaModel}' nicht gefunden. Bitte das Modell zuerst herunterladen: ollama pull ${settings.ollamaModel}`);
    }
    throw new Error(`Ollama-Fehler: ${err.message}`);
  }
}

/**
 * Get list of available models from Ollama.
 */
async function getOllamaModels() {
  const settings = getSettings();
  try {
    const response = await axios.get(`${settings.ollamaHost}/api/tags`, {
      timeout: 10000,
    });
    return (response.data.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    }));
  } catch (err) {
    throw new Error(`Ollama-Modelle konnten nicht abgerufen werden: ${err.message}`);
  }
}

/**
 * Claude API fallback - ONLY call this when explicitly enabled in settings.
 * WARNING: This sends data outside the company network.
 */
async function analyzeWithClaude(text, hints = null) {
  const settings = getSettings();

  if (!settings.claudeEnabled) {
    throw new Error('Claude API ist nicht aktiviert. Aktivieren Sie ihn in den Einstellungen (Achtung: Daten verlassen das Firmennetzwerk!)');
  }

  if (!settings.claudeApiKey) {
    throw new Error('Claude API-Schlüssel ist nicht konfiguriert');
  }

  const prompt = buildPrompt(text, settings.confidenceThreshold, hints);

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-haiku-20240307',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': settings.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const rawResponse = response.data.content[0].text || '';
    return parseAiResponse(rawResponse);
  } catch (err) {
    if (err.response && err.response.status === 401) {
      throw new Error('Claude API: Ungültiger API-Schlüssel');
    }
    throw new Error(`Claude API-Fehler: ${err.message}`);
  }
}

/**
 * Lernbeispiele für einen bekannten Absender aus bot_corrections laden.
 * Sucht sowohl nach Absendertext als auch nach Lieferanten-ID (stabiler).
 * Gibt einen formatierten Hinweis-String zurück oder null.
 */
function loadHintsForSender(senderName, supplierId = null) {
  if (!senderName && !supplierId) return null;
  try {
    let rows;
    if (supplierId) {
      // Suche nach sender_id ODER sender-Text – findet Korrekturen auch wenn
      // der Absendertext beim letzten Upload leicht anders geschrieben wurde
      rows = db.prepare(`
        SELECT field_name, human_value, COUNT(*) as count
        FROM bot_corrections
        WHERE (sender_id = ? OR (sender = ? AND sender IS NOT NULL))
          AND human_value IS NOT NULL AND human_value != ''
        GROUP BY field_name, human_value
        ORDER BY count DESC
        LIMIT 10
      `).all(supplierId, senderName || '');
    } else {
      rows = db.prepare(`
        SELECT field_name, human_value, COUNT(*) as count
        FROM bot_corrections
        WHERE sender = ? AND human_value IS NOT NULL AND human_value != ''
        GROUP BY field_name, human_value
        ORDER BY count DESC
        LIMIT 10
      `).all(senderName);
    }

    if (rows.length === 0) return null;

    const lines = rows.map((r) => `- ${r.field_name}: "${r.human_value}" (${r.count}× manuell bestätigt)`);
    return lines.join('\n');
  } catch (_) {
    return null;
  }
}

/**
 * Main analysis function.
 * Priority: Demo-Modus (regelbasiert) → Ollama → Claude (Fallback, wenn aktiviert).
 * @param {string} text - OCR-extrahierter Dokumenttext
 * @param {string|null} senderHint - Bekannter Absendername für Lernbeispiele (optional)
 * @param {string|null} supplierId - Lieferanten-ID für stabile Korrekturen-Suche (optional)
 */
async function analyzeDocument(text, senderHint = null, supplierId = null) {
  const settings = getSettings();

  if (!text || text.trim().length < 10) {
    return {
      doc_type: 'Unleserlich',
      sender: null,
      confidence: 0,
      reasoning: 'Text zu kurz oder nicht lesbar',
      ampel: 'rot',
    };
  }

  // Demo-Modus: regelbasierte Extraktion ohne Ollama
  if (settings.demoMode) {
    console.log('[AI] Demo-Modus aktiv – regelbasierte Feldextraktion');
    return analyzeWithRules(text);
  }

  // Lernbeispiele für bekannten Absender laden (auch per Lieferanten-ID)
  const hints = loadHintsForSender(senderHint, supplierId);
  if (hints) {
    console.log(`[AI] ${hints.split('\n').length} Lernbeispiele für Absender "${senderHint || supplierId}" in Prompt eingebettet`);
  }

  try {
    return await analyzeWithOllama(text, hints);
  } catch (ollamaErr) {
    console.error('Ollama analysis failed:', ollamaErr.message);

    if (settings.claudeEnabled && settings.claudeApiKey) {
      console.warn('WARNUNG: Fallback auf Claude API - Daten verlassen das Firmennetzwerk!');
      try {
        return await analyzeWithClaude(text, hints);
      } catch (claudeErr) {
        console.error('Claude fallback also failed:', claudeErr.message);
        throw new Error(`Beide KI-Dienste fehlgeschlagen. Ollama: ${ollamaErr.message}. Claude: ${claudeErr.message}`);
      }
    }

    throw ollamaErr;
  }
}

module.exports = {
  analyzeDocument,
  analyzeWithOllama,
  analyzeWithClaude,
  analyzeWithRules,
  getOllamaModels,
  buildPrompt,
};
