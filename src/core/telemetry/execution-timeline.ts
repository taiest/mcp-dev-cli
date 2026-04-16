import type { TelemetryEvent } from '../../types.js'

export function buildExecutionTimeline(events: TelemetryEvent[]): string[] {
  return events.map(event => `${event.timestamp} ${event.type} ${event.message}`)
}
