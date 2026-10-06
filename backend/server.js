"use strict";

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendPath = path.resolve(__dirname, "..");
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters in backend/.env.");
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});

const createPasswordResetMailer = () => {
    const requiredSettings = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"];
    if (requiredSettings.some((setting) => !process.env[setting])) return null;

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
        }
    });
};

class MySQLSessionStore extends session.Store {
    get(sid, callback) {
        pool.execute("SELECT data, expires_at FROM web_sessions WHERE sid = ?", [sid])
            .then(async ([rows]) => {
                const row = rows[0];
                if (!row) return callback(null, null);
                if (Number(row.expires_at) <= Date.now()) {
                    await pool.execute("DELETE FROM web_sessions WHERE sid = ?", [sid]);
                    return callback(null, null);
                }
                callback(null, JSON.parse(row.data));
            })
            .catch(callback);
    }

    set(sid, sessionData, callback = () => {}) {
        const expiresAt = sessionData.cookie?.expires
            ? new Date(sessionData.cookie.expires).getTime()
            : Date.now() + (sessionData.cookie?.maxAge || 24 * 60 * 60 * 1000);
        pool.execute(
            `INSERT INTO web_sessions (sid, expires_at, data)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), data = VALUES(data)`,
            [sid, expiresAt, JSON.stringify(sessionData)]
        ).then(() => callback()).catch(callback);
    }

    touch(sid, sessionData, callback = () => {}) {
        const expiresAt = sessionData.cookie?.expires
            ? new Date(sessionData.cookie.expires).getTime()
            : Date.now() + (sessionData.cookie?.maxAge || 24 * 60 * 60 * 1000);
        pool.execute(
            "UPDATE web_sessions SET expires_at = ? WHERE sid = ?",
            [expiresAt, sid]
        ).then(() => callback()).catch(callback);
    }

    destroy(sid, callback = () => {}) {
        pool.execute("DELETE FROM web_sessions WHERE sid = ?", [sid])
            .then(() => callback())
            .catch(callback);
    }
}

