Umma Hospital Node.js backend
The browser app calls this Node.js API. The API stores users, appointments, doctor availability, notes, and login sessions in MySQL. The frontend itself does not connect directly to MySQL.

Setup
Install Node.js and MySQL.

Create a MySQL database:

CREATE DATABASE umma_hospital
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
Open backend/.env and enter the MySQL username and password for your local MySQL server. A private session secret is already generated there. If you delete .env, copy .env.example to .env and set a private SESSION_SECRET value of at least 32 characters.

From the backend folder, install and start the server:

npm install
npm start
Leave the terminal running and open http://localhost:3000 in your browser. Do not open index.html directly as a file:// URL; the frontend needs the Node.js server to reach the MySQL API.

The server creates the required application and session tables at startup. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin account. On a later restart, those settings replace the email/password of the first admin account. The password must be at least 12 characters. The email must not already belong to a different account. Keep .env private.

Patient and doctor accounts can register through the app. Admin accounts are created by the system owner using the optional environment settings above.

Password reset email
The forgot-password flow emails a six-digit code to the account email address. Codes are stored hashed in MySQL, expire after 10 minutes, allow at most five verification attempts, and can only be requested once per minute per account. The reset form saves a new password hash only after a valid code is verified.

For Gmail, enable 2-Step Verification for the sending account and create a Google App Password. Add these settings to backend/.env (do not use your normal Gmail password):

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-sending-gmail@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_FROM=Umma Hospital <your-sending-gmail@gmail.com>
SMTP_USER is the Gmail account that sends the reset email; it does not have to be the admin login email. Restart Node.js after updating .env. Never commit or share .env.

API
The frontend and API are served from the same Node.js process. API routes are under /api; session cookies are HTTP-only and appointment/availability operations are checked against the signed-in account's role.
