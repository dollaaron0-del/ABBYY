import React, { useState, useEffect } from 'react'

/**
 * Nachbau des ABBYY-FlexiCapture-Validierungsformulars ("Overlay").
 * Die grün hinterlegten Felder entsprechen den von der KI extrahierten Werten.
 * Der Benutzer kann sie hier wie in ABBYY prüfen und korrigieren, bevor sie
 * an ABBYY übergeben werden.
 */

export interface AbbyyFields {
  // Lieferant / Adresse
  absender?: string | null
  absender_strasse?: string | null
  absender_plz?: string | null
  absender_ort?: string | null
  absender_land?: string | null
  // Bank
  iban?: string | null
  bankkonto?: string | null
  bic?: string | null // = Bankleitzahl/BIC im ABBYY-Formular
  // Rechnungsdaten
  rechnungsnummer?: string | null
  rechnungsdatum?: string | null
  faelligkeitsdatum?: string | null
  einkaeufer?: string | null
  // Beträge
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

const c = {
  panel: { background: '#ffffff', border: '1px solid #c8d4e0', borderRadius: 6, fontSize: 12, color: '#1f2937' } as React.CSSProperties,
  sectionTitle: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', background: '#eef2f7', borderTop: '1px solid #dbe3ec',
    fontWeight: 700, fontSize: 11, color: '#334155', textTransform: 'uppercase' as const, letterSpacing: 0.4,
  } as React.CSSProperties,
  row: { display: 'flex', gap: 10, padding: '6px 10px', flexWrap: 'wrap' as const } as React.CSSProperties,
  fieldWrap: (flex: number) => ({ flex, minWidth: 90, display: 'flex', flexDirection: 'column' as const }),
  fieldLabel: { fontSize: 10, color: '#64748b', marginBottom: 2 } as React.CSSProperties,
  input: (filled: boolean): React.CSSProperties => ({
    border: '1px solid #b9d4b9',
    background: filled ? '#e7f6e7' : '#fbfffb',
    borderRadius: 3, padding: '4px 7px', fontSize: 12, color: '#14532d',
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }),
  amount: (filled: boolean): React.CSSProperties => ({
    border: '1px solid #b9d4b9',
    background: filled ? '#e7f6e7' : '#fbfffb',
    borderRadius: 3, padding: '4px 7px', fontSize: 12, color: '#14532d',
    outline: 'none', width: '100%', boxSizing: 'border-box', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  }),
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' } as React.CSSProperties,
}

function Triangle() {
  return <span style={{ fontSize: 9, color: '#64748b' }}>▼</span>
}

