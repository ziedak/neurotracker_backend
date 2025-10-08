#!/bin/bash

# Keycloak Test Realm Setup Script
# Automatically configures Keycloak for integration testing

set -e

KEYCLOAK_URL="${KEYCLOAK_SERVER_URL:-http://localhost:8080}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM_NAME="${KEYCLOAK_REALM:-test-realm}"
CLIENT_ID="${KEYCLOAK_CLIENT_ID:-test-client}"

echo "🔧 Setting up Keycloak Test Realm..."
echo ""
echo "Configuration:"
echo "  Keycloak URL: $KEYCLOAK_URL"
echo "  Realm: $REALM_NAME"
echo "  Client: $CLIENT_ID"
echo ""

# Wait for Keycloak to be ready
echo "⏳ Waiting for Keycloak to be ready..."
max_attempts=30
attempt=1

while [ $attempt -le $max_attempts ]; do
    if curl -s -f -o /dev/null "$KEYCLOAK_URL/realms/master"; then
        echo "✅ Keycloak is ready"
        break
    fi
    echo "   Attempt $attempt/$max_attempts..."
    sleep 2
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ Keycloak failed to start"
    exit 1
fi

# Get admin access token
echo ""
echo "🔑 Getting admin access token..."
TOKEN_RESPONSE=$(curl -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASS" \
  -d 'grant_type=password' \
  -d 'client_id=admin-cli')

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
    echo "❌ Failed to get access token"
    echo "Response: $TOKEN_RESPONSE"
    exit 1
fi

echo "✅ Access token obtained"

# Create realm
echo ""
echo "🌍 Creating realm '$REALM_NAME'..."
REALM_JSON='{
  "realm": "'$REALM_NAME'",
  "enabled": true,
  "registrationAllowed": true,
  "resetPasswordAllowed": true,
  "rememberMe": true,
  "verifyEmail": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "sslRequired": "none",
  "accessTokenLifespan": 3600,
  "accessTokenLifespanForImplicitFlow": 1800,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "offlineSessionIdleTimeout": 2592000,
  "accessCodeLifespan": 60,
  "accessCodeLifespanUserAction": 300,
  "accessCodeLifespanLogin": 1800
}'

REALM_CREATE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$KEYCLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REALM_JSON")

if [ "$REALM_CREATE" == "201" ] || [ "$REALM_CREATE" == "409" ]; then
    echo "✅ Realm created/exists"
else
    echo "⚠️  Realm creation returned status: $REALM_CREATE (might already exist)"
fi

# Create client
echo ""
echo "🔌 Creating client '$CLIENT_ID'..."
CLIENT_JSON='{
  "clientId": "'$CLIENT_ID'",
  "enabled": true,
  "publicClient": false,
  "clientAuthenticatorType": "client-secret",
  "secret": "test-secret",
  "redirectUris": ["http://localhost:*"],
  "webOrigins": ["http://localhost:*"],
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "serviceAccountsEnabled": true,
  "authorizationServicesEnabled": false,
  "protocol": "openid-connect",
  "attributes": {
    "access.token.lifespan": "3600"
  }
}'

CLIENT_CREATE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CLIENT_JSON")

if [ "$CLIENT_CREATE" == "201" ] || [ "$CLIENT_CREATE" == "409" ]; then
    echo "✅ Client created/exists"
else
    echo "⚠️  Client creation returned status: $CLIENT_CREATE (might already exist)"
fi

# Create test roles
echo ""
echo "👤 Creating test roles..."
for role in "admin" "user" "moderator"; do
    ROLE_JSON='{"name": "'$role'"}'
    curl -s -o /dev/null -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/roles" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$ROLE_JSON"
done

echo "✅ Roles created"

# Get client UUID for service account role assignment
echo ""
echo "🔍 Getting client UUID..."
CLIENT_UUID=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | \
  grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$CLIENT_UUID" ]; then
    echo "⚠️  Could not get client UUID"
