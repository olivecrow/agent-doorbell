export type DeliveryMode = "speech" | "sound";

export type DeliveryAttempt =
  | {
      ok: true;
      mode: DeliveryMode;
      handler: string;
    }
  | {
      ok: false;
      mode: DeliveryMode;
      handler: string;
      reason: string;
    };

export type CapabilityAvailability =
  | { available: true }
  | { available: false; reason: string };

export type DeliveryResult =
  | {
      ok: true;
      mode: DeliveryMode;
      attempts: readonly DeliveryAttempt[];
    }
  | {
      ok: false;
      cancelled: boolean;
      attempts: readonly DeliveryAttempt[];
    };
