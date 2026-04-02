import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const internalS3 = new S3Client({
  region: config.s3Region,
  endpoint: config.s3Endpoint,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
});

const signingS3 = new S3Client({
  region: config.s3Region,
  endpoint: config.s3PublicEndpoint,
  forcePathStyle: config.s3ForcePathStyle,
  credentials: {
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  },
});

export async function createUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(signingS3, command, { expiresIn: 60 * 10 });
  return {
    bucket: config.s3Bucket,
    key,
    url,
    publicUrl: `${config.s3PublicEndpoint.replace(/\/$/, '')}/${config.s3Bucket}/${key}`,
  };
}

export async function assertS3BucketConnectivity() {
  await internalS3.send(
    new HeadBucketCommand({
      Bucket: config.s3Bucket,
    })
  );
}
