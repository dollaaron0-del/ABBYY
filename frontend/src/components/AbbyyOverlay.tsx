import React, { useState, useEffect } from 'react'

export interface Position {
  beschreibung: string
  menge: string
  einzelpreis_netto: string
  mwst_satz: string
  waehrung: string
}

const emptyPos = (): Position => ({ beschreibung: '', menge: '', einzelpreis_netto: '', mwst_satz: '', waehrung: '' })

export interface AbbyyFields {
  geschaeftsbereich?: string | null
  lieferant_name?: string | null
  absender?: string | null
  absender_strasse?: string | null
  absender_plz?: string | null
  absender_ort?: string | null
  absender_land?: string | null
  ust_id?: string | null
  steuernummer?: string | null
  iban?: string | null
  bankkonto?: string | null
  bic?: string | null
  rechnungsnummer?: string | null
  rechnungsdatum?: string | null
  faelligkeitsdatum?: string | null
  einkaeufer?: string | null
  reversed_charge?: boolean
  betrag_brutto?: number | string | null
  waehrung?: string | null
  betrag_netto?: number | string | null        // steuerfreier Nettobetrag
  betrag_netto_1?: number | string | null      // Nettobetrag 1 (mit MwSt-Paar)
  steuerbetrag?: number | string | null        // Steuerbetrag 1
  steuersatz?: number | string | null          // Steuersatz 1
  betrag_netto_2?: number | string | null      // Nettobetrag 2
  steuerbetrag_2?: number | string | null      // Steuerbetrag 2
  steuersatz_2?: number | string | null        // Steuersatz 2
  nettogesamtbetrag?: number | string | null
  steuergesamtbetrag?: number | string | null
  referenz?: string | null
  lieferantennummer?: string | null
  kostenstelle?: string | null
  hotel_name?: string | null
  positionen?: Position[]
  [key: string]: any
}

interface Props {
  docId?: string
  fields: AbbyyFields
  fieldSources?: Record<string, string>
  docConfidence?: number
  onSave: (fields: AbbyyFields) => Promise<void> | void
  onForward?: () => Promise<void> | void
  onRequestRegion?: (fieldKey: string) => void
  pendingFieldFill?: { field: string; text: string } | null
  onPendingFillConsumed?: () => void
  targetField?: string | null
  saving?: boolean
  forwarding?: boolean
}

// ─── ABBYY-Stil ───────────────────────────────────────────────────────────────
const a: Record<string, any> = {
  panel: {
    border: '1px solid #3a5a9a',
    borderRadius: 4,
    fontFamily: '"Segoe UI", Tahoma, Geneva, sans-serif',
    fontSize: 12,
    background: '#d4d0c8',
    overflow: 'clip',
    boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
  },
  titleBar: {
    background: 'linear-gradient(180deg, #3a78d4 0%, #1a4aab 100%)',
    color: '#fff',
    padding: '5px 10px',
    fontWeight: 700,
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    borderBottom: '1px solid #1a3a8c',
    letterSpacing: 0.2,
  },
  sectionHeader: {
    background: 'linear-gradient(180deg, #5282cc 0%, #2f60b4 100%)',
    color: '#fff',
    padding: '4px 10px',
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderTop: '1px solid #254e9a',
    letterSpacing: 0.1,
  },
  sectionBody: {
    background: '#f4f1e9',
    padding: '7px 10px',
    borderBottom: '1px solid #c0b8a8',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginBottom: 5,
  },
  label: { fontSize: 11, color: '#2a2a2a', flexShrink: 0, minWidth: 90 },
  labelNarrow: { fontSize: 11, color: '#2a2a2a', flexShrink: 0, minWidth: 60 },
  labelXs: { fontSize: 11, color: '#2a2a2a', flexShrink: 0, minWidth: 36 },
  footer: {
    background: '#ccc8c0',
    borderTop: '2px solid #a8a098',
    padding: '7px 10px',
    display: 'flex',
    gap: 6,
  },
  btn: (primary: boolean, disabled: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 700,
    border: disabled ? '1px solid #a0a0a0' : primary ? '1px solid #1a4a9c' : '1px solid #8a8a8a',
    background: disabled
      ? '#c8c4bc'
      : primary
        ? 'linear-gradient(180deg, #4080d0 0%, #1a4aab 100%)'
        : 'linear-gradient(180deg, #f0ece0 0%, #d4d0c4 100%)',
    color: disabled ? '#999' : primary ? '#fff' : '#1a1a1a',
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 3,
    letterSpacing: 0.2,
  }),
  legend: {
    display: 'flex',
    gap: 10,
    padding: '5px 10px',
    background: '#e4e0d4',
    borderTop: '1px solid #c4bca8',
    fontSize: 10,
    color: '#444',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    minHeight: 24,
  },
  legendDot: (color: string, border?: string): React.CSSProperties => ({
    display: 'inline-block',
    width: 13, height: 11,
    background: color,
    border: `1px solid ${border ?? '#888'}`,
    marginRight: 3,
    borderRadius: 2,
    verticalAlign: 'middle',
  }),
  posTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  posTh: {
    background: 'linear-gradient(180deg, #4080d0 0%, #2060b0 100%)',
    color: '#fff', padding: '3px 5px',
    border: '1px solid #3060a0', textAlign: 'left' as const, fontWeight: 600,
    letterSpacing: 0.1,
  },
  posTd: { padding: '1px', border: '1px solid #c8c8c8', background: '#fff' },
  posTdInput: {
    width: '100%', height: 19, border: 'none', background: 'transparent',
    fontSize: 10, padding: '0 3px', outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
  },
}

