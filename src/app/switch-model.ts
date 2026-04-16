import { SessionRuntime } from '../core/runtime/session-runtime.js'

export async function switchModel(projectRoot: string, mcpId: string, model: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) return '当前没有 active parallel session。'

  const mcps = session.mcps.map(mcp => {
    if (mcp.id !== mcpId) return mcp
    if (mcp.activeModel === model) return mcp
    const allowed = [mcp.modelPolicy.preferredModel, ...mcp.modelPolicy.fallbackModels]
    if (!allowed.includes(model)) {
      throw new Error(`model ${model} is not allowed for ${mcp.id}`)
    }
    return { ...mcp, activeModel: model }
  })

  runtime.save({ ...session, mcps })
  return `✅ ${mcpId} switched to ${model} without resetting session progress.`
}
