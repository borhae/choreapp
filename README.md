# Chore App

A multi-user chore logging application with a Node.js backend and a frontend built with React. The UI uses [Tailwind CSS](https://tailwindcss.com/) themed with colors inspired by Pantone 564 and Pantone 604.

The main `index.html` page now renders a React based chore tracker. The chore entry
field supports autocomplete so you can reuse existing chore names quickly.

You can log out at any time using the **Logout** button in the app.

There is also a **Week overview** page showing the current week's chores. It
lists chores in rows with days of the week as columns and displays the first
three letters of each user's name when they completed a chore on that day.

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

Authentication tokens expire after **1 day**, so you'll need to log in again once a token has expired.

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
