#!/bin/bash

echo "Starting Lavalink server with restricted memory (-Xmx256m) to prevent OOM on Render Free..."
# Run Lavalink in the background
java -Xmx256m -jar Lavalink.jar &

# Wait for Lavalink to boot up (typically takes 10-20 seconds)
echo "Waiting 15 seconds for Lavalink to initialize..."
sleep 15

echo "Starting Node.js Bot..."
npm run start
