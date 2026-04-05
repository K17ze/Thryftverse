import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAuditEntryHash,
  countryToJurisdictionGroups,
  normalizeCountryCode,
} from '../lib/compliance.js';

test('countryToJurisdictionGroups resolves India, EU, Gulf and Africa mappings', () => {
  assert.deepEqual(countryToJurisdictionGroups('in'), ['IN', 'GLOBAL']);
  assert.deepEqual(countryToJurisdictionGroups('fr'), ['EU', 'GLOBAL']);
  assert.deepEqual(countryToJurisdictionGroups('AE'), ['GULF', 'GLOBAL']);
  assert.deepEqual(countryToJurisdictionGroups('ng'), ['AFRICA', 'GLOBAL']);
  assert.deepEqual(countryToJurisdictionGroups('ca'), ['GLOBAL']);
  assert.equal(normalizeCountryCode(undefined), 'GB');
});

test('buildAuditEntryHash is deterministic and tamper-evident', () => {
  const baseline = buildAuditEntryHash({
    previousHash: '0'.repeat(64),
    eventType: 'consent.accepted',
    actorUserId: 'u1',
    subjectUserId: 'u1',
    requestId: 'req_1',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    createdAt: '2026-04-05T00:00:00.000Z',
    payload: { documentId: 'doc_terms_v1_en', accepted: true },
  });

  const baselineRepeat = buildAuditEntryHash({
    previousHash: '0'.repeat(64),
    eventType: 'consent.accepted',
    actorUserId: 'u1',
    subjectUserId: 'u1',
    requestId: 'req_1',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    createdAt: '2026-04-05T00:00:00.000Z',
    payload: { accepted: true, documentId: 'doc_terms_v1_en' },
  });

  const changedPayload = buildAuditEntryHash({
    previousHash: '0'.repeat(64),
    eventType: 'consent.accepted',
    actorUserId: 'u1',
    subjectUserId: 'u1',
    requestId: 'req_1',
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    createdAt: '2026-04-05T00:00:00.000Z',
    payload: { documentId: 'doc_terms_v1_en', accepted: false },
  });

  assert.equal(baseline, baselineRepeat);
  assert.notEqual(baseline, changedPayload);
  assert.equal(baseline.length, 64);
});
