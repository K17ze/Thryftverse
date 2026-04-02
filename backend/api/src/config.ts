import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === 'true';
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? '4000'),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  keyServiceUrl: required('KEY_SERVICE_URL', 'http://localhost:4100'),
  keyServiceAdminToken: process.env.KEY_SERVICE_ADMIN_TOKEN,
  apiSecurityAdminToken: process.env.API_SECURITY_ADMIN_TOKEN,
  s3Endpoint: required('S3_ENDPOINT', 'http://localhost:9000'),
  s3PublicEndpoint: required('S3_PUBLIC_ENDPOINT', process.env.S3_ENDPOINT ?? 'http://localhost:9000'),
  s3Region: required('S3_REGION', 'us-east-1'),
  s3AccessKey: required('S3_ACCESS_KEY', 'minioadmin'),
  s3SecretKey: required('S3_SECRET_KEY', 'minioadmin'),
  s3Bucket: required('S3_BUCKET', 'thryftverse-media'),
  s3ForcePathStyle: asBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  mlServiceUrl: required('ML_SERVICE_URL', 'http://localhost:8000'),
};
