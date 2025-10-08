#!/bin/bash

# Script to assign Keycloak Admin API roles to service account
# This must be run after the test realm and client are created

set -e

KEYCLOAK_URL="${KEYCLOAK_SERVER_URL:-http://localhost:8080}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM_NAME="${KEYCLOAK_REALM:-test-realm}"
CLIENT_ID="${KEYCLOAK_CLIENT_ID:-test-client}"

echo "🔑 Assigning service account roles..."

# Get admin token
ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASS" \
  -d 'grant_type=password' \
  -d 'client_id=admin-cli' | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ADMIN_TOKEN" ]; then
    echo "❌ Failed to get admin token"
    exit 1
fi

# Get client UUID
CLIENT_UUID=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')")

if [ -z "$CLIENT_UUID" ]; then
    echo "❌ Could not find client $CLIENT_ID"
    exit 1
fi

echo "✅ Client UUID: $CLIENT_UUID"

# Get service account user ID
SERVICE_ACCOUNT_ID=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/service-account-user" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['id'])")

if [ -z "$SERVICE_ACCOUNT_ID" ]; then
    echo "❌ Could not get service account user"
    exit 1
fi

echo "✅ Service account ID: $SERVICE_ACCOUNT_ID"

# Get realm-management client ID
REALM_MGMT_ID=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=realm-management" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data[0]['id'] if data else '')")

if [ -z "$REALM_MGMT_ID" ]; then
    echo "❌ Could not find realm-management client"
    exit 1
fi

echo "✅ Realm-management client ID: $REALM_MGMT_ID"

# Get all available roles from realm-management
ROLES_JSON=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$REALM_MGMT_ID/roles" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

# Create JSON array of roles to assign
ROLES_TO_ASSIGN='['
first=true

for role_name in "manage-users" "view-users" "query-users" "manage-realm" "view-realm" "manage-clients" "query-groups"; do
    role_data=$(echo "$ROLES_JSON" | python3 -c "import sys, json; roles=json.load(sys.stdin); role=[r for r in roles if r['name']=='$role_name']; print(json.dumps(role[0]) if role else '')")
    
    if [ -n "$role_data" ]; then
        if [ "$first" = true ]; then
            first=false
        else
            ROLES_TO_ASSIGN="$ROLES_TO_ASSIGN,"
        fi
        ROLES_TO_ASSIGN="$ROLES_TO_ASSIGN$role_data"
    fi
done

ROLES_TO_ASSIGN="$ROLES_TO_ASSIGN]"

echo "Assigning roles..."

# Assign all roles at once
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/users/$SERVICE_ACCOUNT_ID/role-mappings/clients/$REALM_MGMT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ROLES_TO_ASSIGN"

echo "✅ Service account roles assigned successfully"

# Verify by getting a new token and checking roles
echo ""
echo "🔍 Verifying role assignment..."
NEW_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/$REALM_NAME/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=test-secret" | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)

if [ -n "$NEW_TOKEN" ]; then
    echo "Token roles:"
    echo $NEW_TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null | python3 -m json.tool | grep -A 15 '"resource_access"' || echo "Could not decode token"
fi

echo ""
echo "✅ Done!"
