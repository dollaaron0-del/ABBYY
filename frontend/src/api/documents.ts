import apiClient from './client'
import type { Document, PaginatedResponse, DocumentStats, UploadResult } from '../types'

export interface DocumentsFilter {
  page?: number
  limit?: number
  status?: string
  ampel?: string
  search?: string
}

export async function getDocuments(filter: DocumentsFilter = {}): Promise<PaginatedResponse<Document>> {
  const params = new URLSearchParams()
  if (filter.page) params.set('page', String(filter.page))
  if (filter.limit) params.set('limit', String(filter.limit))
  if (filter.status && filter.status !== 'all') params.set('status', filter.status)
  if (filter.ampel && filter.ampel !== 'all') params.set('ampel', filter.ampel)
  if (filter.search) params.set('search', filter.search)

  const res = await apiClient.get<PaginatedResponse<Document>>(`/documents?${params.toString()}`)
  return res.data
}

export async function getDocument(id: string): Promise<Document> {
  const res = await apiClient.get<Document>(`/documents/${id}`)
  return res.data
}

export async function getDocumentStats(from?: string, to?: string): Promise<DocumentStats> {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const res = await apiClient.get<DocumentStats>(`/documents/stats?${params.toString()}`)
  return res.data
}

export async function uploadDocument(file: File): Promise<{ document: Document; message: string }> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await apiClient.post('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300_000,
  })
  return res.data
}

export async function uploadDocumentsBatch(
  files: File[],
  onProgress?: (pct: number) => void
): Promise<{ results: UploadResult[]; message: string }> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  const res = await apiClient.post('/documents/upload-batch', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300_000,
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) {
        onProgress(Math.round((evt.loaded * 100) / evt.total))
      }
    },
  })
  return res.data
}

export async function updateDocument(
  id: string,
  updates: Partial<Pick<Document, 'doc_type' | 'sender' | 'ampel' | 'status' | 'user_correction'>> & {
    extracted_fields?: Record<string, any>
  }
): Promise<Document> {
  const res = await apiClient.patch<Document>(`/documents/${id}`, updates)
  return res.data
}

export async function deleteDocument(id: string): Promise<void> {
  await apiClient.delete(`/documents/${id}`)
}

export async function triggerAnalysis(id: string): Promise<{ message: string; document_id: string }> {
  const res = await apiClient.post(`/analysis/trigger/${id}`)
  return res.data
}

export async function triggerBatchAnalysis(ids: string[]): Promise<{ message: string; queued: string[] }> {
  const res = await apiClient.post('/analysis/trigger-batch', { ids })
  return res.data
}

export async function getAnalysisStatus(id: string): Promise<Document & { logs: any[] }> {
  const res = await apiClient.get(`/analysis/status/${id}`)
  return res.data
}

export async function forwardToAbbyy(id: string): Promise<{ success: boolean; message: string }> {
  const res = await apiClient.post(`/abbyy/forward/${id}`)
  return res.data
}

export async function forwardBatchToAbbyy(ids: string[]): Promise<{ message: string; results: any[] }> {
  const res = await apiClient.post('/abbyy/forward-batch', { ids })
  return res.data
}
