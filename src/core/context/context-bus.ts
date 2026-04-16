export class ContextBus {
  private values = new Map<string, string>()

  set(key: string, value: string): void {
    this.values.set(key, value)
  }

  get(key: string): string {
    return this.values.get(key) || ''
  }
}
