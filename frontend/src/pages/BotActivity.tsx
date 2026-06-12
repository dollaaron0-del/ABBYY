import React, { useEffect, useState } from 'react'

const API = 'http://127.0.0.1:3001/api'

interface Correction {
  document_name: string
  field_name: string
  bot_value: string | null
  human_value: string
  created_at: string
}

interface CorrectionStat {
  field_name: string
  count: number
  examples: string
}

interface Activity {
  step: string
  status: string
  message: string
  created_at: string
}

interface Totals {
  total_corrections: number
  total_documents: number
  total_fields: number
}

interface History {
  recent_activity: Activity[]
  correction_stats: CorrectionStat[]
  recent_corrections: Correction[]
  totals: Totals
}

const FIELD_LABELS: Record<string, string> = {
  absender: 'Lieferant',
  rechnungsnummer: 'Rechnungs-Nr.',
  rechnungsdatum: 'Datum',
  faelligkeitsdatum: 'Fälligkeitsdatum',
  betrag_brutto: 'Brutto',
  betrag_netto: 'Netto',
  steuerbetrag: 'Steuer',
  steuersatz: 'Steuersatz',
  waehrung: 'Währung',
  iban: 'IBAN',
  bic: 'BIC',
}

const s: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto' },
  section: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    marginBottom: 24,
    overflow: 'hidden',
  },
  sectionHead: {
    padding: '14px 20px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
    fontWeight: 600,
    fontSize: 14,
    color: '#1a3a5c',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  sectionBody: { padding: 20 },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: '20px 24px',
    textAlign: 'center',
  },
  statNum: { fontSize: 36, fontWeight: 700, color: '#1a3a5c' },
  statLabel: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    padding: '10px 12px',
    textAlign: 'left' as const,
    borderBottom: '2px solid #e5e7eb',
    color: '#6b7280',
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase' as const,
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'top' as const,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
  },
  empty: { padding: '32px 20px', textAlign: 'center' as const, color: '#9ca3af' },
  dot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 6,
  },
  stepLabel: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    background: '#f3f4f6',
    color: '#374151',
    fontFamily: 'monospace',
  },
  bar: {
    height: 8,
    borderRadius: 4,
    background: '#1a3a5c',
    display: 'inline-block',
    minWidth: 4,
  },
}

function statusColor(status: string) {
  if (status === 'success') return '#16a34a'
  if (status === 'error') return '#dc2626'
  if (status === 'info') return '#2563eb'
  return '#6b7280'
}

