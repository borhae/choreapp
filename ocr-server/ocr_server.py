from flask import Flask, request, jsonify, send_file
import easyocr
from PIL import Image, ImageOps
import logging
import cv2
import numpy as np
from io import BytesIO
from transformers import AutoImageProcessor, TableTransformerForObjectDetection
import torch

def _order_points(pts: np.ndarray) -> np.ndarray:
    """Return points ordered as top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

app = Flask(__name__)
reader = easyocr.Reader(['en'])
image_processor = AutoImageProcessor.from_pretrained("microsoft/table-transformer-detection")
model = TableTransformerForObjectDetection.from_pretrained("microsoft/table-transformer-detection")


def preprocess_image(pil_img: Image.Image) -> Image.Image:
    """Deskew and dewarp the image for better OCR results."""
    try:
        # Respect EXIF orientation so the deskew step works on the image as it
        # should appear to the user.
        pil_img = ImageOps.exif_transpose(pil_img)

        # --- Table Detection and Cropping -----------------------------------
        inputs = image_processor(images=pil_img, return_tensors="pt")
        outputs = model(**inputs)
        target_sizes = torch.tensor([pil_img.size[::-1]])
        results = image_processor.post_process_object_detection(outputs, threshold=0.9, target_sizes=target_sizes)[0]

        if len(results["boxes"]) > 0:
            # take the box with the highest score
            best_box = results["boxes"][torch.argmax(results["scores"])]
            # crop the image to the detected table
            pil_img = pil_img.crop(best_box.tolist())

        img = np.array(pil_img)

        # --- Attempt perspective correction ---------------------------------
        if img.ndim == 2:
            gray = img
        else:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edged = cv2.Canny(blurred, 75, 200)
        cnts, _ = cv2.findContours(edged.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)[:5]
        screen = None
        for c in cnts:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                screen = approx
                break

        if screen is not None:
            rect = _order_points(screen.reshape(4, 2))
            (tl, tr, br, bl) = rect
            widthA = np.linalg.norm(br - bl)
            widthB = np.linalg.norm(tr - tl)
            maxW = max(int(widthA), int(widthB))
            heightA = np.linalg.norm(tr - br)
            heightB = np.linalg.norm(tl - bl)
            maxH = max(int(heightA), int(heightB))
            dst = np.array(
                [[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]],
                dtype="float32",
            )
            M = cv2.getPerspectiveTransform(rect, dst)
            warped = cv2.warpPerspective(
                img, M, (maxW, maxH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
            )
        else:
            warped = img

        # --- Deskew ---------------------------------------------------------
        if warped.ndim == 2:
            gray = warped
        else:
            gray = cv2.cvtColor(warped, cv2.COLOR_RGB2GRAY)
        gray = cv2.bitwise_not(gray)
        thresh = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU
        )[1]
        coords = np.column_stack(np.where(thresh > 0))
        angle = cv2.minAreaRect(coords)[-1]
        angle = -(90 + angle) if angle < -45 else -angle
        (h, w) = warped.shape[:2]
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        cos = abs(M[0, 0])
        sin = abs(M[0, 1])
        nW = int((h * sin) + (w * cos))
        nH = int((h * cos) + (w * sin))
        M[0, 2] += (nW / 2) - w / 2
        M[1, 2] += (nH / 2) - h / 2
        rotated = cv2.warpAffine(
            warped, M, (nW, nH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
        )
        return Image.fromarray(rotated)
    except Exception as exc:
        app.logger.warning("Preprocess failed: %s", exc)
        return pil_img


@app.route('/api/preprocess', methods=['POST'])
def preprocess_route():
    if 'image' not in request.files:
        app.logger.warning('No image file received')
        return jsonify({'error': 'No image file'}), 400
    file = request.files['image']
    try:
        image = Image.open(file.stream).convert("RGB")
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
        image = Image.open(file.stream).convert("RGB")
    except Exception:
        app.logger.warning('Invalid image file')
        return jsonify({'error': 'Invalid image'}), 400
    app.logger.info('Running OCR on received image')
    image = preprocess_image(image)
    image_np = np.array(image)
    result = reader.readtext(image_np)
    text = "\n".join([item[1] for item in result])
    lines = [item[1] for item in result]
    return jsonify({'text': text, 'lines': lines})

if __name__ == '__main__':
    import os
    logging.basicConfig(level=logging.INFO)
    port = int(os.environ.get('OCR_PORT', 5000))
    logging.info('Starting OCR server')
    logging.info(' OCR_PORT=%s', os.environ.get('OCR_PORT', '5000 (default)'))
    app.run(host='0.0.0.0', port=port)
