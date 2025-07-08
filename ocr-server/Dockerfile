FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-deu && \
    rm -rf /var/lib/apt/lists/*
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata

COPY ocr-server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY ocr-server ./ocr-server

EXPOSE 5000
CMD ["python3", "ocr-server/ocr_server.py"]
