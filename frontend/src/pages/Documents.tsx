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
import type { Document } from '../types'

const S = {
  topBar: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' as const, alignItems: 'center' },
  search: { flex: 1, minWidth: 220, padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' },
  select: { padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' },
  btn: (variant: 'primary' | 'secondary' | 'danger' = 'primary', disabled = false): React.CSSProperties => ({
    padding: '9px 18px',
    borderRadius: 8,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
    border: 'none',
    background: disabled ? '#d1d5db' : variant === 'primary' ? '#1a3a5c' : variant === 'danger' ? '#ef4444' : '#f3f4f6',
    color: disabled ? '#9ca3af' : variant === 'primary' ? '#fff' : variant === 'danger' ? '#fff' : '#374151',
    transition: 'background 0.15s, transform 0.1s',
    opacity: disabled ? 0.7 : 1,
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

function Spinner() {
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12,
      border: '2px solid rgba(255,255,255,0.4)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      marginRight: 5,
      verticalAlign: 'middle',
    }} />
  )
}

function Toast({ msg, ok, onDone }: { msg: string; ok: boolean; onDone: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 3000)
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
  const [retriggering, setRetriggering] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['documents', page, statusFilter, ampelFilter, search],
    queryFn: () => getDocuments({ page, limit: 20, status: statusFilter, ampel: ampelFilter, search }),
    refetchInterval: 5_000,
  })

  const docs = data?.data || []
  const hasProcessing = docs.some((d) => d.status === 'processing' || d.status === 'pending')

  // Poll faster when documents are actively processing
  useQuery({
    queryKey: ['documents-processing-poll'],
    queryFn: () => getDocuments({ page, limit: 20, status: statusFilter, ampel: ampelFilter, search }),
    refetchInterval: hasProcessing ? 2_000 : false,
    enabled: hasProcessing,
  })

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    setUploadProgress(0)
    setUploadMessage(null)
    setUploadError(null)

    try {
      const result = await uploadDocumentsBatch(acceptedFiles, setUploadProgress)
      const ok = result.results.filter((r) => r.status === 'queued').length
      const fail = result.results.filter((r) => r.status === 'error').length
      setUploadMessage(`${ok} Dokument(e) hochgeladen und werden analysiert…${fail > 0 ? ` ${fail} fehlgeschlagen.` : ''}`)
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
    setDeleting((prev) => new Set(prev).add(id))
    try {
      await deleteDocument(id)
      qc.invalidateQueries({ queryKey: ['documents'] })
      showToast('Dokument gelöscht')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setDeleting((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const handleRetrigger = async (id: string) => {
    setRetriggering((prev) => new Set(prev).add(id))
    try {
      await triggerAnalysis(id)
      qc.invalidateQueries({ queryKey: ['documents'] })
      showToast('Analyse neu gestartet – bitte warten…')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setRetriggering((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const pagination = data?.pagination

  return (
    <div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .doc-row-processing { animation: pulse 2s ease-in-out infinite; background: #fffbeb !important; }
        .action-btn:hover:not(:disabled) { filter: brightness(0.9); transform: scale(1.05); }
        .action-btn:active:not(:disabled) { transform: scale(0.96); }
      `}</style>

      {toast && <Toast msg={toast.msg} ok={toast.ok} onDone={() => setToast(null)} />}

      <div {...getRootProps()} style={S.dropzone(isDragActive)}>
        <input {...getInputProps()} />
        <div style={{ fontSize: 36, marginBottom: 8 }}>{uploadProgress !== null ? '⏳' : '📄'}</div>
        <div style={S.dropText}>
          {uploadProgress !== null
            ? `Hochladen… ${uploadProgress}%`
            : isDragActive
            ? 'Dateien hier ablegen…'
            : 'Dateien hierher ziehen oder klicken um hochzuladen'}
        </div>
        <div style={S.dropHint}>PDF, JPG, PNG, TIFF, BMP · Mehrfachauswahl möglich · Max. 50 MB je Datei</div>
        {uploadProgress !== null && (
          <div style={S.progress}>
            <div style={S.progressBar(uploadProgress)} />
          </div>
        )}
        {uploadMessage && <div style={{ marginTop: 10, color: '#16a34a', fontSize: 13, fontWeight: 600 }}>✓ {uploadMessage}</div>}
        {uploadError && <div style={{ marginTop: 10, color: '#dc2626', fontSize: 13 }}>✗ {uploadError}</div>}
      </div>

      {hasProcessing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#92400e',
        }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14,
            border: '2px solid #f59e0b', borderTopColor: '#92400e',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0,
          }} />
          <strong>KI-Analyse läuft</strong> – Dokumente werden gerade verarbeitet. Die Seite aktualisiert sich automatisch.
        </div>
      )}

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
            <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>
              <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid #d1d5db', borderTopColor: '#6b7280', borderRadius: '50%', animation: 'spin 0.8s linear infinite', verticalAlign: 'middle', marginRight: 8 }} />
              Lade Dokumente…
            </td></tr>
          )}
          {!isLoading && docs.length === 0 && (
            <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>Keine Dokumente gefunden</td></tr>
          )}
          {docs.map((doc) => {
            const isProcessing = doc.status === 'processing' || doc.status === 'pending'
            const isRetriggering = retriggering.has(doc.id)
            const isDeleting = deleting.has(doc.id)
            return (
              <tr
                key={doc.id}
                className={isProcessing ? 'doc-row-processing' : ''}
                style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { if (!isProcessing) e.currentTarget.style.background = '#f9fafb' }}
                onMouseLeave={(e) => { if (!isProcessing) e.currentTarget.style.background = '' }}
              >
                <td style={S.td} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelect(doc.id)} />
                </td>
                <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isProcessing && (
                      <span style={{
                        display: 'inline-block', width: 10, height: 10, flexShrink: 0,
                        border: '2px solid #f59e0b', borderTopColor: '#92400e',
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                      }} title="Wird analysiert…" />
                    )}
                    <span title={doc.original_name} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.original_name}
                    </span>
                  </div>
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
                    {isProcessing && <span style={{ display: 'inline-block', width: 7, height: 7, border: '1.5px solid #92400e', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 4, verticalAlign: 'middle' }} />}
                    {STATUS_LABELS[doc.status] || doc.status}
                  </span>
                </td>
                <td style={S.td} onClick={() => navigate(`/prüfung/${doc.id}`)}>
                  {new Date(doc.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td style={S.td} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="action-btn"
                      title="Prüfen"
                      style={{ ...S.btn('secondary'), padding: '4px 10px', fontSize: 12, transition: 'all 0.1s' }}
                      onClick={() => navigate(`/prüfung/${doc.id}`)}
                    >🔍</button>
                    <button
                      className="action-btn"
                      title={isRetriggering ? 'Analyse läuft…' : 'Neu analysieren'}
                      disabled={isRetriggering || isProcessing}
                      style={{ ...S.btn('secondary', isRetriggering || isProcessing), padding: '4px 10px', fontSize: 12, transition: 'all 0.1s', minWidth: 32 }}
                      onClick={() => handleRetrigger(doc.id)}
                    >
                      {isRetriggering
                        ? <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #d1d5db', borderTopColor: '#374151', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        : '↺'}
                    </button>
                    <button
                      className="action-btn"
                      title={isDeleting ? 'Wird gelöscht…' : 'Löschen'}
                      disabled={isDeleting}
                      style={{ ...S.btn('danger', isDeleting), padding: '4px 10px', fontSize: 12, transition: 'all 0.1s' }}
                      onClick={() => handleDelete(doc.id, doc.original_name)}
                    >
                      {isDeleting
                        ? <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        : '✕'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
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
