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
export declare function timed(metricName?: string): (target: any, propertyName: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
//# sourceMappingURL=timed.d.ts.map