FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm install

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Set production
ENV NODE_ENV=production

# Expose port
EXPOSE ${PORT:-3004}

# Start server
CMD ["node", "server/index.js"]
