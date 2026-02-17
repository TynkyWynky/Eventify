FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app
COPY . .

# Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S syncuser -u 1001
USER syncuser

# Default command (scheduler mode)
CMD ["node", "sync.js"]