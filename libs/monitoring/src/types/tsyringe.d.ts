declare module "tsyringe" {
  export function injectable<T = any>(target: T): T;
  export function injectable(): <T>(target: T) => T;

  export function singleton<T = any>(target: T): T;
  export function singleton(): <T>(target: T) => T;

  export function inject(
    token: string | symbol
  ): (
    target: any,
    propertyKey: string | symbol | undefined,
    parameterIndex: number
  ) => void;

  export interface DependencyContainer {
    registerSingleton<T>(
      token: string | symbol,
      target: new (...args: any[]) => T
    ): void;
    registerSingleton<T>(target: new (...args: any[]) => T): void;
    registerInstance<T>(token: string | symbol, instance: T): void;
    resolve<T>(token: string | symbol | (new (...args: any[]) => T)): T;
  }

  export const container: DependencyContainer;
}
