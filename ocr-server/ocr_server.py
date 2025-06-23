from flask import Flask, request, jsonify
import pytesseract
from PIL import Image
import logging

app = Flask(__name__)

@app.route('/api/ocr', methods=['POST'])
def ocr_image():
    if 'image' not in request.files:
        app.logger.warning('No image file received')
        return jsonify({'error': 'No image file'}), 400
    file = request.files['image']
    try:
        image = Image.open(file.stream)
    except Exception:
        app.logger.warning('Invalid image file')
        return jsonify({'error': 'Invalid image'}), 400
    app.logger.info('Running OCR on received image')
    text = pytesseract.image_to_string(image)
    # Split lines and remove empties
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return jsonify({'text': text, 'lines': lines})

if __name__ == '__main__':
    import os
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get('OCR_PORT', 5000))
    logging.info('Starting OCR server')
    logging.info(' OCR_PORT=%s', os.environ.get('OCR_PORT', '5000 (default)'))
    app.run(host='0.0.0.0', port=port)
