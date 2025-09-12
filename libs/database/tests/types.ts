declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidCacheResult(): R;
    }
  }
}

export {};
