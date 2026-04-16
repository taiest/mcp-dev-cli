const locks = new Set<string>()

export class WorkspaceLock {
  acquire(id: string): boolean {
    if (locks.has(id)) return false
    locks.add(id)
    return true
  }

  release(id: string): void {
    locks.delete(id)
  }
}
