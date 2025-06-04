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

Authentication tokens expire after **1 day**, so you'll need to log in again once a token has expired.
