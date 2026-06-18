import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { getReportSummary, exportReport, getProcessingLog } from '../api/settings'

const COLORS = { gruen: '#22c55e', gelb: '#eab308', rot: '#ef4444' }

const S = {
  topBar: { display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' as const },
  input: { padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  btn: (v: 'primary' | 'secondary' = 'secondary'): React.CSSProperties => ({
    padding: '9px 18px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500, border: 'none',
    background: v === 'primary' ? '#1a3a5c' : '#f3f4f6',
    color: v === 'primary' ? '#fff' : '#374151',
  }),
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 20 },
  card: { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  cardTitle: { fontSize: 14, fontWeight: 700, color: '#1a3a5c', marginBottom: 16 },
  statNum: (c?: string): React.CSSProperties => ({ fontSize: 32, fontWeight: 700, color: c || '#1a3a5c' }),
  statLabel: { fontSize: 13, color: '#6b7280', marginTop: 3 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { padding: '8px 12px', borderBottom: '2px solid #e5e7eb', textAlign: 'left' as const, color: '#6b7280', fontWeight: 600, background: '#f9fafb' },
  td: { padding: '8px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151' },
  logStatus: (s: string): React.CSSProperties => ({
    display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
    background: s === 'error' ? '#fee2e2' : s === 'success' ? '#dcfce7' : '#fef9c3',
    color: s === 'error' ? '#991b1b' : s === 'success' ? '#166534' : '#854d0e',
  }),
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

function today() { return new Date().toISOString().split('T')[0] }
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

export default function Reports() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [range, setRange] = useState<[string, string]>([daysAgo(30), today()])
  const [logPage, setLogPage] = useState(1)

  const { data: summary, isLoading } = useQuery({
    queryKey: ['report-summary', range[0], range[1]],
    queryFn: () => getReportSummary(range[0], range[1]),
  })

  const { data: logData } = useQuery({
    queryKey: ['processing-log', logPage],
    queryFn: () => getProcessingLog({ page: logPage, limit: 50 }),
    refetchInterval: 30_000,
  })

  function applyRange() {
    setRange([from, to])
    setLogPage(1)
  }

  function setPreset(days: number) {
    const f = daysAgo(days)
    const t = today()
    setFrom(f)
    setTo(t)
    setRange([f, t])
  }

  const overall = summary?.overall
  const byDay: any[] = summary?.by_day || []
  const topSenders: any[] = summary?.top_senders || []

  const pieData = overall
    ? [
        { name: 'Grün', value: overall.gruen, key: 'gruen' },
        { name: 'Gelb', value: overall.gelb, key: 'gelb' },
        { name: 'Rot', value: overall.rot, key: 'rot' },
      ].filter((d) => d.value > 0)
    : []

  const typePieData = overall
    ? [
        { name: 'Rechnung', value: overall.type_rechnung },
        { name: 'Mahnung', value: overall.type_mahnung },
        { name: 'Behördenbescheid', value: overall.type_behoerde },
        { name: 'Unleserlich', value: overall.type_unleserlich },
        { name: 'Sonstiges', value: overall.type_sonstiges },
      ].filter((d) => d.value > 0)
    : []

  const TYPE_COLORS = ['#3b82f6', '#f59e0b', '#8b5cf6', '#6b7280', '#ec4899']

  const logs = logData?.data || []

  return (
    <div>
      <div style={S.topBar}>
        <label style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>Von:</label>
        <input type="date" style={S.input} value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
        <label style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>Bis:</label>
        <input type="date" style={S.input} value={to} onChange={(e) => setTo(e.target.value)} min={from} max={today()} />
        <button style={S.btn('primary')} onClick={applyRange}>Anwenden</button>

        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { label: 'Heute', days: 0 },
            { label: '7 Tage', days: 7 },
            { label: '30 Tage', days: 30 },
            { label: '90 Tage', days: 90 },
          ].map(({ label, days }) => (
            <button key={label} style={S.btn()} onClick={() => setPreset(days)}>{label}</button>
          ))}
        </div>

        <button
          style={S.btn('primary')}
          onClick={() => exportReport(range[0], range[1])}
        >
          📥 Excel exportieren
        </button>
      </div>

      {isLoading && <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Lade Daten…</div>}

      {overall && (
        <>
          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            <div style={S.card}>
              <div style={S.statNum()}>{overall.total}</div>
              <div style={S.statLabel}>Gesamt Dokumente</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum('#22c55e')}>{overall.gruen}</div>
              <div style={S.statLabel}>Grün (auto)</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum('#eab308')}>{overall.gelb}</div>
              <div style={S.statLabel}>Gelb (manuell)</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum('#ef4444')}>{overall.rot}</div>
              <div style={S.statLabel}>Rot (Fehler)</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            <div style={S.card}>
              <div style={S.statNum()}>{overall.avg_confidence !== null ? `${overall.avg_confidence?.toFixed(0)}%` : '–'}</div>
              <div style={S.statLabel}>Ø Konfidenz</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum()}>{overall.forwarded}</div>
              <div style={S.statLabel}>An ABBYY gesendet</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum()}>{overall.corrected}</div>
              <div style={S.statLabel}>Korrekturen</div>
            </div>
            <div style={S.card}>
              <div style={S.statNum()}>{overall.errors}</div>
              <div style={S.statLabel}>Fehler</div>
            </div>
          </div>

          <div style={S.grid2}>
            {/* Daily bar chart */}
            <div style={S.card}>
              <div style={S.cardTitle}>Verarbeitungen pro Tag</div>
              {byDay.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={byDay} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(l) => `Tag: ${l}`} />
                    <Bar dataKey="gruen" name="Grün" fill="#22c55e" stackId="a" />
                    <Bar dataKey="gelb" name="Gelb" fill="#eab308" stackId="a" />
                    <Bar dataKey="rot" name="Rot" fill="#ef4444" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Keine Daten im Zeitraum</div>
              )}
            </div>

            {/* Pie chart */}
            <div style={S.card}>
              <div style={S.cardTitle}>Ampel-Verteilung</div>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={COLORS[entry.key as keyof typeof COLORS]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v} Dokumente`]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Keine Daten</div>
              )}
            </div>
          </div>

          <div style={S.grid2}>
            {/* Doc type distribution */}
            <div style={S.card}>
              <div style={S.cardTitle}>Dokumenttypen</div>
              {typePieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={typePieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                      {typePieData.map((_, i) => (
                        <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Keine Daten</div>
              )}
            </div>

            {/* Top senders */}
            <div style={S.card}>
              <div style={S.cardTitle}>Top Absender</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Absender</th>
                    <th style={S.th}>Anzahl</th>
                  </tr>
                </thead>
                <tbody>
                  {topSenders.length === 0 && (
                    <tr><td colSpan={2} style={{ ...S.td, textAlign: 'center', color: '#9ca3af' }}>Keine Daten</td></tr>
                  )}
                  {topSenders.map((s, i) => (
                    <tr key={i}>
                      <td style={S.td}>{s.sender || '–'}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Processing Log */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={S.cardTitle}>Verarbeitungsprotokoll</div>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>Aktualisiert alle 30s</span>
        </div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Zeit</th>
              <th style={S.th}>Dokument</th>
              <th style={S.th}>Schritt</th>
              <th style={S.th}>Status</th>
              <th style={S.th}>Meldung</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 24 }}>Keine Protokolleinträge</td></tr>
            )}
            {logs.map((log: any) => (
              <tr key={log.id}>
                <td style={S.td}>{new Date(log.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.original_name || log.document_id?.slice(0, 8) + '…'}
                </td>
                <td style={S.td}>{log.step}</td>
                <td style={S.td}><span style={S.logStatus(log.status)}>{log.status}</span></td>
                <td style={{ ...S.td, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.message || '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {logData?.pagination && logData.pagination.pages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
            <button style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }} disabled={logPage <= 1} onClick={() => setLogPage(logPage - 1)}>‹</button>
            <span style={{ padding: '5px 12px', fontSize: 13, color: '#6b7280' }}>Seite {logPage} von {logData.pagination.pages}</span>
            <button style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }} disabled={logPage >= logData.pagination.pages} onClick={() => setLogPage(logPage + 1)}>›</button>
          </div>
        )}
      </div>
    </div>
  )
}