function fmtDate(dt: string) {
  try {
    return new Date(dt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return dt }
}

export default function BotActivity() {
  const [history, setHistory] = useState<History | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    try {
      const r = await fetch(`${API}/abbyy/bot/history?limit=100`)
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setHistory(await r.json())
      setError('')
    } catch (e: any) {
      setError('Verlauf konnte nicht geladen werden: ' + e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // Auto-refresh every 15s
  useEffect(() => {
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    load()
  }

  const totals = history?.totals
  const maxCount = Math.max(...(history?.correction_stats.map(s => s.count) || [1]), 1)

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a3a5c', margin: 0 }}>
            🤖 Bot-Aktivität
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
            Was der KI-Bot in ABBYY automatisch ausgefüllt und korrigiert hat
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #e5e7eb',
            background: '#fff', cursor: 'pointer', fontSize: 13, color: '#374151',
          }}
        >
          {refreshing ? '⟳ Lädt...' : '⟳ Aktualisieren'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16, marginBottom: 20, color: '#dc2626', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div style={s.empty}>Lade Daten...</div>
      ) : (
        <>
          {/* Stats */}
          <div style={s.statGrid}>
            <div style={s.statCard}>
              <div style={s.statNum}>{totals?.total_documents ?? 0}</div>
              <div style={s.statLabel}>Dokumente verarbeitet</div>
            </div>
            <div style={s.statCard}>
              <div style={{ ...s.statNum, color: totals?.total_corrections ? '#d97706' : '#1a3a5c' }}>
                {totals?.total_corrections ?? 0}
              </div>
              <div style={s.statLabel}>Bot-Felder vom Menschen korrigiert</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statNum}>{totals?.total_fields ?? 0}</div>
              <div style={s.statLabel}>Verschiedene Felder korrigiert</div>
            </div>
          </div>

          {/* Correction frequency chart */}
          {history && history.correction_stats.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionHead}>📊 Häufig korrigierte Felder</div>
              <div style={{ ...s.sectionBody }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Feld</th>
                      <th style={s.th}>Korrekturen</th>
                      <th style={s.th}>Häufigkeit</th>
                      <th style={s.th}>Beispiel-Werte (menschlich)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.correction_stats.map((stat) => (
                      <tr key={stat.field_name}>
                        <td style={s.td}>
                          <span style={s.stepLabel}>{FIELD_LABELS[stat.field_name] || stat.field_name}</span>
                        </td>
                        <td style={{ ...s.td, fontWeight: 600 }}>{stat.count}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ ...s.bar, width: Math.round((stat.count / maxCount) * 160) }} />
                            <span style={{ color: '#6b7280', fontSize: 12 }}>
                              {Math.round((stat.count / (totals?.total_corrections || 1)) * 100)}%
                            </span>
                          </div>
                        </td>
                        <td style={{ ...s.td, color: '#6b7280', fontSize: 12 }}>
                          {(stat.examples || '').split(',').slice(0, 3).join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent corrections */}
          <div style={s.section}>
            <div style={s.sectionHead}>✏️ Letzte Korrekturen durch Sachbearbeiter</div>
            {history && history.recent_corrections.length === 0 ? (
              <div style={s.empty}>
                Noch keine Korrekturen aufgezeichnet.<br />
                Das bedeutet: der Bot hat alles richtig ausgefüllt, oder der Bot war noch nicht aktiv.
              </div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Dokument</th>
                    <th style={s.th}>Feld</th>
                    <th style={s.th}>Bot hatte</th>
                    <th style={s.th}>Mensch korrigierte zu</th>
                    <th style={s.th}>Zeit</th>
                  </tr>
                </thead>
                <tbody>
                  {(history?.recent_corrections || []).map((c, i) => (
                    <tr key={i}>
                      <td style={{ ...s.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.document_name || '–'}
                      </td>
                      <td style={s.td}>
                        <span style={s.stepLabel}>{FIELD_LABELS[c.field_name] || c.field_name}</span>
                      </td>
                      <td style={{ ...s.td, color: c.bot_value ? '#dc2626' : '#9ca3af', textDecoration: c.bot_value ? 'line-through' : 'none' }}>
                        {c.bot_value || <em>leer</em>}
                      </td>
                      <td style={{ ...s.td, color: '#16a34a', fontWeight: 500 }}>{c.human_value}</td>
                      <td style={{ ...s.td, color: '#9ca3af', whiteSpace: 'nowrap' }}>{fmtDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent bot activity log */}
          <div style={s.section}>
            <div style={s.sectionHead}>📋 Bot-Aktivitätsprotokoll</div>
            {history && history.recent_activity.length === 0 ? (
              <div style={s.empty}>
                Noch kein Bot-Aktivitätsprotokoll vorhanden.<br />
                Aktivität wird gespeichert sobald der Bot das erste Mal ein Dokument verarbeitet.
              </div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Aktion</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Details</th>
                    <th style={s.th}>Zeit</th>
                  </tr>
                </thead>
                <tbody>
                  {(history?.recent_activity || []).map((a, i) => (
                    <tr key={i}>
                      <td style={s.td}>
                        <span style={s.stepLabel}>{a.step.replace('abbyy_bot_', '')}</span>
                      </td>
                      <td style={s.td}>
                        <span>
                          <span style={{ ...s.dot, background: statusColor(a.status) }} />
                          {a.status}
                        </span>
                      </td>
                      <td style={{ ...s.td, color: '#374151', maxWidth: 400 }}>{a.message}</td>
                      <td style={{ ...s.td, color: '#9ca3af', whiteSpace: 'nowrap' }}>{fmtDate(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
