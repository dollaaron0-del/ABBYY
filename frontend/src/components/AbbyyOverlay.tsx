import React, { useState, useEffect } from 'react'

export interface AbbyyFields {
  absender?: string | null
  absender_strasse?: string | null
  absender_plz?: string | null
  absender_ort?: string | null
  absender_land?: string | null
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
  betrag_netto?: number | string | null
  steuerbetrag?: number | string | null
  steuersatz?: number | string | null
  nettogesamtbetrag?: number | string | null
  steuergesamtbetrag?: number | string | null
  referenz?: string | null
  [key: string]: any
}

interface Props {
  fields: AbbyyFields
  onSave: (fields: AbbyyFields) => Promise<void> | void
  onForward?: () => Promise<void> | void
  saving?: boolean
  forwarding?: boolean
}

// ─── ABBYY-Stil (Windows-Look wie FlexiCapture) ───────────────────────────────
const a: Record<string, React.CSSProperties> = {
  panel: {
    border: '2px solid #4a6fa5',
    borderRadius: 3,
    fontFamily: '"Segoe UI", Tahoma, Geneva, sans-serif',
    fontSize: 12,
    background: '#d4d0c8',
    overflow: 'hidden',
  },
  titleBar: {
    background: 'linear-gradient(180deg, #316ac5 0%, #1a4a9c 100%)',
    color: '#fff',
    padding: '4px 10px',
    fontWeight: 700,
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeader: {
    background: 'linear-gradient(180deg, #4a7ac8 0%, #2a5aac 100%)',
    color: '#fff',
    padding: '3px 8px',
    fontWeight: 600,
    fontSize: 11,
    cursor: 'pointer',
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    borderTop: '1px solid #3a6ab8',
  },
  sectionBody: {
    background: '#f0ece0',
    padding: '5px 8px',
    borderBottom: '1px solid #b0a898',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: '#333',
    flexShrink: 0,
    minWidth: 90,
  },
  labelNarrow: {
    fontSize: 11,
    color: '#333',
    flexShrink: 0,
    minWidth: 60,
  },
  input: (filled: boolean, required = false): React.CSSProperties => ({
    flex: 1,
    height: 20,
    fontSize: 11,
    border: required && !filled ? '2px solid #cc0000' : '1px solid #7a7a7a',
    background: filled ? '#ffffc0' : required ? '#ffe0e0' : '#fff',
    padding: '0 4px',
    outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
    color: '#000',
    borderRadius: 0,
  }),
  inputFixed: (filled: boolean, width: number): React.CSSProperties => ({
    width,
    flexShrink: 0,
    height: 20,
    fontSize: 11,
    border: '1px solid #7a7a7a',
    background: filled ? '#ffffc0' : '#fff',
    padding: '0 4px',
    outline: 'none',
    fontFamily: '"Segoe UI", Tahoma, sans-serif',
    color: '#000',
    borderRadius: 0,
  }),
  footer: {
    background: '#d4d0c8',
    borderTop: '2px solid #b0a898',
    padding: '6px 8px',
    display: 'flex',
    gap: 6,
  },
  btn: (primary: boolean, disabled: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    border: disabled ? '1px solid #a0a0a0' : '1px solid #4a6fa5',
    background: disabled
      ? '#d0d0d0'
      : primary
        ? 'linear-gradient(180deg, #316ac5 0%, #1a4a9c 100%)'
        : 'linear-gradient(180deg, #f0ece0 0%, #d8d4c8 100%)',
    color: disabled ? '#888' : primary ? '#fff' : '#000',
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 2,
  }),
  legend: {
    display: 'flex',
    gap: 12,
    padding: '4px 8px',
    background: '#e8e4d8',
    borderTop: '1px solid #c0b8a8',
    fontSize: 10,
    color: '#555',
    alignItems: 'center',
  },
  legendDot: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    width: 12,
    height: 10,
    background: color,
    border: '1px solid #888',
    marginRight: 3,
    verticalAlign: 'middle',
  }),
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

