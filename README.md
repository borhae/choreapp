# Chore App

A simple multi-user chore logging application with a Node.js backend and static frontend.

The chore entry field now supports autocomplete so you can reuse existing chore names quickly.

You can log out at any time using the **Logout** button in the app.

## Setup

Install dependencies:

```bash
npm install
```

Run the server:

```bash
node server/server.js
```

The app will be available at `http://localhost:3000`.

## Docker

You can also run the app in a container. Build the image:

```bash
docker build -t choreapp .
```

Start the container and mount a host file to persist the database:

```bash
docker run -p 3000:3000 \
  -v $(pwd)/db.json:/app/server/db.json \
  choreapp
```

The server uses `/app/server/db.json` by default. You can specify a different
location inside the container with the `DB_FILE` environment variable. Adjust
the mounted path accordingly:

```bash
docker run -p 3000:3000 \
  -e DB_FILE=/app/data/mydb.json \
  -v $(pwd)/mydb.json:/app/data/mydb.json \
  choreapp
```
