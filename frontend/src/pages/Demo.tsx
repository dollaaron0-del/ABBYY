import React, { useRef, useState } from 'react'

const API = 'http://127.0.0.1:3001/api'

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

// ─── ABBYY-ähnliche Styles ────────────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)',
    background: '#d4d0c8', fontFamily: '"Segoe UI", Tahoma, Geneva, sans-serif',
    border: '1px solid #808080', borderRadius: 4, overflow: 'hidden',
  },
  toolbar: {
    background: 'linear-gradient(180deg, #f0ece0 0%, #d8d4c8 100%)',
    borderBottom: '1px solid #808080', padding: '4px 8px',
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
  },
  toolbarTitle: {
    fontWeight: 600, color: '#000080', fontSize: 13, marginRight: 16,
  },
  statusBar: {
    background: '#d4d0c8', borderTop: '1px solid #808080',
    padding: '3px 8px', fontSize: 11, color: '#333',
    display: 'flex', alignItems: 'center', gap: 16,
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  // Linke Seite: Dokument
  leftPane: {
    flex: '0 0 55%', background: '#808080', display: 'flex',
    flexDirection: 'column', borderRight: '2px solid #606060',
  },
  docHeader: {
    background: '#d4d0c8', borderBottom: '1px solid #808080',
    padding: '3px 8px', fontSize: 11, color: '#333',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  docViewer: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'auto', padding: 16,
  },
  docPage: {
    background: '#fff', boxShadow: '2px 2px 8px rgba(0,0,0,0.4)',
    minHeight: 400, width: '100%', maxWidth: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative' as const,
  },

  // Rechte Seite: Felder
  rightPane: {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: '#d4d0c8', overflow: 'hidden',
  },
  formScroll: { flex: 1, overflowY: 'auto' as const, padding: 6 },

  // Sektionen
  section: { marginBottom: 4 },
  sectionHeader: {
    background: 'linear-gradient(180deg, #316ac5 0%, #1a4a9c 100%)',
    color: '#fff', padding: '2px 8px', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', userSelect: 'none' as const,
    display: 'flex', alignItems: 'center', gap: 4,
  },
  sectionBody: {
    background: '#f0ece0', border: '1px solid #808080',
    borderTop: 'none', padding: '6px 8px',
  },

  // Formularzeilen
  row: { display: 'flex', alignItems: 'center', marginBottom: 4, gap: 4 },
  label: { fontSize: 11, color: '#333', minWidth: 90, flexShrink: 0 },
  labelSmall: { fontSize: 11, color: '#333', minWidth: 60, flexShrink: 0 },

  // Eingabefelder
  input: {
    flex: 1, height: 20, fontSize: 11, border: '1px solid #7a7a7a',
    background: '#fff', padding: '0 4px', outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
  inputFilled: {
    flex: 1, height: 20, fontSize: 11, border: '1px solid #7a7a7a',
    background: '#ffffc0', padding: '0 4px', outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
  inputRequired: {
    flex: 1, height: 20, fontSize: 11,
    border: '2px solid #cc0000', background: '#ffe0e0',
    padding: '0 4px', outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
  inputSmall: {
    width: 60, height: 20, fontSize: 11, border: '1px solid #7a7a7a',
    background: '#fff', padding: '0 4px', outline: 'none', flexShrink: 0,
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
  inputSmallFilled: {
    width: 60, height: 20, fontSize: 11, border: '1px solid #7a7a7a',
    background: '#ffffc0', padding: '0 4px', outline: 'none', flexShrink: 0,
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },

  // Tabelle Positionsdaten
  posTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  posTh: {
    background: '#316ac5', color: '#fff', padding: '2px 4px',
    border: '1px solid #808080', textAlign: 'left' as const, fontWeight: 600,
  },
  posTd: {
    padding: '1px', border: '1px solid #c0c0c0', background: '#fff',
  },
  posTdInput: {
    width: '100%', height: 18, border: 'none', background: 'transparent',
    fontSize: 10, padding: '0 2px', outline: 'none',
  },

  // Upload
  uploadZone: {
    border: '2px dashed #808080', background: '#c8c4b8',
    display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center',
    gap: 8, cursor: 'pointer', flex: 1, margin: 16, borderRadius: 2,
  },
  uploadText: { fontSize: 13, color: '#333', fontWeight: 600 },
  uploadSub: { fontSize: 11, color: '#666' },
  btn: {
    background: 'linear-gradient(180deg, #f0ece0 0%, #d0ccc0 100%)',
    border: '1px solid #808080', padding: '3px 12px', fontSize: 11,
    cursor: 'pointer', borderRadius: 2, color: '#000',
  },
  btnPrimary: {
    background: 'linear-gradient(180deg, #316ac5 0%, #1a4a9c 100%)',
    border: '1px solid #1a3a7c', padding: '3px 12px', fontSize: 11,
    cursor: 'pointer', borderRadius: 2, color: '#fff', fontWeight: 600,
  },
  decisionBanner: {
    padding: '4px 8px', fontSize: 11, fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 6,
  },
}

// ─── Hilfsfunktion: Stilwahl je nach Wert ─────────────────────────────────────
function fieldStyle(value: string | undefined, required = false) {
  if (value && String(value).trim()) return s.inputFilled
  if (required) return s.inputRequired
  return s.input
}
function smallFieldStyle(value: string | undefined) {
  if (value && String(value).trim()) return s.inputSmallFilled
  return s.inputSmall
}

// ─── Kollapsierbare Sektion ────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={s.section}>
      <div style={s.sectionHeader} onClick={() => setOpen(!open)}>
        <span>{open ? '▼' : '▶'}</span> {title}
      </div>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  )
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Demo() {
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const f = result?.fields || {}

  async function analyze(file: File) {
    setFile(file)
    setFileUrl(URL.createObjectURL(file))
    setResult(null)
    setError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch(`${API}/documents/upload`, { method: 'POST', body: formData })
      const uploaded = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploaded.error || 'Upload fehlgeschlagen')

      const docId = uploaded.document?.id || uploaded.id || uploaded.document_id
      if (!docId) throw new Error('Keine Dokument-ID in der Antwort')
      await new Promise(r => setTimeout(r, 2500))

      const docRes = await fetch(`${API}/documents/${docId}`)
      const doc = await docRes.json()

      const ocrText = doc.ai_reasoning || doc.ai_suggestion || `Dokument: ${file.name}`
      const existingFields: Record<string, string> = {}
      if (doc.extracted_fields) { try { Object.assign(existingFields, JSON.parse(doc.extracted_fields)) } catch {} }

      const analyzeRes = await fetch(`${API}/abbyy/bot/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocr_text: ocrText, document_name: file.name, existing_fields: existingFields }),
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
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) analyze(f)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) analyze(f)
  }

  const decisionColor = result?.ampel === 'gruen' ? '#006600' : result?.ampel === 'gelb' ? '#996600' : '#cc0000'
  const decisionIcon  = result?.ampel === 'gruen' ? '✔' : result?.ampel === 'gelb' ? '⚠' : '✘'
  const decisionText  = result?.decision === 'auto_complete' ? 'Automatisch abgeschlossen' : 'Manuelle Prüfung erforderlich'

  return (
    <div style={s.shell}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <span style={s.toolbarTitle}>ABBYY FlexiCapture 12 — Verification Station (Demo)</span>
        <button style={s.btn} onClick={() => { setFile(null); setFileUrl(''); setResult(null); setError('') }}>
          Neues Dokument
        </button>
        {result && (
          <button style={s.btnPrimary}>
            {result.decision === 'auto_complete' ? '✔ Task schließen' : '⚑ Task abrufen'}
          </button>
        )}
        {result && (
          <div style={{ ...s.decisionBanner, color: decisionColor, marginLeft: 'auto' }}>
            {decisionIcon} {decisionText} — Konfidenz: {result.confidence}%
          </div>
        )}
      </div>

      {/* Body */}
      <div style={s.body}>

        {/* Linke Seite: Dokumentanzeige */}
        <div style={s.leftPane}>
          <div style={s.docHeader}>
            <span>📄</span>
            <span>{file ? file.name : 'Kein Dokument geladen'}</span>
            {file && <span style={{ marginLeft: 'auto', color: '#666' }}>1 / 1</span>}
          </div>

          <div style={s.docViewer}>
            {!file && (
              <div
                style={{ ...s.uploadZone, ...(dragging ? { borderColor: '#316ac5', background: '#c0d0e8' } : {}) }}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
              >
                <span style={{ fontSize: 40 }}>📄</span>
                <span style={s.uploadText}>Rechnung hier ablegen</span>
                <span style={s.uploadSub}>PDF, JPG, PNG, TIF</span>
                <button style={s.btn}>Datei auswählen</button>
                <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
                  style={{ display: 'none' }} onChange={onFileChange} />
              </div>
            )}

            {loading && (
              <div style={{ color: '#fff', textAlign: 'center' as const, padding: 32 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>KI analysiert Dokument...</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>OCR → Felderkennung → Lieferantenabgleich</div>
              </div>
            )}

            {file && !loading && (
              <div style={s.docPage}>
                {file.type === 'application/pdf' ? (
                  <iframe src={fileUrl} style={{ width: '100%', height: 700, border: 'none' }} title="Dokument" />
                ) : (
                  <img src={fileUrl} alt="Dokument" style={{ maxWidth: '100%', maxHeight: 700, display: 'block' }} />
                )}
              </div>
            )}
          </div>

          {error && (
            <div style={{ background: '#ffd0d0', border: '1px solid #cc0000', padding: '6px 10px', fontSize: 11, color: '#cc0000' }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Rechte Seite: Felder */}
        <div style={s.rightPane}>
          {!result && !loading && (
            <div style={{ padding: 20, color: '#666', fontSize: 12, textAlign: 'center' as const, marginTop: 40 }}>
              Lade ein Dokument, um die erkannten Felder zu sehen.
            </div>
          )}

          {loading && (
            <div style={{ padding: 20, color: '#333', fontSize: 12, textAlign: 'center' as const, marginTop: 40 }}>
              Felder werden erkannt...
            </div>
          )}

          {result && !loading && (
            <div style={s.formScroll}>

              {/* Rechnungstyp */}
              <div style={{ ...s.sectionBody, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...s.label, minWidth: 70 }}>Rechnungstyp</span>
                <select style={{ ...s.input, flex: '0 0 120px', height: 22 }}>
                  <option>{f.doc_type || result.doc_type || 'Rechnung'}</option>
                  <option>Gutschrift</option>
                  <option>Mahnung</option>
                </select>
              </div>

              {/* Lieferant */}
              <Section title="Lieferant">
                <div style={s.row}>
                  <span style={s.label}>Suchen...</span>
                  <input style={{ ...s.input, flex: '0 0 50px' }} readOnly value={f.lieferant_id || ''} placeholder="ID" />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Name</span>
                  <input style={fieldStyle(f.absender)} readOnly value={f.absender || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Umsatzsteuer ID</span>
                  <input style={fieldStyle(f.ust_id)} readOnly value={f.ust_id || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Steuernummer</span>
                  <input style={{ ...fieldStyle(f.steuernummer), flex: '0 0 90px' }} readOnly value={f.steuernummer || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Straße</span>
                  <input style={fieldStyle(f.absender_strasse)} readOnly value={f.absender_strasse || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>PLZ</span>
                  <input style={{ ...fieldStyle(f.absender_plz), flex: '0 0 60px' }} readOnly value={f.absender_plz || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Ort</span>
                  <input style={fieldStyle(f.absender_ort)} readOnly value={f.absender_ort || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4, minWidth: 30 }}>Land</span>
                  <input style={{ ...fieldStyle(f.absender_land), flex: '0 0 40px' }} readOnly value={f.absender_land || 'DE'} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>IBAN</span>
                  <input style={fieldStyle(f.iban)} readOnly value={f.iban || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Bankkonto</span>
                  <input style={fieldStyle(f.bankkonto)} readOnly value={f.bankkonto || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Bankleitzahl</span>
                  <input style={fieldStyle(f.bic)} readOnly value={f.bic || ''} />
                </div>
              </Section>

              {/* Rechnungsdaten */}
              <Section title="Rechnungsdaten">
                <div style={s.row}>
                  <span style={s.label}>Rechnungsnummer</span>
                  <input style={fieldStyle(f.rechnungsnummer, true)} readOnly value={f.rechnungsnummer || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Rechnungsdatum</span>
                  <input style={fieldStyle(f.rechnungsdatum, true)} readOnly value={f.rechnungsdatum || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Fälligkeitsdatum</span>
                  <input style={fieldStyle(f.faelligkeitsdatum)} readOnly value={f.faelligkeitsdatum || ''} />
                </div>
              </Section>

              {/* Sonstige Daten */}
              <Section title="Sonstige Daten" defaultOpen={false}>
                <div style={s.row}>
                  <span style={s.label}>Kein</span>
                </div>
              </Section>

              {/* Beträge */}
              <Section title="Beträge">
                <div style={{ ...s.row, marginBottom: 6 }}>
                  <input type="checkbox" style={{ marginRight: 4 }} readOnly />
                  <span style={{ fontSize: 11 }}>Reversed Charge</span>
                </div>
                <div style={s.row}>
                  <span style={s.label}>Bruttogesamtbetrag</span>
                  <input style={fieldStyle(f.betrag_brutto, true)} readOnly value={f.betrag_brutto || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4, minWidth: 40 }}>Währung</span>
                  <input style={{ ...fieldStyle(f.waehrung), flex: '0 0 50px' }} readOnly value={f.waehrung || 'EUR'} />
                </div>
              </Section>

              {/* Weitere Beträge */}
              <Section title="Weitere Beträge">
                <div style={s.row}>
                  <span style={s.label}>Nettobetrag</span>
                  <input style={fieldStyle(f.betrag_netto)} readOnly value={f.betrag_netto || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Nettobetrag 1</span>
                  <input style={fieldStyle(f.betrag_netto)} readOnly value={f.betrag_netto || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Steuerbetrag 1</span>
                  <input style={smallFieldStyle(f.steuerbetrag)} readOnly value={f.steuerbetrag || ''} />
                  <span style={{ ...s.labelSmall, marginLeft: 4, minWidth: 50 }}>Steuersatz 1</span>
                  <input style={smallFieldStyle(f.steuersatz)} readOnly value={f.steuersatz || ''} />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Nettobetrag 2</span>
                  <input style={s.input} readOnly value="" />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Steuerbetrag 2</span>
                  <input style={s.inputSmall} readOnly value="" />
                  <span style={{ ...s.labelSmall, marginLeft: 4, minWidth: 50 }}>Steuersatz 2</span>
                  <input style={s.inputSmall} readOnly value="" />
                </div>
                <div style={s.row}>
                  <span style={s.label}>Nettogesamtbetrag</span>
                  <input style={fieldStyle(f.betrag_netto)} readOnly value={f.betrag_netto || '0,00'} />
                  <span style={{ ...s.labelSmall, marginLeft: 4 }}>Steuergesamtbetrag</span>
                  <input style={fieldStyle(f.steuerbetrag)} readOnly value={f.steuerbetrag || '0,00'} />
                </div>
              </Section>

              {/* Positionsdaten */}
              <Section title="Positionsdaten" defaultOpen={false}>
                <table style={s.posTable}>
                  <thead>
                    <tr>
                      {['Description','Quantity','Unit','Unit price','Discount','Total netto','VAT %','Currency'].map(h => (
                        <th key={h} style={s.posTh}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[0,1,2].map(i => (
                      <tr key={i}>
                        {[0,1,2,3,4,5,6,7].map(j => (
                          <td key={j} style={s.posTd}>
                            <input style={s.posTdInput} readOnly value={i === 0 && j === 7 ? 'EUR' : ''} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              {/* KI-Hinweis */}
              <div style={{
                background: result.ampel === 'gruen' ? '#e0ffe0' : result.ampel === 'gelb' ? '#fff8e0' : '#ffe0e0',
                border: `1px solid ${result.ampel === 'gruen' ? '#60c060' : result.ampel === 'gelb' ? '#c0a030' : '#c06060'}`,
                padding: '6px 10px', marginTop: 6, fontSize: 11, borderRadius: 2,
              }}>
                <strong>🤖 KI-Bot:</strong> {result.reason}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Statusleiste */}
      <div style={s.statusBar}>
        {result ? (
          <>
            <span>Dokument: {file?.name}</span>
            <span>|</span>
            <span>Typ: {result.doc_type}</span>
            <span>|</span>
            <span>Konfidenz: {result.confidence}%</span>
            <span>|</span>
            <span style={{ color: decisionColor, fontWeight: 600 }}>
              {decisionIcon} {decisionText}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              Gelbe Felder = KI ausgefüllt &nbsp;|&nbsp; Rote Felder = fehlend/leer
            </span>
          </>
        ) : (
          <span>Bereit — Dokument hochladen um KI-Analyse zu starten</span>
        )}
      </div>
    </div>
  )
}
