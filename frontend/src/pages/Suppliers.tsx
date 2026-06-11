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
import type { Supplier } from '../types'

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
  modalBox: { background: '#fff', borderRadius: 14, padding: 32, width: 500, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  modalTitle: { fontSize: 18, fontWeight: 700, color: '#1a3a5c', marginBottom: 20 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase' as const },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, marginBottom: 14 },
  aliasInput: { display: 'flex', gap: 8, marginBottom: 8 },
  aliasTag: { display: 'flex', alignItems: 'center', gap: 4, background: '#f3f4f6', borderRadius: 6, padding: '4px 10px', fontSize: 13 },
  tagList: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginBottom: 14 },
  info: { background: '#eff6ff', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', marginBottom: 16 },
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

interface ModalProps {
  supplier?: Supplier | null
  onClose: () => void
  onSave: (data: { name: string; aliases: string[]; category: string | null }) => Promise<void>
}

function SupplierModal({ supplier, onClose, onSave }: ModalProps) {
  const [name, setName] = useState(supplier?.name || '')
  const [category, setCategory] = useState(supplier?.category || '')
  const [aliases, setAliases] = useState<string[]>(supplier?.aliases || [])
  const [aliasInput, setAliasInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addAlias = () => {
    const trimmed = aliasInput.trim()
    if (trimmed && !aliases.includes(trimmed)) {
      setAliases([...aliases, trimmed])
    }
    setAliasInput('')
  }

  const removeAlias = (a: string) => setAliases(aliases.filter((x) => x !== a))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name ist erforderlich'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), aliases, category: category.trim() || null })
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
          <label style={S.label}>Name *</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Firmenname" required />

          <label style={S.label}>Kategorie</label>
          <input style={S.input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="z.B. Lebensmittel, Technik, Reinigung…" />

          <label style={S.label}>Aliase (alternative Schreibweisen)</label>
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

          {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
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

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, search],
    queryFn: () => getSuppliers({ page, limit: 25, search }),
  })

  const handleSave = async (id: string | undefined, formData: { name: string; aliases: string[]; category: string | null }) => {
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

  return (
    <div>
      {modal.open && (
        <SupplierModal
          supplier={modal.supplier}
          onClose={() => setModal({ open: false })}
          onSave={(fd) => handleSave(modal.supplier?.id, fd)}
        />
      )}

      <div style={S.info}>
        Lieferanten werden für den automatischen Absender-Abgleich (Fuzzy Matching) verwendet.
        Fügen Sie Aliase für alternative Firmenbezeichnungen hinzu, um die Erkennungsrate zu verbessern.
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

        <label style={S.btn('secondary')}>
          📥 CSV/Excel importieren
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
        </label>

        <button style={S.btn('secondary')} onClick={exportSuppliers}>📤 Excel exportieren</button>
      </div>

      {importStatus && <div style={{ background: '#dcfce7', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#166534' }}>✓ {importStatus}</div>}
      {importError && <div style={{ background: '#fee2e2', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#991b1b' }}>✗ {importError}</div>}

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Name</th>
            <th style={S.th}>Kategorie</th>
            <th style={S.th}>Aliase</th>
            <th style={S.th}>Erstellt</th>
            <th style={S.th}>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>Lade Lieferanten…</td></tr>}
          {!isLoading && suppliers.length === 0 && (
            <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>
              Keine Lieferanten gefunden. Importieren Sie eine Liste oder legen Sie manuell Lieferanten an.
            </td></tr>
          )}
          {suppliers.map((s) => (
            <tr key={s.id}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <td style={{ ...S.td, fontWeight: 600 }}>{s.name}</td>
              <td style={S.td}>{s.category || <span style={{ color: '#9ca3af' }}>–</span>}</td>
              <td style={S.td}>
                {s.aliases.length > 0
                  ? s.aliases.map((a) => <span key={a} style={S.alias}>{a}</span>)
                  : <span style={{ color: '#9ca3af', fontSize: 12 }}>Keine Aliase</span>
                }
              </td>
              <td style={S.td}>{new Date(s.created_at).toLocaleDateString('de-DE')}</td>
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
