FROM node:18-slim

# Install build tools needed for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Railway sets PORT dynamically
ENV PORT=3001

# Start the app
CMD ["node", "server.js"]
