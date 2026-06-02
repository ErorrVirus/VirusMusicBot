#!/bin/bash

echo "Starting Lavalink server with restricted memory (-Xmx256m) to prevent OOM on Render Free..."
# Run Lavalink in the background
java -Xmx256m -jar Lavalink.jar &

# Wait for Lavalink to boot up (Java takes ~45-90s on Render Free Tier)
echo "Waiting for Lavalink to become ready (this can take up to 90 seconds on Render Free)..."
while ! curl -s http://127.0.0.1:2333 > /dev/null; do
  sleep 5
done
echo "Lavalink port is open! Waiting 5 more seconds for the websocket handler to initialize..."
sleep 5

echo "Starting Node.js Bot..."
npm run start
