import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();

collectDefaultMetrics({
  register: registry,
  prefix: 'thryftverse_',
});

const httpRequestsTotal = new Counter({
  name: 'thryftverse_http_requests_total',
  help: 'Total HTTP requests processed by the API',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'thryftverse_http_request_duration_seconds',
  help: 'Request latency distribution by route',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.03, 0.06, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6, 12],
  registers: [registry],
});

const paymentTransitionsTotal = new Counter({
  name: 'thryftverse_payment_transitions_total',
  help: 'Payment intent status transitions grouped by channel and gateway',
  labelNames: ['channel', 'from', 'to', 'gateway'] as const,
  registers: [registry],
});

const auctionSettlementsTotal = new Counter({
  name: 'thryftverse_auction_settlements_total',
  help: 'Server-side auction settlement outcomes',
  labelNames: ['result'] as const,
  registers: [registry],
});

const pushDeliveriesTotal = new Counter({
  name: 'thryftverse_push_deliveries_total',
  help: 'Push delivery attempts by provider/status',
  labelNames: ['provider', 'status'] as const,
  registers: [registry],
});

const backgroundJobsTotal = new Counter({
  name: 'thryftverse_background_jobs_total',
  help: 'Background job executions by queue/job/result',
  labelNames: ['queue', 'job', 'result'] as const,
  registers: [registry],
});

function normalizeRouteLabel(route: string): string {
  const trimmed = route.trim();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function observeHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}): void {
  const labels = {
    method: input.method.toUpperCase(),
    route: normalizeRouteLabel(input.route),
    status: String(input.statusCode),
  };

  httpRequestsTotal.inc(labels, 1);
  httpRequestDurationSeconds.observe(labels, Math.max(0, input.durationSeconds));
}

export function recordPaymentTransition(input: {
  channel: string;
  from: string;
  to: string;
  gateway: string;
}): void {
  paymentTransitionsTotal.inc(
    {
      channel: input.channel,
      from: input.from,
      to: input.to,
      gateway: input.gateway,
    },
    1
  );
}

export function recordAuctionSettlement(result: 'settled' | 'no_action' | 'failed'): void {
  auctionSettlementsTotal.inc({ result }, 1);
}

export function recordPushDelivery(input: {
  provider: string;
  status: 'sent' | 'failed' | 'queued';
}): void {
  pushDeliveriesTotal.inc(
    {
      provider: input.provider,
      status: input.status,
    },
    1
  );
}

export function recordBackgroundJob(input: {
  queue: string;
  job: string;
  result: 'completed' | 'failed';
}): void {
  backgroundJobsTotal.inc(
    {
      queue: input.queue,
      job: input.job,
      result: input.result,
    },
    1
  );
}

export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

export function metricsContentType(): string {
  return registry.contentType;
}
