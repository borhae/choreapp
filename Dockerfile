
FROM node:20-alpine
WORKDIR /app

# Install Python and tesseract for the OCR microservice
RUN apk add --no-cache python3 py3-pip tesseract-ocr

COPY package*.json ./
RUN npm install --production

COPY server/requirements.txt server/requirements.txt
RUN pip3 install --break-system-packages --no-cache-dir -r server/requirements.txt

COPY . .

EXPOSE 3000 5000

# Start both the Node backend and the OCR service
CMD ["sh", "-c", "python3 server/ocr_server.py & exec node server/server.js"]
