import { DeliveryAttempt, DeliveryResult } from "./results.js";

export interface DeliveryPolicyHandlers {
  readonly speech?: () => Promise<DeliveryAttempt>;
  readonly sound: () => Promise<DeliveryAttempt>;
}

export async function runDeliveryPolicy(
  handlers: DeliveryPolicyHandlers,
  signal?: AbortSignal,
): Promise<DeliveryResult> {
  const attempts: DeliveryAttempt[] = [];
  const steps: Array<() => Promise<DeliveryAttempt>> = [];

  if (handlers.speech !== undefined) {
    steps.push(handlers.speech);
  }

  steps.push(handlers.sound);

  for (const step of steps) {
    if (signal?.aborted) {
      return {
        ok: false,
        cancelled: true,
        attempts,
      };
    }

    const attempt = await step();
    attempts.push(attempt);

    if (signal?.aborted) {
      return {
        ok: false,
        cancelled: true,
        attempts,
      };
    }

    if (attempt.ok) {
      return {
        ok: true,
        mode: attempt.mode,
        attempts,
      };
    }
  }

  return {
    ok: false,
    cancelled: false,
    attempts,
  };
}
