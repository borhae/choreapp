FROM python:3.12-alpine
WORKDIR /app

RUN apk add --no-cache tesseract-ocr

COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ocr_server.py ./ocr_server.py

EXPOSE 5000
CMD ["python3", "ocr_server.py"]