const sessionStore = new MySQLSessionStore();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(session({
    name: "umma.sid",
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const schema = [
    `CREATE TABLE IF NOT EXISTS web_sessions (
        sid VARCHAR(128) NOT NULL,
        expires_at BIGINT UNSIGNED NOT NULL,
        data MEDIUMTEXT NOT NULL,
        PRIMARY KEY (sid),
        KEY idx_web_sessions_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(160) NOT NULL,
        email VARCHAR(254) NOT NULL,
        role ENUM('patient', 'doctor', 'admin') NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        specialty VARCHAR(160) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS appointments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        patient_id BIGINT UNSIGNED NOT NULL,
        doctor_id BIGINT UNSIGNED NULL,
        slot_id BIGINT UNSIGNED NULL,
        reason TEXT NOT NULL,
        preferred_date DATE NULL,
        visit_date DATE NULL,
        visit_time TIME NULL,
        status ENUM('Requested', 'Scheduled', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Requested',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_appointments_patient (patient_id),
        KEY idx_appointments_doctor (doctor_id),
        CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES users (id),
        CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS doctor_slots (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        doctor_id BIGINT UNSIGNED NOT NULL,
        slot_date DATE NOT NULL,
        slot_time TIME NOT NULL,
        booked_by BIGINT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_doctor_slot (doctor_id, slot_date, slot_time),
        KEY idx_doctor_slots_date (slot_date, slot_time),
        CONSTRAINT fk_slots_doctor FOREIGN KEY (doctor_id) REFERENCES users (id),
        CONSTRAINT fk_slots_appointment FOREIGN KEY (booked_by) REFERENCES appointments (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS appointment_notes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        appointment_id BIGINT UNSIGNED NOT NULL,
        author_id BIGINT UNSIGNED NOT NULL,
        note_text TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notes_appointment (appointment_id, created_at),
        CONSTRAINT fk_notes_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
        CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS password_reset_codes (
        email VARCHAR(254) NOT NULL,
        role ENUM('patient', 'doctor', 'admin') NOT NULL,
        code_hash VARCHAR(60) NOT NULL,
        expires_at BIGINT UNSIGNED NOT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        requested_at BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (email, role),
        KEY idx_password_reset_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

const safeUser = (user) => ({
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    specialty: user.specialty || ""
});

const requireUser = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: "Please sign in to continue." });
    }
    next();
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
        return res.status(403).json({ error: "You are not allowed to perform this action." });
    }
    next();
};

const validRole = (role) => ["patient", "doctor", "admin"].includes(role);

app.get("/", (req, res) => res.sendFile(path.join(frontendPath, "index.html")));
app.get("/app.js", (req, res) => res.sendFile(path.join(frontendPath, "app.js")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(frontendPath, "styles.css")));

app.get("/api/session", (req, res) => {
    res.json({ user: req.session.user || null });
});

app.post("/api/users/check", async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const role = String(req.body.role || "");
        if (!email || !validRole(role)) {
            return res.status(400).json({ error: "Enter a valid email and account type." });
        }

        const [users] = await pool.execute(
            "SELECT id, name, email, role, specialty FROM users WHERE email = ? AND role = ?",
            [email, role]
        );
        res.json({ exists: users.length > 0, user: users[0] ? safeUser(users[0]) : null });
    } catch (error) {
        next(error);
    }
});

app.post("/api/users", async (req, res, next) => {
    try {
        const name = String(req.body.name || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        const role = String(req.body.role || "");
        const specialty = role === "doctor" ? String(req.body.specialty || "").trim() : null;

        if (!name || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            email.length > 254 || password.length < 4 || !validRole(role) ||
            (role === "doctor" && !specialty)) {
            return res.status(400).json({ error: "Please provide valid registration details." });
        }

        if (role === "admin") {
            return res.status(403).json({
                error: "Admin accounts must be created by the system owner using the backend setup instructions."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const [result] = await pool.execute(
            "INSERT INTO users (name, email, role, password_hash, specialty) VALUES (?, ?, ?, ?, ?)",
            [name, email, role, passwordHash, specialty]
        );
        res.status(201).json({ id: Number(result.insertId) });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ error: "That email is already registered." });
        }
        next(error);
    }
});

app.post("/api/users/login", async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        const role = String(req.body.role || "");
        const [users] = await pool.execute(
            "SELECT id, name, email, role, specialty, password_hash FROM users WHERE email = ? AND role = ?",
            [email, role]
        );
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: "Invalid email or password." });
        }

        req.session.user = safeUser(user);
        req.session.save((error) => {
            if (error) return next(error);
            res.json({ user: req.session.user });
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/users/password-reset/request", async (req, res, next) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validRole(role)) {
        return res.status(400).json({ error: "Enter a valid email and account type." });
    }

    const mailer = createPasswordResetMailer();
    if (!mailer) {
        return res.status(503).json({
            error: "Password reset email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in backend/.env."
        });
    }

    try {
        const [users] = await pool.execute(
            "SELECT id FROM users WHERE email = ? AND role = ?",
            [email, role]
        );
        const genericMessage = "If an account matches those details, a reset code will be emailed.";
        if (!users.length) return res.json({ message: genericMessage });

        const now = Date.now();
        const [existingCodes] = await pool.execute(
            "SELECT requested_at FROM password_reset_codes WHERE email = ? AND role = ?",
            [email, role]
        );
        if (existingCodes.length && now - Number(existingCodes[0].requested_at) < 60_000) {
            return res.json({ message: genericMessage });
        }

        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = await bcrypt.hash(code, 10);
        await pool.execute(
            `INSERT INTO password_reset_codes
                (email, role, code_hash, expires_at, attempts, requested_at)
             VALUES (?, ?, ?, ?, 0, ?)
             ON DUPLICATE KEY UPDATE
                code_hash = VALUES(code_hash),
                expires_at = VALUES(expires_at),
                attempts = 0,
                requested_at = VALUES(requested_at)`,
            [email, role, codeHash, now + 10 * 60_000, now]
        );

        try {
            await mailer.sendMail({
                from: process.env.SMTP_FROM,
                to: email,
                subject: "Your Umma Hospital password reset code",
                text: `Your Umma Hospital password reset code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
                html: `<p>Your Umma Hospital password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`
            });
        } catch (mailError) {
            await pool.execute(
                "DELETE FROM password_reset_codes WHERE email = ? AND role = ?",
                [email, role]
            );
            throw mailError;
        }

        res.json({ message: genericMessage });
    } catch (error) {
        next(error);
    }
});

