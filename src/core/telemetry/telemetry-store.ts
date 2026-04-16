import type { TelemetryEvent } from '../../types.js'

export class TelemetryStore {
  private events: TelemetryEvent[] = []

  push(event: TelemetryEvent): void {
    this.events.push(event)
  }

  list(): TelemetryEvent[] {
    return [...this.events]
  }
}
