# Use the official Python 3.11 slim image
FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Install ffmpeg, git, and required system packages
RUN apt-get update && \
    apt-get install -y ffmpeg git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy the requirements file into the container
COPY requirements.txt .

# Install the Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the bot's code
COPY . .

# Expose the port that UptimeRobot will ping (Render sets PORT dynamically, but defaults to 8080)
EXPOSE 8080

# Command to run the bot
CMD ["python", "bot.py"]
