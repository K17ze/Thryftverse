import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/pool.js';
import { config } from '../config.js';

export type AuthRole = 'user' | 'seller' | 'moderator' | 'admin';

const AUTH_ROLES = new Set<AuthRole>(['user', 'seller', 'moderator', 'admin']);

export interface AuthenticatedUser {
  userId: string;
  role: AuthRole;
  sessionId: string;
}

type RefreshLookupRow = {
  id: number;
  user_id: string;
  session_id: string;
  expires_at: string;
  revoked_at: string | null;
  session_revoked_at: string | null;
  role: AuthRole;
};

function createOpaqueToken(prefix = 'tok') {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashOpaqueToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function futureTimestamp(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function signAccessToken(userId: string, role: AuthRole, sessionId: string) {
  return jwt.sign(
    {
      role,
      sid: sessionId,
      typ: 'access',
    },
    config.authAccessTokenSecret,
    {
      algorithm: 'HS256',
      subject: userId,
      audience: 'thryftverse-app',
      issuer: 'thryftverse-api',
      expiresIn: config.authAccessTokenTtlSeconds,
      jwtid: crypto.randomUUID(),
    }
  );
}

function parseJwtPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const maybe = payload as {
    sub?: unknown;
    role?: unknown;
    sid?: unknown;
    typ?: unknown;
  };

  if (
    typeof maybe.sub !== 'string' ||
    typeof maybe.role !== 'string' ||
    typeof maybe.sid !== 'string' ||
    maybe.typ !== 'access' ||
    !AUTH_ROLES.has(maybe.role as AuthRole)
  ) {
    return null;
  }

  return {
    userId: maybe.sub,
    role: maybe.role as AuthRole,
    sessionId: maybe.sid,
  };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, config.authPasswordHashCost);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function issueAuthSession(
  input: {
    userId: string;
    role: AuthRole;
  },
  context: {
    ipAddress?: string;
    userAgent?: string;
  }
) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const sessionId = `ses_${crypto.randomUUID()}`;
    const refreshToken = createOpaqueToken('rft');
    const refreshTokenHash = hashOpaqueToken(refreshToken);
    const refreshTokenExpiresAt = futureTimestamp(config.authRefreshTokenTtlSeconds);

    await client.query(
      `
        INSERT INTO user_sessions (id, user_id, user_agent, ip_address)
        VALUES ($1, $2, $3, $4)
      `,
      [sessionId, input.userId, context.userAgent ?? null, context.ipAddress ?? null]
    );

    await client.query(
      `
        INSERT INTO refresh_tokens (session_id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
      `,
      [sessionId, input.userId, refreshTokenHash, refreshTokenExpiresAt]
    );

    await client.query(
      `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
      `,
      [input.userId]
    );

    await client.query('COMMIT');

    return {
      accessToken: signAccessToken(input.userId, input.role, sessionId),
      refreshToken,
      sessionId,
      accessTokenExpiresInSeconds: config.authAccessTokenTtlSeconds,
      refreshTokenExpiresAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateRefreshSession(
  refreshToken: string,
  context: {
    ipAddress?: string;
    userAgent?: string;
  }
) {
  const refreshTokenHash = hashOpaqueToken(refreshToken);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const lookupResult = await client.query<RefreshLookupRow>(
      `
        SELECT
          rt.id,
          rt.user_id,
          rt.session_id,
          rt.expires_at,
          rt.revoked_at,
          us.revoked_at AS session_revoked_at,
          u.role
        FROM refresh_tokens rt
        INNER JOIN user_sessions us ON us.id = rt.session_id
        INNER JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        LIMIT 1
        FOR UPDATE
      `,
      [refreshTokenHash]
    );

    const row = lookupResult.rows[0];

    if (!row) {
      throw new Error('Invalid refresh token');
    }

    if (row.revoked_at || row.session_revoked_at) {
      throw new Error('Refresh token is revoked');
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new Error('Refresh token expired');
    }

    const nextRefreshToken = createOpaqueToken('rft');
    const nextRefreshTokenHash = hashOpaqueToken(nextRefreshToken);
    const nextRefreshTokenExpiresAt = futureTimestamp(config.authRefreshTokenTtlSeconds);

    await client.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE id = $1
      `,
      [row.id]
    );

    await client.query(
      `
        INSERT INTO refresh_tokens (session_id, user_id, token_hash, expires_at, rotated_from_id)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [row.session_id, row.user_id, nextRefreshTokenHash, nextRefreshTokenExpiresAt, row.id]
    );

    await client.query(
      `
        UPDATE user_sessions
        SET
          last_seen_at = NOW(),
          user_agent = COALESCE($2, user_agent),
          ip_address = COALESCE($3, ip_address)
        WHERE id = $1
      `,
      [row.session_id, context.userAgent ?? null, context.ipAddress ?? null]
    );

    await client.query('COMMIT');

    return {
      userId: row.user_id,
      role: row.role,
      sessionId: row.session_id,
      accessToken: signAccessToken(row.user_id, row.role, row.session_id),
      refreshToken: nextRefreshToken,
      accessTokenExpiresInSeconds: config.authAccessTokenTtlSeconds,
      refreshTokenExpiresAt: nextRefreshTokenExpiresAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSessionByRefreshToken(refreshToken: string) {
  const refreshTokenHash = hashOpaqueToken(refreshToken);

  await db.query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1
        AND revoked_at IS NULL
    `,
    [refreshTokenHash]
  );
}

export async function revokeAllUserSessions(userId: string) {
  await db.query(
    `
      UPDATE user_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [userId]
  );

  await db.query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [userId]
  );
}

export async function verifyAccessToken(accessToken: string): Promise<AuthenticatedUser | null> {
  let payload: unknown;

  try {
    payload = jwt.verify(accessToken, config.authAccessTokenSecret, {
      algorithms: ['HS256'],
      audience: 'thryftverse-app',
      issuer: 'thryftverse-api',
    });
  } catch {
    return null;
  }

  const parsed = parseJwtPayload(payload);
  if (!parsed) {
    return null;
  }

  const sessionResult = await db.query<{
    id: string;
    revoked_at: string | null;
  }>(
    `
      SELECT id, revoked_at
      FROM user_sessions
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [parsed.sessionId, parsed.userId]
  );

  const session = sessionResult.rows[0];
  if (!session || session.revoked_at) {
    return null;
  }

  return parsed;
}

export function hashOpaqueValue(value: string) {
  return hashOpaqueToken(value);
}

export function createPublicToken(prefix: string) {
  return createOpaqueToken(prefix);
}
