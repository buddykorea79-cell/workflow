export type IntegrationService = 'ai' | 'database' | 'storage';
export interface IntegrationVariable { name: string; configured: boolean; required: boolean; purpose: string }
export interface IntegrationStatus {
  checkedAt: string;
  ai: { configured: boolean; variables: IntegrationVariable[] };
  database: { configured: boolean; mode: 'neon' | 'local'; variables: IntegrationVariable[] };
  storage: { configured: boolean; mode: 'neon' | 'local'; variables: IntegrationVariable[] };
}
export interface DiagnosticCheck { label: string; ok: boolean; detail?: string }
export interface DiagnosticResult { service: IntegrationService; ok: boolean; checkedAt: string; durationMs: number; checks: DiagnosticCheck[]; message: string }
export interface PreparedStorageProbe { provider: 'local' | 'neon'; token: string; uploadUrl: string; contentType: string }
