import assert from 'node:assert/strict';
import test from 'node:test';

import { computePayoutSettlementBreakdown } from '../lib/payoutAccounting.js';

test('computePayoutSettlementBreakdown computes net payout with fee and spread deductions', () => {
  const breakdown = computePayoutSettlementBreakdown({
    amountGbp: 100,
    networkFeeGbp: 2.345,
    spreadGbp: 1.1,
  });

  assert.equal(breakdown.amountGbp, 100);
  assert.equal(breakdown.networkFeeGbp, 2.35);
  assert.equal(breakdown.spreadGbp, 1.1);
  assert.equal(breakdown.totalPlatformDeductionGbp, 3.45);
  assert.equal(breakdown.netPayoutGbp, 96.55);
  assert.equal(breakdown.isValid, true);
});

test('computePayoutSettlementBreakdown normalizes invalid fee inputs to zero', () => {
  const breakdown = computePayoutSettlementBreakdown({
    amountGbp: 50,
    networkFeeGbp: Number.NaN,
    spreadGbp: -2,
  });

  assert.equal(breakdown.networkFeeGbp, 0);
  assert.equal(breakdown.spreadGbp, 0);
  assert.equal(breakdown.totalPlatformDeductionGbp, 0);
  assert.equal(breakdown.netPayoutGbp, 50);
  assert.equal(breakdown.isValid, true);
});

test('computePayoutSettlementBreakdown marks breakdown invalid when deductions exceed amount', () => {
  const breakdown = computePayoutSettlementBreakdown({
    amountGbp: 10,
    networkFeeGbp: 8,
    spreadGbp: 5,
  });

  assert.equal(breakdown.totalPlatformDeductionGbp, 13);
  assert.equal(breakdown.netPayoutGbp, 0);
  assert.equal(breakdown.isValid, false);
});
