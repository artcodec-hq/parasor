import type { WsEventMessage } from "@parasor/shared";

/**
 * Narrow outbound port for application use cases that fan state changes out to
 * connected clients. The concrete `EventBus` (ws/) structurally satisfies this,
 * so it is wired in directly at bootstrap; application code depends only on the
 * `broadcast` contract, never on the WS layer's client-lifecycle internals.
 */
export interface EventPublisher {
  broadcast(message: WsEventMessage): void;
}
