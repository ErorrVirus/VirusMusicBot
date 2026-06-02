#!/bin/bash

echo "Starting Lavalink server with restricted memory (-Xmx256m) to prevent OOM on Render Free..."
# Run Lavalink in the background
java -Xmx256m -jar Lavalink.jar &

# Wait for Lavalink to boot up (Java takes ~45-60s on Render Free Tier)
echo "Waiting 60 seconds for Lavalink to initialize completely..."
sleep 60

echo "Starting Node.js Bot..."
npm run start
