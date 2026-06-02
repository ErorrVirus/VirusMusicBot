FROM node:20-bullseye

# Install Java 17 for Lavalink
RUN apt-get update && \
    apt-get install -y openjdk-17-jre-headless wget && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Download Lavalink v4
# Using 4.0.5 as it is a highly stable v4 release
RUN wget https://github.com/lavalink-devs/Lavalink/releases/download/4.0.5/Lavalink.jar -O Lavalink.jar

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code and config
COPY . .

# Make the start script executable
RUN chmod +x start.sh

# Expose Render dummy port
EXPOSE 10000

# Start script handles both Lavalink and Node.js
CMD ["./start.sh"]