app.post("/api/users/password-reset/complete", async (req, res, next) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "");
    const code = String(req.body.code || "").trim();
    const password = String(req.body.password || "");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validRole(role) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Enter a valid email, account type, and six-digit reset code." });
    }
    if (password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: "Your new password must be between 8 and 72 characters." });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [codes] = await connection.execute(
            `SELECT code_hash, expires_at, attempts
             FROM password_reset_codes
             WHERE email = ? AND role = ?
             FOR UPDATE`,
            [email, role]
        );
        const reset = codes[0];
        if (!reset || Number(reset.expires_at) <= Date.now() || Number(reset.attempts) >= 5) {
            await connection.rollback();
            return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
        }

        if (!(await bcrypt.compare(code, reset.code_hash))) {
            await connection.execute(
                "UPDATE password_reset_codes SET attempts = attempts + 1 WHERE email = ? AND role = ?",
                [email, role]
            );
            await connection.commit();
            return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
        }

        const [users] = await connection.execute(
            "SELECT id FROM users WHERE email = ? AND role = ? FOR UPDATE",
            [email, role]
        );
        if (!users.length) {
            await connection.rollback();
            return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        await connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            [passwordHash, users[0].id]
        );
        await connection.execute(
            "DELETE FROM password_reset_codes WHERE email = ? AND role = ?",
            [email, role]
        );
        await connection.commit();
        res.json({ message: "Password updated. Sign in using your new password." });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
});

