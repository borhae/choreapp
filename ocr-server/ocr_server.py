from flask import Flask, request, jsonify, send_file
import pytesseract
from PIL import Image, ImageOps
import logging
import cv2
import numpy as np
from io import BytesIO

app = Flask(__name__)


def preprocess_image(pil_img):
    """Attempt to deskew the image using its text lines."""
    try:
        # Respect EXIF orientation so the deskew step works on the image as it
        # should appear to the user.
        pil_img = ImageOps.exif_transpose(pil_img)
        img = np.array(pil_img)
        if img.ndim == 2:
            gray = img
        else:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        gray = cv2.bitwise_not(gray)
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
        coords = np.column_stack(np.where(thresh > 0))
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        (h, w) = img.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        # Compute new bounding dimensions to avoid cropping for large angles
        cos = abs(M[0, 0])
        sin = abs(M[0, 1])
        nW = int((h * sin) + (w * cos))
        nH = int((h * cos) + (w * sin))
        # Adjust the rotation matrix to take into account translation
        M[0, 2] += (nW / 2) - w / 2
        M[1, 2] += (nH / 2) - h / 2
        rotated = cv2.warpAffine(
            img, M, (nW, nH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
        )
        return Image.fromarray(rotated)
    except Exception as exc:
        app.logger.warning('Preprocess failed: %s', exc)
        return pil_img


@app.route('/api/preprocess', methods=['POST'])
def preprocess_route():
    if 'image' not in request.files:
        app.logger.warning('No image file received')
        return jsonify({'error': 'No image file'}), 400
    file = request.files['image']
    try:
        image = Image.open(file.stream)
    except Exception:
        app.logger.warning('Invalid image file')
        return jsonify({'error': 'Invalid image'}), 400
    app.logger.info('Preprocessing image')
    processed = preprocess_image(image)
    buf = BytesIO()
    processed.save(buf, format='PNG')
    buf.seek(0)
    return send_file(buf, mimetype='image/png')

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
    image = preprocess_image(image)
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
