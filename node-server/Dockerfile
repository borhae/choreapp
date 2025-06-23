FROM node:20-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production
COPY client ./client
COPY node-server ./node-server
COPY data ./data
RUN mkdir -p data/avatars
EXPOSE 3000
CMD ["node", "node-server/server.js"]
