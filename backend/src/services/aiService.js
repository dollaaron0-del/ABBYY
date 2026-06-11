'use strict';

const axios = require('axios');
const db = require('../database/db');

function getSettings() {
  const rows = db.prepare(`
    SELECT key, value FROM settings
    WHERE key IN ('ollama_host', 'ollama_model', 'confidence_threshold', 'claude_api_enabled', 'claude_api_key')
  `).all();
  const s = {};
  for (const row of rows) s[row.key] = row.value;
  return {
    ollamaHost: s.ollama_host || 'http://localhost:11434',
    ollamaModel: s.ollama_model || 'llama3.2-vision',
    confidenceThreshold: parseInt(s.confidence_threshold || '75', 10),
    claudeEnabled: s.claude_api_enabled === 'true',
    claudeApiKey: s.claude_api_key || '',
  };
}

/**
 * Build the analysis prompt for document classification.
 * @param {string} text - extracted document text
 * @param {number} threshold - confidence threshold from settings
 */
function buildPrompt(text, threshold) {
  const truncated = text.slice(0, 4000);
  return `Du bist ein Experte für die Analyse von Geschäftsdokumenten in einem Hotelbetrieb.
Analysiere das folgende Dokument und antworte NUR mit einem JSON-Objekt.

Dokumenttext:
${truncated}

Antworte mit folgendem JSON-Format:
{
  "dokumenttyp": "Rechnung" | "Mahnung" | "Behördenbescheid" | "Unleserlich" | "Sonstiges",
  "absender": "Name des Absenders oder null",
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
  const sender = parsed.absender || parsed.sender || parsed.absender_name || null;
  const confidence = Math.min(100, Math.max(0, parseInt(parsed.konfidenz ?? parsed.confidence ?? 0, 10)));
  const reasoning = parsed.begruendung || parsed.reasoning || parsed.begründung || '';
  const ampel = parsed.ampel || 'rot';

  const validDocTypes = ['Rechnung', 'Mahnung', 'Behördenbescheid', 'Unleserlich', 'Sonstiges'];
  const validAmpel = ['gruen', 'gelb', 'rot'];

  return {
    doc_type: validDocTypes.includes(docType) ? docType : 'Sonstiges',
    sender: sender || null,
    confidence,
    reasoning,
    ampel: validAmpel.includes(ampel) ? ampel : 'rot',
  };
}

/**
 * Analyze document text using the local Ollama instance.
 */
async function analyzeWithOllama(text) {
  const settings = getSettings();
  const prompt = buildPrompt(text, settings.confidenceThreshold);

  try {
    const response = await axios.post(
      `${settings.ollamaHost}/api/generate`,
      {
        model: settings.ollamaModel,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 512,
          top_p: 0.9,
        },
      },
      {
        timeout: 120000,
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
async function analyzeWithClaude(text) {
  const settings = getSettings();

  if (!settings.claudeEnabled) {
    throw new Error('Claude API ist nicht aktiviert. Aktivieren Sie ihn in den Einstellungen (Achtung: Daten verlassen das Firmennetzwerk!)');
  }

  if (!settings.claudeApiKey) {
    throw new Error('Claude API-Schlüssel ist nicht konfiguriert');
  }

  const prompt = buildPrompt(text, settings.confidenceThreshold);

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
 * Main analysis function. Uses Ollama by default, falls back to Claude only if enabled.
 */
async function analyzeDocument(text) {
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

  try {
    return await analyzeWithOllama(text);
  } catch (ollamaErr) {
    console.error('Ollama analysis failed:', ollamaErr.message);

    if (settings.claudeEnabled && settings.claudeApiKey) {
      console.warn('WARNUNG: Fallback auf Claude API - Daten verlassen das Firmennetzwerk!');
      try {
        return await analyzeWithClaude(text);
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
  getOllamaModels,
  buildPrompt,
};
