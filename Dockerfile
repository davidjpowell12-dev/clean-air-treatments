FROM node:18-slim

# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Railway injects PORT at runtime (usually 8080)
# Use shell form so we can create dirs before starting
CMD mkdir -p /data/uploads && node server.js
