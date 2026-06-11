import React, { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import { useNavigate } from 'react-router-dom'
import {
  getDocuments,
  uploadDocumentsBatch,
  deleteDocument,
  triggerAnalysis,
} from '../api/documents'
import type { Document, Ampel } from '../types'

const S = {
  topBar: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' as const, alignItems: 'center' },
  search: { flex: 1, minWidth: 220, padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' },
  select: { padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' },
  btn: (variant: 'primary' | 'secondary' | 'danger' = 'primary'): React.CSSProperties => ({
    padding: '9px 18px',
    borderRadius: 8,
    fontSize: 14,
    cursor: 'pointer',
    fontWeight: 500,
    border: 'none',
    background: variant === 'primary' ? '#1a3a5c' : variant === 'danger' ? '#ef4444' : '#f3f4f6',
    color: variant === 'primary' ? '#fff' : variant === 'danger' ? '#fff' : '#374151',
  }),
  dropzone: (isDragActive: boolean): React.CSSProperties => ({
    border: `2px dashed ${isDragActive ? '#2563eb' : '#d1d5db'}`,
    borderRadius: 12,
    padding: '32px 24px',
    textAlign: 'center',
    background: isDragActive ? '#eff6ff' : '#fafafa',
    cursor: 'pointer',
    marginBottom: 24,
    transition: 'all 0.2s',
  }),
  dropText: { fontSize: 15, color: '#6b7280', marginBottom: 6 },
  dropHint: { fontSize: 12, color: '#9ca3af' },
  progress: { background: '#e5e7eb', borderRadius: 99, height: 8, marginTop: 12, overflow: 'hidden' },
  progressBar: (pct: number): React.CSSProperties => ({
    width: `${pct}%`,
    height: '100%',
    background: '#2563eb',
    borderRadius: 99,
    transition: 'width 0.3s',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  th: { padding: '10px 14px', borderBottom: '2px solid #e5e7eb', textAlign: 'left' as const, color: '#6b7280', fontWeight: 600, fontSize: 12, background: '#f9fafb' },
  td: { padding: '10px 14px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'middle' as const },
  statusBadge: (s: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    background: s === 'processed' ? '#dcfce7' : s === 'pending' || s === 'processing' ? '#fef9c3' : s === 'forwarded' ? '#dbeafe' : '#fee2e2',
    color: s === 'processed' ? '#166534' : s === 'pending' || s === 'processing' ? '#854d0e' : s === 'forwarded' ? '#1e40af' : '#991b1b',
  }),
  ampelDot: (a: string): React.CSSProperties => ({
    display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 6,
    background: a === 'gruen' ? '#22c55e' : a === 'gelb' ? '#eab308' : '#ef4444',
  }),
  pagination: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, justifyContent: 'center' },
  pageBtn: (active: boolean): React.CSSProperties => ({
    padding: '6px 13px', borderRadius: 7, border: '1px solid #d1d5db', cursor: 'pointer',
    background: active ? '#1a3a5c' : '#fff', color: active ? '#fff' : '#374151', fontSize: 13,
  }),
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

const AMPEL_LABELS: Record<string, string> = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' }
const STATUS_LABELS: Record<string, string> = {
  pending: 'Ausstehend', processing: 'In Bearbeitung', processed: 'Verarbeitet',
  error: 'Fehler', forwarded: 'Weitergeleitet',
}

export default function Documents() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [ampelFilter, setAmpelFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents', page, statusFilter, ampelFilter, search],
    queryFn: () => getDocuments({ page, limit: 20, status: statusFilter, ampel: ampelFilter, search }),
    refetchInterval: 10_000,
  })

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    setUploadProgress(0)
    setUploadMessage(null)
    setUploadError(null)

    try {
      const result = await uploadDocumentsBatch(acceptedFiles, setUploadProgress)
      const ok = result.results.filter((r) => r.status === 'queued').length
      const fail = result.results.filter((r) => r.status === 'error').length
      setUploadMessage(`${ok} Dokument(e) hochgeladen${fail > 0 ? `, ${fail} fehlgeschlagen` : ''}.`)
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    } catch (err: any) {
      setUploadError(err.message)
    } finally {
      setUploadProgress(null)
    }
  }, [qc])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/tiff': ['.tiff', '.tif'],
      'image/bmp': ['.bmp'],
    },
    multiple: true,
  })

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Dokument "${name}" wirklich löschen?`)) return
    await deleteDocument(id)
    qc.invalidateQueries({ queryKey: ['documents'] })
  }

  const handleRetrigger = async (id: string) => {
    await triggerAnalysis(id)
    qc.invalidateQueries({ queryKey: ['documents'] })
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const docs = data?.data || []
  const pagination = data?.pagination

  return (
    <div>
      <div {...getRootProps()} style={S.dropzone(isDragActive)}>
        <input {...getInputProps()} />
        <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
        <div style={S.dropText}>
          {isDragActive ? 'Dateien hier ablegen…' : 'Dateien hierher ziehen oder klicken um hochzuladen'}
        </div>
        <div style={S.dropHint}>PDF, JPG, PNG, TIFF, BMP · Mehrfachauswahl möglich · Max. 50 MB je Datei</div>
        {uploadProgress !== null && (
          <div style={S.progress}>
            <div style={S.progressBar(uploadProgress)} />
          </div>
        )}
        {uploadMessage && <div style={{ marginTop: 10, color: '#16a34a', fontSize: 13 }}>✓ {uploadMessage}</div>}
        {uploadError && <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>✗ {uploadError}</div>}
      </div>

      <div style={S.topBar}>
        <input
          style={S.search}
          placeholder="Suche nach Dateiname oder Absender…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
        />
        <button style={S.btn('secondary')} onClick={() => { setSearch(searchInput); setPage(1) }}>Suchen</button>

        <select style={S.select} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="all">Alle Status</option>
          <option value="pending">Ausstehend</option>
          <option value="processing">In Bearbeitung</option>
          <option value="processed">Verarbeitet</option>
          <option value="error">Fehler</option>
          <option value="forwarded">Weitergeleitet</option>
        </select>

        <select style={S.select} value={ampelFilter} onChange={(e) => { setAmpelFilter(e.target.value); setPage(1) }}>
          <option value="all">Alle Ampeln</option>
          <option value="gruen">Grün</option>
          <option value="gelb">Gelb</option>
          <option value="rot">Rot</option>
        </select>

        {(search || statusFilter !== 'all' || ampelFilter !== 'all') && (
          <button style={S.btn('secondary')} onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setAmpelFilter('all'); setPage(1) }}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}><input type="checkbox" onChange={(e) => {
              if (e.target.checked) setSelectedIds(new Set(docs.map((d) => d.id)))
              else setSelectedIds(new Set())
            }} /></th>
            <th style={S.th}>Dateiname</th>
            <th style={S.th}>Typ</th>
            <th style={S.th}>Absender</th>
            <th style={S.th}>Ampel</th>
            <th style={S.th}>Konfidenz</th>
            <th style={S.th}>Status</th>
            <th style={S.th}>Datum</th>
            <th style={S.th}>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>Lade Dokumente…</td></tr>
          )}
          {!isLoading && docs.length === 0 && (
            <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>Keine Dokumente gefunden</td></tr>
          )}
          {docs.map((doc) => (
            <tr key={doc.id}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
            >
              <td style={S.td} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelect(doc.id)} />
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                <span title={doc.original_name} style={{ maxWidth: 220, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.original_name}
                </span>
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>{doc.doc_type || '–'}</td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                {doc.sender || '–'}
                {doc.sender_matched ? <span style={{ marginLeft: 4, color: '#16a34a', fontSize: 11 }}>✓</span> : null}
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                <span style={S.ampelDot(doc.ampel)} />
                {AMPEL_LABELS[doc.ampel] || doc.ampel}
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                {doc.confidence > 0 ? `${doc.confidence}%` : '–'}
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                <span style={S.statusBadge(doc.status)}>
                  {STATUS_LABELS[doc.status] || doc.status}
                </span>
              </td>
              <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                {new Date(doc.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td style={S.td} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    title="Prüfen"
                    style={{ ...S.btn('secondary'), padding: '4px 10px', fontSize: 12 }}
                    onClick={() => navigate(`/prüfung/${doc.id}`)}
                  >🔍</button>
                  <button
                    title="Neu analysieren"
                    style={{ ...S.btn('secondary'), padding: '4px 10px', fontSize: 12 }}
                    onClick={() => handleRetrigger(doc.id)}
                  >↺</button>
                  <button
                    title="Löschen"
                    style={{ ...S.btn('danger'), padding: '4px 10px', fontSize: 12 }}
                    onClick={() => handleDelete(doc.id, doc.original_name)}
                  >✕</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pagination && pagination.pages > 1 && (
        <div style={S.pagination}>
          <button
            style={S.pageBtn(false)}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >‹ Zurück</button>

          {Array.from({ length: Math.min(pagination.pages, 7) }, (_, i) => {
            const p = i + 1
            return (
              <button key={p} style={S.pageBtn(p === page)} onClick={() => setPage(p)}>
                {p}
              </button>
            )
          })}

          <button
            style={S.pageBtn(false)}
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >Weiter ›</button>

          <span style={{ fontSize: 13, color: '#6b7280', marginLeft: 8 }}>
            {pagination.total} Dokumente gesamt
          </span>
        </div>
      )}
    </div>
  )
}
