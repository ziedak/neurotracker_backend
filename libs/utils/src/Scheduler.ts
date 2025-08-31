interface Timer {
  type: "timeout" | "interval";
  id: number;
}

export interface IScheduler {
  setInterval(key: string, ms: number, callback: () => void): void;
  setTimeout(key: string, ms: number, callback: () => void): void;
  clearInterval(key: string): void;
  clearTimeout(key: string): void;
  clearAll(): void;
}
/**
 * Service for managing timeouts and intervals across the application
 * Prevents memory leaks by ensuring all timers are properly cleaned up
 */
export class Scheduler implements IScheduler {
  private timers: Map<string, Timer> = new Map();

  /**
   * Set an interval with a unique key
   */
  public setInterval(key: string, ms: number, callback: () => void): void {
    this.clearInterval(key); // Clear any existing interval with this key
    const id = window.setInterval(callback, ms);
    this.timers.set(key, { type: "interval", id });
  }

  /**
   * Set a timeout with a unique key
   */
  public setTimeout(key: string, ms: number, callback: () => void): void {
    this.clearTimeout(key); // Clear any existing timeout with this key
    const id = window.setTimeout(() => {
      callback();
      this.timers.delete(key);
    }, ms);
    this.timers.set(key, { type: "timeout", id });
  }

  /**
   * Clear an interval by key
   */
  public clearInterval(key: string): void {
    const timer = this.timers.get(key);
    if (timer?.type === "interval") {
      window.clearInterval(timer.id);
      this.timers.delete(key);
    }
  }

  /**
   * Clear a timeout by key
   */
  public clearTimeout(key: string): void {
    const timer = this.timers.get(key);
    if (timer?.type === "timeout") {
      window.clearTimeout(timer.id);
      this.timers.delete(key);
    }
  }

  /**
   * Clear all intervals and timeouts
   */
  public clearAll(): void {
    for (const [key, timer] of this.timers) {
      if (timer.type === "interval") {
        window.clearInterval(timer.id);
      } else {
        window.clearTimeout(timer.id);
      }
      this.timers.delete(key);
    }
  }
}
