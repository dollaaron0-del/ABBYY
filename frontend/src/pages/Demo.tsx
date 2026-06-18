import React, { useRef, useState } from 'react'

const API = 'http://127.0.0.1:3001/api'

// ─── Typen ──────────────────────────────────────────────────────────────────
interface AnalyzeResult {
  success: boolean
  fields: Record<string, string>
  decision: 'auto_complete' | 'manual_review'
  doc_type: string
  confidence: number
  supplier_matched: boolean
  supplier_name: string | null
  ampel: 'gruen' | 'gelb' | 'rot'
  reason: string
  error?: string
}

// ─── Feldnamen auf Deutsch ────────────────────────────────────────────────
const FIELD_META: { key: string; label: string; icon: string }[] = [
  { key: 'absender',          label: 'Lieferant',        icon: '🏢' },
  { key: 'absender_strasse',  label: 'Straße',           icon: '📍' },
  { key: 'absender_plz',      label: 'PLZ',              icon: '📍' },
  { key: 'absender_ort',      label: 'Ort',              icon: '📍' },
  { key: 'absender_land',     label: 'Land',             icon: '🌍' },
  { key: 'rechnungsnummer',   label: 'Rechnungs-Nr.',    icon: '🔢' },
  { key: 'rechnungsdatum',    label: 'Rechnungsdatum',   icon: '📅' },
  { key: 'faelligkeitsdatum', label: 'Fälligkeitsdatum', icon: '⏰' },
  { key: 'betrag_brutto',     label: 'Brutto-Betrag',    icon: '💶' },
  { key: 'betrag_netto',      label: 'Netto-Betrag',     icon: '💶' },
  { key: 'steuerbetrag',      label: 'Steuerbetrag',     icon: '📊' },
  { key: 'steuersatz',        label: 'Steuersatz',       icon: '📊' },
  { key: 'waehrung',          label: 'Währung',          icon: '💱' },
  { key: 'iban',              label: 'IBAN',             icon: '🏦' },
  { key: 'bic',               label: 'BIC / SWIFT',      icon: '🏦' },
]

const REQUIRED = ['rechnungsnummer', 'rechnungsdatum', 'betrag_brutto']

