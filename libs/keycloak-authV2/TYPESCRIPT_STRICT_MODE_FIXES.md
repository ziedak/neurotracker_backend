# TypeScript Strict Mode Fixes - UserManagementService

## Issue: `exactOptionalPropertyTypes: true` Compliance

The service had TypeScript compilation errors due to strict mode `exactOptionalPropertyTypes: true` which requires careful handling of `null` vs `undefined` for optional properties.

## Fixes Applied

### 1. **Prisma Field Types (null vs undefined)**

**Problem**: Prisma's UserCreateInput expects `string | null` for nullable fields, but we were using `string | undefined`.

**Solution**: Changed to use `null` as fallback:

```typescript
// ❌ Before
firstName: data.firstName ?? undefined,
lastName: data.lastName ?? undefined,
phone: data.phone ?? undefined,

// ✅ After
firstName: data.firstName ?? null,
lastName: data.lastName ?? null,
phone: data.phone ?? null,
```

### 2. **Optional Return Properties**

**Problem**: With `exactOptionalPropertyTypes: true`, you cannot assign `string | undefined` to optional property `refreshToken?: string`.

**Solution**: Build object conditionally, only adding properties when they exist:

```typescript
// ❌ Before
return {
  accessToken: authResult.tokens?.access_token ?? "",
  refreshToken: authResult.tokens?.refresh_token ?? undefined, // Error!
  idToken: authResult.tokens?.id_token ?? undefined,
  expiresIn: authResult.tokens?.expires_in ?? 0,
};

// ✅ After
const tokens: AuthenticationResult["tokens"] = {
  accessToken: authResult.tokens?.access_token ?? "",
  expiresIn: authResult.tokens?.expires_in ?? 0,
};

if (authResult.tokens?.refresh_token) {
  tokens.refreshToken = authResult.tokens.refresh_token;
}
if (authResult.tokens?.id_token) {
  tokens.idToken = authResult.tokens.id_token;
}

return { user, tokens };
```

### 3. **UpdateUserOptions Type**

**Problem**: Building `UpdateUserOptions` with `boolean | undefined` for `enabled` field.

**Solution**: Build object conditionally using `Partial<UpdateUserOptions>`:

```typescript
// ❌ Before
const keycloakUpdates: UpdateUserOptions = {
  email: typeof data.email === "string" ? data.email : undefined,
  firstName: typeof data.firstName === "string" ? data.firstName : undefined,
  lastName: typeof data.lastName === "string" ? data.lastName : undefined,
  enabled:
    typeof data.status === "string" ? data.status === "ACTIVE" : undefined, // Error!
};

// ✅ After
const keycloakUpdates: Partial<UpdateUserOptions> = {};

if (typeof data.email === "string") keycloakUpdates.email = data.email;
if (typeof data.firstName === "string")
  keycloakUpdates.firstName = data.firstName;
if (typeof data.lastName === "string") keycloakUpdates.lastName = data.lastName;
if (typeof data.status === "string")
  keycloakUpdates.enabled = data.status === "ACTIVE";

if (Object.keys(keycloakUpdates).length > 0) {
  await this.keycloakUserService.updateUser(
    userId,
    keycloakUpdates as UpdateUserOptions
  );
}
```

### 4. **Import Statement for UserUpdateInput**

**Problem**: Using `Prisma.UserUpdateInput` requires importing `Prisma` namespace from `@prisma/client`.

**Solution**: Import `UserUpdateInput` directly from `@libs/database`:

```typescript
// ❌ Before
import type { Prisma } from "@prisma/client";
async updateUser(userId: string, data: Prisma.UserUpdateInput): Promise<User>

// ✅ After
import type { UserUpdateInput } from "@libs/database";
async updateUser(userId: string, data: UserUpdateInput): Promise<User>
```

## Key Learnings

### Understanding `exactOptionalPropertyTypes: true`

With this TypeScript setting:

1. **Optional properties** (`prop?: string`) can ONLY be:

   - Present with the specified type (`string`)
   - Completely absent (not set)
   - **NOT** `undefined`

2. **Nullable types** (`prop: string | null`) can be:

   - The specified type (`string`)
   - `null`
   - **NOT** `undefined`

3. **The difference**:

   ```typescript
   // With exactOptionalPropertyTypes: true

   interface Example {
     optional?: string; // Can be string or missing (NOT undefined)
     nullable: string | null; // Can be string or null (NOT undefined)
   }

   // ❌ Wrong
   const obj: Example = {
     optional: undefined, // Error!
     nullable: undefined, // Error!
   };

   // ✅ Correct
   const obj: Example = {
     nullable: null, // OK
   };
   if (someValue) {
     obj.optional = someValue; // OK - conditionally add
   }
   ```

### Best Practices for Strict Mode

1. **For Prisma nullable fields**: Use `value ?? null` (not `?? undefined`)
2. **For optional return properties**: Build object conditionally with `if` statements
3. **For partial updates**: Use `Partial<Type>` and conditional assignment
4. **For type imports**: Import from workspace libs (`@libs/database`) to avoid `@prisma/client` namespace issues

## Verification

All TypeScript errors fixed - service now compiles cleanly:

```bash
✅ No TypeScript compilation errors
✅ Proper null handling for Prisma fields
✅ Correct optional property construction
✅ Type-safe Keycloak integration
```

## Architecture Compliance

The service correctly:

- Uses existing `UserRepository` from `@libs/database` (no duplication)
- Uses existing `UserCreateInput` and `UserUpdateInput` types
- Follows Prisma relation syntax: `{ store: { connect: { id } } }`
- Handles `exactOptionalPropertyTypes: true` correctly throughout
