import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { getDocuments, getDocument, updateDocument, triggerAnalysis, forwardToAbbyy, updateDocumentFields, getDocumentCorrections, getPreviewImageUrl, ocrRegion } from '../api/documents'
import type { Document, DocType, Ampel, ExtractedFields } from '../types'

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

function FieldRow({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value == null || value === '') return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', paddingTop: 2 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#111827', fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const hasContent = React.Children.toArray(children).some(Boolean)
  if (!hasContent) return null
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, marginTop: 4 }}>{title}</div>
      {children}
    </div>
  )
}

type FieldKey = keyof ExtractedFields

const FIELD_LABELS: Record<FieldKey, string> = {
  rechnungsnummer: 'Rechnungs-Nr.',
  rechnungsdatum: 'Rechnungsdatum',
  faelligkeitsdatum: 'Fälligkeit',
  absender_strasse: 'Straße',
  absender_plz: 'PLZ',
  absender_ort: 'Ort',
  absender_land: 'Land',
  betrag_brutto: 'Brutto',
  betrag_netto: 'Netto',
  steuerbetrag: 'Steuerbetrag',
  steuersatz: 'Steuersatz',
  waehrung: 'Währung',
  iban: 'IBAN',
  bic: 'BIC / SWIFT',
}

function formatAmount(val: number | null, currency: string | null) {
  if (val == null) return null
  return `${val.toFixed(2).replace('.', ',')} ${currency ?? 'EUR'}`
}

