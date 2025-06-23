from flask import Flask, request, jsonify
import pytesseract
from PIL import Image

app = Flask(__name__)

@app.route('/api/ocr', methods=['POST'])
def ocr_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file'}), 400
    file = request.files['image']
    try:
        image = Image.open(file.stream)
    except Exception:
        return jsonify({'error': 'Invalid image'}), 400
    text = pytesseract.image_to_string(image)
    # Split lines and remove empties
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return jsonify({'text': text, 'lines': lines})

if __name__ == '__main__':
    import os
    port = int(os.environ.get('OCR_PORT', 5000))
    app.run(host='0.0.0.0', port=port)
