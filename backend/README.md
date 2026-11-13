# Umma Hospital Node.js backend

The browser app calls this Node.js API. The API stores users, appointments,
doctor availability, notes, and login sessions in MySQL. The frontend itself
does not connect directly to MySQL.

## Deploy on Google Cloud Run

The root `Dockerfile` packages the Node.js backend and the frontend files it
serves. Cloud Run can build this image from source; local Docker is not required.
Cloud SQL provides the MySQL database.

1. Sign in to Google Cloud, select or create a project, and enable billing.
   Cloud Run has a monthly free tier, but Cloud SQL and other resources can
   incur charges. Review current pricing before creating them.
2. Create a **Cloud SQL for MySQL** instance in the same region as the app.
   Create an application database and a dedicated database user. Configure
   automated backups before using real data.
3. From the repository root, deploy the app using Cloud Run's source deploy
   workflow (the root `Dockerfile` is used). In the Cloud Run service settings,
   attach the Cloud SQL instance and use a service account with the
   **Cloud SQL Client** role.
4. Configure these Cloud Run environment variables. Replace the connection
   name with the instance's `PROJECT:REGION:INSTANCE` value:

   ```text
   DB_SOCKET_PATH=/cloudsql/PROJECT:REGION:INSTANCE
   DB_USER=<Cloud SQL application user>
   DB_PASSWORD=<Cloud SQL application user's password>
   DB_NAME=<application database name>
   NODE_ENV=production
   SESSION_SECRET=<private random value of at least 32 characters>
   ```

   Use Secret Manager or Cloud Run's secret references for passwords and
   `SESSION_SECRET`; do not commit secret values. The Cloud SQL connection uses
   the mounted Unix socket, so `DB_SSL` is not needed for this connection.
5. Set the Cloud Run health check path to `/healthz` and allow unauthenticated
   access if this is a public website. Deploy and open the generated service
   URL.
6. To create the first administrator, temporarily add `ADMIN_NAME`,
   `ADMIN_EMAIL`, and `ADMIN_PASSWORD` using secret/environment settings, then
   deploy. The password must be at least 12 characters. Remove those three
   variables after the account is created; leaving them set resets the first
   admin account's email and password on every server startup.
7. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
   and `SMTP_FROM` through secret/environment settings if password-reset email
   is needed.

Never put production credentials in source control or chat. Test that database
backups can be restored. This project is a demo; do not store real patient or
other sensitive health data in it. A clinical deployment requires security,
privacy, regulatory, backup, and availability reviews appropriate to its
jurisdiction and use.

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
