export class ArtifactStore {
  private artifacts = new Map<string, string>()

  save(id: string, value: string): void {
    this.artifacts.set(id, value)
  }

  load(id: string): string {
    return this.artifacts.get(id) || ''
  }
}
