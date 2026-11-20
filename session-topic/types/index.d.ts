export type Topic = string | null

declare module 'claude-code' {
  interface PluginState {
    'session-topic': { topic: Topic }
  }
}
