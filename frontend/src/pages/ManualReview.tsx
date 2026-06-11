import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocuments, getDocument, updateDocument, triggerAnalysis, forwardToAbbyy } from '../api/documents'
import type { Document, DocType, Ampel } from '../types'

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
  btn: (v: 'primary' | 'success' | 'warning' | 'danger' | 'secondary' = 'primary'): React.CSSProperties => ({
    padding: '10px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600, border: 'none',
    background: v === 'primary' ? '#1a3a5c' : v === 'success' ? '#16a34a' : v === 'warning' ? '#ca8a04' : v === 'danger' ? '#ef4444' : '#f3f4f6',
    color: v === 'secondary' ? '#374151' : '#fff',
    transition: 'opacity 0.15s',
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
  }),
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

const AMPEL_LABELS: Record<string, string> = { gruen: 'Grün – Auto', gelb: 'Gelb – Manuell', rot: 'Rot – Fehler' }

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
  const [forwarding, setForwarding] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data: queue } = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => getDocuments({ status: 'processed', ampel: 'gelb', limit: 50 }),
    refetchInterval: 15_000,
  })

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: () => getDocument(id!),
    enabled: !!id,
    refetchInterval: id ? 10_000 : false,
  })

  useEffect(() => {
    if (doc) {
      setCorrDocType((doc.doc_type as DocType) || 'Sonstiges')
      setCorrSender(doc.sender || '')
    }
  }, [doc?.id])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleConfirm() {
    if (!doc) return
    setSaving(true)
    try {
      await updateDocument(doc.id, { status: 'processed', user_correction: 'Bestätigt' })
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      qc.invalidateQueries({ queryKey: ['review-queue'] })
      showToast('Dokument bestätigt')
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
    try {
      await triggerAnalysis(doc.id)
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      showToast('Analyse neu gestartet')
    } catch (err: any) {
      showToast(err.message, false)
    }
  }

  const queueDocs = queue?.data || []

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 24px', borderRadius: 10, fontWeight: 600, fontSize: 14,
          background: toast.ok ? '#16a34a' : '#dc2626', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          {toast.ok ? '✓' : '✗'} {toast.msg}
        </div>
      )}

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
              <div key={d.id} style={S.queueItem(d.id === id)} onClick={() => navigate(`/prüfung/${d.id}`)}>
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
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Lade Dokument…</div>
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

              <div style={S.panel}>
                <div style={S.label}>Dokumenttyp</div>
                <div style={S.value}>{doc.doc_type || '–'}</div>

                <div style={S.label}>Absender</div>
                <div style={S.value}>
                  {doc.sender || '–'}
                  {doc.sender_matched ? <span style={{ marginLeft: 8, color: '#16a34a', fontSize: 12 }}>✓ {doc.supplier_name}</span> : null}
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

                {!correctionMode && (
                  <div style={S.actions}>
                    <button style={S.btn('success')} disabled={saving} onClick={handleConfirm}>
                      ✓ Bestätigen
                    </button>
                    <button style={S.btn('warning')} onClick={() => setCorrectionMode(true)}>
                      ✏ Korrigieren
                    </button>
                    <button style={S.btn('primary')} disabled={forwarding} onClick={handleForward}>
                      {forwarding ? '…' : '→ An ABBYY'}
                    </button>
                    <button style={S.btn('secondary')} onClick={handleRetrigger}>
                      ↺ Neu
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
                      <button style={S.btn('success')} disabled={saving} onClick={handleCorrect}>
                        {saving ? '…' : '✓ Speichern'}
                      </button>
                      <button style={S.btn('secondary')} onClick={() => setCorrectionMode(false)}>
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
