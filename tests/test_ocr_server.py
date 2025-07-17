import io
import sys
import unittest
from unittest import mock

from PIL import Image
import numpy as np

# Allow importing the ocr_server module
sys.path.append('ocr-server')
import ocr_server

class OrderPointsTests(unittest.TestCase):
    def test_order_points_returns_ordered_points(self):
        # Points are intentionally scrambled
        pts = np.array([
            [10, 0],  # top-right
            [0, 10],  # bottom-left
            [10, 10], # bottom-right
            [0, 0],   # top-left
        ], dtype="float32")
        ordered = ocr_server._order_points(pts)
        expected = np.array([
            [0, 0],   # top-left
            [10, 0],  # top-right
            [10, 10], # bottom-right
            [0, 10],  # bottom-left
        ], dtype="float32")
        np.testing.assert_allclose(ordered, expected)

class PreprocessImageTests(unittest.TestCase):
    def test_preprocess_returns_image(self):
        img = Image.new("RGB", (50, 50), "white")
        result = ocr_server.preprocess_image(img)
        self.assertIsInstance(result, Image.Image)

class OcrApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ocr_server.app.test_client()

    def _make_image_bytes(self):
        img = Image.new("RGB", (20, 20), "white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf

    def test_preprocess_route_returns_png(self):
        resp = self.client.post(
            "/api/preprocess",
            data={"image": (self._make_image_bytes(), "test.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content_type, "image/png")
        # Verify returned bytes are a valid PNG image
        Image.open(io.BytesIO(resp.data))

    def test_preprocess_route_missing_image(self):
        resp = self.client.post("/api/preprocess", data={}, content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())

    def test_ocr_route_success(self):
        with mock.patch(
            "ocr_server.pytesseract.image_to_string", return_value="Hello\nWorld\n"
        ):
            resp = self.client.post(
                "/api/ocr",
                data={"image": (self._make_image_bytes(), "test.png")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["text"], "Hello\nWorld\n")
            self.assertEqual(data["lines"], ["Hello", "World"])

    def test_ocr_route_invalid_image(self):
        fake = io.BytesIO(b"not an image")
        resp = self.client.post(
            "/api/ocr",
            data={"image": (fake, "bad.txt")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())

    def test_ocr_route_missing_image(self):
        resp = self.client.post("/api/ocr", data={}, content_type="multipart/form-data")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())

if __name__ == "__main__":
    unittest.main()
