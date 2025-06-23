FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY client ./client
COPY server/server.js ./server/server.js
COPY data ./data

EXPOSE 3000
CMD ["node", "server/server.js"]
