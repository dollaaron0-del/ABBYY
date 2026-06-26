import apiClient from './client'
import type { Supplier, PaginatedResponse } from '../types'

export interface SuppliersFilter {
  page?: number
  limit?: number
  search?: string
  category?: string
}

export async function getSuppliers(filter: SuppliersFilter = {}): Promise<PaginatedResponse<Supplier>> {
  const params = new URLSearchParams()
  if (filter.page) params.set('page', String(filter.page))
  if (filter.limit) params.set('limit', String(filter.limit))
  if (filter.search) params.set('search', filter.search)
  if (filter.category) params.set('category', filter.category)

  const res = await apiClient.get<PaginatedResponse<Supplier>>(`/suppliers?${params.toString()}`)
  return res.data
}

export async function getSupplier(id: string): Promise<Supplier> {
  const res = await apiClient.get<Supplier>(`/suppliers/${id}`)
  return res.data
}

export interface SupplierFormData {
  name: string
  aliases?: string[]
  category?: string | null
  iban?: string | null
  vendor_code?: string | null
  ust_id?: string | null
}

export async function createSupplier(data: SupplierFormData): Promise<Supplier> {
  const res = await apiClient.post<Supplier>('/suppliers', data)
  return res.data
}

export async function updateSupplier(id: string, data: Partial<SupplierFormData>): Promise<Supplier> {
  const res = await apiClient.put<Supplier>(`/suppliers/${id}`, data)
  return res.data
}

export async function deleteSupplier(id: string): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`)
}

export async function importSuppliers(file: File): Promise<{
  message: string
  imported: number
  updated: number
  errors: number
}> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await apiClient.post('/suppliers/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export async function exportSuppliers(): Promise<void> {
  const response = await apiClient.get('/suppliers/export/excel', {
    responseType: 'blob',
  })

  const url = window.URL.createObjectURL(new Blob([response.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = `lieferanten_${new Date().toISOString().split('T')[0]}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)
}

export async function getCategories(): Promise<string[]> {
  const res = await apiClient.get<string[]>('/suppliers/meta/categories')
  return res.data
}