else
    echo "✅ Client UUID: $CLIENT_UUID"
    
    # Get service account user ID
    echo ""
    echo "🤖 Getting service account user..."
    SERVICE_ACCOUNT_USER=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/service-account-user" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    
    SERVICE_ACCOUNT_ID=$(echo $SERVICE_ACCOUNT_USER | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
    
    if [ -z "$SERVICE_ACCOUNT_ID" ]; then
        echo "⚠️  Could not get service account user ID"
    else
        echo "✅ Service account user ID: $SERVICE_ACCOUNT_ID"
        
        # Get realm-management client ID
        echo ""
        echo "🔑 Assigning admin roles to service account..."
        REALM_MGMT_CLIENT=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
          -H "Authorization: Bearer $ACCESS_TOKEN" | \
          grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
        
        if [ -n "$REALM_MGMT_CLIENT" ]; then
            # Get available roles from realm-management client
            AVAILABLE_ROLES=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$REALM_MGMT_CLIENT/roles" \
              -H "Authorization: Bearer $ACCESS_TOKEN")
            
            # Assign specific admin roles
            for role_name in "manage-users" "view-users" "query-users" "manage-realm" "view-realm" "manage-clients" "query-groups"; do
                ROLE_DATA=$(echo $AVAILABLE_ROLES | grep -o "{[^}]*\"name\":\"$role_name\"[^}]*}")
                if [ -n "$ROLE_DATA" ]; then
                    curl -s -o /dev/null -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/users/$SERVICE_ACCOUNT_ID/role-mappings/clients/$REALM_MGMT_CLIENT" \
                      -H "Authorization: Bearer $ACCESS_TOKEN" \
                      -H "Content-Type: application/json" \
                      -d "[$ROLE_DATA]"
                fi
            done
            
            echo "✅ Admin roles assigned to service account"
        fi
    fi
fi

# Get client secret
echo ""
echo "🔐 Getting client secret..."
CLIENT_SECRET=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | \
  grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -n "$CLIENT_SECRET" ]; then
    SECRET_RESPONSE=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_SECRET/client-secret" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    
    SECRET_VALUE=$(echo $SECRET_RESPONSE | grep -o '"value":"[^"]*' | cut -d'"' -f4)
    
    if [ -n "$SECRET_VALUE" ]; then
        echo "✅ Client secret: $SECRET_VALUE"
    else
        echo "✅ Client secret: test-secret (default)"
        SECRET_VALUE="test-secret"
    fi
fi

# Create .env.test file
echo ""
echo "📝 Creating .env.test file..."
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cat > "$PROJECT_DIR/.env.test" << EOF
# Auto-generated Keycloak Test Configuration
# Generated on: $(date)

# Keycloak Configuration
KEYCLOAK_SERVER_URL=$KEYCLOAK_URL
KEYCLOAK_REALM=$REALM_NAME
KEYCLOAK_CLIENT_ID=$CLIENT_ID
KEYCLOAK_CLIENT_SECRET=${SECRET_VALUE:-test-secret}

# Database Configuration
DATABASE_URL=postgresql://postgres:TEST@localhost:5432/neurotracker

# Redis Configuration (optional)
REDIS_URL=redis://localhost:6379

# Test Configuration
TEST_TIMEOUT=30000
CLEANUP_AFTER_TESTS=true
LOG_LEVEL=info
EOF

echo "✅ .env.test file created"

# Summary
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       ✅ Keycloak Setup Complete                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Configuration:"
echo "  🌍 Realm: $REALM_NAME"
echo "  🔌 Client: $CLIENT_ID"
echo "  🔐 Secret: ${SECRET_VALUE:-test-secret}"
echo ""
echo "Admin Access:"
echo "  🔗 URL: $KEYCLOAK_URL/admin"
echo "  👤 User: $ADMIN_USER"
echo "  🔑 Pass: $ADMIN_PASS"
echo ""
echo "Next Steps:"
echo "  1. Run: pnpm test:integration"
echo "  2. Or:  ./scripts/run-integration-tests.sh"
echo ""
