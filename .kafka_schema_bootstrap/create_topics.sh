#!/bin/bash
BOOTSTRAP_SERVER=${BOOTSTRAP_SERVER:-broker:9092}

while read -r topic partitions replication retention policy; do
  [[ "$topic" =~ ^#.*$ ]] && continue
  echo "Creating topic: $topic"
  kafka-topics.sh --create     --topic "$topic"     --partitions "$partitions"     --replication-factor "$replication"     --config retention.ms="$retention"     --config cleanup.policy="$policy"     --bootstrap-server "$BOOTSTRAP_SERVER"
done < topics-config.txt
