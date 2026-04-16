import type { AuditRecord } from '../../types.js'

function buildId(): string {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createAuditRecord(input: Omit<AuditRecord, 'id' | 'timestamp'> & { timestamp?: string }): AuditRecord {
  return {
    id: buildId(),
    timestamp: input.timestamp || new Date().toISOString(),
    ...input,
  }
}

export function appendAuditRecords(existing: AuditRecord[] = [], records: AuditRecord[] = []): AuditRecord[] {
  return [...existing, ...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
