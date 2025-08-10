#!/bin/bash
SCHEMA_REGISTRY_URL=${SCHEMA_REGISTRY_URL:-http://schema-registry:8081}

jq -c '.[]' bootstrap.json | while read -r schema; do
  SUBJECT=$(echo "$schema" | jq -r '.subject')
  echo "Registering schema for $SUBJECT"
  curl -s -X POST     -H "Content-Type: application/vnd.schemaregistry.v1+json"     --data "$schema"     "$SCHEMA_REGISTRY_URL/subjects/$SUBJECT/versions"
done
