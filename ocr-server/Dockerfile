FROM python:3.12-alpine
WORKDIR /app

RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-deu
ENV TESSDATA_PREFIX=/usr/share/tessdata

COPY ocr-server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY ocr-server ./ocr-server

EXPOSE 5000
CMD ["python3", "ocr-server/ocr_server.py"]
