#!/bin/bash

# Direct test of admin API with token from client credentials

cd /home/zied/workspace/backend/libs/keycloak-authV2

echo "Getting token with client credentials..."
TOKEN=$(curl -s -X POST "http://localhost:8080/realms/test-realm/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=test-client" \
  -d "client_secret=test-secret" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$TOKEN" ]; then
    echo "❌ Failed to get token"
    exit 1
fi

echo "✅ Token obtained"
echo "Token length: ${#TOKEN}"
echo "Token prefix: ${TOKEN:0:50}..."

echo ""
echo "Testing Admin API with token..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "http://localhost:8080/admin/realms/test-realm/users?username=nonexistent" \
  -H "Authorization: Bearer $TOKEN")

STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $STATUS"
if [ "$STATUS" = "200" ]; then
    echo "✅ Admin API accessible"
    echo "Response: $BODY"
else
    echo "❌ Admin API returned error"
    echo "Response: $BODY"
fi
