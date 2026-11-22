/** Minimal Redis-backed event bus with best-effort publish. */
export declare class EventBus {
  constructor(url: string);
  publish(topic: string, payload: unknown): Promise<boolean>;
  close(): Promise<void>;
}
