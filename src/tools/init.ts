import { initProjectApp } from '../app/init-project.js'

export function isInitialized(): boolean {
  return true
}

export async function initProject(root: string): Promise<string> {
  return initProjectApp(root)
}
