export type TelemetryPayload = Record<string, unknown>;
export type TelemetryHandler = (eventName: string, payload: TelemetryPayload) => void;

let telemetryHandler: TelemetryHandler | null = null;

export function setTelemetryHandler(handler: TelemetryHandler | null) {
  telemetryHandler = handler;
}

export function trackTelemetryEvent(eventName: string, payload: TelemetryPayload = {}) {
  if (telemetryHandler) {
    try {
      telemetryHandler(eventName, payload);
    } catch (error) {
      if (__DEV__) {
        console.warn('[telemetry] handler_failed', { eventName, error });
      }
    }
  }

  if (__DEV__) {
    console.info(`[telemetry] ${eventName}`, payload);
  }
}
