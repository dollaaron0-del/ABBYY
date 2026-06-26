import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocuments, getDocument, updateDocument, triggerAnalysis, forwardToAbbyy, updateDocumentFields, getDocumentCorrections, getPreviewImageUrl, ocrRegion } from '../api/documents'
import type { Document, DocType, Ampel, ExtractedFields } from '../types'
import AbbyyOverlay, { type AbbyyFields } from '../components/AbbyyOverlay'

const DOC_TYPES: DocType[] = ['Rechnung', 'Mahnung', 'Behördenbescheid', 'Unleserlich', 'Sonstiges']
const AMPEL_MAP: Record<DocType, Ampel> = {
  Rechnung: 'gruen',
  Mahnung: 'gelb',
  Behördenbescheid: 'gelb',
  Unleserlich: 'rot',
  Sonstiges: 'rot',
}

type FieldKey = keyof ExtractedFields

// Combined label map for all known field keys (used in AnnotationViewer UI)
const POS_FIELD_NAMES: Record<string, string> = {
  beschreibung: 'Beschreibung', menge: 'Menge',
  einzelpreis_netto: 'Einzelpreis', mwst_satz: 'MwSt-%', waehrung: 'Währung',
}

function fieldLabel(key: string): string {
  const m = key.match(/^pos_(\d+)_(.+)$/)
  if (m) return `Pos. ${+m[1] + 1} – ${POS_FIELD_NAMES[m[2]] ?? m[2]}`
  return FIELD_LABEL_MAP[key] ?? key
}

const FIELD_LABEL_MAP: Record<string, string> = {
  geschaeftsbereich: 'Geschäftsbereich',
  lieferant_name: 'Lieferant',
  absender: 'Absender / Name',
  ust_id: 'USt-ID',
  steuernummer: 'Steuernummer',
  iban: 'IBAN',
  bankkonto: 'Bankkonto',
  bic: 'BIC / SWIFT',
  rechnungsnummer: 'Rechnungs-Nr.',
  rechnungsdatum: 'Rechnungsdatum',
  faelligkeitsdatum: 'Fälligkeit',
  einkaeufer: 'Einkäufer',
  referenz: 'Referenz',
  betrag_brutto: 'Bruttogesamtbetrag',
  waehrung: 'Währung',
  betrag_netto: 'Nettobetrag (steuerfrei)',
  betrag_netto_1: 'Nettobetrag 1',
  steuerbetrag: 'Steuerbetrag 1',
  steuersatz: 'Steuersatz 1',
  betrag_netto_2: 'Nettobetrag 2',
  steuerbetrag_2: 'Steuerbetrag 2',
  steuersatz_2: 'Steuersatz 2',
  nettogesamtbetrag: 'Nettogesamtbetrag',
  steuergesamtbetrag: 'Steuergesamtbetrag',
}

