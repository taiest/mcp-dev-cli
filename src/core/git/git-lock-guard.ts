import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class GitLockGuard {
  constructor(private projectRoot: string) {}

  hasLock(): boolean {
    return existsSync(join(this.projectRoot, '.git', 'index.lock'))
  }
}
