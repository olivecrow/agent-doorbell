export interface DeliveryLease {
  release(): Promise<void>;
}

export interface DeliveryQueue {
  acquire(source?: string, signal?: AbortSignal): Promise<DeliveryLease>;
}