// ─── Kollapsierbare Sektion ────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <div style={a.sectionHeader} onClick={() => setOpen(o => !o)}>
        <span>{open ? '▼' : '▶'}</span> {title}
      </div>
      {open && <div style={a.sectionBody}>{children}</div>}
    </>
  )
}

// ─── Quellen-Badge ────────────────────────────────────────────────────────────
type FieldSource = 'ki' | 'datenbank' | 'gelernt' | 'manuell' | string | undefined

function SourceBadge({ source, docConfidence }: { source?: FieldSource; docConfidence?: number }) {
  if (!source) return null
  const conf = docConfidence ?? 100
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 8, padding: '1px 4px', borderRadius: 8,
    marginLeft: 3, lineHeight: 1.5, flexShrink: 0,
    fontWeight: 700, letterSpacing: 0.2, verticalAlign: 'middle',
    cursor: 'default',
  }
  if (source === 'datenbank') {
    return <span style={{ ...base, background: '#16a34a', color: '#fff' }} title="Wert aus der Lieferanten-/Hoteldatenbank (hohe Sicherheit)">DB ✓</span>
  }
  if (source === 'gelernt') {
    return <span style={{ ...base, background: '#7c3aed', color: '#fff' }} title="Wert aus gespeicherten manuellen Korrekturen (Lernmodus)">Gelernt</span>
  }
  if (source === 'manuell') {
    return <span style={{ ...base, background: '#1d4ed8', color: '#fff' }} title="Manuell eingetragen">Manuell</span>
  }
  if (source === 'ki') {
    if (conf < 55) return <span style={{ ...base, background: '#dc2626', color: '#fff' }} title={`KI-Schätzung – niedrige Konfidenz (${conf}%) – bitte manuell prüfen`}>KI ⚠</span>
    if (conf < 72) return <span style={{ ...base, background: '#ea580c', color: '#fff' }} title={`KI-Schätzung – mittlere Konfidenz (${conf}%) – empfehlenswert zu prüfen`}>KI ?</span>
    // Hohe Konfidenz → kein Badge nötig
  }
  return null
}

// ─── Eingabefeld mit Bestätigen/Bereich-Buttons ───────────────────────────────
interface FProps {
  label: string
  value: any
  onChange: (v: string) => void
  required?: boolean
  width?: number
  narrow?: boolean
  xs?: boolean
  fieldKey?: string
  confirmed?: boolean
  ocrFilled?: boolean
  targeted?: boolean
  source?: FieldSource
  docConfidence?: number
  onConfirm?: () => void
  onRequestRegion?: () => void
}

