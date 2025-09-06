# TSyringe Migration Guide for ClickHouse Client

## 🎯 **Current State: Pure TSyringe ClickHouse Client Ready**

The ClickHouse client is now completely TSyringe-based and ready for integration once your migration is complete.

## 🏗️ **Migration Steps for Each App**

### **1. Update App Container (Replace ServiceContainer with TSyringe)**

```typescript
// Before (old ServiceContainer pattern)
export class ServiceContainer {
  private services: Map<string, any> = new Map();
  // ...manual service management
}

// After (TSyringe container)
import { container } from "tsyringe";
import { registerClickHouseDependencies } from "@libs/database";

// Initialize dependencies
registerClickHouseDependencies(container);

// Use services
const clickhouse = container.resolve(ClickHouseClient);
const redis = container.resolve(RedisClient);
```

### **2. Service Usage Pattern**

```typescript
// In your services/controllers
import { container } from "tsyringe";
import { ClickHouseClient } from "@libs/database";

export class EventService {
  private clickhouse = container.resolve(ClickHouseClient);

  async saveEvent(event: EventData) {
    await this.clickhouse.insert("events", [event]);
  }
}
```

### **3. Application Initialization**

```typescript
// In your app startup (index.ts or main.ts)
import { container } from "tsyringe";
import { registerClickHouseDependencies } from "@libs/database";

// Initialize all dependencies
registerClickHouseDependencies(container);

// Your app is now ready to use TSyringe-based services
```

## 🚀 **Benefits After Migration**

✅ **Unified DI System**: All services use TSyringe consistently  
✅ **Enterprise ClickHouse**: Full resilience, metrics, and monitoring  
✅ **Type Safety**: Proper interface-based injection  
✅ **Testability**: Easy mocking with container.register()  
✅ **Maintainability**: No manual service management

## 📋 **Migration Checklist**

- [ ] Replace ServiceContainer with TSyringe in each app
- [ ] Update service imports and usage patterns
- [ ] Initialize dependencies in app startup
- [ ] Update tests to use TSyringe container
- [ ] Remove old singleton getInstance() calls

Your ClickHouse client is ready and waiting for this migration! 🎉
