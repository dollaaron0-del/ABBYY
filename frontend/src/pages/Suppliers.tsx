'use strict'
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  importSuppliers,
  exportSuppliers,
} from '../api/suppliers'
import type { SupplierFormData } from '../api/suppliers'
import type { Supplier } from '../types'
import apiClient from '../api/client'

const S = {
  topBar: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' as const },
  search: { flex: 1, minWidth: 220, padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  btn: (v: 'primary' | 'secondary' | 'danger' | 'success' = 'primary'): React.CSSProperties => ({
    padding: '9px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, border: 'none',
    background: v === 'primary' ? '#1a3a5c' : v === 'danger' ? '#ef4444' : v === 'success' ? '#16a34a' : '#f3f4f6',
    color: v === 'secondary' ? '#374151' : '#fff',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  th: { padding: '10px 14px', borderBottom: '2px solid #e5e7eb', textAlign: 'left' as const, color: '#6b7280', fontWeight: 600, fontSize: 12, background: '#f9fafb' },
  td: { padding: '10px 14px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'top' as const },
  alias: { display: 'inline-block', background: '#f3f4f6', borderRadius: 6, padding: '2px 8px', fontSize: 11, marginRight: 4, marginBottom: 2, color: '#374151' },
  modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modalBox: { background: '#fff', borderRadius: 14, padding: 32, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#1a3a5c', marginBottom: 20 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 14, boxSizing: 'border-box' as const },
  aliasInput: { display: 'flex', gap: 8, marginBottom: 8 },
  aliasTag: { display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', borderRadius: 6, padding: '4px 10px', fontSize: 13 },
  tagList: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 14 },
  info: { background: '#eff6ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', marginBottom: 16 },
  warn: { background: '#fef9c3', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#713f12', marginBottom: 16, border: '1px solid #fde047' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  section: { borderTop: '1px solid #e5e7eb', marginTop: 16, paddingTop: 16 },
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>

interface ModalProps {
  supplier?: Supplier | null
  onClose: () => void
  onSave: (data: SupplierFormData) => Promise<void>
}

function SupplierModal({ supplier, onClose, onSave }: ModalProps) {
  const [name, setName] = useState(supplier?.name || '')
  const [category, setCategory] = useState(supplier?.category || '')
  const [iban, setIban] = useState(supplier?.iban || '')
  const [vendorCode, setVendorCode] = useState(supplier?.vendor_code || '')
  const [ustId, setUstId] = useState(supplier?.ust_id || '')
  const [aliases, setAliases] = useState<string[]>(supplier?.aliases || [])
  const [aliasInput, setAliasInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addAlias = () => {
    const trimmed = aliasInput.trim()
    if (trimmed && !aliases.includes(trimmed)) setAliases([...aliases, trimmed])
    setAliasInput('')
  }

  const removeAlias = (a: string) => setAliases(aliases.filter((x) => x !== a))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name ist erforderlich'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        aliases,
        category: category.trim() || null,
        iban: iban.replace(/\s+/g, '').toUpperCase() || null,
        vendor_code: vendorCode.trim() || null,
        ust_id: ustId.trim() || null,
      })
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalTitle}>{supplier ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}</div>
        <form onSubmit={handleSubmit}>

          <label style={S.label}>Firmenname *</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Lüneburger Heide GmbH" required />

          <div style={S.row2}>
            <div>
              <label style={S.label}>Lieferantennummer</label>
              <input style={S.input} value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} placeholder="z.B. 10042" />
            </div>
            <div>
              <label style={S.label}>Kategorie</label>
              <input style={S.input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z.B. Lebensmittel" />
            </div>
          </div>

          <div style={S.section}>
            <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, marginBottom: 10 }}>
              ABGLEICH-DATEN — je mehr ausgefüllt, desto höhere Konfidenz
            </div>
            <label style={S.label}>IBAN (empfohlen — gibt 92% Konfidenz)</label>
            <input
              style={S.input}
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              placeholder="DE12 3456 7890 1234 5678 90"
            />
            <label style={S.label}>USt-ID (gibt ebenfalls 92% Konfidenz)</label>
            <input style={S.input} value={ustId} onChange={(e) => setUstId(e.target.value)} placeholder="DE123456789" />
          </div>

          <div style={S.section}>
            <label style={S.label}>Aliase (alternative Firmenbezeichnungen im OCR)</label>
            <div style={S.tagList}>
              {aliases.map((a) => (
                <div key={a} style={S.aliasTag}>
                  {a}
                  <button type="button" onClick={() => removeAlias(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16 }}>×</button>
                </div>
              ))}
            </div>
            <div style={S.aliasInput}>
              <input
                style={{ ...S.input, marginBottom: 0 }}
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias() } }}
                placeholder="Alias eingeben und Enter drücken"
              />
              <button type="button" style={S.btn('secondary')} onClick={addAlias}>+</button>
            </div>
          </div>

          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" style={S.btn('primary')} disabled={saving}>
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            <button type="button" style={S.btn('secondary')} onClick={onClose}>Abbrechen</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Suppliers() {
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ open: boolean; supplier?: Supplier | null }>({ open: false })
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, search],
    queryFn: () => getSuppliers({ page, limit: 25, search }),
  })

  const handleSave = async (id: string | undefined, formData: SupplierFormData) => {
    if (id) {
      await updateSupplier(id, formData)
    } else {
      await createSupplier(formData)
    }
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleDelete = async (s: Supplier) => {
    if (!confirm(`Lieferant "${s.name}" wirklich löschen?`)) return
    await deleteSupplier(s.id)
    qc.invalidateQueries({ queryKey: ['suppliers'] })
  }

  const handleSync = async () => {
    setSyncing(true)
    setImportStatus(null)
    setImportError(null)
    try {
      const res = await apiClient.post('/abbyy/sync-suppliers', {})
      const d = res.data
      setImportStatus(`Von ABBYY synchronisiert: ${d.imported} neu, ${d.updated} aktualisiert (${d.total} gesamt)`)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    } catch (err: any) {
      setImportError(err.response?.data?.error || err.message)
    } finally {
      setSyncing(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportStatus(null)
    setImportError(null)
    try {
      const result = await importSuppliers(file)
      setImportStatus(result.message)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    } catch (err: any) {
      setImportError(err.message)
    }
    e.target.value = ''
  }

  const suppliers = data?.data || []
  const pagination = data?.pagination
  const total = pagination?.total ?? 0

  return (
    <div>
      {modal.open && (
        <SupplierModal
          supplier={modal.supplier}
          onClose={() => setModal({ open: false })}
          onSave={(fd) => handleSave(modal.supplier?.id, fd)}
        />
      )}

      {total === 0 && !isLoading && (
        <div style={S.warn}>
          <strong>Keine Lieferanten in der Datenbank.</strong> Das ist der Grund für niedrige Konfidenz-Werte.
          Ohne Lieferanten kann das System keinen Absender-Abgleich machen.<br />
          <strong>→ IBAN eintragen</strong> = System erkennt den Lieferanten sofort mit 92% Konfidenz.
          Nutzen Sie "CSV/Excel importieren" für eine schnelle Masseneintragung.
        </div>
      )}

      <div style={S.info}>
        Lieferanten mit <strong>IBAN oder USt-ID</strong> werden eindeutig erkannt (92% Konfidenz).
        Nur-Name-Einträge nutzen Fuzzy-Matching (~78–85%). CSV-Format: Spalten "Name", "IBAN", "Lieferantennummer", "USt_ID", "Aliases", "Kategorie" (Trennzeichen Semikolon).
      </div>

      <div style={S.topBar}>
        <input
          style={S.search}
          placeholder="Name oder Alias suchen…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
        />
        <button style={S.btn('secondary')} onClick={() => { setSearch(searchInput); setPage(1) }}>Suchen</button>
        <button style={S.btn('primary')} onClick={() => setModal({ open: true, supplier: null })}>+ Neuer Lieferant</button>

        <label style={{ ...S.btn('secondary'), display: 'inline-block' }}>
          CSV/Excel importieren
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
        </label>

        <button style={S.btn('secondary')} onClick={exportSuppliers}>Excel exportieren</button>

        <button
          style={{ ...S.btn('success'), background: '#1a3a5c' }}
          onClick={handleSync}
          disabled={syncing}
          title="Lieferanten aus ABBYY / ERP automatisch importieren (URL in Einstellungen konfigurieren)"
        >
          {syncing ? 'Sync…' : 'Von ABBYY synchronisieren'}
        </button>
      </div>

      {importStatus && <div style={{ background: '#dcfce7', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#166534' }}>✓ {importStatus}</div>}
      {importError && <div style={{ background: '#fee2e2', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#991b1b' }}>✗ {importError}</div>}

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Name</th>
            <th style={S.th}>Lief.-Nr.</th>
            <th style={S.th}>IBAN</th>
            <th style={S.th}>USt-ID</th>
            <th style={S.th}>Kategorie</th>
            <th style={S.th}>Aliase</th>
            <th style={S.th}>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>Lade Lieferanten…</td></tr>}
          {!isLoading && suppliers.length === 0 && (
            <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>
              Keine Lieferanten gefunden. Importieren Sie eine Liste oder legen Sie Lieferanten manuell an.
            </td></tr>
          )}
          {suppliers.map((s) => (
            <tr key={s.id}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <td style={{ ...S.td, fontWeight: 600 }}>{s.name}</td>
              <td style={S.td}>{s.vendor_code || <span style={{ color: '#9ca3af' }}>–</span>}</td>
              <td style={S.td}>
                {s.iban
                  ? <span style={{ fontFamily: 'monospace', fontSize: 12, background: '#dcfce7', borderRadius: 4, padding: '1px 6px', color: '#166534' }}>{s.iban}</span>
                  : <span style={{ color: '#d97706', fontSize: 12 }}>fehlt</span>}
              </td>
              <td style={S.td}>{s.ust_id || <span style={{ color: '#9ca3af' }}>–</span>}</td>
              <td style={S.td}>{s.category || <span style={{ color: '#9ca3af' }}>–</span>}</td>
              <td style={S.td}>
                {s.aliases.length > 0
                  ? s.aliases.map((a) => <span key={a} style={S.alias}>{a}</span>)
                  : <span style={{ color: '#9ca3af', fontSize: 12 }}>–</span>}
              </td>
              <td style={S.td}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={S.btn('secondary')} onClick={() => setModal({ open: true, supplier: s })}>Bearbeiten</button>
                  <button style={S.btn('danger')} onClick={() => handleDelete(s)}>Löschen</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pagination && pagination.pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >‹</button>
          <span style={{ padding: '6px 14px', fontSize: 13, color: '#6b7280' }}>
            Seite {page} von {pagination.pages} · {pagination.total} Lieferanten
          </span>
          <button
            style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }}
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >›</button>
        </div>
      )}
    </div>
  )
}