function F({ label, value, onChange, required = false, width, narrow = false, xs = false,
  fieldKey, confirmed, ocrFilled, targeted, source, docConfidence, onConfirm, onRequestRegion }: FProps) {
  const str = value == null ? '' : String(value)
  const filled = str.trim().length > 0
  const labelStyle = xs ? a.labelXs : narrow ? a.labelNarrow : a.label
  const conf = docConfidence ?? 100

  const showConfirmBtn = Boolean(onConfirm) && (!width || width >= 80)
  const showRegionBtn = Boolean(onRequestRegion)

  // Hintergrundfarbe und Rahmen: Priorität → targeted > ocr > confirmed > datenbank > gelernt > manuell > ki(unsicher) > ki > leer/pflicht
  let bg = '#fff'
  let border = '1px solid #8a8a8a'
  if (targeted) {
    bg = '#dceeff'; border = '2px solid #2a68cc'
  } else if (ocrFilled) {
    bg = '#d4eaff'; border = '1px solid #4a88c8'
  } else if (confirmed) {
    bg = '#d8f5d8'; border = '1px solid #3a9a3a'
  } else if (source === 'datenbank') {
    bg = '#c0f0c4'; border = '1px solid #16a34a'
  } else if (source === 'gelernt') {
    bg = '#ede0ff'; border = '1px solid #7c3aed'
  } else if (source === 'manuell') {
    bg = '#dce8ff'; border = '1px solid #3b6fd4'
  } else if (filled && source === 'ki') {
    // KI-Wert: Farbe zeigt wie sicher das Programm ist
    if (conf < 55) { bg = '#ffe0c8'; border = '1px solid #c04800' }
    else if (conf < 72) { bg = '#fff3c0'; border = '1px solid #b08000' }
    else { bg = '#ffffc8' }  // hohe Konfidenz: normales Gelb
  } else if (filled) {
    bg = '#ffffc8'
  } else if (required) {
    bg = '#ffe4e4'; border = '2px solid #cc2222'
  }

  return (
    <>
      <span style={{ ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: 0 }}>
        {label}{required && <span style={{ color: '#cc2222' }}>*</span>}
        <SourceBadge source={source} docConfidence={docConfidence} />
      </span>
      <div style={{
        display: 'flex', alignItems: 'center',
        flex: width ? undefined : 1,
        width: width ?? undefined,
        flexShrink: width ? 0 : undefined,
        minWidth: 0,
      }}>
        <input
          style={{
            flex: 1, minWidth: 0, height: 21, fontSize: 11,
            border, background: bg,
            padding: '0 4px', outline: 'none',
            fontFamily: '"Segoe UI", Tahoma, sans-serif',
            color: '#000', borderRadius: 2,
            transition: 'border-color 0.1s',
          }}
          value={str}
          placeholder={!filled && onRequestRegion ? '✂ markieren…' : undefined}
          onChange={e => onChange(e.target.value)}
        />
        {showConfirmBtn && onConfirm && (
          <button
            onClick={onConfirm}
            title={confirmed ? 'Bestätigung aufheben' : 'Wert bestätigen'}
            style={{
              width: 18, height: 21, fontSize: 9, padding: 0, cursor: 'pointer',
              border: confirmed ? '1px solid #2a7a2a' : '1px solid #8a8a8a',
              borderLeft: 'none', borderRadius: '0 2px 0 0',
              background: confirmed ? 'linear-gradient(180deg,#5ab85a,#3a8a3a)' : 'linear-gradient(180deg,#e0dcd0,#c8c4b8)',
              color: confirmed ? '#fff' : '#444', flexShrink: 0,
            }}
          >✓</button>
        )}
        {showRegionBtn && onRequestRegion && (
          <button
            onClick={onRequestRegion}
            title="Bereich im Dokument markieren (OCR-Lernen)"
            style={{
              width: 18, height: 21, fontSize: 9, padding: 0, cursor: 'pointer',
              border: targeted ? '1px solid #1a52a8' : !filled ? '1px solid #c87010' : '1px solid #8a8a8a',
              borderLeft: 'none',
              borderRadius: showConfirmBtn && onConfirm ? '0 0 2px 0' : '0 2px 2px 0',
              background: targeted
                ? 'linear-gradient(180deg,#4888d8,#1a52a8)'
                : !filled
                  ? 'linear-gradient(180deg,#ffd070,#e8a020)'
                  : 'linear-gradient(180deg,#e0dcd0,#c8c4b8)',
              color: targeted ? '#fff' : !filled ? '#3a1800' : '#444', flexShrink: 0,
              fontWeight: !filled && !targeted ? 700 : 400,
            }}
          >✂</button>
        )}
      </div>
    </>
  )
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 11, height: 11,
      border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  )
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function toNum(v: any): number {
  const n = parseFloat(String(v ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function fmtAmt(n: number, waehrung: string): string {
  if (n === 0) return '–'
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + waehrung
}

function AmountSummary({ nettoGes, steuerGes, waehrung }: { nettoGes: number; steuerGes: number; waehrung: string }) {
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#1a3060', flexShrink: 0, minWidth: 118, fontWeight: 600 }
  const valStyle: React.CSSProperties = {
    flex: 1, height: 22, fontSize: 12, border: '1px solid #7a9ac8',
    background: 'linear-gradient(180deg,#eef4fc,#dde8f4)',
    padding: '0 6px', fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#0a1a50',
    display: 'flex', alignItems: 'center', userSelect: 'none' as const,
    fontWeight: 700, borderRadius: 2,
  }
  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>Nettogesamtbetrag</span>
        <div style={valStyle}>{fmtAmt(nettoGes, waehrung)}</div>
      </div>
      <div style={{ ...rowStyle, marginBottom: 0 }}>
        <span style={labelStyle}>Steuergesamtbetrag</span>
        <div style={valStyle}>{fmtAmt(steuerGes, waehrung)}</div>
      </div>
    </>
  )
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export default function AbbyyOverlay({
  docId, fields, fieldSources, docConfidence, onSave, onForward,
  onRequestRegion, pendingFieldFill, onPendingFillConsumed, targetField,
  saving, forwarding,
}: Props) {
  const [f, setF] = useState<AbbyyFields>(fields)
  const [dirty, setDirty] = useState(false)
  const [confirmedFields, setConfirmedFields] = useState<Set<string>>(new Set())
  const [ocrFilledFields, setOcrFilledFields] = useState<Set<string>>(new Set())
  // Felder die der Benutzer manuell bearbeitet hat → Badge wird gelöscht
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set())

  // Reset completely on new document
  useEffect(() => {
    setF(fields)
    setDirty(false)
    setConfirmedFields(new Set())
    setOcrFilledFields(new Set())
    setEditedFields(new Set())
  }, [docId])

  // Update from server refresh if user hasn't started editing
  useEffect(() => {
    if (!dirty) setF(fields)
  }, [fields])

  // Apply incoming OCR fill from document region selection
  useEffect(() => {
    if (!pendingFieldFill) return
    const posMatch = pendingFieldFill.field.match(/^pos_(\d+)_(.+)$/)
    if (posMatch) {
      const idx = parseInt(posMatch[1])
      const posField = posMatch[2] as keyof Position
      setF(prev => {
        const arr = [...(prev.positionen ?? [emptyPos(), emptyPos(), emptyPos()])]
        while (arr.length <= idx) arr.push(emptyPos())
        arr[idx] = { ...arr[idx], [posField]: pendingFieldFill.text }
        return { ...prev, positionen: arr }
      })
    } else {
      setF(prev => ({ ...prev, [pendingFieldFill.field]: pendingFieldFill.text }))
    }
    setOcrFilledFields(prev => new Set([...prev, pendingFieldFill.field]))
    setConfirmedFields(prev => new Set([...prev, pendingFieldFill.field]))
    setDirty(true)
    onPendingFillConsumed?.()
  }, [pendingFieldFill])

  const set = (key: keyof AbbyyFields, value: any) => {
    setF(prev => ({ ...prev, [key]: value }))
    setDirty(true)
    setConfirmedFields(prev => { const n = new Set(prev); n.delete(key as string); return n })
    setOcrFilledFields(prev => { const n = new Set(prev); n.delete(key as string); return n })
    // Wenn Benutzer tippt → Badge auf "manuell" wechseln (lokaler Zustand, vor dem Speichern)
    setEditedFields(prev => new Set([...prev, key as string]))
  }

  function toggleConfirm(fk: string) {
    setConfirmedFields(prev => {
      const next = new Set(prev)
      if (prev.has(fk)) next.delete(fk); else next.add(fk)
      return next
    })
  }

  // Positionen (Zeilen der Rechnung)
  const positions: Position[] = Array.isArray(f.positionen) && f.positionen.length > 0
    ? f.positionen
    : [emptyPos(), emptyPos(), emptyPos()]

  function setPosition(index: number, field: keyof Position, value: string) {
    const arr = positions.map((p, i) => i === index ? { ...p, [field]: value } : p)
    set('positionen', arr)
  }
  function addPosition() { set('positionen', [...positions, emptyPos()]) }
  function removePosition(index: number) { set('positionen', positions.filter((_, i) => i !== index)) }

  // Build props for each field key (inkl. Quelleninfo)
  function fp(fk: string): Partial<FProps> {
    // Wenn Benutzer das Feld gerade editiert hat → als "manuell" zeigen (lokal)
    const src = editedFields.has(fk) ? 'manuell' : (fieldSources?.[fk] as FieldSource)
    return {
      fieldKey: fk,
      confirmed: confirmedFields.has(fk),
      ocrFilled: ocrFilledFields.has(fk),
      targeted: targetField === fk,
      source: src,
      docConfidence,
      onConfirm: () => toggleConfirm(fk),
      onRequestRegion: onRequestRegion ? () => onRequestRegion(fk) : undefined,
    }
  }

  const confirmedCount = confirmedFields.size
  const filledCount = Object.entries(f).filter(([, v]) => v != null && String(v).trim()).length

  const posOcrBtn: React.CSSProperties = {
    width: 13, height: 19, fontSize: 8, padding: 0, cursor: 'pointer', flexShrink: 0,
    border: 'none', borderLeft: '1px solid #c8c0b0',
    background: 'linear-gradient(180deg,#f0e8d0,#d8cdb0)',
    color: '#664400', lineHeight: 1,
  }

  return (
    <div style={a.panel}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Title bar */}
      <div style={a.titleBar}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>📋</span>
          <span>ABBYY FlexiCapture — Felder prüfen &amp; korrigieren</span>
        </span>
        {filledCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.9, background: 'rgba(255,255,255,0.15)', padding: '1px 7px', borderRadius: 10 }}>
            {confirmedCount}/{filledCount} ✓
          </span>
        )}
      </div>

      {/* Target field banner */}
      {targetField && (
        <div style={{ padding: '4px 10px', background: '#1a5ca8', fontSize: 11, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>✂</span>
          <span>Bereich im Dokument für dieses Feld aufziehen…</span>
        </div>
      )}

      {/* Geschäftsbereich + Lieferant — immer sichtbar, oben */}
      <div style={{ background: 'linear-gradient(180deg,#eae6da,#dedad0)', padding: '7px 10px', borderBottom: '2px solid #b0a898' }}>
        <div style={a.row}>
          <span style={{ ...a.label, minWidth: 110 }}>Geschäftsbereich</span>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <input
              style={{ flex: 1, height: 20, fontSize: 11, border: f.geschaeftsbereich ? '1px solid #7a7a7a' : '1px solid #7a7a7a', background: f.geschaeftsbereich ? '#ffffc0' : '#fff', padding: '0 4px', outline: 'none', fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#000', borderRadius: 0 }}
              value={f.geschaeftsbereich ?? ''}
              onChange={e => set('geschaeftsbereich', e.target.value)}
              placeholder="z. B. Frankfurt, München…"
            />
          </div>
        </div>
        <div style={{ ...a.row, marginBottom: 0 }}>
          <span style={{ ...a.label, minWidth: 110 }}>Lieferant</span>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <input
              style={{ flex: 1, height: 20, fontSize: 11, border: '1px solid #7a7a7a', background: f.lieferant_name ? '#ffffc0' : '#fff', padding: '0 4px', outline: 'none', fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#000', borderRadius: 0 }}
              value={f.lieferant_name ?? f.absender ?? ''}
              onChange={e => { set('lieferant_name', e.target.value); set('absender', e.target.value) }}
            />
          </div>
        </div>
      </div>

      {/* Rechnungsdaten */}
      <Section title="Rechnungsdaten">
        <div style={a.row}>
          <F label="Rechnungs-Nr." value={f.rechnungsnummer} onChange={v => set('rechnungsnummer', v)} required {...fp('rechnungsnummer')} />
          <F label="Datum" value={f.rechnungsdatum} onChange={v => set('rechnungsdatum', v)} required narrow {...fp('rechnungsdatum')} />
        </div>
        <div style={{ ...a.row, marginBottom: 0 }}>
          <F label="Fälligkeitsdatum" value={f.faelligkeitsdatum} onChange={v => set('faelligkeitsdatum', v)} narrow {...fp('faelligkeitsdatum')} />
          <F label="Referenz/PO" value={f.referenz} onChange={v => set('referenz', v)} {...fp('referenz')} />
        </div>
      </Section>

      {/* Absender & Adresse */}
      <Section title="Absender & Adresse">
        <div style={a.row}>
          <F label="Straße" value={f.absender_strasse} onChange={v => set('absender_strasse', v)} {...fp('absender_strasse')} />
        </div>
        <div style={a.row}>
          <F label="PLZ" value={f.absender_plz} onChange={v => set('absender_plz', v)} xs width={72} {...fp('absender_plz')} />
          <F label="Ort" value={f.absender_ort} onChange={v => set('absender_ort', v)} {...fp('absender_ort')} />
          <F label="Land" value={f.absender_land} onChange={v => set('absender_land', v)} xs width={56} {...fp('absender_land')} />
        </div>
        <div style={{ ...a.row, marginBottom: 0 }}>
          <F label="USt-ID" value={f.ust_id} onChange={v => set('ust_id', v)} {...fp('ust_id')} />
          <F label="Steuernr." value={f.steuernummer} onChange={v => set('steuernummer', v)} narrow {...fp('steuernummer')} />
        </div>
      </Section>

      {/* Bankdaten */}
      <Section title="Bankdaten">
        <div style={a.row}>
          <F label="IBAN" value={f.iban} onChange={v => set('iban', v)} {...fp('iban')} />
        </div>
        <div style={{ ...a.row, marginBottom: 0 }}>
          <F label="BIC" value={f.bic} onChange={v => set('bic', v)} {...fp('bic')} />
          <F label="Bankkonto" value={f.bankkonto} onChange={v => set('bankkonto', v)} {...fp('bankkonto')} />
        </div>
      </Section>

      {/* Buchungsdaten */}
      <Section title="Buchungsdaten (Kostenstelle / Hotel)">
        <div style={a.row}>
          <F label="Lieferanten-Nr." value={f.lieferantennummer} onChange={v => set('lieferantennummer', v)} {...fp('lieferantennummer')} />
          <F label="Kostenstelle" value={f.kostenstelle} onChange={v => set('kostenstelle', v)} narrow {...fp('kostenstelle')} />
        </div>
        <div style={{ ...a.row, marginBottom: 0 }}>
          <F label="Hotel" value={f.hotel_name} onChange={v => set('hotel_name', v)} {...fp('hotel_name')} />
          <F label="Einkäufer" value={f.einkaeufer} onChange={v => set('einkaeufer', v)} narrow {...fp('einkaeufer')} />
        </div>
      </Section>

      {/* Beträge */}
      <Section title="Beträge">
        {/* Reversed Charge */}
        <div style={{ ...a.row, marginBottom: 6 }}>
          <input type="checkbox" checked={!!f.reversed_charge} onChange={e => set('reversed_charge', e.target.checked)} />
          <span style={{ fontSize: 11, marginLeft: 2 }}>Reversed Charge</span>
        </div>

        {/* Bruttogesamtbetrag + Währung */}
        <div style={a.row}>
          <F label="Bruttogesamt" value={f.betrag_brutto} onChange={v => set('betrag_brutto', v)} required {...fp('betrag_brutto')} />
          <span style={{ ...a.labelXs, minWidth: 'unset', marginLeft: 4 }}>Währung</span>
          <select
            value={f.waehrung ?? 'EUR'}
            onChange={e => set('waehrung', e.target.value)}
            style={{ width: 58, height: 20, fontSize: 11, border: '1px solid #7a7a7a', background: '#ffffc0', padding: '0 2px', outline: 'none', fontFamily: '"Segoe UI", Tahoma, sans-serif', borderRadius: 0, flexShrink: 0 }}
          >
            {['EUR', 'USD', 'CHF', 'GBP', 'PLN', 'CZK', 'HUF', 'SEK', 'DKK', 'NOK'].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Weitere Beträge Sub-Bereich */}
        <div style={{ marginTop: 8, background: '#ede9e0', border: '1px solid #c8c0b0', borderRadius: 3, padding: '6px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#2a4a8a', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, borderBottom: '1px solid #c0b8a8', paddingBottom: 4 }}>
            ▸ Weitere Beträge
          </div>

          {/* Steuerfreier Nettobetrag */}
          <div style={a.row}>
            <F label="Nettobetrag" value={f.betrag_netto} onChange={v => set('betrag_netto', v)} {...fp('betrag_netto')} />
            <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', flexShrink: 0, fontStyle: 'italic' }}>steuerfrei</span>
          </div>

          {/* Paar 1 */}
          <div style={a.row}>
            <F label="Nettobetrag 1" value={f.betrag_netto_1} onChange={v => set('betrag_netto_1', v)} narrow {...fp('betrag_netto_1')} />
            <F label="Steuer 1" value={f.steuerbetrag} onChange={v => set('steuerbetrag', v)} narrow {...fp('steuerbetrag')} />
            <F label="Satz 1 %" value={f.steuersatz} onChange={v => set('steuersatz', v)} xs {...fp('steuersatz')} />
          </div>

          {/* Paar 2 */}
          <div style={{ ...a.row, marginBottom: 0 }}>
            <F label="Nettobetrag 2" value={f.betrag_netto_2} onChange={v => set('betrag_netto_2', v)} narrow {...fp('betrag_netto_2')} />
            <F label="Steuer 2" value={f.steuerbetrag_2} onChange={v => set('steuerbetrag_2', v)} narrow {...fp('steuerbetrag_2')} />
            <F label="Satz 2 %" value={f.steuersatz_2} onChange={v => set('steuersatz_2', v)} xs {...fp('steuersatz_2')} />
          </div>
        </div>

        {/* Gesamtbeträge (auto-berechnet) */}
        <div style={{ marginTop: 8, background: '#dce8f8', border: '1px solid #9ab8e0', borderRadius: 3, padding: '6px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1a3a7a', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6, borderBottom: '1px solid #b0c8e8', paddingBottom: 4 }}>
            ∑ Summen
          </div>
          <AmountSummary
            nettoGes={toNum(f.betrag_netto) + toNum(f.betrag_netto_1) + toNum(f.betrag_netto_2)}
            steuerGes={toNum(f.steuerbetrag) + toNum(f.steuerbetrag_2)}
            waehrung={f.waehrung ?? 'EUR'}
          />
        </div>
      </Section>

      {/* Positionsdaten */}
      <Section title="Positionen (Produkte &amp; Dienstleistungen)" defaultOpen={false}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ ...a.posTable, tableLayout: 'fixed', minWidth: 480 }}>
            <colgroup>
              <col />
              <col style={{ width: 42 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 44 }} />
              <col style={{ width: 42 }} />
              <col style={{ width: 18 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={a.posTh}>Beschreibung</th>
                <th style={{ ...a.posTh, textAlign: 'right' as const }}>Menge</th>
                <th style={{ ...a.posTh, textAlign: 'right' as const }}>EP Netto</th>
                <th style={{ ...a.posTh, textAlign: 'right' as const }}>GP Netto</th>
                <th style={{ ...a.posTh, textAlign: 'center' as const }}>MwSt%</th>
                <th style={{ ...a.posTh, textAlign: 'center' as const }}>Wäh.</th>
                <th style={{ ...a.posTh, background: '#3a5aa0', padding: 0 }}></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, i) => {
                const gesamt = toNum(pos.menge) * toNum(pos.einzelpreis_netto)
                const gesamtStr = gesamt !== 0
                  ? gesamt.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : ''
                return (
                  <tr key={i}>
                    {/* Beschreibung */}
                    <td style={a.posTd}>
                      <div style={{ display: 'flex' }}>
                        <input style={{ ...a.posTdInput, flex: 1, minWidth: 0 }} value={pos.beschreibung} onChange={e => setPosition(i, 'beschreibung', e.target.value)} placeholder="Beschreibung…" />
                        {onRequestRegion && <button onClick={() => onRequestRegion(`pos_${i}_beschreibung`)} style={posOcrBtn} title="Bereich markieren">✂</button>}
                      </div>
                    </td>
                    {/* Menge */}
                    <td style={a.posTd}>
                      <div style={{ display: 'flex' }}>
                        <input style={{ ...a.posTdInput, flex: 1, minWidth: 0, textAlign: 'right' }} value={pos.menge} onChange={e => setPosition(i, 'menge', e.target.value)} placeholder="0" />
                        {onRequestRegion && <button onClick={() => onRequestRegion(`pos_${i}_menge`)} style={posOcrBtn} title="Bereich markieren">✂</button>}
                      </div>
                    </td>
                    {/* Einzelpreis Netto */}
                    <td style={a.posTd}>
                      <div style={{ display: 'flex' }}>
                        <input style={{ ...a.posTdInput, flex: 1, minWidth: 0, textAlign: 'right' }} value={pos.einzelpreis_netto} onChange={e => setPosition(i, 'einzelpreis_netto', e.target.value)} placeholder="0,00" />
                        {onRequestRegion && <button onClick={() => onRequestRegion(`pos_${i}_einzelpreis_netto`)} style={posOcrBtn} title="Bereich markieren">✂</button>}
                      </div>
                    </td>
                    {/* GP Netto auto */}
                    <td style={{ ...a.posTd, background: '#e8e4d8' }}>
                      <span style={{ ...a.posTdInput, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: gesamtStr ? '#000' : '#bbb', fontFamily: '"Segoe UI", Tahoma, sans-serif' }}>
                        {gesamtStr || '–'}
                      </span>
                    </td>
                    {/* MwSt% */}
                    <td style={a.posTd}>
                      <div style={{ display: 'flex' }}>
                        <input style={{ ...a.posTdInput, flex: 1, minWidth: 0, textAlign: 'center' }} value={pos.mwst_satz} onChange={e => setPosition(i, 'mwst_satz', e.target.value)} placeholder="19" />
                        {onRequestRegion && <button onClick={() => onRequestRegion(`pos_${i}_mwst_satz`)} style={posOcrBtn} title="Bereich markieren">✂</button>}
                      </div>
                    </td>
                    {/* Währung */}
                    <td style={a.posTd}>
                      <div style={{ display: 'flex' }}>
                        <input style={{ ...a.posTdInput, flex: 1, minWidth: 0, textAlign: 'center' }} value={pos.waehrung} onChange={e => setPosition(i, 'waehrung', e.target.value)} placeholder={f.waehrung ?? 'EUR'} />
                        {onRequestRegion && <button onClick={() => onRequestRegion(`pos_${i}_waehrung`)} style={posOcrBtn} title="Bereich markieren">✂</button>}
                      </div>
                    </td>
                    <td
                      style={{ ...a.posTd, background: '#d4d0c8', textAlign: 'center', cursor: 'pointer', verticalAlign: 'middle' }}
                      onClick={() => removePosition(i)}
                      title="Zeile löschen"
                    >
                      <span style={{ color: '#880000', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>×</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button
          onClick={addPosition}
          style={{ marginTop: 6, padding: '2px 12px', fontSize: 10, border: '1px solid #808080', background: 'linear-gradient(180deg, #f0ece0 0%, #d8d4c8 100%)', cursor: 'pointer', borderRadius: 2, fontFamily: '"Segoe UI", Tahoma, sans-serif', fontWeight: 600 }}
        >
          + Zeile hinzufügen
        </button>
      </Section>

      {/* Legende – Farben & Badges */}
      <div style={{ ...a.legend, flexWrap: 'wrap', rowGap: 4 }}>
        <span style={{ fontWeight: 700, color: '#333', marginRight: 4 }}>Herkunft:</span>
        <span title="Wert aus der Lieferanten- oder Hoteldatenbank"><span style={a.legendDot('#c0f0c4', '#16a34a')}>​</span><span style={{ fontSize: 8, background: '#16a34a', color: '#fff', borderRadius: 6, padding: '0 3px', marginLeft: 1 }}>DB ✓</span> Datenbank</span>
        <span title="Aus gespeicherten manuellen Korrekturen"><span style={a.legendDot('#ede0ff', '#7c3aed')}>​</span><span style={{ fontSize: 8, background: '#7c3aed', color: '#fff', borderRadius: 6, padding: '0 3px', marginLeft: 1 }}>Gelernt</span> Gelernt</span>
        <span title="KI-Schätzung, hohe Konfidenz"><span style={a.legendDot('#ffffc0')}>​</span> KI sicher</span>
        <span title="KI-Schätzung, mittlere/niedrige Konfidenz"><span style={a.legendDot('#fff3c0', '#b08000')}>​</span><span style={{ fontSize: 8, background: '#ea580c', color: '#fff', borderRadius: 6, padding: '0 3px', marginLeft: 1 }}>KI ?</span> KI unsicher</span>
        <span title="Manuell eingetragen"><span style={a.legendDot('#dce8ff', '#3b6fd4')}>​</span><span style={{ fontSize: 8, background: '#1d4ed8', color: '#fff', borderRadius: 6, padding: '0 3px', marginLeft: 1 }}>Manuell</span></span>
        <span title="OCR-Bereich manuell markiert"><span style={a.legendDot('#d0e8ff', '#4a80c0')}>​</span>OCR</span>
        <span title="Pflichtfeld fehlt"><span style={a.legendDot('#ffe0e0', '#cc0000')}>​</span>Pflicht fehlt</span>
        {confirmedCount > 0 && (
          <span style={{ marginLeft: 'auto', color: '#006600', fontWeight: 700 }}>
            {confirmedCount} ✓ bestätigt
          </span>
        )}
        {dirty && (
          <span style={{ color: '#996600', fontWeight: 700, marginLeft: confirmedCount > 0 ? 6 : 'auto' }}>
            ● Ungespeichert
          </span>
        )}
      </div>

      {/* Hinweis zu Bestätigen/Bereich */}
      <div style={{ background: '#e0dcd2', padding: '4px 10px', fontSize: 10, color: '#555', borderTop: '1px solid #c4bca8', display: 'flex', gap: 12 }}>
        <span><strong>✓</strong> Wert bestätigen</span>
        <span style={{ color: '#c0c0b8' }}>│</span>
        <span><strong>✂</strong> Bereich im Dokument markieren → OCR-Lernen</span>
        {docConfidence !== undefined && (
          <>
            <span style={{ color: '#c0c0b8' }}>│</span>
            <span>KI-Konfidenz: <strong style={{ color: docConfidence >= 75 ? '#006600' : docConfidence >= 55 ? '#996600' : '#cc0000' }}>{docConfidence}%</strong></span>
          </>
        )}
      </div>

      {/* Buttons */}
      <div style={a.footer}>
        <button
          disabled={saving || !dirty}
          onClick={async () => { await onSave(f); setDirty(false) }}
          style={a.btn(true, !!(saving || !dirty))}
        >
          {saving ? <Spinner /> : null}{' '}
          {saving ? 'Speichern…' : dirty ? '✓ Felder speichern' : '✓ Gespeichert'}
        </button>
        {onForward && (
          <button
            disabled={!!(forwarding || dirty)}
            onClick={() => onForward()}
            title={dirty ? 'Bitte zuerst speichern' : 'An ABBYY übergeben'}
            style={a.btn(false, !!(forwarding || dirty))}
          >
            {forwarding ? <Spinner /> : null}{' '}
            {forwarding ? 'Übergabe…' : '→ An ABBYY'}
          </button>
        )}
      </div>
    </div>
  )
}