app.post("/api/logout", requireUser, (req, res, next) => {
    req.session.destroy((error) => {
        if (error) return next(error);
        res.clearCookie("umma.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });
        res.json({ ok: true });
    });
});

app.get("/api/data", requireUser, async (req, res, next) => {
    try {
        const user = req.session.user;
        const [users] = await pool.execute(
            "SELECT id, name, role, specialty FROM users ORDER BY name"
        );

        let appointmentSql = `SELECT a.id, a.patient_id AS pid, a.doctor_id AS did,
                a.slot_id AS sid, a.reason, a.preferred_date AS pref,
                a.visit_date AS date, TIME_FORMAT(a.visit_time, '%H:%i') AS time,
                a.status
            FROM appointments a`;
        let appointmentParams = [];

        if (user.role === "patient") {
            appointmentSql += " WHERE a.patient_id = ?";
            appointmentParams = [user.id];
        } else if (user.role === "doctor") {
            appointmentSql += ` WHERE a.doctor_id = ?
                OR a.patient_id IN (
                    SELECT patient_id FROM appointments WHERE doctor_id = ?
                )`;
            appointmentParams = [user.id, user.id];
        }
        appointmentSql += " ORDER BY a.created_at DESC";

        const [appointments] = await pool.execute(appointmentSql, appointmentParams);
        const [notes] = await pool.execute(
            `SELECT n.appointment_id AS appointmentId, n.note_text AS text,
                    u.name AS byName, DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i') AS at
             FROM appointment_notes n
             JOIN users u ON u.id = n.author_id
             ORDER BY n.created_at`
        );
        const notesByAppointment = new Map();
        for (const note of notes) {
            const list = notesByAppointment.get(Number(note.appointmentId)) || [];
            list.push({ text: note.text, by: note.byName, at: note.at });
            notesByAppointment.set(Number(note.appointmentId), list);
        }

        const [slots] = user.role === "admin"
            ? await pool.execute(
                `SELECT id, doctor_id AS did, slot_date AS date,
                        TIME_FORMAT(slot_time, '%H:%i') AS time, booked_by AS taken
                 FROM doctor_slots ORDER BY slot_date, slot_time`
            )
            : user.role === "doctor"
                ? await pool.execute(
                    `SELECT id, doctor_id AS did, slot_date AS date,
                            TIME_FORMAT(slot_time, '%H:%i') AS time, booked_by AS taken
                     FROM doctor_slots WHERE doctor_id = ? ORDER BY slot_date, slot_time`,
                    [user.id]
                )
                : [ [] ];

        const formattedAppointments = appointments.map((appointment) => ({
            ...appointment,
            id: Number(appointment.id),
            pid: Number(appointment.pid),
            did: appointment.did === null ? null : Number(appointment.did),
            sid: appointment.sid === null ? null : Number(appointment.sid),
            date: appointment.date || "",
            pref: appointment.pref || "",
            time: appointment.time || "",
            notes: notesByAppointment.get(Number(appointment.id)) || []
        }));

        res.json({
            currentUser: user,
            users: users.map(safeUser),
            appts: formattedAppointments,
            slots: slots.map((slot) => ({
                ...slot,
                id: Number(slot.id),
                did: Number(slot.did),
                taken: slot.taken === null ? null : Number(slot.taken)
            }))
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/appointments", requireRole("patient"), async (req, res, next) => {
    try {
        const reason = String(req.body.reason || "").trim();
        const preferredDate = req.body.preferred_date || null;
        if (!reason) return res.status(400).json({ error: "Please provide a reason for the appointment." });

        const [result] = await pool.execute(
            "INSERT INTO appointments (patient_id, reason, preferred_date) VALUES (?, ?, ?)",
            [req.session.user.id, reason, preferredDate]
        );
        res.status(201).json({ id: Number(result.insertId) });
    } catch (error) {
        next(error);
    }
});

app.post("/api/appointments/:id/cancel", requireUser, async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            "SELECT id, patient_id, slot_id, status FROM appointments WHERE id = ? FOR UPDATE",
            [req.params.id]
        );
        const appointment = rows[0];
        if (!appointment) {
            await connection.rollback();
            return res.status(404).json({ error: "Appointment not found." });
        }
        const user = req.session.user;
        if (user.role !== "admin" && Number(appointment.patient_id) !== Number(user.id)) {
            await connection.rollback();
            return res.status(403).json({ error: "You cannot cancel this appointment." });
        }

        if (appointment.slot_id) {
            await connection.execute("UPDATE doctor_slots SET booked_by = NULL WHERE booked_by = ?", [appointment.id]);
        }
        await connection.execute(
            `UPDATE appointments
             SET status = 'Cancelled', slot_id = NULL, doctor_id = NULL,
                 visit_date = NULL, visit_time = NULL
             WHERE id = ?`,
            [appointment.id]
        );
        await connection.commit();
        res.json({ ok: true });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
});

app.post("/api/appointments/:id/assign", requireRole("admin"), async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [appointments] = await connection.execute(
            "SELECT id, status, slot_id FROM appointments WHERE id = ? FOR UPDATE",
            [req.params.id]
        );
        const appointment = appointments[0];
        if (!appointment || ["Completed", "Cancelled"].includes(appointment.status)) {
            await connection.rollback();
            return res.status(404).json({ error: "This appointment cannot be assigned." });
        }

        const [slots] = await connection.execute(
            `SELECT id, doctor_id, slot_date, slot_time, booked_by
             FROM doctor_slots WHERE id = ? FOR UPDATE`,
            [req.body.slot_id]
        );
        const slot = slots[0];
        if (!slot || (slot.booked_by && Number(slot.booked_by) !== Number(appointment.id))) {
            await connection.rollback();
            return res.status(409).json({ error: "That time slot is no longer available." });
        }

        if (appointment.slot_id) {
            await connection.execute("UPDATE doctor_slots SET booked_by = NULL WHERE id = ?", [appointment.slot_id]);
        }
        await connection.execute(
            "UPDATE doctor_slots SET booked_by = ? WHERE id = ?",
            [appointment.id, slot.id]
        );
        await connection.execute(
            `UPDATE appointments
             SET slot_id = ?, doctor_id = ?, visit_date = ?, visit_time = ?, status = 'Scheduled'
             WHERE id = ?`,
            [slot.id, slot.doctor_id, slot.slot_date, slot.slot_time, appointment.id]
        );
        await connection.commit();
        res.json({ ok: true });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
});

app.post("/api/appointments/:id/notes", requireRole("doctor"), async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const text = String(req.body.text || "").trim();
        if (!text) return res.status(400).json({ error: "Note text is required." });

        await connection.beginTransaction();
        const [appointments] = await connection.execute(
            "SELECT id FROM appointments WHERE id = ? AND doctor_id = ? AND status = 'Scheduled' FOR UPDATE",
            [req.params.id, req.session.user.id]
        );
        if (!appointments.length) {
            await connection.rollback();
            return res.status(404).json({ error: "Scheduled appointment not found." });
        }
        await connection.execute(
            "INSERT INTO appointment_notes (appointment_id, author_id, note_text) VALUES (?, ?, ?)",
            [req.params.id, req.session.user.id, text]
        );
        await connection.execute(
            "UPDATE appointments SET status = 'Completed' WHERE id = ?",
            [req.params.id]
        );
        await connection.commit();
        res.status(201).json({ ok: true });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
});

