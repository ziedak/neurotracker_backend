/**
 * Global type declarations for Jest tests
 */

declare global {
  namespace NodeJS {
    interface Global {
      testUtils: {
        createMockUser: (overrides?: Partial<any>) => any;
        createMockAuthResult: (overrides?: Partial<any>) => any;
        createMockDeps: (overrides?: Partial<any>) => any;
        createMockAuthConfig: (overrides?: Partial<any>) => any;
      };
    }
  }
}

export {};
