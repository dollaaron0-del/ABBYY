export type Ampel = 'gruen' | 'gelb' | 'rot'

export type DocType =
  | 'Rechnung'
  | 'Mahnung'
  | 'Behördenbescheid'
  | 'Unleserlich'
  | 'Sonstiges'

export type DocumentStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'error'
  | 'forwarded'

export interface Document {
  id: string
  filename: string
  original_name: string
  file_path: string
  file_type: string
  status: DocumentStatus
  doc_type: DocType | null
  sender: string | null
  sender_matched: number
  sender_id: string | null
  supplier_name: string | null
  confidence: number
  ai_suggestion: string | null
  ai_reasoning: string | null
  user_correction: string | null
  ampel: Ampel
  processed_at: string | null
  created_at: string
  processing_logs?: ProcessingLog[]
  feedbacks?: Feedback[]
}

export interface Supplier {
  id: string
  name: string
  aliases: string[]
  category: string | null
  created_at: string
  updated_at: string
}

export interface Settings {
  ollama_host: string
  ollama_model: string
  confidence_threshold: string
  abbyy_endpoint: string
  abbyy_auth_token: string
  abbyy_enabled: string
  claude_api_enabled: string
  claude_api_key: string
  auto_forward_green: string
  log_level: string
  max_file_size_mb: string
  ocr_language: string
  [key: string]: string
}

export interface ProcessingLog {
  id: string
  document_id: string
  step: string
  status: 'success' | 'error' | 'running' | 'info'
  message: string | null
  created_at: string
}

export interface Feedback {
  id: string
  document_id: string
  original_suggestion: string | null
  corrected_value: string
  created_at: string
}

export interface Pagination {
  total: number
  page: number
  limit: number
  pages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: Pagination
}

export interface DocumentStats {
  overall: {
    total: number
    gruen: number
    gelb: number
    rot: number
    processed: number
    pending: number
    error: number
    forwarded: number
    corrected: number
    avg_confidence: number | null
  }
  today: {
    total: number
    gruen: number
    gelb: number
    rot: number
    processed: number
    pending: number
  }
}

export interface ReportSummary {
  overall: {
    total: number
    gruen: number
    gelb: number
    rot: number
    processed: number
    pending: number
    errors: number
    forwarded: number
    corrected: number
    avg_confidence: number | null
    type_rechnung: number
    type_mahnung: number
    type_behoerde: number
    type_unleserlich: number
    type_sonstiges: number
  }
  by_day: Array<{
    day: string
    total: number
    gruen: number
    gelb: number
    rot: number
  }>
  top_senders: Array<{
    sender: string
    count: number
  }>
}

export interface OllamaModel {
  name: string
  size: number
  modified_at: string
}

export interface UploadResult {
  id: string
  filename: string
  status: 'queued' | 'error'
  error?: string
}
