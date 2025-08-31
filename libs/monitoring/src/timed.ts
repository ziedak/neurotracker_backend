import { MetricsCollector } from "./MetricsCollector";

// Performance monitoring decorator
/**
 * A method decorator that measures the execution time of an async function and records metrics.
 *
 * The decorator uses `performance.now()` to track the duration of the method execution.
 * On successful completion, it records a timer metric with status "success".
 * On error, it records a timer metric with status "error" and increments an error counter.
 *
 * @param metricName - Optional custom metric name. If not provided, defaults to `${ClassName}.${methodName}`.
 * @returns A method decorator function.
 *
 * @example
 * ```typescript
 * class MyService {
 *   @timed('my_custom_metric')
 *   async fetchData() {
 *     // ... your code ...
 *   }
 * }
 * ```
 */
export function timed(metricName?: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;
    const name = metricName || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const startTime = performance.now();
      const metrics = MetricsCollector.getInstance();

      try {
        const result = await method.apply(this, args);
        const duration = performance.now() - startTime;

        await metrics.recordTimer(name, duration, { status: "success" });
        return result;
      } catch (error) {
        const duration = performance.now() - startTime;

        await metrics.recordTimer(name, duration, { status: "error" });
        await metrics.recordCounter(`${name}.errors`);

        throw error;
      }
    };

    return descriptor;
  };
}
