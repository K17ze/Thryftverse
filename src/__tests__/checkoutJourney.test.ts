import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store/useStore';
import {
  buildBankAccountPaymentMethod,
  buildCardPaymentMethod,
  isCheckoutReady,
} from '../utils/checkoutFlow';

function resetStore() {
  useStore.setState(useStore.getInitialState(), true);
}

describe('checkout journey smoke', () => {
  beforeEach(() => {
    resetStore();
  });

  it('persists AddAddress -> AddCard path and unlocks checkout', () => {
    const state = useStore.getState();

    expect(isCheckoutReady(state.savedAddress, state.savedPaymentMethod)).toBe(false);

    state.saveAddress({
      name: 'Ava Harper',
      street: '22 Wardrobe Lane',
      city: 'Manchester',
      postcode: 'M1 2AB',
    });

    let checkoutState = useStore.getState();
    expect(checkoutState.savedAddress?.city).toBe('Manchester');
    expect(isCheckoutReady(checkoutState.savedAddress, checkoutState.savedPaymentMethod)).toBe(false);

    state.savePaymentMethod(buildCardPaymentMethod('1234', '12/28', 'Visa'));

    checkoutState = useStore.getState();
    expect(checkoutState.savedPaymentMethod?.type).toBe('card');
    expect(checkoutState.savedPaymentMethod?.label).toContain('1234');
    expect(isCheckoutReady(checkoutState.savedAddress, checkoutState.savedPaymentMethod)).toBe(true);
  });

  it('supports bank-account payment persistence and clear flow', () => {
    const state = useStore.getState();

    state.saveAddress({
      name: 'Noah Clark',
      street: '71 Archive Street',
      city: 'London',
      postcode: 'EC1A 1BB',
    });
    state.savePaymentMethod(buildBankAccountPaymentMethod('7788', '04-00-04'));

    let checkoutState = useStore.getState();
    expect(checkoutState.savedPaymentMethod?.type).toBe('bank_account');
    expect(checkoutState.savedPaymentMethod?.details).toBe('Sort code 04-00-04');
    expect(isCheckoutReady(checkoutState.savedAddress, checkoutState.savedPaymentMethod)).toBe(true);

    state.clearSavedPaymentMethod();
    checkoutState = useStore.getState();
    expect(isCheckoutReady(checkoutState.savedAddress, checkoutState.savedPaymentMethod)).toBe(false);
  });
});