// ─── Styles ──────────────────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 900, margin: '0 auto' },
  hero: {
    background: 'linear-gradient(135deg, #1a3a5c 0%, #0d2438 100%)',
    borderRadius: 14,
    padding: '36px 40px',
    color: '#fff',
    marginBottom: 28,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  heroTitle: { fontSize: 24, fontWeight: 700, margin: 0 },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 6 },
  heroBadge: {
    position: 'absolute' as const, top: 20, right: 20,
    background: 'rgba(212,168,67,0.2)', border: '1px solid #d4a843',
    borderRadius: 20, padding: '4px 14px', fontSize: 12, color: '#d4a843', fontWeight: 600,
  },
  uploadZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 12,
    padding: '48px 24px',
    textAlign: 'center' as const,
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: '#f8fafc',
    marginBottom: 24,
  },
  uploadZoneActive: { borderColor: '#1a3a5c', background: '#eff6ff' },
  uploadIcon: { fontSize: 48, marginBottom: 12 },
  uploadText: { fontSize: 16, fontWeight: 600, color: '#1a3a5c' },
  uploadSub: { fontSize: 13, color: '#6b7280', marginTop: 6 },
  btn: {
    padding: '12px 28px', borderRadius: 8, border: 'none',
    background: '#1a3a5c', color: '#fff', fontWeight: 600,
    fontSize: 14, cursor: 'pointer', display: 'inline-block',
    marginTop: 16,
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  card: {
    background: '#fff', border: '1px solid #e5e7eb',
    borderRadius: 12, overflow: 'hidden', marginBottom: 20,
  },
  cardHead: {
    padding: '14px 20px', background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb', fontWeight: 600,
    fontSize: 14, color: '#1a3a5c', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
  },
  cardBody: { padding: 20 },
  decisionGreen: {
    background: '#f0fdf4', border: '1px solid #86efac',
    borderRadius: 10, padding: '20px 24px', marginBottom: 20,
    display: 'flex', alignItems: 'flex-start', gap: 16,
  },
  decisionYellow: {
    background: '#fffbeb', border: '1px solid #fcd34d',
    borderRadius: 10, padding: '20px 24px', marginBottom: 20,
    display: 'flex', alignItems: 'flex-start', gap: 16,
  },
  decisionRed: {
    background: '#fef2f2', border: '1px solid #fca5a5',
    borderRadius: 10, padding: '20px 24px', marginBottom: 20,
    display: 'flex', alignItems: 'flex-start', gap: 16,
  },
  decisionIcon: { fontSize: 40, flexShrink: 0 },
  decisionTitle: { fontSize: 18, fontWeight: 700 },
  decisionText: { fontSize: 13, marginTop: 4, lineHeight: 1.6 },
  fieldGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
  },
  fieldRow: {
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  fieldLabel: { fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  fieldValue: {
    fontSize: 14, color: '#111', background: '#f9fafb',
    border: '1px solid #e5e7eb', borderRadius: 6,
    padding: '8px 12px', fontFamily: 'monospace',
  },
  fieldValueMissing: {
    fontSize: 14, color: '#9ca3af', background: '#f9fafb',
    border: '1px dashed #e5e7eb', borderRadius: 6,
    padding: '8px 12px', fontStyle: 'italic',
  },
  fieldValueRequired: {
    border: '1px solid #fca5a5', background: '#fef2f2',
  },
  pillGreen: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 12,
    background: '#dcfce7', color: '#16a34a', fontSize: 12, fontWeight: 600,
  },
  pillRed: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 12,
    background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600,
  },
  pillYellow: {
    display: 'inline-block', padding: '2px 10px', borderRadius: 12,
    background: '#fef9c3', color: '#b45309', fontSize: 12, fontWeight: 600,
  },
  meter: {
    height: 10, borderRadius: 5, background: '#e5e7eb', overflow: 'hidden', marginTop: 4,
  },
  meterFill: { height: '100%', borderRadius: 5, transition: 'width 0.6s ease' },
  abbyyPreview: {
    border: '2px solid #1a3a5c', borderRadius: 10, overflow: 'hidden',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
  abbyyTitle: {
    background: '#1a3a5c', color: '#fff', padding: '8px 16px',
    fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
  },
  abbyyBody: { background: '#fff', padding: 0 },
  abbyyRow: {
    display: 'grid', gridTemplateColumns: '180px 1fr',
    borderBottom: '1px solid #f3f4f6',
  },
  abbyyRowLast: {
    display: 'grid', gridTemplateColumns: '180px 1fr',
  },
  abbyyKey: {
    padding: '9px 14px', background: '#f8fafc',
    fontSize: 13, color: '#374151', fontWeight: 500,
    borderRight: '1px solid #e5e7eb',
  },
  abbyyVal: {
    padding: '9px 14px', fontSize: 13, color: '#111',
    background: '#fffbf0',
  },
  abbyyValEmpty: {
    padding: '9px 14px', fontSize: 13, color: '#9ca3af',
    background: '#fafafa', fontStyle: 'italic',
  },
  spinner: {
    display: 'inline-block', width: 18, height: 18,
    border: '3px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff', borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function confColor(c: number) {
  if (c >= 90) return '#16a34a'
  if (c >= 70) return '#d97706'
  return '#dc2626'
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve((e.target?.result as string) || '')
    reader.readAsText(file)
  })
}

async function extractText(file: File): Promise<string> {
  // For PDF/image files the backend handles OCR; we send raw text for .txt files
  if (file.type === 'text/plain') return readFileAsText(file)
  // For all other types, return empty - backend will OCR via existing pipeline
  return `[Datei: ${file.name}]`
}

