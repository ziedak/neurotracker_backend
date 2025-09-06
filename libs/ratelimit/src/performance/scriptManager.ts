import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";

/**
 * Shared script management for EVALSHA optimization
 * Prevents redundant script loading across multiple instances
 */
export class SharedScriptManager {
  private static instance: SharedScriptManager;
  private readonly scriptShas = new Map<string, string>();
  private scriptsInitialized = false;
  private initPromise: Promise<void> | undefined;

  // Immutable Lua scripts for security
  private readonly SCRIPTS = {
    SLIDING_WINDOW: `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])
      local request_id = ARGV[5]
      
      -- Remove expired entries
      redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
      
      -- Count current requests in window
      local current_requests = redis.call('ZCARD', key)
      
      local allowed = 0
      if current_requests < max_requests then
        -- Add this request
        redis.call('ZADD', key, now, request_id)
        allowed = 1
      end
      
      -- Set expiration
      redis.call('EXPIRE', key, expiry)
      
      -- Get final count
      local total_requests = redis.call('ZCARD', key)
      local remaining = math.max(0, max_requests - total_requests)
      
      -- Calculate reset time from oldest entry
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local reset_time = now + tonumber(ARGV[6])
      if #oldest >= 2 then
        reset_time = tonumber(oldest[2]) + tonumber(ARGV[6])
      end
      
      return {allowed, remaining, reset_time, total_requests}
    `,

    TOKEN_BUCKET: `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local refill_rate = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])
      
      -- Get current bucket state
      local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
      local tokens = tonumber(bucket[1]) or capacity
      local last_refill = tonumber(bucket[2]) or now
      
      -- Calculate tokens to add based on time elapsed
      local time_passed = (now - last_refill) / 1000
      local tokens_to_add = time_passed * refill_rate
      tokens = math.min(capacity, tokens + tokens_to_add)
      
      local allowed = 0
      if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
      end
      
      -- Update bucket state
      redis.call('HMSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(now))
      redis.call('EXPIRE', key, expiry)
      
      local reset_time = now + ((capacity - tokens) / refill_rate) * 1000
      local remaining = math.floor(tokens)
      
      return {allowed, remaining, reset_time, capacity - remaining}
    `,

    FIXED_WINDOW: `
      local key = KEYS[1]
      local max_requests = tonumber(ARGV[1])
      local expiry = tonumber(ARGV[2])
      local reset_time = tonumber(ARGV[3])
      
      local current = redis.call('GET', key)
      local count = tonumber(current) or 0
      
      local allowed = 0
      if count < max_requests then
        count = redis.call('INCR', key)
        allowed = 1
        if count == 1 then
          redis.call('EXPIRE', key, expiry)
        end
      else
        count = tonumber(redis.call('GET', key)) or 0
      end
      
      local remaining = math.max(0, max_requests - count)
      
      return {allowed, remaining, reset_time, count}
    `,

    BATCH_SLIDING_WINDOW: `
      local keys = KEYS
      local now = tonumber(ARGV[1])
      local window_start = tonumber(ARGV[2])
      local max_requests = tonumber(ARGV[3])
      local expiry = tonumber(ARGV[4])
      local window_ms = tonumber(ARGV[5])
      
      local results = {}
      
      for i, key in ipairs(keys) do
        local request_id = tostring(now) .. '_' .. tostring(i)
        
        -- Remove expired entries
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        
        -- Count current requests in window
        local current_requests = redis.call('ZCARD', key)
        
        local allowed = 0
        if current_requests < max_requests then
          -- Add this request
          redis.call('ZADD', key, now, request_id)
          allowed = 1
        end
        
        -- Set expiration
        redis.call('EXPIRE', key, expiry)
        
        -- Get final count
        local total_requests = redis.call('ZCARD', key)
        local remaining = math.max(0, max_requests - total_requests)
        
        -- Calculate reset time from oldest entry
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local reset_time = now + window_ms
        if #oldest >= 2 then
          reset_time = tonumber(oldest[2]) + window_ms
        end
        
        results[i] = {allowed, remaining, reset_time, total_requests}
      end
      
      return results
    `,
  } as const;

  logger = createLogger("SharedScriptManager");
  /**
   * Initialize scripts with Redis client
   */
  async initialize(redisClient: RedisClient): Promise<void> {
    // Return existing promise if initialization is in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Return immediately if already initialized
    if (this.scriptsInitialized) {
      return;
    }

    this.initPromise = this.doInitialize(redisClient);
    return this.initPromise;
  }

  /**
   * Perform actual script initialization
   */
  private async doInitialize(redisClient: RedisClient): Promise<void> {
    try {
      const redis = redisClient.getRedis();

      for (const [name, script] of Object.entries(this.SCRIPTS)) {
        const sha = (await redis.script("LOAD", script)) as string;
        this.scriptShas.set(name, sha);
      }

      this.scriptsInitialized = true;
      this.logger?.info("Shared Lua scripts initialized", {
        scripts: Object.keys(this.SCRIPTS).length,
        shas: Array.from(this.scriptShas.values()),
      });
    } catch (error) {
      this.logger?.error("Failed to initialize shared scripts", error);
      this.scriptsInitialized = false;
      this.initPromise = undefined;
      throw error;
    }
  }

  /**
   * Get script SHA by name
   */
  getScriptSha(scriptName: keyof typeof this.SCRIPTS): string | undefined {
    return this.scriptShas.get(scriptName);
  }

  /**
   * Check if scripts are initialized
   */
  isInitialized(): boolean {
    return this.scriptsInitialized;
  }

  /**
   * Get all available script names
   */
  getAvailableScripts(): string[] {
    return Object.keys(this.SCRIPTS);
  }

  /**
   * Reset initialization state (for testing)
   */
  reset(): void {
    this.scriptsInitialized = false;
    this.scriptShas.clear();
    this.initPromise = undefined;
  }

  /**
   * Get script content for debugging
   */
  getScriptContent(scriptName: keyof typeof this.SCRIPTS): string | undefined {
    return this.SCRIPTS[scriptName];
  }

  /**
   * Force re-initialization (useful for Redis reconnections)
   */
  async forceReinitialize(redisClient: RedisClient): Promise<void> {
    this.reset();
    await this.initialize(redisClient);
  }
}
