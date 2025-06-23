FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY node-server ./node-server
COPY client ./client
RUN mkdir -p data/avatars
EXPOSE 3000
CMD ["node", "node-server/server.js"]