app.post("/api/slots", requireRole("doctor"), async (req, res, next) => {
    try {
        const { date, time } = req.body;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ||
            !/^\d{2}:\d{2}$/.test(String(time || ""))) {
            return res.status(400).json({ error: "Enter a valid date and time." });
        }
        const [result] = await pool.execute(
            "INSERT INTO doctor_slots (doctor_id, slot_date, slot_time) VALUES (?, ?, ?)",
            [req.session.user.id, date, time]
        );
        res.status(201).json({ id: Number(result.insertId) });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ error: "You already added that available time." });
        }
        next(error);
    }
});

app.delete("/api/slots/:id", requireRole("doctor"), async (req, res, next) => {
    try {
        const [result] = await pool.execute(
            "DELETE FROM doctor_slots WHERE id = ? AND doctor_id = ? AND booked_by IS NULL",
            [req.params.id, req.session.user.id]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ error: "Available time not found or already booked." });
        }
        res.json({ ok: true });
    } catch (error) {
        next(error);
    }
});

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found." }));

app.use((error, req, res, next) => {
    console.error("Request failed:", error);
    if (res.headersSent) return next(error);
    if (error.code === "ER_NO_REFERENCED_ROW_2" || error.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({ error: "This record is still in use and cannot be changed." });
    }
    res.status(500).json({ error: "A server error occurred. Check the backend terminal for details." });
});

async function initializeDatabase() {
    if (!process.env.DB_NAME || !process.env.DB_USER) {
        throw new Error("Set DB_NAME and DB_USER in backend/.env before starting the server.");
    }

    for (const statement of schema) {
        await pool.query(statement);
    }
    await pool.execute("DELETE FROM web_sessions WHERE expires_at <= ?", [Date.now()]);

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (adminEmail || adminPassword) {
        if (!adminEmail || !adminPassword) {
            throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env.");
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
            throw new Error("ADMIN_EMAIL in backend/.env must be a valid email address.");
        }
        if (adminPassword.length < 12) {
            throw new Error("ADMIN_PASSWORD in backend/.env must be at least 12 characters.");
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [admins] = await connection.execute(
                "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1 FOR UPDATE"
            );
            const [emailMatches] = await connection.execute(
                "SELECT id, role FROM users WHERE email = ? FOR UPDATE",
                [adminEmail]
            );
            const emailBelongsToOtherAccount = emailMatches.some(
                (user) => !admins[0] || Number(user.id) !== Number(admins[0].id)
            );
            if (emailBelongsToOtherAccount) {
                throw new Error("ADMIN_EMAIL is already used by another account. Choose an unused email.");
            }

            const passwordHash = await bcrypt.hash(adminPassword, 12);
            const adminName = String(process.env.ADMIN_NAME || "System Administrator").trim();
            if (admins.length) {
                await connection.execute(
                    `UPDATE users
                     SET name = ?, email = ?, password_hash = ?, specialty = ?
                     WHERE id = ?`,
                    [adminName, adminEmail, passwordHash, "Hospital Management", admins[0].id]
                );
                const [sessions] = await connection.execute(
                    "SELECT sid, data FROM web_sessions"
                );
                const oldAdminSessions = sessions
                    .filter((storedSession) => {
                        const sessionData = JSON.parse(storedSession.data);
                        return Number(sessionData.user?.id) === Number(admins[0].id);
                    })
                    .map((storedSession) => storedSession.sid);
                if (oldAdminSessions.length) {
                    await connection.query(
                        "DELETE FROM web_sessions WHERE sid IN (?)",
                        [oldAdminSessions]
                    );
                }
                console.log("Updated the existing admin account from backend/.env.");
            } else {
                await connection.execute(
                    "INSERT INTO users (name, email, role, password_hash, specialty) VALUES (?, ?, 'admin', ?, ?)",
                    [adminName, adminEmail, passwordHash, "Hospital Management"]
                );
                console.log("Created the initial admin account from backend/.env.");
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Umma Hospital app running at http://localhost:${port}`);
    });
}).catch((error) => {
    console.error("Could not initialize the MySQL backend:", error);
    process.exitCode = 1;
});
