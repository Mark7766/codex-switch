/**
 * 跨轮 reasoning_content 状态（deepseek-reasoner / R1 需要回传）。
 */
export class ReasoningStore {
  private readonly map = new Map<string, string>();

  set(callId: string, reasoning: string): void {
    if (!callId || !reasoning) return;
    this.map.set(callId, reasoning);
  }

  get(callId: string): string | undefined {
    return this.map.get(callId);
  }

  asMap(): Map<string, string> {
    return this.map;
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
