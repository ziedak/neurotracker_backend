# Integration Tests Status - Session 2

**Date:** October 8, 2025
**Status:** 3/7 tests passing, investigating 401 errors

## Issues Fixed This Session

1. ✅ **Invalid OAuth Scopes** - Changed DEFAULT_ADMIN_SCOPES from role names to OAuth scopes
2. ✅ **Service Account Roles** - Assigned realm-management roles to test-client service account
3. ✅ **Missing ensureBaseUrl() call** - Added to searchUsers() method
4. ✅ **Error Serialization** - Improved error logging to show actual error messages
5. ✅ **Redis Cache Cleared** - Removed any stale cached tokens

## Current Issue: 401 Unauthorized

**Symptom:** All user registration tests fail with "Validation failed: Request failed with status code 401"

**Verified Working:**

- ✅ Client credentials grant returns valid token
- ✅ Token includes realm-management roles
- ✅ Direct curl to Admin API with same token works (HTTP 200)
- ✅ Service account has all necessary roles assigned

**Hypothesis:**
The token being used in the integration tests is somehow different from what curl uses, OR there's an issue with how axios/HttpClient is sending the Authorization header.

**Next Steps:**

1. Add detailed HTTP request/response logging
2. Compare actual token being sent vs. token that works in curl
3. Check if there's a token expiration or timing issue
4. Verify Authorization header format

## Test Results

- ✅ should reject authentication with wrong password (working)
- ✅ should reject authentication for non-existent user (working)
- ✅ should reject invalid session ID (working)
- ❌ should register and authenticate user (401 on getUserByUsername)
- ❌ should validate active session (depends on registration)
- ❌ should refresh session tokens (depends on registration)
- ❌ should logout user (depends on registration)

## Performance

- Test duration: 14-15 seconds (excellent, down from 36s)
- No retry loops or scope errors
- Clean, fast execution

The architecture is correct, just need to solve this 401 mystery!
