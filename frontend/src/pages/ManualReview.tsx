import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocuments, getDocument, updateDocument, triggerAnalysis, forwardToAbbyy } from '../api/documents'
import type { Document, DocType, Ampel } from '../types'
import AbbyyOverlay, { type AbbyyFields } from '../components/AbbyyOverlay'

const DOC_TYPES: DocType[] = ['Rechnung', 'Mahnung', 'Behördenbescheid', 'Unleserlich', 'Sonstiges']
const AMPEL_MAP: Record<DocType, Ampel> = {
  Rechnung: 'gruen',
  Mahnung: 'gelb',
  Behördenbescheid: 'gelb',
  Unleserlich: 'rot',
  Sonstiges: 'rot',
}

const S = {
  shell: { display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, minHeight: 600 },
  card: { background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' },
  previewArea: { display: 'flex', flexDirection: 'column', height: '100%' },
  previewHeader: { padding: '14px 20px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, color: '#1a3a5c', fontSize: 14 },
  previewFrame: { flex: 1, minHeight: 500 },
  panelHeader: { padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  panel: { padding: 20 },
  label: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 5, marginTop: 14 },
  value: { fontSize: 14, color: '#111827', fontWeight: 500 },
  ampelBig: (a: string): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '6px 16px', borderRadius: 20, fontWeight: 700, fontSize: 15,
    background: a === 'gruen' ? '#dcfce7' : a === 'gelb' ? '#fef9c3' : '#fee2e2',
    color: a === 'gruen' ? '#15803d' : a === 'gelb' ? '#a16207' : '#b91c1c',
  }),
  ampelDot: (a: string): React.CSSProperties => ({
    width: 12, height: 12, borderRadius: '50%',
    background: a === 'gruen' ? '#22c55e' : a === 'gelb' ? '#eab308' : '#ef4444',
  }),
  confidence: (c: number): React.CSSProperties => ({
    display: 'inline-block', padding: '3px 12px', borderRadius: 12,
    background: c >= 75 ? '#dcfce7' : c >= 50 ? '#fef9c3' : '#fee2e2',
    color: c >= 75 ? '#15803d' : c >= 50 ? '#a16207' : '#b91c1c',
    fontWeight: 700, fontSize: 15,
  }),
  reasoning: {
    background: '#f9fafb', borderRadius: 8, padding: '10px 14px',
    fontSize: 13, color: '#374151', lineHeight: 1.6, marginTop: 6,
    border: '1px solid #e5e7eb',
  },
  select: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  btn: (v: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' = 'primary', disabled = false): React.CSSProperties => ({
    padding: '10px 18px', borderRadius: 8, fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, border: 'none',
    background: disabled ? '#d1d5db'
      : v === 'primary' ? '#1a3a5c'
      : v === 'success' ? '#16a34a'
      : v === 'warning' ? '#ca8a04'
      : v === 'danger' ? '#ef4444'
      : '#f3f4f6',
    color: disabled ? '#9ca3af' : v === 'secondary' ? '#374151' : '#fff',
    transition: 'all 0.15s',
    opacity: disabled ? 0.7 : 1,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }),
  actions: { display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' as const },
  logEntry: (s: string): React.CSSProperties => ({
    padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12,
    color: s === 'error' ? '#dc2626' : s === 'success' ? '#16a34a' : '#6b7280',
  }),
  queueList: { display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 400, overflowY: 'auto' as const },
  queueItem: (active: boolean): React.CSSProperties => ({
    padding: '9px 14px', cursor: 'pointer', fontSize: 13,
    background: active ? '#eff6ff' : '#fff',
    borderBottom: '1px solid #f3f4f6',
    borderLeft: active ? '3px solid #2563eb' : '3px solid transparent',
    color: active ? '#1e40af' : '#374151',
    transition: 'background 0.15s',
  }),
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

const AMPEL_LABELS: Record<string, string> = { gruen: 'Grün – Auto', gelb: 'Gelb – Manuell', rot: 'Rot – Fehler' }

function Spinner({ color = '#fff' }: { color?: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 13, height: 13,
      border: `2px solid ${color}40`,
      borderTopColor: color,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

function Toast({ msg, ok, onDone }: { msg: string; ok: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div style={{
      position: 'fixed', top: 24, right: 24, zIndex: 1000,
      padding: '12px 24px', borderRadius: 10, fontWeight: 600, fontSize: 14,
      background: ok ? '#16a34a' : '#dc2626', color: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'slideIn 0.2s ease',
    }}>
      {ok ? '✓' : '✗'} {msg}
    </div>
  )
}

/** Liest die extrahierten Felder aus dem Dokument und ergänzt den Lieferantennamen. */
function buildAbbyyFields(doc: Document): AbbyyFields {
  let ef: Record<string, any> = {}
  const raw = (doc as any).extracted_fields
  if (raw) {
    try { ef = typeof raw === 'string' ? JSON.parse(raw) : raw } catch (_) {}
  }
  return {
    absender: doc.sender || ef.absender || null,
    absender_strasse: ef.absender_strasse ?? null,
    absender_plz: ef.absender_plz ?? null,
    absender_ort: ef.absender_ort ?? null,
    absender_land: ef.absender_land ?? null,
    iban: ef.iban ?? null,
    bankkonto: ef.bankkonto ?? null,
    bic: ef.bic ?? null,
    rechnungsnummer: ef.rechnungsnummer ?? null,
    rechnungsdatum: ef.rechnungsdatum ?? null,
    faelligkeitsdatum: ef.faelligkeitsdatum ?? null,
    einkaeufer: ef.einkaeufer ?? null,
    reversed_charge: ef.reversed_charge ?? false,
    betrag_brutto: ef.betrag_brutto ?? null,
    waehrung: ef.waehrung ?? null,
    betrag_netto: ef.betrag_netto ?? null,
    steuerbetrag: ef.steuerbetrag ?? null,
    steuersatz: ef.steuersatz ?? null,
    nettogesamtbetrag: ef.nettogesamtbetrag ?? null,
    steuergesamtbetrag: ef.steuergesamtbetrag ?? null,
    referenz: ef.referenz ?? null,
  }
}

function Field({ label, value, highlight, wide }: { label: string; value: any; highlight?: boolean; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? 'span 2' : undefined }}>
      <div style={{ color: '#9ca3af', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>{label}</div>
      <div style={{
        fontWeight: highlight ? 700 : 500,
        color: highlight ? '#15803d' : '#111827',
        background: highlight ? '#dcfce7' : '#f9fafb',
        padding: '2px 6px', borderRadius: 4, fontSize: 12,
        fontFamily: highlight ? undefined : 'monospace',
        letterSpacing: highlight ? undefined : 0.3,
      }}>{value}</div>
    </div>
  )
}

function PreviewPane({ doc }: { doc: Document }) {
  const fileUrl = `/uploads/originals/${doc.filename}`
  const isImage = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp'].includes(doc.file_type.toLowerCase())
  const isPdf = doc.file_type.toLowerCase() === 'pdf'

  return (
    <div style={S.previewArea}>
      <div style={S.previewHeader}>{doc.original_name}</div>
      <div style={S.previewFrame}>
        {isPdf && (
          <iframe
            src={fileUrl}
            style={{ width: '100%', height: 600, border: 'none' }}
            title={doc.original_name}
          />
        )}
        {isImage && (
          <img
            src={fileUrl}
            alt={doc.original_name}
            style={{ maxWidth: '100%', maxHeight: 600, display: 'block', margin: '0 auto' }}
          />
        )}
        {!isPdf && !isImage && (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            Vorschau nicht verfügbar für Typ: {doc.file_type}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ManualReview() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [correctionMode, setCorrectionMode] = useState(false)
  const [corrDocType, setCorrDocType] = useState<DocType>('Rechnung')
  const [corrSender, setCorrSender] = useState('')
  const [corrNote, setCorrNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingFields, setSavingFields] = useState(false)
  const [forwarding, setForwarding] = useState(false)
  const [retriggeringAnalysis, setRetriggeringAnalysis] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const { data: queue } = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => getDocuments({ status: 'processed', ampel: 'gelb', limit: 50 }),
    refetchInterval: 15_000,
  })

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: () => getDocument(id!),
    enabled: !!id,
    // Poll faster while processing
    refetchInterval: id ? 5_000 : false,
  })

  const isDocProcessing = doc?.status === 'processing' || doc?.status === 'pending'

  useEffect(() => {
    if (doc) {
      setCorrDocType((doc.doc_type as DocType) || 'Sonstiges')
      setCorrSender(doc.sender || '')
      setConfirmed(false)
    }
  }, [doc?.id])

  // Reset retrigger state when doc finishes processing
  useEffect(() => {
    if (doc && doc.status !== 'processing' && doc.status !== 'pending') {
      setRetriggeringAnalysis(false)
    }
  }, [doc?.status])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
  }

  async function handleConfirm() {
    if (!doc) return
    setSaving(true)
    setConfirmed(false)
    try {
      await updateDocument(doc.id, { status: 'processed', user_correction: 'Bestätigt' })
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      qc.invalidateQueries({ queryKey: ['review-queue'] })
      setConfirmed(true)
      showToast('Dokument bestätigt ✓')
      setTimeout(() => setConfirmed(false), 3000)
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function handleCorrect() {
    if (!doc) return
    setSaving(true)
    try {
      const newAmpel = AMPEL_MAP[corrDocType] || 'rot'
      await updateDocument(doc.id, {
        doc_type: corrDocType,
        sender: corrSender || doc.sender || undefined,
        ampel: newAmpel,
        user_correction: `Typ: ${corrDocType}${corrNote ? ' · ' + corrNote : ''}`,
        status: 'processed',
      })
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      qc.invalidateQueries({ queryKey: ['review-queue'] })
      setCorrectionMode(false)
      showToast('Korrektur gespeichert')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveFields(fields: AbbyyFields) {
    if (!doc) return
    setSavingFields(true)
    try {
      // Lieferantenname separat ins sender-Feld, Rest in extracted_fields
      const { absender, ...rest } = fields
      await updateDocument(doc.id, {
        sender: absender || doc.sender || undefined,
        extracted_fields: rest,
        user_correction: 'Rechnungsfelder geprüft',
      })
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      showToast('Rechnungsfelder gespeichert')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setSavingFields(false)
    }
  }

  async function handleForward() {
    if (!doc) return
    setForwarding(true)
    try {
      const result = await forwardToAbbyy(doc.id)
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      showToast(result.message || 'An ABBYY weitergeleitet')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setForwarding(false)
    }
  }

  async function handleRetrigger() {
    if (!doc) return
    setRetriggeringAnalysis(true)
    try {
      await triggerAnalysis(doc.id)
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      showToast('KI-Analyse neu gestartet – bitte warten…')
    } catch (err: any) {
      showToast(err.message, false)
      setRetriggeringAnalysis(false)
    }
  }

  const queueDocs = queue?.data || []

  return (
    <div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0.4); } 50% { box-shadow: 0 0 0 6px rgba(251,191,36,0); } }
        .review-btn:hover:not(:disabled) { filter: brightness(0.88); transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.15); }
        .review-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
        .confirmed-flash { animation: confirmedFlash 0.4s ease; }
        @keyframes confirmedFlash { 0% { background: #bbf7d0; } 100% { background: #fff; } }
      `}</style>

      {toast && <Toast msg={toast.msg} ok={toast.ok} onDone={() => setToast(null)} />}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 420px', gap: 16 }}>
        {/* Left queue panel */}
        <div style={S.card}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 13, color: '#1a3a5c' }}>
            Warteschlange ({queueDocs.length})
          </div>
          <div style={S.queueList}>
            {queueDocs.length === 0 && (
              <div style={{ padding: 20, fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>
                Keine Dokumente in der Warteschlange
              </div>
            )}
            {queueDocs.map((d) => (
              <div
                key={d.id}
                className="review-btn"
                style={{ ...S.queueItem(d.id === id), transition: 'background 0.15s' }}
                onClick={() => navigate(`/prüfung/${d.id}`)}
              >
                <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.original_name}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{d.doc_type || '–'} · {d.confidence}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Document preview */}
        <div style={S.card}>
          {!id && (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 15 }}>
              Wählen Sie ein Dokument aus der Warteschlange zur Prüfung aus.
            </div>
          )}
          {id && isLoading && (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
              <span style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid #d1d5db', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: 8 }} />
              Lade Dokument…
            </div>
          )}
          {id && doc && <PreviewPane doc={doc} />}
        </div>

        {/* Right analysis panel */}
        <div style={S.card}>
          {!doc ? (
            <div style={{ padding: 20, color: '#9ca3af', fontSize: 14 }}>Kein Dokument ausgewählt</div>
          ) : (
            <>
              <div style={S.panelHeader}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1a3a5c' }}>KI-Analyse</span>
                <span style={S.ampelBig(doc.ampel)}>
                  <span style={S.ampelDot(doc.ampel)} />
                  {AMPEL_LABELS[doc.ampel]}
                </span>
              </div>

              {/* Processing banner */}
              {(isDocProcessing || retriggeringAnalysis) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#fffbeb', borderBottom: '1px solid #fde68a',
                  padding: '12px 20px', fontSize: 13, color: '#92400e',
                  animation: 'pulseGlow 2s ease-in-out infinite',
                }}>
                  <Spinner color="#92400e" />
                  <div>
                    <strong>KI analysiert das Dokument…</strong>
                    <div style={{ fontSize: 11, marginTop: 2, opacity: 0.7 }}>Das kann je nach Modell bis zu 2 Minuten dauern.</div>
                  </div>
                </div>
              )}

              <div style={{ ...S.panel, ...(confirmed ? { background: '#f0fdf4' } : {}) }}>
                <div style={S.label}>Dokumenttyp</div>
                <div style={S.value}>{doc.doc_type || '–'}</div>

                <div style={S.label}>Absender</div>
                <div style={S.value}>
                  {doc.sender || '–'}
                  {doc.sender_matched ? <span style={{ marginLeft: 8, color: '#16a34a', fontSize: 12 }}>✓ {(doc as any).supplier_name}</span> : null}
                </div>

                <div style={S.label}>Konfidenz</div>
                <span style={S.confidence(doc.confidence)}>{doc.confidence}%</span>

                <div style={S.label}>KI-Begründung</div>
                <div style={S.reasoning}>{doc.ai_reasoning || '–'}</div>

                {doc.user_correction && (
                  <>
                    <div style={S.label}>Letzte Korrektur</div>
                    <div style={{ ...S.reasoning, borderColor: '#fde68a', background: '#fef9c3' }}>{doc.user_correction}</div>
                  </>
                )}

                {/* ABBYY-Formular (Nachbau des Validierungs-Overlays) */}
                <div style={{ marginTop: 18 }}>
                  <AbbyyOverlay
                    fields={buildAbbyyFields(doc)}
                    saving={savingFields}
                    forwarding={forwarding}
                    onSave={handleSaveFields}
                    onForward={handleForward}
                  />
                </div>

                {!correctionMode && (
                  <div style={S.actions}>
                    <button
                      className="review-btn"
                      style={S.btn('success', saving || isDocProcessing)}
                      disabled={saving || isDocProcessing}
                      onClick={handleConfirm}
                    >
                      {saving ? <Spinner /> : '✓'}
                      {saving ? 'Speichern…' : 'Bestätigen'}
                    </button>
                    <button
                      className="review-btn"
                      style={S.btn('warning', isDocProcessing)}
                      disabled={isDocProcessing}
                      onClick={() => setCorrectionMode(true)}
                    >
                      ✏ Korrigieren
                    </button>
                    <button
                      className="review-btn"
                      style={S.btn('primary', forwarding || isDocProcessing)}
                      disabled={forwarding || isDocProcessing}
                      onClick={handleForward}
                    >
                      {forwarding ? <Spinner /> : '→'}
                      {forwarding ? 'Wird gesendet…' : 'An ABBYY'}
                    </button>
                    <button
                      className="review-btn"
                      style={S.btn('secondary', retriggeringAnalysis || isDocProcessing)}
                      disabled={retriggeringAnalysis || isDocProcessing}
                      onClick={handleRetrigger}
                    >
                      {retriggeringAnalysis ? <Spinner color="#374151" /> : '↺'}
                      {retriggeringAnalysis ? 'Gestartet…' : 'Neu analysieren'}
                    </button>
                  </div>
                )}

                {correctionMode && (
                  <div style={{ marginTop: 16, padding: 16, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                    <div style={{ fontWeight: 600, marginBottom: 12, color: '#1a3a5c' }}>Korrektur eingeben</div>

                    <div style={S.label}>Dokumenttyp</div>
                    <select style={S.select} value={corrDocType} onChange={(e) => setCorrDocType(e.target.value as DocType)}>
                      {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>

                    <div style={S.label}>Absender</div>
                    <input style={S.input} value={corrSender} onChange={(e) => setCorrSender(e.target.value)} placeholder="Absendername" />

                    <div style={S.label}>Anmerkung (optional)</div>
                    <input style={S.input} value={corrNote} onChange={(e) => setCorrNote(e.target.value)} placeholder="Anmerkung zur Korrektur" />

                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <button
                        className="review-btn"
                        style={S.btn('success', saving)}
                        disabled={saving}
                        onClick={handleCorrect}
                      >
                        {saving ? <Spinner /> : '✓'}
                        {saving ? 'Speichern…' : 'Speichern'}
                      </button>
                      <button
                        className="review-btn"
                        style={S.btn('secondary')}
                        onClick={() => setCorrectionMode(false)}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                )}

                {/* Processing log */}
                {doc.processing_logs && doc.processing_logs.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={S.label}>Verarbeitungsprotokoll</div>
                    {doc.processing_logs.map((log) => (
                      <div key={log.id} style={S.logEntry(log.status)}>
                        <span style={{ fontWeight: 600 }}>{log.step}</span>
                        {log.message && <span style={{ marginLeft: 6, opacity: 0.8 }}>{log.message}</span>}
                        <span style={{ float: 'right', opacity: 0.5 }}>
                          {new Date(log.created_at).toLocaleTimeString('de-DE')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
