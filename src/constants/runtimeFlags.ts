const runtimeDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__;
const isDevelopmentRuntime =
  typeof runtimeDevFlag === 'boolean'
    ? runtimeDevFlag
    : process.env.NODE_ENV !== 'production';

export const ENABLE_RUNTIME_MOCKS =
  isDevelopmentRuntime || process.env.EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS === 'true';