// Styles only used by AnnotationViewer
const S = {
  previewArea: { display: 'flex', flexDirection: 'column' as const, height: '100%' },
  previewHeader: {
    padding: '4px 10px', background: '#c8c4b8', borderBottom: '1px solid #808080',
    fontWeight: 600, color: '#000080', fontSize: 11,
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  previewFrame: { flex: 1, minHeight: 0, overflow: 'auto' as const },
}

function abbyyBtn(primary = false, disabled = false): React.CSSProperties {
  if (primary) {
    return {
      background: disabled ? '#d0d0d0' : 'linear-gradient(180deg, #316ac5 0%, #1a4a9c 100%)',
      border: disabled ? '1px solid #a0a0a0' : '1px solid #1a3a7c',
      padding: '3px 12px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer',
      borderRadius: 2, color: disabled ? '#888' : '#fff', fontWeight: 600,
      fontFamily: '"Segoe UI", Tahoma, sans-serif',
    }
  }
  return {
    background: disabled ? '#d0d0d0' : 'linear-gradient(180deg, #f0ece0 0%, #d0ccc0 100%)',
    border: disabled ? '1px solid #a0a0a0' : '1px solid #808080',
    padding: '3px 12px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 2, color: disabled ? '#888' : '#000',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  }
}

// ─── AnnotationViewer ─────────────────────────────────────────────────────────
type Rect = { x: number; y: number; w: number; h: number }
interface OcrPopup { region: Rect; text: string; loading: boolean; field: string }

function AnnotationViewer({ doc, targetField, onRegionOcrSaved, onCancelRegion, onFieldSaved }: {
  doc: Document
  targetField?: string | null
  onRegionOcrSaved?: (field: string, text: string) => void
  onCancelRegion?: () => void
  onFieldSaved?: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [selMode, setSelMode] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [startFrac, setStartFrac] = useState<{ x: number; y: number } | null>(null)
  const [liveSel, setLiveSel] = useState<Rect | null>(null)
  const [popup, setPopup] = useState<OcrPopup | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [savedRegions, setSavedRegions] = useState<(Rect & { field: string })[]>([])

  const previewUrl = getPreviewImageUrl(doc.id)
  const isPdf = doc.file_type.toLowerCase() === 'pdf'

  // Auto-enter selection mode when a target field is requested
  useEffect(() => {
    if (targetField) {
      setSelMode(true)
      setPopup(null)
      setLiveSel(null)
    }
  }, [targetField])

  useEffect(() => {
    getDocumentCorrections(doc.id).catch(() => {})
  }, [doc.id])

  function toFrac(e: React.MouseEvent): { x: number; y: number } {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  function syncCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.round(rect.width)
      canvas.height = Math.round(rect.height)
    }
  }

  function drawCanvas(live: Rect | null) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    for (const r of savedRegions) {
      ctx.save()
      ctx.strokeStyle = '#16a34a'
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H)
      ctx.fillStyle = 'rgba(22,163,74,0.08)'
      ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H)
      ctx.font = 'bold 10px sans-serif'
      ctx.fillStyle = '#15803d'
      ctx.fillText(fieldLabel(r.field), r.x * W + 3, r.y * H + 12)
      ctx.restore()
    }

    if (live) {
      ctx.save()
      ctx.strokeStyle = targetField ? '#316ac5' : '#2563eb'
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.strokeRect(live.x * W, live.y * H, live.w * W, live.h * H)
      ctx.fillStyle = targetField ? 'rgba(49,106,197,0.12)' : 'rgba(37,99,235,0.12)'
      ctx.fillRect(live.x * W, live.y * H, live.w * W, live.h * H)
      ctx.restore()
    }
  }

  useEffect(() => {
    syncCanvas()
    drawCanvas(liveSel)
  }, [liveSel, imgLoaded, savedRegions, targetField])

  function onMouseDown(e: React.MouseEvent) {
    if (!selMode) return
    e.preventDefault()
    setDrawing(true)
    setStartFrac(toFrac(e))
    setLiveSel(null)
    setPopup(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drawing || !startFrac) return
    const cur = toFrac(e)
    setLiveSel({
      x: Math.min(startFrac.x, cur.x),
      y: Math.min(startFrac.y, cur.y),
      w: Math.abs(cur.x - startFrac.x),
      h: Math.abs(cur.y - startFrac.y),
    })
  }

  async function onMouseUp(e: React.MouseEvent) {
    if (!drawing || !startFrac) return
    setDrawing(false)
    const cur = toFrac(e)
    const sel: Rect = {
      x: Math.min(startFrac.x, cur.x),
      y: Math.min(startFrac.y, cur.y),
      w: Math.abs(cur.x - startFrac.x),
      h: Math.abs(cur.y - startFrac.y),
    }
    setStartFrac(null)
    if (sel.w < 0.015 || sel.h < 0.008) { setLiveSel(null); return }

    // Pre-select targetField in popup if we're in targeted mode
    setPopup({ region: sel, text: '', loading: true, field: targetField || 'rechnungsnummer' })

    try {
      const result = await ocrRegion(doc.id, sel)
      setPopup((p) => p ? { ...p, text: result.text, loading: false } : null)
    } catch {
      setPopup((p) => p ? { ...p, text: '', loading: false } : null)
    }
  }

  async function handlePopupSave() {
    if (!popup || !popup.field || !popup.text.trim()) return
    setSaving(true)
    try {
      await ocrRegion(doc.id, popup.region, popup.field, true)
      setSavedRegions((prev) => [...prev, { ...popup.region, field: popup.field }])
      setSavedMsg(`"${fieldLabel(popup.field)}" gespeichert & gelernt`)

      // Notify parent: fill the field in AbbyyOverlay and clear target mode
      onRegionOcrSaved?.(popup.field, popup.text)

      setPopup(null)
      setLiveSel(null)
      if (targetField) setSelMode(false)
      onFieldSaved?.()
      setTimeout(() => setSavedMsg(null), 3500)
    } catch (err: any) {
      setSavedMsg(`Fehler: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  function handleCancelTarget() {
    setSelMode(false)
    setPopup(null)
    setLiveSel(null)
    onCancelRegion?.()
  }

  function popupStyle(region: Rect): React.CSSProperties {
    const canvas = canvasRef.current
    if (!canvas) return { display: 'none' }
    const W = canvas.clientWidth, H = canvas.clientHeight
    let left = region.x * W
    let top = (region.y + region.h) * H + 8
    if (left + 300 > W) left = Math.max(0, W - 308)
    if (top + 210 > H) top = region.y * H - 218
    return { position: 'absolute', left, top, width: 300, zIndex: 20 }
  }

  const selBtnStyle: React.CSSProperties = {
    padding: '2px 10px', fontSize: 10, borderRadius: 2, cursor: 'pointer', fontWeight: 600,
    border: selMode ? 'none' : '1px solid #808080',
    background: selMode ? '#316ac5' : 'linear-gradient(180deg, #f0ece0 0%, #d0ccc0 100%)',
    color: selMode ? '#fff' : '#000',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  }

  return (
    <div style={S.previewArea}>
      {/* Header */}
      <div style={S.previewHeader}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
          📄 {doc.original_name}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {savedMsg && (
            <span style={{ fontSize: 10, color: savedMsg.startsWith('Fehler') ? '#cc0000' : '#006600', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {savedMsg}
            </span>
          )}
          {!targetField && (
            <button style={selBtnStyle} onClick={() => { setSelMode(!selMode); setPopup(null); setLiveSel(null) }}>
              {selMode ? '✕ Aus' : '✂ Bereich'}
            </button>
          )}
        </div>
      </div>

      {/* Target field banner */}
      {targetField && (
        <div style={{ padding: '5px 10px', background: '#1a5ca8', fontSize: 11, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderBottom: '1px solid #1a3a7c' }}>
          <span style={{ fontSize: 14 }}>✂</span>
          <span>
            Bereich für <strong>{fieldLabel(targetField)}</strong> aufziehen
          </span>
          <button
            style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 10, border: '1px solid rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', borderRadius: 2, fontFamily: '"Segoe UI", Tahoma, sans-serif' }}
            onClick={handleCancelTarget}
          >
            ✕ Abbrechen
          </button>
        </div>
      )}

      {/* Free selection mode banner */}
      {selMode && !targetField && (
        <div style={{ padding: '4px 10px', background: '#d0e4f8', fontSize: 10, color: '#1a4a9c', borderBottom: '1px solid #a0c0e0', flexShrink: 0, fontFamily: '"Segoe UI", Tahoma, sans-serif' }}>
          Bereich aufziehen → OCR → Feld zuweisen &amp; speichern (Lernen für künftige Rechnungen)
        </div>
      )}

      {/* Document image */}
      <div style={{ ...S.previewFrame, background: '#606060' }} ref={containerRef}>
        {imgError ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#ccc', fontSize: 12, fontFamily: '"Segoe UI", Tahoma, sans-serif' }}>
            {isPdf ? 'PDF-Vorschau: Container neu bauen für PDF-Support.' : 'Vorschau nicht verfügbar.'}
            <br /><br />
            <a href={`/uploads/originals/${doc.filename}`} target="_blank" rel="noreferrer" style={{ color: '#90c0ff' }}>
              Originaldatei öffnen ↗
            </a>
          </div>
        ) : (
          <div style={{ background: '#808080', padding: 12, boxSizing: 'border-box' }}>
            {/* Inner wrapper sized exactly by the image — canvas overlays it perfectly */}
            <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
            <img
              ref={imgRef}
              src={previewUrl}
              alt={doc.original_name}
              draggable={false}
              style={{ display: 'block', width: '100%', userSelect: 'none', boxShadow: '2px 2px 8px rgba(0,0,0,0.5)' }}
              onLoad={() => { setImgLoaded(true); syncCanvas() }}
              onError={() => setImgError(true)}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                cursor: selMode ? 'crosshair' : 'default',
                pointerEvents: selMode ? 'auto' : 'none',
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            />

            {/* OCR Popup */}
            {popup && (
              <div style={{ ...popupStyle(popup.region), background: '#fff', border: '2px solid #316ac5', borderRadius: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', padding: 10, fontFamily: '"Segoe UI", Tahoma, sans-serif' }}>
                <div style={{ fontWeight: 700, fontSize: 11, color: '#000080', marginBottom: 8 }}>
                  {targetField ? `Bereich für "${fieldLabel(targetField)}"` : 'Markierter Bereich'}
                </div>

                <div style={{ fontSize: 10, color: '#555', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase' }}>Erkannter Text</div>
                {popup.loading ? (
                  <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>OCR läuft…</div>
                ) : (
                  <textarea
                    style={{ width: '100%', padding: '4px 6px', border: '1px solid #808080', fontSize: 11, resize: 'vertical', minHeight: 40, boxSizing: 'border-box', fontFamily: '"Segoe UI", Tahoma, sans-serif' }}
                    value={popup.text}
                    onChange={(e) => setPopup((p) => p ? { ...p, text: e.target.value } : null)}
                    placeholder="Keinen Text erkannt – manuell eingeben…"
                  />
                )}

                {/* Field selector: locked when targeting a specific field, free dropdown otherwise */}
                <div style={{ fontSize: 10, color: '#555', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', marginTop: 8 }}>Welches Feld?</div>
                {targetField ? (
                  <div style={{ padding: '4px 6px', background: '#eff6ff', border: '1px solid #316ac5', fontSize: 11, fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#1a3a7c', fontWeight: 600 }}>
                    🔒 {fieldLabel(targetField)}
                  </div>
                ) : (
                  <select
                    style={{ width: '100%', padding: '3px 4px', border: '1px solid #808080', fontSize: 11, background: '#fff', boxSizing: 'border-box', fontFamily: '"Segoe UI", Tahoma, sans-serif' }}
                    value={popup.field}
                    onChange={(e) => setPopup((p) => p ? { ...p, field: e.target.value } : null)}
                  >
                    {Object.entries(FIELD_LABEL_MAP).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                )}

                <div style={{ fontSize: 10, color: '#666', marginTop: 6, padding: '3px 0', borderTop: '1px solid #e0e0e0' }}>
                  ✓ Speichern lernt den Bereich für künftige Rechnungen dieses Absenders
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    disabled={saving || popup.loading || !popup.text.trim()}
                    style={abbyyBtn(true, saving || popup.loading || !popup.text.trim())}
                    onClick={handlePopupSave}
                  >{saving ? '…' : '✓ Speichern & Lernen'}</button>
                  <button
                    style={abbyyBtn(false)}
                    onClick={() => { setPopup(null); setLiveSel(null); if (targetField) handleCancelTarget() }}
                  >✕</button>
                </div>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ManualReview ──────────────────────────────────────────────────────────────
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
  const [overlaySaving, setOverlaySaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Region selection state: links AbbyyOverlay ✂ button to AnnotationViewer
  const [regionTargetField, setRegionTargetField] = useState<string | null>(null)
  const [pendingFieldFill, setPendingFieldFill] = useState<{ field: string; text: string } | null>(null)

  // Resizable right panel
  const [rightWidth, setRightWidth] = useState(400)
  function startResizeRight(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = rightWidth
    const onMove = (ev: MouseEvent) => setRightWidth(Math.max(280, Math.min(820, startW + (startX - ev.clientX))))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

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

  // Lernstatus: gespeicherte Korrekturen für diesen Absender
  const { data: correctionsData, refetch: refetchCorrections } = useQuery({
    queryKey: ['corrections', id],
    queryFn: () => getDocumentCorrections(id!),
    enabled: !!id,
  })
  const learnedCount = correctionsData?.corrections?.length ?? 0
  const senderName = correctionsData?.sender || doc?.sender || null

  // Reset region target when navigating to a different document
  useEffect(() => {
    setRegionTargetField(null)
    setPendingFieldFill(null)
  }, [id])

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

  const overlayFields = useMemo<AbbyyFields>(() => {
    let ef: Record<string, any> = {}
    if (doc?.extracted_fields) {
      try { ef = typeof doc.extracted_fields === 'string' ? JSON.parse(doc.extracted_fields) : doc.extracted_fields as any } catch {}
    }
    return { absender: doc?.sender ?? null, ...ef }
  }, [doc?.extracted_fields, doc?.sender])

  const fieldSources = useMemo<Record<string, string>>(() => {
    if (!doc?.field_sources) return {}
    try { return typeof doc.field_sources === 'string' ? JSON.parse(doc.field_sources) : (doc.field_sources as any) } catch { return {} }
  }, [doc?.field_sources])

  async function handleOverlaySave(fields: AbbyyFields) {
    if (!doc) return
    setOverlaySaving(true)
    try {
      const { absender, positionen, ...primitiveFields } = fields
      const payload: Record<string, any> = { ...primitiveFields }
      if (positionen !== undefined) payload.positionen = positionen
      await updateDocumentFields(doc.id, payload)
      if (absender !== doc.sender) await updateDocument(doc.id, { sender: absender ?? undefined } as any)
      qc.invalidateQueries({ queryKey: ['document', doc.id] })
      qc.invalidateQueries({ queryKey: ['review-queue'] })
      // Korrekturen-Zähler neu laden und Toast mit Lerninfo anzeigen
      const updatedCorr = await refetchCorrections()
      const newCount = updatedCorr.data?.corrections?.length ?? 0
      const sender = absender || doc.sender
      const changedFields = Object.keys(primitiveFields).filter((k) => primitiveFields[k] != null && primitiveFields[k] !== '').length
      showToast(
        sender
          ? `${changedFields > 0 ? changedFields + ' Felder gelernt' : 'Gespeichert'} für "${sender}" (${newCount} Korrekturen gesamt)`
          : 'Felder gespeichert & gelernt'
      )
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setOverlaySaving(false)
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

  // Called from AbbyyOverlay when user clicks ✂ on a field
  function handleRequestRegion(fieldKey: string) {
    setRegionTargetField(fieldKey)
    setCorrectionMode(false)
  }

  // Called from AnnotationViewer after OCR region was saved successfully
  function handleRegionOcrSaved(field: string, text: string) {
    setPendingFieldFill({ field, text })
    setRegionTargetField(null)
    showToast(`"${fieldLabel(field)}" per OCR erkannt & gelernt`)
  }

  const queueDocs = queue?.data || []

  const ampelColor = !doc ? '#555' : doc.ampel === 'gruen' ? '#006600' : doc.ampel === 'gelb' ? '#996600' : '#cc0000'
  const ampelIcon = !doc ? '' : doc.ampel === 'gruen' ? '✔' : doc.ampel === 'gelb' ? '⚠' : '✘'
  const ampelLabel = !doc ? '' : doc.ampel === 'gruen' ? 'Automatisch' : doc.ampel === 'gelb' ? 'Manuell prüfen' : 'Fehler'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Segoe UI", Tahoma, Geneva, sans-serif',
      background: '#d4d0c8',
      height: 'calc(100vh - 130px)',
      overflow: 'hidden',
      border: '1px solid #707070',
      borderRadius: 2,
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '8px 18px', borderRadius: 3, fontWeight: 600, fontSize: 12,
          background: toast.ok ? '#006600' : '#cc0000', color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          fontFamily: '"Segoe UI", Tahoma, sans-serif', border: '1px solid rgba(0,0,0,0.2)',
        }}>
          {toast.ok ? '✔' : '✘'} {toast.msg}
        </div>
      )}

      {/* ── ABBYY Toolbar ── */}
      <div style={{
        background: 'linear-gradient(180deg, #f0ece0 0%, #d8d4c8 100%)',
        borderBottom: '2px solid #808080', padding: '4px 8px',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: '#000080', fontSize: 13, marginRight: 8, whiteSpace: 'nowrap' }}>
          ABBYY FlexiCapture 12 — Verification Station
        </span>
        {doc && (
          <>
            <span style={{ color: '#c0b8a8' }}>│</span>
            <span style={{ fontSize: 11, color: '#444', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.original_name}</span>
            <span style={{ color: '#c0b8a8' }}>│</span>
            <span style={{ fontSize: 11, color: '#333' }}>Typ: <strong>{doc.doc_type || '–'}</strong></span>
            <span style={{ color: '#c0b8a8' }}>│</span>
            <span style={{ fontSize: 11, color: ampelColor, fontWeight: 600 }}>{ampelIcon} {ampelLabel} — {doc.confidence}%</span>
          </>
        )}
        {regionTargetField && (
          <>
            <span style={{ color: '#c0b8a8' }}>│</span>
            <span style={{ fontSize: 11, color: '#316ac5', fontWeight: 600 }}>
              ✂ Wähle Bereich für: {fieldLabel(regionTargetField)}
            </span>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <button style={abbyyBtn(true, saving || !doc)} disabled={saving || !doc} onClick={handleConfirm}>
            {saving ? '…' : '✔ Bestätigen'}
          </button>
          <button style={abbyyBtn(false, !doc)} disabled={!doc} onClick={() => { setCorrectionMode(c => !c); setRegionTargetField(null) }}>
            {correctionMode ? '✕ Abbrechen' : '✏ Korrigieren'}
          </button>
          <button style={abbyyBtn(false, !doc)} disabled={!doc} onClick={handleRetrigger}>↺ Neu</button>
        </div>
      </div>

      {/* ── Lernmodus-Banner ── */}
      {doc && (
        <div style={{
          background: learnedCount > 0 ? '#1a4a1a' : '#2a3a6a',
          borderBottom: '1px solid #000',
          padding: '3px 10px',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, flexShrink: 0,
          color: '#fff', fontFamily: '"Segoe UI", Tahoma, sans-serif',
        }}>
          {/* Pulsierender REC-Punkt */}
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: '#ff4444', boxShadow: '0 0 4px #ff4444',
            animation: 'none', flexShrink: 0,
          }} />
          <span style={{ fontWeight: 600 }}>LERNMODUS AKTIV</span>
          <span style={{ color: '#a0c8a0' }}>│</span>
          {senderName ? (
            <span>
              System lernt für: <strong style={{ color: '#7de87d' }}>{senderName}</strong>
              {learnedCount > 0 && (
                <span style={{ marginLeft: 8, color: '#a0e0a0' }}>
                  · {learnedCount} Felder bereits gespeichert
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: '#d0d8ff' }}>
              Kein Absender erkannt — nach dem Speichern wird gelernt sobald ein Absender eingetragen ist
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: '#8888cc', fontSize: 10 }}>
            Alle Korrekturen werden automatisch auf zukünftige Rechnungen dieses Lieferanten angewendet
          </span>
        </div>
      )}

      {/* ── Main Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Queue panel */}
        <div style={{ flex: '0 0 200px', borderRight: '2px solid #808080', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '3px 8px', background: 'linear-gradient(180deg, #4a7ac8 0%, #2a5aac 100%)', borderBottom: '1px solid #1a4a9c', fontSize: 11, fontWeight: 600, color: '#fff', flexShrink: 0 }}>
            Aufgaben ({queueDocs.length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', background: '#c8c4b8' }}>
            {queueDocs.length === 0 && (
              <div style={{ padding: '16px 8px', fontSize: 11, color: '#666', textAlign: 'center' }}>Keine Aufgaben</div>
            )}
            {queueDocs.map((d, i) => {
              const isActive = d.id === id
              return (
                <div
                  key={d.id}
                  onClick={() => navigate(`/prüfung/${d.id}`)}
                  style={{
                    padding: '6px 8px 5px', cursor: 'pointer', fontSize: 11,
                    background: isActive ? '#316ac5' : i % 2 === 0 ? '#d0ccc0' : '#c8c4b8',
                    borderBottom: '1px solid #b0a898',
                    borderLeft: isActive ? '3px solid #ffd700' : '3px solid transparent',
                    color: isActive ? '#fff' : '#222',
                  }}
                >
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>{d.original_name}</div>
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{d.doc_type || 'Unbekannt'} · {d.confidence}%</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Document viewer — flex: 1 nimmt den Rest */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#606060' }}>
          {!id && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 13, flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 48, opacity: 0.4 }}>📄</span>
              <span>Aufgabe aus der Liste auswählen</span>
            </div>
          )}
          {id && isLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 12 }}>
              Lade Dokument…
            </div>
          )}
          {id && doc && (
            <AnnotationViewer
              doc={doc}
              targetField={regionTargetField}
              onRegionOcrSaved={handleRegionOcrSaved}
              onCancelRegion={() => setRegionTargetField(null)}
              onFieldSaved={() => { qc.invalidateQueries({ queryKey: ['document', id] }) }}
            />
          )}
        </div>

        {/* Drag handle zum Verschieben */}
        <div
          onMouseDown={startResizeRight}
          style={{
            width: 5, flexShrink: 0, cursor: 'col-resize', zIndex: 10,
            background: 'linear-gradient(180deg,#9a9690,#808070)',
            borderLeft: '1px solid #606060', borderRight: '1px solid #b0a898',
          }}
          title="Ziehen zum Vergrößern/Verkleinern"
        />

        {/* Right panel: ABBYY form */}
        <div style={{ flex: `0 0 ${rightWidth}px`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#d4d0c8' }}>
          {!doc ? (
            <div style={{ padding: 24, fontSize: 12, color: '#888', textAlign: 'center', marginTop: 40 }}>
              Kein Dokument ausgewählt
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <AbbyyOverlay
                docId={doc.id}
                fields={overlayFields}
                fieldSources={fieldSources}
                docConfidence={doc.confidence}
                onSave={handleOverlaySave}
                onForward={handleForward}
                onRequestRegion={handleRequestRegion}
                pendingFieldFill={pendingFieldFill}
                onPendingFillConsumed={() => setPendingFieldFill(null)}
                targetField={regionTargetField}
                saving={overlaySaving}
                forwarding={forwarding}
              />

              {/* Gelernte Korrekturen Protokoll */}
              {correctionsData && correctionsData.corrections.length > 0 && (
                <div style={{ borderTop: '2px solid #808080', background: '#1a3a1a', color: '#d0f0d0', padding: '6px 10px', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7de87d', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Gespeicherte Lernkorrekturen für diesen Absender ({correctionsData.corrections.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {correctionsData.corrections.map((c) => (
                      <div key={`${c.field_name}-${c.human_value}`} style={{
                        background: 'rgba(0,160,0,0.25)', border: '1px solid #3a7a3a',
                        borderRadius: 3, padding: '2px 8px', fontSize: 10,
                      }}>
                        <span style={{ color: '#a0d0a0' }}>{FIELD_LABEL_MAP[c.field_name] ?? c.field_name}:</span>
                        {' '}
                        <strong style={{ color: '#fff' }}>{c.human_value}</strong>
                        {c.count > 1 && <span style={{ color: '#7de87d', marginLeft: 4 }}>×{c.count}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Correction panel */}
              {correctionMode && (
                <div style={{ borderTop: '2px solid #808080', padding: '8px 10px', background: '#e8e4d8', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#000080', marginBottom: 8 }}>✏ Klassifizierung korrigieren</div>
                  <div style={{ fontSize: 11, color: '#333', marginBottom: 2 }}>Dokumenttyp</div>
                  <select
                    style={{ width: '100%', height: 22, fontSize: 11, border: '1px solid #7a7a7a', marginBottom: 6, background: '#fff', fontFamily: '"Segoe UI", Tahoma, sans-serif', boxSizing: 'border-box' }}
                    value={corrDocType}
                    onChange={e => setCorrDocType(e.target.value as DocType)}
                  >
                    {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: '#333', marginBottom: 2 }}>Absender</div>
                  <input
                    style={{ width: '100%', height: 20, fontSize: 11, border: '1px solid #7a7a7a', padding: '0 4px', marginBottom: 6, background: '#fff', fontFamily: '"Segoe UI", Tahoma, sans-serif', boxSizing: 'border-box', outline: 'none' }}
                    value={corrSender}
                    onChange={e => setCorrSender(e.target.value)}
                    placeholder="Absendername"
                  />
                  <div style={{ fontSize: 11, color: '#333', marginBottom: 2 }}>Anmerkung (optional)</div>
                  <input
                    style={{ width: '100%', height: 20, fontSize: 11, border: '1px solid #7a7a7a', padding: '0 4px', marginBottom: 8, background: '#fff', fontFamily: '"Segoe UI", Tahoma, sans-serif', boxSizing: 'border-box', outline: 'none' }}
                    value={corrNote}
                    onChange={e => setCorrNote(e.target.value)}
                    placeholder="Anmerkung zur Korrektur"
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={abbyyBtn(true, saving)} disabled={saving} onClick={handleCorrect}>{saving ? '…' : '✔ Speichern'}</button>
                    <button style={abbyyBtn(false)} onClick={() => setCorrectionMode(false)}>Abbrechen</button>
                  </div>
                </div>
              )}

              {/* Processing log */}
              {doc.processing_logs && doc.processing_logs.length > 0 && (
                <div style={{ borderTop: '1px solid #b0a898', padding: '5px 8px', background: '#dedad0', flexShrink: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Protokoll</div>
                  {doc.processing_logs.slice(-5).map(log => (
                    <div key={log.id} style={{ padding: '2px 0', borderBottom: '1px solid #ccc8b8', fontSize: 10, color: log.status === 'error' ? '#cc0000' : log.status === 'success' ? '#006600' : '#555' }}>
                      <span style={{ fontWeight: 600 }}>{log.step}</span>
                      {log.message && <span style={{ marginLeft: 4, opacity: 0.8 }}>{log.message}</span>}
                      <span style={{ float: 'right', opacity: 0.5 }}>{new Date(log.created_at).toLocaleTimeString('de-DE')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── ABBYY Status Bar ── */}
      <div style={{ background: '#d4d0c8', borderTop: '2px solid #808080', padding: '2px 8px', fontSize: 11, color: '#333', display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, minHeight: 20, fontFamily: '"Segoe UI", Tahoma, sans-serif' }}>
        {doc ? (
          <>
            <span style={{ whiteSpace: 'nowrap' }}>📄 {doc.original_name}</span>
            {doc.user_correction && (
              <>
                <span style={{ color: '#b0a898' }}>│</span>
                <span style={{ color: '#996600', whiteSpace: 'nowrap' }}>Korr.: {doc.user_correction}</span>
              </>
            )}
            {doc.sender_matched && (
              <>
                <span style={{ color: '#b0a898' }}>│</span>
                <span style={{ color: '#006600', whiteSpace: 'nowrap' }}>✔ {doc.supplier_name}</span>
              </>
            )}
            <span style={{ color: '#b0a898' }}>│</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#555' }}>KI: {doc.ai_reasoning || '–'}</span>
          </>
        ) : (
          <span>Bereit — Aufgabe aus der Liste auswählen</span>
        )}
      </div>
    </div>
  )
}