function TextField({
  label, value, onChange, flex = 1, mono = false,
}: { label: string; value: any; onChange: (v: string) => void; flex?: number; mono?: boolean }) {
  const str = value == null ? '' : String(value)
  return (
    <div style={c.fieldWrap(flex)}>
      <span style={c.fieldLabel}>{label}</span>
      <input
        style={{ ...c.input(str.length > 0), ...(mono ? { fontFamily: 'monospace', letterSpacing: 0.4 } : {}) }}
        value={str}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function AmountField({
  label, value, onChange, flex = 1,
}: { label: string; value: any; onChange: (v: string) => void; flex?: number }) {
  const str = value == null ? '' : String(value)
  return (
    <div style={c.fieldWrap(flex)}>
      <span style={c.fieldLabel}>{label}</span>
      <input style={c.amount(str.length > 0)} value={str} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

interface Props {
  fields: AbbyyFields
  onSave: (fields: AbbyyFields) => Promise<void> | void
  onForward?: () => Promise<void> | void
  saving?: boolean
  forwarding?: boolean
}

export default function AbbyyOverlay({ fields, onSave, onForward, saving, forwarding }: Props) {
  const [f, setF] = useState<AbbyyFields>(fields)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setF(fields); setDirty(false) }, [fields])

  const set = (key: keyof AbbyyFields, value: any) => {
    setF((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  return (
    <div style={c.panel}>
      <div style={{ padding: '8px 10px', background: '#1a3a5c', color: '#fff', fontWeight: 700, fontSize: 12, borderRadius: '6px 6px 0 0' }}>
        ABBYY-Formular · Validierung
      </div>

      {/* Adresse */}
      <div style={c.sectionTitle}><Triangle /> Lieferant / Adresse</div>
      <div style={c.row}>
        <TextField label="Lieferant" value={f.absender} onChange={(v) => set('absender', v)} flex={3} />
      </div>
      <div style={c.row}>
        <TextField label="Straße" value={f.absender_strasse} onChange={(v) => set('absender_strasse', v)} flex={3} />
      </div>
      <div style={c.row}>
        <TextField label="PLZ" value={f.absender_plz} onChange={(v) => set('absender_plz', v)} flex={1} />
        <TextField label="Ort" value={f.absender_ort} onChange={(v) => set('absender_ort', v)} flex={2} />
        <TextField label="Land" value={f.absender_land} onChange={(v) => set('absender_land', v)} flex={1} />
      </div>

      {/* Bank */}
      <div style={c.sectionTitle}><Triangle /> Bankverbindung</div>
      <div style={c.row}>
        <TextField label="IBAN" value={f.iban} onChange={(v) => set('iban', v)} flex={3} mono />
      </div>
      <div style={c.row}>
        <TextField label="Bankkonto" value={f.bankkonto} onChange={(v) => set('bankkonto', v)} flex={2} mono />
        <TextField label="Bankleitzahl / BIC" value={f.bic} onChange={(v) => set('bic', v)} flex={2} mono />
      </div>

      {/* Rechnungsdaten */}
      <div style={c.sectionTitle}><Triangle /> Rechnungsdaten</div>
      <div style={c.row}>
        <TextField label="Rechnungsnummer" value={f.rechnungsnummer} onChange={(v) => set('rechnungsnummer', v)} flex={2} />
        <TextField label="Rechnungsdatum" value={f.rechnungsdatum} onChange={(v) => set('rechnungsdatum', v)} flex={2} />
      </div>

      {/* Sonstige Daten */}
      <div style={c.sectionTitle}><Triangle /> Sonstige Daten</div>
      <div style={c.row}>
        <TextField label="Fälligkeitsdatum" value={f.faelligkeitsdatum} onChange={(v) => set('faelligkeitsdatum', v)} flex={2} />
        <TextField label="Einkäufer" value={f.einkaeufer} onChange={(v) => set('einkaeufer', v)} flex={2} />
      </div>

      {/* Beträge */}
      <div style={c.sectionTitle}><Triangle /> Beträge</div>
      <div style={c.checkRow}>
        <input type="checkbox" checked={!!f.reversed_charge} onChange={(e) => set('reversed_charge', e.target.checked)} />
        <span style={{ fontSize: 11, color: '#475569' }}>Reversed Charge</span>
      </div>
      <div style={c.row}>
        <AmountField label="Bruttogesamtbetrag" value={f.betrag_brutto} onChange={(v) => set('betrag_brutto', v)} flex={2} />
        <TextField label="Währung" value={f.waehrung} onChange={(v) => set('waehrung', v)} flex={1} />
      </div>

      {/* Weitere Beträge */}
      <div style={c.sectionTitle}><Triangle /> Weitere Beträge</div>
      <div style={c.row}>
        <AmountField label="Nettobetrag" value={f.betrag_netto} onChange={(v) => set('betrag_netto', v)} flex={2} />
        <AmountField label="Steuerbetrag" value={f.steuerbetrag} onChange={(v) => set('steuerbetrag', v)} flex={2} />
        <TextField label="Steuersatz %" value={f.steuersatz} onChange={(v) => set('steuersatz', v)} flex={1} />
      </div>

      {/* Steuerbeträge gesamt */}
      <div style={c.sectionTitle}><Triangle /> Weitere Steuerbeträge</div>
      <div style={c.row}>
        <AmountField label="Nettogesamtbetrag" value={f.nettogesamtbetrag ?? f.betrag_netto} onChange={(v) => set('nettogesamtbetrag', v)} flex={2} />
        <AmountField label="Steuergesamtbetrag" value={f.steuergesamtbetrag ?? f.steuerbetrag} onChange={(v) => set('steuergesamtbetrag', v)} flex={2} />
      </div>

      {/* Referenz */}
      <div style={c.sectionTitle}><Triangle /> Referenz</div>
      <div style={c.row}>
        <TextField label="Referenz" value={f.referenz} onChange={(v) => set('referenz', v)} flex={3} />
      </div>

      {/* Aktionen */}
      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #dbe3ec', background: '#f8fafc', borderRadius: '0 0 6px 6px' }}>
        <button
          disabled={saving || !dirty}
          onClick={async () => { await onSave(f); setDirty(false) }}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12,
            cursor: saving || !dirty ? 'not-allowed' : 'pointer',
            background: saving || !dirty ? '#d1d5db' : '#16a34a', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {saving && <Spinner />}
          {saving ? 'Speichern…' : dirty ? '✓ Felder speichern' : '✓ Gespeichert'}
        </button>
        {onForward && (
          <button
            disabled={forwarding || dirty}
            onClick={() => onForward()}
            title={dirty ? 'Bitte zuerst speichern' : 'An ABBYY übergeben'}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 12,
              cursor: forwarding || dirty ? 'not-allowed' : 'pointer',
              background: forwarding || dirty ? '#d1d5db' : '#1a3a5c', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {forwarding && <Spinner />}
            {forwarding ? 'Übergabe…' : '→ An ABBYY übergeben'}
          </button>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12,
      border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
    }} />
  )
}