// ─── Eingabefeld ──────────────────────────────────────────────────────────────
function F({
  label, value, onChange, required = false, width, narrow = false,
}: {
  label: string; value: any; onChange: (v: string) => void;
  required?: boolean; width?: number; narrow?: boolean;
}) {
  const str = value == null ? '' : String(value)
  const filled = str.trim().length > 0
  return (
    <>
      <span style={narrow ? a.labelNarrow : a.label}>{label}{required && <span style={{ color: '#cc0000' }}>*</span>}</span>
      <input
        style={width ? a.inputFixed(filled, width) : a.input(filled, required)}
        value={str}
        onChange={e => onChange(e.target.value)}
      />
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

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export default function AbbyyOverlay({ fields, onSave, onForward, saving, forwarding }: Props) {
  const [f, setF] = useState<AbbyyFields>(fields)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setF(fields); setDirty(false) }, [fields])

  const set = (key: keyof AbbyyFields, value: any) => {
    setF(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  return (
    <div style={a.panel}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={a.titleBar}>
        🖥 ABBYY FlexiCapture — Felder prüfen &amp; korrigieren
      </div>

      {/* Lieferant */}
      <Section title="Lieferant">
        <div style={a.row}>
          <F label="Name" value={f.absender} onChange={v => set('absender', v)} required />
        </div>
        <div style={a.row}>
          <F label="Straße" value={f.absender_strasse} onChange={v => set('absender_strasse', v)} />
        </div>
        <div style={a.row}>
          <F label="PLZ" value={f.absender_plz} onChange={v => set('absender_plz', v)} width={56} narrow />
          <F label="Ort" value={f.absender_ort} onChange={v => set('absender_ort', v)} narrow />
          <F label="Land" value={f.absender_land} onChange={v => set('absender_land', v)} width={36} narrow />
        </div>
        <div style={a.row}>
          <F label="IBAN" value={f.iban} onChange={v => set('iban', v)} />
        </div>
        <div style={a.row}>
          <F label="Bankkonto" value={f.bankkonto} onChange={v => set('bankkonto', v)} />
          <F label="BIC" value={f.bic} onChange={v => set('bic', v)} width={90} narrow />
        </div>
      </Section>

      {/* Rechnungsdaten */}
      <Section title="Rechnungsdaten">
        <div style={a.row}>
          <F label="Rechnungs-Nr." value={f.rechnungsnummer} onChange={v => set('rechnungsnummer', v)} required />
          <F label="Datum" value={f.rechnungsdatum} onChange={v => set('rechnungsdatum', v)} required narrow />
        </div>
        <div style={a.row}>
          <F label="Fälligkeit" value={f.faelligkeitsdatum} onChange={v => set('faelligkeitsdatum', v)} />
          <F label="Einkäufer" value={f.einkaeufer} onChange={v => set('einkaeufer', v)} narrow />
        </div>
      </Section>

      {/* Beträge */}
      <Section title="Beträge">
        <div style={{ ...a.row, marginBottom: 5 }}>
          <input type="checkbox" checked={!!f.reversed_charge} onChange={e => set('reversed_charge', e.target.checked)} />
          <span style={{ fontSize: 11, marginLeft: 2 }}>Reversed Charge</span>
        </div>
        <div style={a.row}>
          <F label="Brutto" value={f.betrag_brutto} onChange={v => set('betrag_brutto', v)} required />
          <F label="Währung" value={f.waehrung ?? 'EUR'} onChange={v => set('waehrung', v)} width={46} narrow />
        </div>
      </Section>

      {/* Weitere Beträge */}
      <Section title="Weitere Beträge" defaultOpen={false}>
        <div style={a.row}>
          <F label="Netto" value={f.betrag_netto} onChange={v => set('betrag_netto', v)} />
          <F label="Steuer" value={f.steuerbetrag} onChange={v => set('steuerbetrag', v)} narrow />
          <F label="Satz %" value={f.steuersatz} onChange={v => set('steuersatz', v)} width={42} narrow />
        </div>
        <div style={a.row}>
          <F label="Netto ges." value={f.nettogesamtbetrag ?? f.betrag_netto} onChange={v => set('nettogesamtbetrag', v)} />
          <F label="Steuer ges." value={f.steuergesamtbetrag ?? f.steuerbetrag} onChange={v => set('steuergesamtbetrag', v)} narrow />
        </div>
        <div style={a.row}>
          <F label="Referenz" value={f.referenz} onChange={v => set('referenz', v)} />
        </div>
      </Section>

      {/* Legende */}
      <div style={a.legend}>
        <span><span style={a.legendDot('#ffffc0')} />KI ausgefüllt</span>
        <span><span style={a.legendDot('#ffe0e0')} />Pflichtfeld leer</span>
        <span><span style={a.legendDot('#ffffff')} />Nicht erkannt</span>
        {dirty && <span style={{ marginLeft: 'auto', color: '#996600', fontWeight: 700 }}>● Ungespeicherte Änderungen</span>}
      </div>

      {/* Buttons */}
      <div style={a.footer}>
        <button
          disabled={saving || !dirty}
          onClick={async () => { await onSave(f); setDirty(false) }}
          style={a.btn(true, !!(saving || !dirty))}
        >
          {saving ? <Spinner /> : null} {saving ? 'Speichern…' : dirty ? '✓ Felder speichern' : '✓ Gespeichert'}
        </button>
        {onForward && (
          <button
            disabled={!!(forwarding || dirty)}
            onClick={() => onForward()}
            title={dirty ? 'Bitte zuerst speichern' : 'An ABBYY übergeben'}
            style={a.btn(false, !!(forwarding || dirty))}
          >
            {forwarding ? <Spinner /> : null} {forwarding ? 'Übergabe…' : '→ An ABBYY'}
          </button>
        )}
      </div>
    </div>
  )
}
