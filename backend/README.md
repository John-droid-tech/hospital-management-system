# Umma Hospital Node.js backend

The browser app calls this Node.js API. The API stores users, appointments,
doctor availability, notes, and login sessions in MySQL. The frontend itself
does not connect directly to MySQL.

## Deploy on Railway

The root `Dockerfile` packages the Node.js backend and the frontend files it
serves. The root `.dockerignore` keeps local environment files and dependencies
out of the image.

1. Push this repository to a GitHub repository connected to your Railway
   account.
2. Create a Railway project and add a **MySQL** database service. Wait for it
   to finish deploying.
3. Add a service from the GitHub repository. Leave the root directory at the
   repository root so Railway detects the root `Dockerfile`.
4. In the app service's **Variables**, add the database variables as references
   to the MySQL service. Replace `MySQL` with the exact database service name
   if it differs:

   ```text
   DB_HOST=${{MySQL.MYSQLHOST}}
   DB_PORT=${{MySQL.MYSQLPORT}}
   DB_USER=${{MySQL.MYSQLUSER}}
   DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
   DB_NAME=${{MySQL.MYSQLDATABASE}}
   DB_SSL=false
   NODE_ENV=production
   SESSION_SECRET=<generate a private random value of at least 32 characters>
   ```

   Add a generated secret directly in Railway, not to this repository or chat.
   The private Railway MySQL connection does not need public database access.
5. In the app service's **Settings**, set the healthcheck path to `/healthz`,
   then deploy. After deployment, generate a public domain from the service's
   **Networking** settings and open it to verify the site.
6. To create the initial administrator, temporarily add `ADMIN_NAME`,
   `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the app service's Variables and
   redeploy. The password must be at least 12 characters. Remove these three
   variables after the admin account is created; leaving them set resets the
   first admin account's email and password on every server startup.
7. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
   and `SMTP_FROM` as app-service variables if password-reset email is needed.

Never put production credentials in source control or chat. Configure database
backups in Railway and test that you can restore them. This project is a demo;
do not store real patient or other sensitive health data in it. A clinical
deployment requires security, privacy, regulatory, backup, and availability
reviews appropriate to its jurisdiction and use.

## Setup

1. Install Node.js and MySQL.
2. Create a MySQL database:

   ```sql
   CREATE DATABASE umma_hospital
     CHARACTER SET utf8mb4
     COLLATE utf8mb4_unicode_ci;
   ```

3. Open `backend/.env` and enter the MySQL username and password for your
   local MySQL server. A private session secret is already generated there.
   If you delete `.env`, copy `.env.example` to `.env` and set a private
   `SESSION_SECRET` value of at least 32 characters.
4. From the `backend` folder, install and start the server:

   ```powershell
   npm install
   npm start
   ```

5. Leave the terminal running and open `http://localhost:3000` in your
   browser. Do not open `index.html` directly as a `file://` URL; the frontend
   needs the Node.js server to reach the MySQL API.

The server creates the required application and session tables at startup.
Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to create the first admin account.
On a later restart, those settings replace the email/password of the first
admin account. The password must be at least 12 characters. The email must
not already belong to a different account. Keep `.env` private.

Patient and doctor accounts can register through the app. Admin accounts are
created by the system owner using the optional environment settings above.

## Password reset email

The forgot-password flow emails a six-digit code to the account email address.
Codes are stored hashed in MySQL, expire after 10 minutes, allow at most five
verification attempts, and can only be requested once per minute per account.
The reset form saves a new password hash only after a valid code is verified.

For Gmail, enable 2-Step Verification for the sending account and create a
Google App Password. Add these settings to `backend/.env` (do not use your
normal Gmail password):

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sending-gmail@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_FROM=Umma Hospital <your-sending-gmail@gmail.com>
```

`SMTP_USER` is the Gmail account that sends the reset email; it does not have
to be the admin login email. Restart Node.js after updating `.env`. Never
commit or share `.env`.

## API

The frontend and API are served from the same Node.js process. API routes are
under `/api`; session cookies are HTTP-only and appointment/availability
operations are checked against the signed-in account's role.