function AbbyyFieldsPanel({ doc, onSaved }: { doc: Document; onSaved?: () => void }) {
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [learnedInfo, setLearnedInfo] = useState<{ field_name: string; human_value: string; count: number }[]>([])

  const ef = useMemo<ExtractedFields | null>(() => {
    if (!doc.extracted_fields) return null
    try {
      return typeof doc.extracted_fields === 'string'
        ? JSON.parse(doc.extracted_fields) as ExtractedFields
        : doc.extracted_fields as unknown as ExtractedFields
    } catch { return null }
  }, [doc.extracted_fields])

  // Initialize edit values from current extracted fields
  useEffect(() => {
    const vals: Record<string, string> = {}
    if (ef) {
      for (const [k, v] of Object.entries(ef)) {
        vals[k] = v != null ? String(v) : ''
      }
    }
    setEditValues(vals)
  }, [doc.extracted_fields])

  // Load correction history for this sender
  useEffect(() => {
    if (!doc.id) return
    getDocumentCorrections(doc.id)
      .then((r) => setLearnedInfo(r.corrections || []))
      .catch(() => {})
  }, [doc.id])

  const learnedCount = learnedInfo.length
  const learnedFields = new Set(learnedInfo.map((c) => c.field_name))

  function setField(key: string, val: string) {
    setEditValues((prev) => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const payload: Record<string, string | number | null> = {}
      for (const [k, v] of Object.entries(editValues)) {
        if (v === '') {
          payload[k] = null
        } else if (['betrag_brutto', 'betrag_netto', 'steuerbetrag', 'steuersatz'].includes(k)) {
          const n = parseFloat(v.replace(',', '.'))
          payload[k] = isNaN(n) ? null : n
        } else {
          payload[k] = v
        }
      }
      await updateDocumentFields(doc.id, payload)
      setSaveMsg('Gespeichert')
      setEditMode(false)
      onSaved?.()
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err: any) {
      setSaveMsg(`Fehler: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const inpStyle: React.CSSProperties = {
    width: '100%', padding: '4px 8px', border: '1px solid #93c5fd',
    borderRadius: 5, fontSize: 12, background: '#eff6ff',
  }

  function EditableRow({ fieldKey, mono }: { fieldKey: FieldKey; mono?: boolean }) {
    const label = FIELD_LABELS[fieldKey]
    const rawVal = editValues[fieldKey] ?? ''
    const aiVal = ef ? ef[fieldKey] : null
    const isLearned = learnedFields.has(fieldKey)
    const isChanged = editMode
      ? false
      : (rawVal !== '' && rawVal !== String(aiVal ?? ''))

    const displayVal = ef ? ef[fieldKey] : null

    if (!editMode) {
      if (displayVal == null && !isLearned) return null
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', paddingTop: 2 }}>{label}</span>
          <span style={{
            fontSize: 13,
            color: isChanged ? '#1d4ed8' : isLearned && displayVal != null ? '#15803d' : '#111827',
            fontFamily: mono ? 'monospace' : undefined,
            wordBreak: 'break-all',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {displayVal != null ? String(displayVal) : '–'}
            {isLearned && displayVal != null && <span title="Aus Korrekturen gelernt" style={{ fontSize: 10, color: '#15803d' }}>✓ gelernt</span>}
          </span>
        </div>
      )
    }

    return (
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, padding: '3px 0' }}>
        <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', paddingTop: 6 }}>{label}</span>
        <input
          style={{ ...inpStyle, fontFamily: mono ? 'monospace' : undefined }}
          value={rawVal}
          onChange={(e) => setField(fieldKey, e.target.value)}
          placeholder={`${label} eingeben…`}
        />
      </div>
    )
  }

  const hasAnyField = ef && Object.values(ef).some((v) => v != null)

  return (
    <div style={{ marginTop: 20, borderTop: '2px solid #e5e7eb', paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#1a3a5c' }}>ABBYY FlexiCapture – Felder</span>
          {learnedCount > 0 && !editMode && (
            <span style={{ fontSize: 10, background: '#dcfce7', color: '#15803d', borderRadius: 10, padding: '2px 7px', fontWeight: 600 }}>
              {learnedCount} gelernt
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {saveMsg && <span style={{ fontSize: 11, color: saveMsg.startsWith('Fehler') ? '#dc2626' : '#16a34a' }}>{saveMsg}</span>}
          {!editMode ? (
            <button
              style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', fontWeight: 500 }}
              onClick={() => setEditMode(true)}
            >✏ Bearbeiten</button>
          ) : (
            <>
              <button
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: 'none', background: '#1a3a5c', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                disabled={saving}
                onClick={handleSave}
              >{saving ? '…' : '✓ Speichern'}</button>
              <button
                style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db', background: '#f3f4f6', cursor: 'pointer' }}
                onClick={() => { setEditMode(false); if (ef) { const v: Record<string,string> = {}; for (const [k,val] of Object.entries(ef)) v[k] = val != null ? String(val) : ''; setEditValues(v) } }}
              >Abbrechen</button>
            </>
          )}
        </div>
      </div>

      {!hasAnyField && !editMode ? (
        <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 0' }}>
          Noch keine Felder extrahiert – über „Bearbeiten" manuell eintragen oder Demo-Modus aktivieren.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Dokumentdaten</div>
          <EditableRow fieldKey="rechnungsnummer" />
          <EditableRow fieldKey="rechnungsdatum" />
          <EditableRow fieldKey="faelligkeitsdatum" />

          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, marginTop: 10 }}>Absender / Lieferant</div>
          {editMode ? (
            <>
              <EditableRow fieldKey="absender_strasse" />
              <EditableRow fieldKey="absender_plz" />
              <EditableRow fieldKey="absender_ort" />
              <EditableRow fieldKey="absender_land" />
            </>
          ) : (
            <>
              {doc.sender && (
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 6, padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', paddingTop: 2 }}>Firmenname</span>
                  <span style={{ fontSize: 13, color: '#111827' }}>{doc.sender}</span>
                </div>
              )}
              <EditableRow fieldKey="absender_strasse" />
              <EditableRow fieldKey="absender_plz" />
              <EditableRow fieldKey="absender_ort" />
              <EditableRow fieldKey="absender_land" />
            </>
          )}

          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, marginTop: 10 }}>Beträge</div>
          {editMode ? (
            <>
              <EditableRow fieldKey="betrag_brutto" />
              <EditableRow fieldKey="betrag_netto" />
              <EditableRow fieldKey="steuerbetrag" />
              <EditableRow fieldKey="steuersatz" />
              <EditableRow fieldKey="waehrung" />
            </>
          ) : (
            <>
              {ef?.betrag_brutto != null && (
                <FieldRow label="Brutto" value={formatAmount(ef.betrag_brutto, ef.waehrung)} />
              )}
              {ef?.betrag_netto != null && (
                <FieldRow label="Netto" value={formatAmount(ef.betrag_netto, ef.waehrung)} />
              )}
              {ef?.steuerbetrag != null && (
                <FieldRow label="Steuer" value={`${formatAmount(ef.steuerbetrag, ef.waehrung)}${ef.steuersatz != null ? ` (${ef.steuersatz}%)` : ''}`} />
              )}
              {ef?.waehrung && <FieldRow label="Währung" value={ef.waehrung} />}
            </>
          )}

          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, marginTop: 10 }}>Bankverbindung</div>
          <EditableRow fieldKey="iban" mono />
          <EditableRow fieldKey="bic" mono />

          {learnedCount > 0 && !editMode && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d' }}>
              <strong>Lernstatus:</strong> Das System hat {learnedCount} Feld-Korrekturen für „{doc.sender || 'diesen Absender'}" gespeichert
              und wendet sie bei neuen Dokumenten automatisch an.
            </div>
          )}
        </>
      )}
    </div>
  )
}

type Rect = { x: number; y: number; w: number; h: number }

interface OcrPopup {
  region: Rect
  text: string
  loading: boolean
  field: string
}

function AnnotationViewer({ doc, onFieldSaved }: { doc: Document; onFieldSaved?: () => void }) {
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

  // Load saved region corrections for visualization
  useEffect(() => {
    getDocumentCorrections(doc.id)
      .then((r) => {
        const regions: (Rect & { field: string })[] = []
        // We can't get regions from the corrections endpoint yet, but we keep the structure
        setSavedRegions(regions)
      })
      .catch(() => {})
  }, [doc.id])

  function toFrac(e: React.MouseEvent): { x: number; y: number } {
    const img = imgRef.current
    if (!img) return { x: 0, y: 0 }
    const rect = img.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }

  function syncCanvas() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
  }

  function drawCanvas(live: Rect | null) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Saved regions (green dashed)
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
      ctx.fillText(FIELD_LABELS[r.field as FieldKey] ?? r.field, r.x * W + 3, r.y * H + 12)
      ctx.restore()
    }

    // Live selection (blue solid)
    if (live) {
      ctx.save()
      ctx.strokeStyle = '#2563eb'
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.strokeRect(live.x * W, live.y * H, live.w * W, live.h * H)
      ctx.fillStyle = 'rgba(37,99,235,0.12)'
      ctx.fillRect(live.x * W, live.y * H, live.w * W, live.h * H)
      ctx.restore()
    }
  }

  useEffect(() => {
    syncCanvas()
    drawCanvas(liveSel)
  }, [liveSel, imgLoaded, savedRegions])

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

    setPopup({ region: sel, text: '', loading: true, field: 'rechnungsnummer' })

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
      setSavedMsg(`"${FIELD_LABELS[popup.field as FieldKey] ?? popup.field}" gespeichert & gelernt`)
      setPopup(null)
      setLiveSel(null)
      onFieldSaved?.()
      setTimeout(() => setSavedMsg(null), 3500)
    } catch (err: any) {
      setSavedMsg(`Fehler: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // Popup position: below selection, left-aligned, bounded by container
  function popupStyle(region: Rect): React.CSSProperties {
    const img = imgRef.current
    if (!img) return { display: 'none' }
    const W = img.clientWidth
    const H = img.clientHeight
    let left = region.x * W
    let top = (region.y + region.h) * H + 8
    if (left + 300 > W) left = Math.max(0, W - 308)
    if (top + 200 > H) top = region.y * H - 208
    return { position: 'absolute', left, top, width: 300, zIndex: 20 }
  }

  const selBtnStyle: React.CSSProperties = {
    padding: '5px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 600,
    border: selMode ? 'none' : '1px solid #d1d5db',
    background: selMode ? '#2563eb' : '#f3f4f6',
    color: selMode ? '#fff' : '#374151',
  }

  return (
    <div style={S.previewArea}>
      <div style={{ ...S.previewHeader, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{doc.original_name}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {savedMsg && <span style={{ fontSize: 11, color: savedMsg.startsWith('Fehler') ? '#dc2626' : '#16a34a', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{savedMsg}</span>}
          <button style={selBtnStyle} onClick={() => { setSelMode(!selMode); setPopup(null); setLiveSel(null) }}>
            {selMode ? '✕ Markierung aus' : '✂ Bereich markieren'}
          </button>
        </div>
      </div>

      {selMode && (
        <div style={{ padding: '6px 16px', background: '#eff6ff', fontSize: 12, color: '#1d4ed8', borderBottom: '1px solid #bfdbfe' }}>
          Auf dem Dokument einen Bereich mit der Maus aufziehen → Text wird per OCR erkannt → Feld zuweisen & speichern.
        </div>
      )}

      <div style={{ ...S.previewFrame, position: 'relative', overflow: 'auto' }} ref={containerRef}>
        {imgError ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
            {isPdf ? 'PDF-Vorschau: Container neu bauen (docker compose build) für PDF-Unterstützung.' : 'Vorschau nicht verfügbar.'}
            <br /><br />
            <a href={`/uploads/originals/${doc.filename}`} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
              Originaldatei öffnen ↗
            </a>
          </div>
        ) : (
          <div style={{ position: 'relative', display: 'inline-block', minWidth: '100%' }}>
            <img
              ref={imgRef}
              src={previewUrl}
              alt={doc.original_name}
              draggable={false}
              style={{ display: 'block', maxWidth: '100%', userSelect: 'none' }}
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
              <div style={{ ...popupStyle(popup.region), background: '#fff', border: '2px solid #2563eb', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1a3a5c', marginBottom: 10 }}>Markierter Bereich</div>

                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>Erkannter Text</div>
                {popup.loading ? (
                  <div style={{ color: '#9ca3af', fontSize: 12, padding: '6px 0' }}>OCR läuft…</div>
                ) : (
                  <textarea
                    style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical', minHeight: 48, boxSizing: 'border-box' }}
                    value={popup.text}
                    onChange={(e) => setPopup((p) => p ? { ...p, text: e.target.value } : null)}
                    placeholder="Keinen Text erkannt – manuell eingeben…"
                  />
                )}

                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', marginTop: 10 }}>Welches Feld?</div>
                <select
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, background: '#fff', boxSizing: 'border-box' }}
                  value={popup.field}
                  onChange={(e) => setPopup((p) => p ? { ...p, field: e.target.value } : null)}
                >
                  {(Object.entries(FIELD_LABELS) as [FieldKey, string][]).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    disabled={saving || popup.loading || !popup.text.trim()}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', background: '#1a3a5c', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    onClick={handlePopupSave}
                  >{saving ? '…' : '✓ Speichern & Lernen'}</button>
                  <button
                    style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#f3f4f6', fontSize: 12, cursor: 'pointer' }}
                    onClick={() => { setPopup(null); setLiveSel(null) }}
                  >✕</button>
                </div>
              </div>
            )}
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
          {id && doc && <AnnotationViewer doc={doc} onFieldSaved={() => { qc.invalidateQueries({ queryKey: ['document', id] }) }} />}
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

                <AbbyyFieldsPanel doc={doc} onSaved={() => { qc.invalidateQueries({ queryKey: ['document', doc.id] }); qc.invalidateQueries({ queryKey: ['review-queue'] }) }} />

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
