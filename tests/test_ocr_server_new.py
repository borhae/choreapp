import io
import sys
import unittest
from unittest import mock

from PIL import Image
import numpy as np

# Allow importing the ocr_server module
sys.path.append('ocr-server')
import ocr_server

class OcrApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = ocr_server.app.test_client()

    def _make_image_bytes(self, size=(20, 20)):
        img = Image.new("RGB", size, "white")
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
            "ocr_server.reader.readtext", return_value=[([[0, 0], [10, 0], [10, 10], [0, 10]], "Hello", 0.9), ([[20, 20], [30, 20], [30, 30], [20, 30]], "World", 0.9)]
        ):
            resp = self.client.post(
                "/api/ocr",
                data={"image": (self._make_image_bytes(), "test.png")},
                content_type="multipart/form-data",
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["text"], "Hello\nWorld")
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

    def test_table_detection(self):
        # Create a dummy image with a black box in it
        img = Image.new("RGB", (500, 500), "white")
        for x in range(100, 200):
            for y in range(150, 250):
                img.putpixel((x, y), (0, 0, 0))

        # a table should be detected and the image cropped
        processed = ocr_server.preprocess_image(img)
        self.assertLess(processed.size[0], 500)
        self.assertLess(processed.size[1], 500)


if __name__ == "__main__":
    unittest.main()
