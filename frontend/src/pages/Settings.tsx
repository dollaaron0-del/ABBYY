import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings, updateSettings, testAbbyyConnection, getOllamaModels, getOllamaHealth } from '../api/settings'
import apiClient from '../api/client'
import type { Settings as SettingsType, OllamaModel } from '../types'

const S = {
  section: { background: '#fff', borderRadius: 10, padding: 28, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#1a3a5c', marginBottom: 6 },
  sectionSub: { fontSize: 13, color: '#6b7280', marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  group: { marginBottom: 18 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 5, textTransform: 'uppercase' as const },
  input: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 },
  select: { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff' },
  btn: (v: 'primary' | 'secondary' | 'danger' = 'primary'): React.CSSProperties => ({
    padding: '9px 22px', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600, border: 'none',
    background: v === 'primary' ? '#1a3a5c' : v === 'danger' ? '#ef4444' : '#f3f4f6',
    color: v === 'secondary' ? '#374151' : '#fff',
  }),
  warning: { background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 10, padding: '14px 18px', marginBottom: 16 },
  warningTitle: { fontWeight: 700, color: '#991b1b', fontSize: 15, marginBottom: 4 },
  warningText: { fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 },
  toggle: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  toggleSwitch: (on: boolean): React.CSSProperties => ({
    width: 44, height: 24, borderRadius: 99, background: on ? '#1a3a5c' : '#d1d5db',
    cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
  }),
  toggleKnob: (on: boolean): React.CSSProperties => ({
    position: 'absolute', width: 18, height: 18, borderRadius: '50%', background: '#fff',
    top: 3, left: on ? 23 : 3, transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  }),
  statusDot: (ok: boolean | null): React.CSSProperties => ({
    width: 10, height: 10, borderRadius: '50%', display: 'inline-block', marginRight: 6,
    background: ok === null ? '#d1d5db' : ok ? '#22c55e' : '#ef4444',
  }),
  slider: { width: '100%', marginTop: 4 },
  toast: (ok: boolean): React.CSSProperties => ({
    position: 'fixed', top: 24, right: 24, zIndex: 1000, padding: '12px 24px', borderRadius: 10,
    fontWeight: 600, fontSize: 14, background: ok ? '#16a34a' : '#dc2626', color: '#fff',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  }),
  divider: { borderTop: '1px solid #f3f4f6', margin: '20px 0' },
} satisfies Record<string, React.CSSProperties | ((...args: any[]) => React.CSSProperties)>;

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={S.toggleSwitch(value)} onClick={() => onChange(!value)}>
      <div style={S.toggleKnob(value)} />
    </div>
  )
}

