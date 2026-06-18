import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { getDocumentStats, getDocuments } from '../api/documents'

const PIE_COLORS = { gruen: '#22c55e', gelb: '#eab308', rot: '#ef4444' }

const S = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 },
  card: { background: '#fff', borderRadius: 10, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  statNum: { fontSize: 36, fontWeight: 700, color: '#1a3a5c' },
  statLabel: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  statSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 },
  chartCard: { background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  h2: { fontSize: 15, fontWeight: 600, color: '#1a3a5c', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontWeight: 600, fontSize: 12 },
  td: { padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151', verticalAlign: 'middle' as const },
  ampelDot: (color: string): React.CSSProperties => ({
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color === 'gruen' ? '#22c55e' : color === 'gelb' ? '#eab308' : '#ef4444',
    marginRight: 6,
  }),
  btn: {
    background: '#1a3a5c',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 22px',
    fontSize: 14,
    cursor: 'pointer',
    fontWeight: 500,
  },
  uploadBanner: {
    background: 'linear-gradient(135deg, #1a3a5c 0%, #2563eb 100%)',
    borderRadius: 10,
    padding: '20px 28px',
    color: '#fff',
    marginBottom: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

function StatCard({ num, label, sub, color }: { num: number | string; label: string; sub?: string; color?: string }) {
  return (
    <div style={S.card}>
      <div style={{ ...S.statNum, color: color || '#1a3a5c' }}>{num}</div>
      <div style={S.statLabel}>{label}</div>
      {sub && <div style={S.statSub}>{sub}</div>}
    </div>
  )
}

function AmpelLabel({ ampel }: { ampel: string }) {
  const labels: Record<string, string> = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' }
  return (
    <span>
      <span style={S.ampelDot(ampel)} />
      {labels[ampel] || ampel}
    </span>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => getDocumentStats(),
    refetchInterval: 30_000,
  })

  const { data: recentDocs } = useQuery({
    queryKey: ['recent-docs'],
    queryFn: () => getDocuments({ page: 1, limit: 10 }),
    refetchInterval: 30_000,
  })

  const today = stats?.today
  const overall = stats?.overall

  const pieData = today
    ? [
        { name: 'Grün', value: today.gruen, key: 'gruen' },
        { name: 'Gelb', value: today.gelb, key: 'gelb' },
        { name: 'Rot', value: today.rot, key: 'rot' },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div>
      <div style={S.uploadBanner}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Dokumente hochladen</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Rechnungen, Mahnungen und Bescheide zur automatischen Verarbeitung einreichen</div>
        </div>
        <button style={S.btn} onClick={() => navigate('/dokumente')}>
          + Dokument hochladen
        </button>
      </div>

      <div style={S.grid}>
        <StatCard num={today?.total ?? 0} label="Heute verarbeitet" sub="Dokumente heute" />
        <StatCard num={today?.gruen ?? 0} label="Automatisch verarbeitet" sub="Ampel grün" color="#22c55e" />
        <StatCard num={today?.gelb ?? 0} label="Manuelle Prüfung" sub="Ampel gelb" color="#eab308" />
        <StatCard num={today?.rot ?? 0} label="Fehler / Unleserlich" sub="Ampel rot" color="#ef4444" />
        <StatCard
          num={overall?.avg_confidence !== null && overall?.avg_confidence !== undefined ? `${overall.avg_confidence.toFixed(0)}%` : '–'}
          label="Ø Konfidenz"
          sub="Gesamtdurchschnitt"
        />
        <StatCard num={overall?.forwarded ?? 0} label="An ABBYY gesendet" sub="Gesamt weitergeleitet" />
      </div>

      <div style={S.row}>
        <div style={S.chartCard}>
          <div style={S.h2}>Heutige Ampel-Verteilung</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={PIE_COLORS[entry.key as keyof typeof PIE_COLORS]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v} Dokumente`]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 14 }}>
              Heute noch keine Dokumente verarbeitet
            </div>
          )}
        </div>

        <div style={S.chartCard}>
          <div style={S.h2}>Gesamtstatistik</div>
          <table style={S.table}>
            <tbody>
              {[
                { label: 'Gesamt Dokumente', value: overall?.total ?? 0 },
                { label: 'Grün (auto)', value: overall?.gruen ?? 0 },
                { label: 'Gelb (manuell)', value: overall?.gelb ?? 0 },
                { label: 'Rot (Fehler)', value: overall?.rot ?? 0 },
                { label: 'Verarbeitet', value: overall?.processed ?? 0 },
                { label: 'Ausstehend', value: overall?.pending ?? 0 },
                { label: 'Weitergeleitet', value: overall?.forwarded ?? 0 },
                { label: 'Korrekturen', value: overall?.corrected ?? 0 },
              ].map((row) => (
                <tr key={row.label}>
                  <td style={{ ...S.td, color: '#6b7280' }}>{row.label}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={S.chartCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={S.h2}>Zuletzt verarbeitete Dokumente</div>
          <button
            style={{ ...S.btn, padding: '6px 16px', fontSize: 13, background: '#f3f4f6', color: '#374151' }}
            onClick={() => navigate('/dokumente')}
          >
            Alle anzeigen →
          </button>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Dateiname</th>
              <th style={S.th}>Typ</th>
              <th style={S.th}>Absender</th>
              <th style={S.th}>Ampel</th>
              <th style={S.th}>Konfidenz</th>
              <th style={S.th}>Datum</th>
            </tr>
          </thead>
          <tbody>
            {recentDocs?.data.map((doc) => (
              <tr
                key={doc.id}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/prüfung/${doc.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <td style={S.td}>{doc.original_name}</td>
                <td style={S.td}>{doc.doc_type || '–'}</td>
                <td style={S.td}>{doc.sender || '–'}</td>
                <td style={S.td}><AmpelLabel ampel={doc.ampel} /></td>
                <td style={S.td}>{doc.confidence > 0 ? `${doc.confidence}%` : '–'}</td>
                <td style={S.td}>{new Date(doc.created_at).toLocaleString('de-DE')}</td>
              </tr>
            ))}
            {(!recentDocs?.data || recentDocs.data.length === 0) && (
              <tr>
                <td colSpan={6} style={{ ...S.td, textAlign: 'center', color: '#9ca3af', padding: 32 }}>
                  Noch keine Dokumente vorhanden
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
