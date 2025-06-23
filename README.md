# Chore App

A multi-user chore logging application with a Node.js backend and a frontend built with React. The UI uses [Tailwind CSS](https://tailwindcss.com/) themed with colors inspired by Pantone 564 and Pantone 604.

The main `index.html` page now renders a React based chore tracker. The chore entry
field supports autocomplete so you can reuse existing chore names quickly. You can
also choose the weekday before adding a chore so it is logged for that day.

You can log out at any time using the **Logout** button in the app.

Users can personalize their profile with an avatar. Click the **Edit** button next to your avatar to choose from a few cute emoji presets, pick from previously uploaded images, or upload your own.


Chores can be organized into **groups**. When adding a chore you may specify a
group name. Groups are created automatically and inputs provide autocomplete
suggestions. Weekly overviews and log pages now group chores under their group
heading.

All open pages stay in sync thanks to a WebSocket connection. When a chore is
added or removed in one browser, other connected clients update instantly.

## Setup

Install dependencies:

```bash
npm install
```

Run the server:

```bash
node node-server/server.js
```

The app will be available at `http://localhost:3000`.


## Docker

You can also run the app in containers. Build the images:

Authentication tokens expire after **1 day**, so you'll need to log in again once a token has expired.

```bash
docker build -t choreapp-node -f node-server/Dockerfile .
docker build -t choreapp-ocr -f ocr-server/Dockerfile .
```

Start the Node backend and mount a host file to persist the database:

```bash
docker run -p 3000:3000 \
  -v $(pwd)/db.json:/app/data/db.json \
  choreapp-node
```

The server uses `/app/data/db.json` by default. You can specify a different
location inside the container with the `DB_FILE` environment variable. Adjust
the mounted path accordingly:

```bash
docker run -p 3000:3000 \
  -e DB_FILE=/app/data/mydb.json \
  -v $(pwd)/mydb.json:/app/data/mydb.json \
  choreapp-node
```

Run the OCR service in a separate container:

```bash
docker run -p 5000:5000 choreapp-ocr
```

## Admin page

Visit `http://localhost:3000/admin.html` for administrative tasks. The
login uses the `ADMIN_USER` and `ADMIN_PASS` environment variables
(defaults are `admin` / `adminpass`). After authentication you can view
and delete uploaded avatar images.

## OCR Backend

An additional microservice provides optical character recognition for images of printed tables filled out by hand. It is packaged as a separate Docker image and listens on port `5000`.

To run the OCR service outside the container:

```bash
pip install -r ocr-server/requirements.txt
python3 ocr-server/ocr_server.py
```

Send a POST request with an image file under the `image` form field to `http://localhost:5000/api/ocr` and you will receive the recognized text lines as JSON.
