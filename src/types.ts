export interface Campaign {
  id: string;
  name: string;
  status: string;
  budget: number;
  impressions: number;
  clicks: number;
  conversions: number;
  created_at?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  issued_at: number;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

export interface SyncResponse {
  success: boolean;
  campaign_id: string;
  synced_at: string;
  message: string;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface SyncResult {
  campaignId: string;
  success: boolean;
  error?: string;
}