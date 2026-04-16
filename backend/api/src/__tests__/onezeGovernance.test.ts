import assert from 'node:assert/strict';
import test from 'node:test';

type GovernanceClient = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

let governanceModulePromise: Promise<typeof import('../lib/onezeGovernance.js')> | null = null;

async function loadGovernanceModule(): Promise<typeof import('../lib/onezeGovernance.js')> {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/thryftverse-test';
  process.env.ONEZE_OPERATOR_TOKEN ??= 'test-oneze-operator-token';

  if (!governanceModulePromise) {
    governanceModulePromise = import('../lib/onezeGovernance.js');
  }

  return governanceModulePromise;
}

function createMockClient(input: {
  outstandingIze: number;
  circulatingIze: number;
  createdAt?: string;
  captureInsertValues?: (values: unknown[] | undefined) => void;
}): GovernanceClient {
  return {
    query: async <T = Record<string, unknown>>(
      text: string,
      values?: unknown[]
    ): Promise<{ rows: T[]; rowCount: number | null }> => {
      if (text.includes("la.owner_type = 'platform'") && text.includes('la.account_code = $1')) {
        return {
          rows: [{ balance: String(input.outstandingIze) }] as T[],
          rowCount: 1,
        };
      }

      if (text.includes("la.owner_type = 'user'") && text.includes("la.account_code = 'ize_wallet'")) {
        return {
          rows: [{ balance: String(input.circulatingIze) }] as T[],
          rowCount: 1,
        };
      }

      if (text.includes('INSERT INTO ize_reconciliation_snapshots')) {
        input.captureInsertValues?.(values);
        return {
          rows: [{ created_at: input.createdAt ?? '2024-01-01T00:00:00.000Z' }] as T[],
          rowCount: 1,
        };
      }

      throw new Error(`Unexpected query in test double: ${text.slice(0, 80)}`);
    },
  };
}

test('assertOnezeOperatorToken enforces configured token', async () => {
  const { assertOnezeOperatorToken } = await loadGovernanceModule();
  const expectedToken = process.env.ONEZE_OPERATOR_TOKEN;

  assert.doesNotThrow(() => assertOnezeOperatorToken(expectedToken));
  assert.throws(
    () => {
      assertOnezeOperatorToken('invalid-token');
    },
    {
      message: /Missing or invalid operator token/,
    }
  );
});

test('createOnezeReconciliationAttestation computes supply parity and stores metadata', async () => {
  const { createOnezeReconciliationAttestation } = await loadGovernanceModule();
  let insertedValues: unknown[] | undefined;
  const client = createMockClient({
    outstandingIze: 120.5,
    circulatingIze: 125.75,
    createdAt: '2024-01-01T00:00:00.000Z',
    captureInsertValues: (values) => {
      insertedValues = values;
    },
  });

  const attestation = await createOnezeReconciliationAttestation(client, {
    attestedBy: 'operator',
    thresholdIze: 10,
    metadata: {
      source: 'test',
    },
  });

  assert.equal(attestation.outstandingIze, 120.5);
  assert.equal(attestation.circulatingIze, 125.75);
  assert.equal(attestation.supplyDeltaIze, 5.25);
  assert.equal(attestation.driftIze, 5.25);
  assert.equal(attestation.withinThreshold, true);
  assert.equal(attestation.thresholdIze, 10);
  assert.equal(attestation.createdAt, '2024-01-01T00:00:00.000Z');

  const metadata = JSON.parse(String(insertedValues?.[6] ?? '{}')) as Record<string, unknown>;
  assert.equal(metadata.model, 'controlled_liquidity_supply_parity');
  assert.equal(metadata.source, 'test');
  assert.equal(metadata.toleranceIze, 10);
});

test('createOnezeReconciliationAttestation flags out-of-threshold drift', async () => {
  const { createOnezeReconciliationAttestation } = await loadGovernanceModule();
  const client = createMockClient({
    outstandingIze: 100,
    circulatingIze: 140,
  });

  const attestation = await createOnezeReconciliationAttestation(client, {
    thresholdIze: 5,
  });

  assert.equal(attestation.supplyDeltaIze, 40);
  assert.equal(attestation.withinThreshold, false);
});