// ─── Hauptkomponente ─────────────────────────────────────────────────────────
export default function Demo() {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function analyze(f: File) {
    setFile(f)
    setResult(null)
    setError('')
    setLoading(true)

    try {
      // 1. Upload the document to extract text via the existing pipeline
      const formData = new FormData()
      formData.append('document', f)

      const uploadRes = await fetch(`${API}/documents/upload`, { method: 'POST', body: formData })
      const uploaded = await uploadRes.json()

      if (!uploadRes.ok || (!uploaded.id && !uploaded.document_id)) {
        throw new Error(uploaded.error || 'Upload fehlgeschlagen')
      }

      const docId = uploaded.id || uploaded.document_id

      // 2. Wait briefly for AI processing, then get the document details
      await new Promise(r => setTimeout(r, 2000))
      const docRes = await fetch(`${API}/documents/${docId}`)
      const doc = await docRes.json()

      // 3. Call bot analyze with available text
      const ocrText = doc.ai_reasoning || doc.ai_suggestion || `Dokument: ${f.name}`
      const existingFields: Record<string, string> = {}
      if (doc.extracted_fields) {
        try { Object.assign(existingFields, JSON.parse(doc.extracted_fields)) } catch {}
      }

      const analyzeRes = await fetch(`${API}/abbyy/bot/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ocr_text: ocrText,
          document_name: f.name,
          existing_fields: existingFields,
        }),
      })

      const data = await analyzeRes.json()
      if (!analyzeRes.ok || !data.success) throw new Error(data.error || 'Analyse fehlgeschlagen')
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) analyze(f)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) analyze(f)
  }

  function reset() {
    setFile(null)
    setResult(null)
    setError('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const filledFields = result
    ? FIELD_META.filter(m => result.fields[m.key] && String(result.fields[m.key]).trim())
    : []

  return (
    <div style={s.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Hero */}
      <div style={s.hero}>
        <span style={s.heroBadge}>DEMO-MODUS</span>
        <div style={s.heroTitle}>🤖 KI-Bot Vorschau</div>
        <div style={s.heroSub}>
          Dokument hochladen → KI analysiert → zeigt was in ABBYY FlexiCapture eingetragen würde
        </div>
      </div>

      {/* Upload */}
      {!loading && !result && (
        <>
          <div
            style={{ ...s.uploadZone, ...(dragging ? s.uploadZoneActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div style={s.uploadIcon}>📄</div>
            <div style={s.uploadText}>Rechnung hier ablegen oder klicken</div>
            <div style={s.uploadSub}>PDF, JPG, PNG, TIF – bis 50 MB</div>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.txt"
              style={{ display: 'none' }} onChange={onFileChange} />
            <div style={s.btn}>Datei auswählen</div>
          </div>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16, color: '#dc2626', fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}
        </>
      )}

      {/* Ladeanzeige */}
      {loading && (
        <div style={{ ...s.card, textAlign: 'center' as const, padding: '48px 24px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1a3a5c' }}>KI analysiert: {file?.name}</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
            OCR → Feldextraktion → Lieferantenabgleich → Entscheidung...
          </div>
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%', background: '#1a3a5c',
              animation: 'spin 1s linear infinite'
            }} />
            <div style={{ fontSize: 13, color: '#6b7280' }}>Bitte warten...</div>
          </div>
        </div>
      )}

      {/* Ergebnis */}
      {result && !loading && (
        <>
          {/* Entscheidungs-Banner */}
          {result.ampel === 'gruen' && result.decision === 'auto_complete' ? (
            <div style={s.decisionGreen}>
              <div style={s.decisionIcon}>✅</div>
              <div>
                <div style={{ ...s.decisionTitle, color: '#16a34a' }}>
                  Automatisch abschließen — kein Sachbearbeiter nötig
                </div>
                <div style={{ ...s.decisionText, color: '#166534' }}>{result.reason}</div>
              </div>
            </div>
          ) : result.ampel === 'gelb' ? (
            <div style={s.decisionYellow}>
              <div style={s.decisionIcon}>🟡</div>
              <div>
                <div style={{ ...s.decisionTitle, color: '#92400e' }}>
                  Zur manuellen Prüfung — Felder werden vorausgefüllt
                </div>
                <div style={{ ...s.decisionText, color: '#78350f' }}>{result.reason}</div>
              </div>
            </div>
          ) : (
            <div style={s.decisionRed}>
              <div style={s.decisionIcon}>🔴</div>
              <div>
                <div style={{ ...s.decisionTitle, color: '#991b1b' }}>
                  Manuelle Prüfung erforderlich
                </div>
                <div style={{ ...s.decisionText, color: '#7f1d1d' }}>{result.reason}</div>
              </div>
            </div>
          )}

          {/* KPI-Zeile */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Dokumenttyp', value: result.doc_type || '–' },
              { label: 'Konfidenz', value: `${result.confidence}%` },
              { label: 'Lieferant bekannt', value: result.supplier_matched ? (result.supplier_name || 'Ja') : 'Nein' },
              { label: 'Felder erkannt', value: `${filledFields.length} / ${FIELD_META.length}` },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' as const }}>{kpi.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1a3a5c', marginTop: 4 }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Konfidenz-Balken */}
          <div style={{ ...s.card }}>
            <div style={s.cardHead}>📊 Analyse-Konfidenz</div>
            <div style={{ ...s.cardBody }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: '#374151' }}>Erkennungsqualität</span>
                <span style={{ fontWeight: 700, color: confColor(result.confidence) }}>{result.confidence}%</span>
              </div>
              <div style={s.meter}>
                <div style={{ ...s.meterFill, width: `${result.confidence}%`, background: confColor(result.confidence) }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
                <span>0%</span>
                <span>Schwellenwert (75%)</span>
                <span>Auto-Abschluss (90%)</span>
                <span>100%</span>
              </div>
            </div>
          </div>

          {/* ABBYY-Vorschau */}
          <div style={s.card}>
            <div style={s.cardHead}>
              <span>🖥️ So würde ABBYY FlexiCapture ausgefüllt</span>
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 400 }}>
                {filledFields.length} Felder automatisch befüllt
              </span>
            </div>
            <div style={s.cardBody}>
              <div style={s.abbyyPreview}>
                <div style={s.abbyyTitle}>
                  <span>📄</span>
                  <span>ABBYY FlexiCapture – Verification Station</span>
                  <span style={{ marginLeft: 'auto', background: 'rgba(212,168,67,0.3)', padding: '2px 10px', borderRadius: 10, color: '#d4a843', fontSize: 11 }}>
                    KI-Bot ausgefüllt
                  </span>
                </div>
                <div style={s.abbyyBody}>
                  {FIELD_META.map((m, i) => {
                    const val = result.fields[m.key]
                    const hasVal = val && String(val).trim()
                    const isReq = REQUIRED.includes(m.key)
                    const isLast = i === FIELD_META.length - 1
                    return (
                      <div key={m.key} style={isLast ? s.abbyyRowLast : s.abbyyRow}>
                        <div style={s.abbyyKey}>
                          {m.icon} {m.label}
                          {isReq && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
                        </div>
                        <div style={hasVal ? s.abbyyVal : s.abbyyValEmpty}>
                          {hasVal ? String(val) : '(leer — nicht erkannt)'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af' }}>
                * Pflichtfelder
              </div>
            </div>
          </div>

          {/* Neues Dokument */}
          <div style={{ textAlign: 'center' as const, marginTop: 8, marginBottom: 32 }}>
            <button style={{ ...s.btn, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }}
              onClick={reset}>
              ← Neues Dokument testen
            </button>
          </div>
        </>
      )}
    </div>
  )
}