export default function SettingsPage() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  const [form, setForm] = useState<Partial<SettingsType>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [abbyyStatus, setAbbyyStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingAbbyy, setTestingAbbyy] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm(settings)
      // Load Ollama models
      getOllamaModels().then(setOllamaModels).catch(() => setOllamaModels([]))
      getOllamaHealth()
        .then((h) => setOllamaStatus({ ok: h.status === 'ok', msg: h.status === 'ok' ? `Verbunden (${h.models_count} Modelle)` : h.error || 'Nicht erreichbar' }))
        .catch(() => setOllamaStatus({ ok: false, msg: 'Nicht erreichbar' }))
    }
  }, [settings])

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateSettings(form)
      qc.invalidateQueries({ queryKey: ['settings'] })
      showToast('Einstellungen gespeichert')
    } catch (err: any) {
      showToast(err.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function testAbbyy() {
    setTestingAbbyy(true)
    setAbbyyStatus(null)
    try {
      const r = await testAbbyyConnection()
      setAbbyyStatus({ ok: r.success, msg: r.message })
    } catch (err: any) {
      setAbbyyStatus({ ok: false, msg: err.message })
    } finally {
      setTestingAbbyy(false)
    }
  }

  async function syncSuppliers() {
    setSyncing(true)
    setSyncStatus(null)
    try {
      const res = await apiClient.post('/abbyy/sync-suppliers', {})
      const d = res.data
      setSyncStatus({ ok: true, msg: `${d.imported} neu, ${d.updated} aktualisiert (${d.total} gesamt). Quelle: ${d.source}` })
      showToast(`Lieferanten synchronisiert: ${d.imported + d.updated} Einträge`)
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message
      setSyncStatus({ ok: false, msg })
    } finally {
      setSyncing(false)
    }
  }

  async function refreshModels() {
    try {
      const models = await getOllamaModels()
      setOllamaModels(models)
      showToast(`${models.length} Modelle geladen`)
    } catch (err: any) {
      showToast(err.message, false)
    }
  }

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Lade Einstellungen…</div>

  const threshold = parseInt(form.confidence_threshold || '75', 10)
  const demoMode = form.demo_mode === 'true'
  const claudeEnabled = form.claude_api_enabled === 'true'
  const abbyyEnabled = form.abbyy_enabled === 'true'
  const autoForward = form.auto_forward_green === 'true'

  return (
    <form onSubmit={handleSave}>
      {toast && <div style={S.toast(toast.ok)}>{toast.ok ? '✓' : '✗'} {toast.msg}</div>}

      {/* Demo-Modus */}
      <div style={{ ...S.section, borderLeft: demoMode ? '4px solid #2563eb' : '4px solid #e5e7eb' }}>
        <div style={S.sectionTitle}>🎯 Demo-Modus</div>
        <div style={S.sectionSub}>
          Im Demo-Modus werden Rechnungsfelder regelbasiert (Regex) ohne Ollama extrahiert.
          Ideal zum Testen ohne laufendes KI-Modell. Die extrahierten Felder entsprechen dem,
          was später an ABBYY FlexiCapture übergeben wird.
        </div>

        <div style={S.toggle}>
          <Toggle value={demoMode} onChange={(v) => setField('demo_mode', v ? 'true' : 'false')} />
          <span style={{ fontSize: 14, fontWeight: 600, color: demoMode ? '#1d4ed8' : '#374151' }}>
            Demo-Modus {demoMode ? '(AKTIV – Regelbasierte Extraktion)' : '(Deaktiviert)'}
          </span>
        </div>

        {demoMode && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
            <strong>Aktiv:</strong> Alle neuen Dokumente werden ohne Ollama verarbeitet.
            OCR läuft normal. Die Felder (Rechnungsnr., Betrag, IBAN etc.) werden per Muster erkannt
            und in der Prüfansicht unter „ABBYY FlexiCapture – Extrahierte Felder" angezeigt.
          </div>
        )}
      </div>

      {/* KI Einstellungen */}
      <div style={S.section}>
        <div style={S.sectionTitle}>🤖 KI-Einstellungen (Ollama)</div>
        <div style={S.sectionSub}>
          Konfiguration der lokalen KI-Analyse. Alle Verarbeitungen erfolgen vollständig on-premise.
          {ollamaStatus && (
            <span style={{ marginLeft: 12 }}>
              <span style={S.statusDot(ollamaStatus.ok)} />
              <span style={{ fontSize: 13 }}>{ollamaStatus.msg}</span>
            </span>
          )}
        </div>

        <div style={S.grid}>
          <div style={S.group}>
            <label style={S.label}>Ollama Server URL</label>
            <input
              style={S.input}
              value={form.ollama_host || ''}
              onChange={(e) => setField('ollama_host', e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>

          <div style={S.group}>
            <label style={S.label}>
              Ollama Modell
              <button type="button" style={{ marginLeft: 10, fontSize: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer' }} onClick={refreshModels}>
                ↺ Aktualisieren
              </button>
            </label>
            {ollamaModels.length > 0 ? (
              <select
                style={S.select}
                value={form.ollama_model || ''}
                onChange={(e) => setField('ollama_model', e.target.value)}
              >
                {ollamaModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '?'})
                  </option>
                ))}
              </select>
            ) : (
              <input
                style={S.input}
                value={form.ollama_model || ''}
                onChange={(e) => setField('ollama_model', e.target.value)}
                placeholder="llama3.2-vision"
              />
            )}
          </div>
        </div>

        <div style={S.group}>
          <label style={S.label}>
            Konfidenz-Schwellenwert: <strong>{threshold}%</strong>
          </label>
          <input
            type="range"
            style={S.slider}
            min={0}
            max={100}
            step={5}
            value={threshold}
            onChange={(e) => setField('confidence_threshold', e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
            <span>0% (Alles grün)</span>
            <span style={{ color: '#6b7280' }}>Unter {threshold}% → gelb</span>
            <span>100% (Alles manuell)</span>
          </div>
        </div>

        <div style={S.grid}>
          <div style={S.group}>
            <label style={S.label}>OCR-Sprache</label>
            <select style={S.select} value={form.ocr_language || 'deu+eng'} onChange={(e) => setField('ocr_language', e.target.value)}>
              <option value="deu">Deutsch</option>
              <option value="eng">Englisch</option>
              <option value="deu+eng">Deutsch + Englisch</option>
            </select>
          </div>

          <div style={S.group}>
            <label style={S.label}>Max. Dateigröße (MB)</label>
            <input
              type="number"
              style={S.input}
              value={form.max_file_size_mb || '50'}
              onChange={(e) => setField('max_file_size_mb', e.target.value)}
              min={1}
              max={500}
            />
          </div>
        </div>
      </div>

      {/* ABBYY Integration */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📋 ABBYY FlexiCapture Integration</div>
        <div style={S.sectionSub}>Weiterleitung verarbeiteter Dokumente an ABBYY FlexiCapture.</div>

        <div style={S.toggle}>
          <Toggle value={abbyyEnabled} onChange={(v) => setField('abbyy_enabled', v ? 'true' : 'false')} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>ABBYY-Integration aktivieren</span>
        </div>

        {abbyyEnabled && (
          <>
            <div style={S.grid}>
              <div style={S.group}>
                <label style={S.label}>ABBYY API Endpunkt</label>
                <input
                  style={S.input}
                  value={form.abbyy_endpoint || ''}
                  onChange={(e) => setField('abbyy_endpoint', e.target.value)}
                  placeholder="https://abbyy-server/api/v1"
                />
              </div>

              <div style={S.group}>
                <label style={S.label}>Auth Token</label>
                <input
                  type="password"
                  style={S.input}
                  value={form.abbyy_auth_token || ''}
                  onChange={(e) => setField('abbyy_auth_token', e.target.value)}
                  placeholder="Bearer Token oder API Key"
                />
              </div>
            </div>

            <div style={S.toggle}>
              <Toggle value={autoForward} onChange={(v) => setField('auto_forward_green', v ? 'true' : 'false')} />
              <span style={{ fontSize: 14 }}>Grüne Dokumente automatisch weiterleiten</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <button
                type="button"
                style={S.btn('secondary')}
                onClick={testAbbyy}
                disabled={testingAbbyy}
              >
                {testingAbbyy ? 'Teste…' : '🔌 Verbindung testen'}
              </button>
              {abbyyStatus && (
                <span>
                  <span style={S.statusDot(abbyyStatus.ok)} />
                  <span style={{ fontSize: 13 }}>{abbyyStatus.msg}</span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Lieferanten-Sync */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Lieferanten-Sync</div>
        <div style={S.sectionSub}>
          Importiert Lieferanten automatisch aus ABBYY / ERP / Buchhaltungssystem.
          Unterstützt HTTP-REST-Endpunkt, CSV-Datei oder Excel auf Netzlaufwerk (z.B. <code>\\\\Server\Freigabe\lieferanten.xlsx</code>).
          Das System versucht auch automatisch bekannte ABBYY-API-Pfade.
        </div>

        <div style={S.group}>
          <label style={S.label}>Sync-URL oder Dateipfad</label>
          <input
            style={S.input}
            value={form.abbyy_vendor_sync_url || ''}
            onChange={(e) => setField('abbyy_vendor_sync_url', e.target.value)}
            placeholder="http://erp-server/api/vendors  ODER  \\Server\Freigabe\lieferanten.xlsx"
          />
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            CSV-Spalten (Semikolon): Name; IBAN; Lieferantennummer; USt_ID; Kategorie
          </div>
        </div>

        <div style={{ ...S.grid, gridTemplateColumns: '1fr 2fr' }}>
          <div style={S.group}>
            <label style={S.label}>Auto-Sync (Stunden, 0 = aus)</label>
            <input
              type="number"
              style={S.input}
              value={form.abbyy_vendor_sync_interval_hours || '0'}
              onChange={(e) => setField('abbyy_vendor_sync_interval_hours', e.target.value)}
              min={0}
              step={1}
              placeholder="0"
            />
          </div>
          <div style={S.group}>
            <label style={S.label}>Letzter Sync</label>
            <div style={{ padding: '9px 12px', fontSize: 13, color: '#6b7280' }}>
              {form.abbyy_vendor_sync_last
                ? new Date(form.abbyy_vendor_sync_last).toLocaleString('de-DE')
                : 'Noch nie synchronisiert'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            type="button"
            style={S.btn('secondary')}
            onClick={syncSuppliers}
            disabled={syncing}
          >
            {syncing ? 'Synchronisiere…' : 'Jetzt synchronisieren'}
          </button>
          {syncStatus && (
            <span style={{ fontSize: 13, color: syncStatus.ok ? '#16a34a' : '#dc2626' }}>
              {syncStatus.ok ? '✓ ' : '✗ '}{syncStatus.msg}
            </span>
          )}
        </div>
      </div>

      {/* Claude API Fallback */}
      <div style={S.section}>
        <div style={S.sectionTitle}>⚠️ Claude API Fallback</div>

        {claudeEnabled && (
          <div style={S.warning}>
            <div style={S.warningTitle}>🚨 ACHTUNG: Daten verlassen das Firmennetzwerk!</div>
            <div style={S.warningText}>
              Bei aktiviertem Claude API Fallback werden Dokumentinhalte (extrahierter Text) an die
              Anthropic API (api.anthropic.com) gesendet. Diese Daten verlassen Ihr internes Netzwerk.
              Stellen Sie sicher, dass dies gemäß Ihrer Datenschutzrichtlinien zulässig ist.
              <br /><br />
              <strong>Empfehlung:</strong> Nutzen Sie ausschließlich Ollama für On-Premise-Betrieb.
            </div>
          </div>
        )}

        <div style={S.toggle}>
          <Toggle value={claudeEnabled} onChange={(v) => setField('claude_api_enabled', v ? 'true' : 'false')} />
          <span style={{ fontSize: 14, fontWeight: 500, color: claudeEnabled ? '#991b1b' : '#374151' }}>
            Claude API Fallback {claudeEnabled ? '(AKTIV – Externe API)' : '(Deaktiviert)'}
          </span>
        </div>

        {claudeEnabled && (
          <div style={S.group}>
            <label style={S.label}>Claude API Schlüssel</label>
            <input
              type="password"
              style={S.input}
              value={form.claude_api_key || ''}
              onChange={(e) => setField('claude_api_key', e.target.value)}
              placeholder="sk-ant-…"
            />
          </div>
        )}
      </div>

      {/* Logging */}
      <div style={S.section}>
        <div style={S.sectionTitle}>📝 Protokollierung</div>
        <div style={S.group}>
          <label style={S.label}>Log-Level</label>
          <select style={S.select} value={form.log_level || 'info'} onChange={(e) => setField('log_level', e.target.value)}>
            <option value="error">Nur Fehler</option>
            <option value="warn">Warnungen</option>
            <option value="info">Info (empfohlen)</option>
            <option value="debug">Debug (ausführlich)</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button type="submit" style={S.btn('primary')} disabled={saving}>
          {saving ? 'Speichern…' : '💾 Einstellungen speichern'}
        </button>
        <button
          type="button"
          style={S.btn('secondary')}
          onClick={() => { if (settings) setForm(settings) }}
        >
          Zurücksetzen
        </button>
      </div>
    </form>
  )
}
