// Enterprise-secured routes for data intelligence service
// This file serves as a reference to the main routes.ts which now includes
// comprehensive security middleware integration

export { setupFeatureRoutes } from "./routes/routes";

SECURITY FEATURES IMPLEMENTED IN routes.ts:

1.  Authentication Middleware:

    - JWT/API key validation
    - Role-based access control (admin, analyst, viewer, compliance)
    - User context attachment

2.  Validation Middleware:

    - Request body validation with comprehensive schemas
    - Parameter validation (cartId, userId, requestId, ruleId)
    - Type checking and custom validation rules

3.  Rate Limiting Middleware:

    - General API limits (1000 req/min)
    - User-specific limits (500 req/min)
    - Export limits (50 req/5min)
    - GDPR operation limits (5 req/5min)
    - Analytics limits (200 req/min)
    - Strict limits for sensitive operations (10 req/min)

4.  Audit Middleware:
    - Comprehensive request/response logging
    - ClickHouse analytics storage
    - Redis caching with TTL
    - Specialized audit trails for different operation types

ENDPOINT SECURITY LEVELS:

PUBLIC:

- /health (no authentication)

AUTHENTICATED:

- /v1/status (admin, analyst, viewer roles)

ANALYST+ (READ ACCESS):

- /v1/features/\* (except batch compute)
- /v1/analytics/\*
- /v1/quality/status, alerts, validate
- /v1/reports/\*

ADMIN+ (WRITE ACCESS):

- /v1/export/\*
- /v1/features/batch-compute
- /v1/reconciliation/\*

COMPLIANCE+ (GDPR OPERATIONS):

- /v1/gdpr/\*

RATE LIMITING BY OPERATION TYPE:

- Analytics: 200 req/min
- Exports: 50 req/5min
- GDPR: 5 req/5min
- Reconciliation: 10 req/min
- General: 1000 req/min
