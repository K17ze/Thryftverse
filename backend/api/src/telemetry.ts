import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { config } from './config.js';

let telemetrySdk: NodeSDK | null = null;

if (config.otelEnabled) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SemanticResourceAttributes.SERVICE_NAME]: 'thryftverse-api',
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'thryftverse',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.nodeEnv,
    }),
    traceExporter: new OTLPTraceExporter({
      url: config.otelExporterOtlpHttpUrl,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  });

  void Promise.resolve(telemetrySdk.start()).catch((error: unknown) => {
    console.error('[telemetry] failed to start', error);
  });
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetrySdk) {
    return;
  }

  await telemetrySdk.shutdown();
  telemetrySdk = null;
}
