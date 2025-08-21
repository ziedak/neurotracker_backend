# Architecture Notes - libs/authV2 Development

## Existing Infrastructure Analysis

### libs/models Structure

- **Location**: `/home/zied/workspace/backend/libs/models/src/index.ts`
- **Purpose**: Contains all TypeScript models generated from Prisma schema
- **Key Entities Identified**:
  - `User` - Core user entity with comprehensive fields
  - `UserSession` - Session management with metadata
  - `Role` - RBAC role system with hierarchy
  - `RolePermission` - Permission system with conditions
  - `Store` - Multi-tenant store structure
  - Various business entities (Cart, Order, Product, etc.)

### Integration Strategy for libs/authV2

#### 1. User Entity Alignment

- **Existing Model**: `User` interface with comprehensive fields including:

  - Basic auth fields: `id`, `email`, `password`, `username`
  - Status management: `status: UserStatus`, `emailVerified`, `phoneVerified`
  - Audit fields: `createdAt`, `updatedAt`, `lastLoginAt`, `loginCount`
  - Role integration: `roleId`, `role`, role assignment tracking
  - Soft delete: `deletedAt`, `isDeleted`
  - Metadata support: `metadata`, `auditLog`

- **authV2 Strategy**:
  - Use existing `User` model as base structure
  - Extend with additional security fields if needed
  - Maintain compatibility with current database schema

#### 2. Session Management

- **Existing Model**: `UserSession` with:

  - Session tracking: `sessionId`, `userId`, `createdAt`, `expiresAt`
  - Device info: `ipAddress`, `userAgent`, `metadata`
  - Status: `isActive`, `endedAt`
  - Relationships: `events`, `logs`, `activities`

- **authV2 Strategy**:
  - Leverage existing session structure
  - Enhance with additional security features
  - Maintain backward compatibility

#### 3. Permission System

- **Existing Model**: `Role` and `RolePermission` with:

  - Hierarchical roles: `parentRoleIds`, `childRoleIds`
  - Versioning: `version`, `level`
  - Permissions: `resource`, `action`, `conditions`
  - Metadata support and lifecycle management

- **authV2 Strategy**:
  - Build upon existing RBAC structure
  - Enhance permission checking and caching
  - Add enterprise-grade permission resolution

### Key Architectural Decisions

1. **Model Compatibility**:

   - Use existing Prisma-generated models as foundation
   - Extend with additional interfaces for enhanced functionality
   - Maintain database schema compatibility

2. **Type Enhancement**:

   - Add branded types for better type safety
   - Create strict validation interfaces
   - Implement runtime type guards

3. **Service Layer Abstraction**:
   - Create service interfaces that work with existing models
   - Add enterprise features (caching, audit, metrics)
   - Ensure clean separation between data models and business logic

### Implementation Notes

- **Database Integration**: Leverage existing `libs/database` with current schema
- **Model Extensions**: Create enhanced interfaces that extend existing models
- **Backward Compatibility**: Ensure all existing code continues to work
- **Migration Path**: Gradual adoption without breaking changes

### Risk Mitigation

- **Schema Changes**: Avoid breaking changes to existing database schema
- **API Compatibility**: Maintain existing API contracts
- **Data Migration**: No data migration required, only service layer changes
- **Rollback Strategy**: Can rollback to existing libs/auth without data loss

---

This analysis ensures that libs/authV2 builds upon the proven data models while adding enterprise-grade authentication and authorization capabilities.
