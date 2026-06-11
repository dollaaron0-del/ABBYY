import apiClient from './client'
import type { Settings, OllamaModel } from '../types'

export async function getSettings(): Promise<Settings> {
  const res = await apiClient.get<Settings>('/settings')
  return res.data
}

export async function updateSettings(updates: Partial<Settings>): Promise<{ message: string; settings: Settings }> {
  const res = await apiClient.put('/settings', updates)
  return res.data
}

export async function testAbbyyConnection(): Promise<{
  success: boolean
  message: string
  status?: number
}> {
  const res = await apiClient.get('/abbyy/test')
  return res.data
}

export async function testAbbyyAutopilot(): Promise<{ success: boolean; message?: string; mode?: string }> {
  const res = await apiClient.get('/abbyy/autopilot/test')
  return res.data
}

export async function runAbbyyAutopilot(): Promise<{ message: string; summary: any }> {
  const res = await apiClient.post('/abbyy/autopilot/run')
  return res.data
}

export async function getOllamaModels(): Promise<OllamaModel[]> {
  const res = await apiClient.get<{ models: OllamaModel[] }>('/analysis/ollama/models')
  return res.data.models || []
}

export async function getOllamaHealth(): Promise<{ status: string; host: string; models_count?: number; error?: string }> {
  const res = await apiClient.get('/analysis/ollama/health')
  return res.data
}

export async function getReportSummary(from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const res = await apiClient.get(`/reports/summary?${params.toString()}`)
  return res.data
}

export async function exportReport(from?: string, to?: string): Promise<void> {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const response = await apiClient.get(`/reports/export?${params.toString()}`, {
    responseType: 'blob',
  })

  const url = window.URL.createObjectURL(new Blob([response.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = `bericht_${new Date().toISOString().split('T')[0]}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function getProcessingLog(params: {
  from?: string
  to?: string
  status?: string
  page?: number
  limit?: number
}) {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) p.set(k, String(v)) })
  const res = await apiClient.get(`/reports/processing-log?${p.toString()}`)
  return res.data
}
