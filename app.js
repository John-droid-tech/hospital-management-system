// ============================================================
// UMMA HOSPITAL MANAGEMENT SYSTEM
// Frontend connected to Node.js + MariaDB/MySQL
// ============================================================
const API = "/api";
let data = {
    users: [],
    appts: [],
    slots: []
};

let meId = null;

let auth = {
    role: "patient",
    email: "",
    step: 0,
    user: null,
    err: "",
    msg: ""
};

// ============================================================
// LOAD DATA FROM THE NODE.JS API
// ============================================================

const request = async (route, options = {}) => {
    const response = await fetch(`${API}${route}`, {
        credentials: "same-origin",
        ...options
    });
    const result = await response.json();
    if (!response.ok) {
        throw new Error(result.error || "The request could not be completed.");
    }
    return result;
};

const refreshData = async () => {
    const result = await request("/data");
    data = {
        users: result.users || [],
        appts: result.appts || [],
        slots: result.slots || []
    };
    meId = Number(result.currentUser.id);
};

// ============================================================
// HELPERS
// ============================================================

const esc = (s) =>
    String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[c])
    );

const tpl = (id, vars = {}) =>
    document
        .getElementById(id)
        .innerHTML
        .replace(
            /{{(\w+)}}/g,
            (_, k) =>
                k.endsWith("Html")
                    ? vars[k] ?? ""
                    : esc(vars[k])
        );

const userById = (id) =>
    data.users.find((u) => Number(u.id) === Number(id));

const me = () => userById(meId);

const titles = {
    patient: "Patient",
    doctor: "Doctor",
    admin: "Admin"
};

const byTime = (a, b) =>
    (a.date + a.time).localeCompare(
        b.date + b.time
    );

const empty = (text) =>
    tpl("t-empty", { text });

const when = (a) =>
    a.date
        ? `${a.date} at ${a.time}`
        : "Time not set yet";

const doctorPrefix = (a) => {
    const doctor = userById(a.did);

    return doctor
        ? doctor.name + " · "
        : "";
};

const header = (user) =>
    tpl("t-header", {
        name: user.name,
        title: titles[user.role]
    });

const slotLabel = (s) => {
    const d = userById(s.did);

    return d
        ? `${d.name} (${d.spec || d.specialty || ""}) · ${s.date} ${s.time}`
        : `${s.date} ${s.time}`;
};

const noteList = (a) =>
    (a.notes || [])
        .map((n) =>
            tpl("t-note", {
                text: n.text,
                by: n.by,
                at: n.at
            })
        )
        .join("");

// ============================================================
// AUTHENTICATION SCREEN
// ============================================================

function authScreen() {

    const {
        role,
        user
    } = auth;

    const rolesHtml = Object.keys(titles)
        .map((k) =>
            tpl("t-role", {
                role: k,
                title: titles[k],
                pressed: k === role
            })
        )
        .join("");

    let bodyHtml;

    if (auth.chooseRole) {

        bodyHtml = tpl("t-role-selection", {
            rolesHtml
        });

    } else if (auth.resetMode) {

        bodyHtml = auth.resetStage === "complete"
            ? tpl("t-reset-complete", {
                msg: auth.msg,
                err: auth.err
            })
            : tpl("t-reset-request", {
                email: auth.email,
                err: auth.err
            });

    } else if (auth.adminSetupRequired) {

        bodyHtml = tpl("t-admin-setup");

    } else if (auth.step === 0) {

        bodyHtml = tpl("t-email", {
            email: auth.email,
            err: auth.err
        });

    } else if (user) {

        const greetingHtml = auth.msg
            ? tpl("t-greet-new", {
                msg: auth.msg
            })
            : tpl("t-greet-back", {
                name: user.name
            });

        bodyHtml = tpl("t-signin", {
            greetingHtml,
            signinEmailHtml: role === "admin"
                ? tpl("t-signin-account", { email: auth.email })
                : "",
            passwordToggleHtml: role === "admin" ? tpl("t-password-toggle") : "",
            err: auth.err
        });

    } else {

        bodyHtml = tpl("t-register", {
            role,
            email: auth.email,
            err: auth.err,
            specHtml:
                role === "doctor"
                    ? tpl("t-spec")
                    : ""
        });
    }

    return tpl("t-auth", {
        rolesHtml: auth.chooseRole ? "" : rolesHtml,
        bodyHtml
    });
}

// ============================================================
// PATIENT SCREEN
// ============================================================

function patientScreen(user) {

    const visitsHtml = data.appts
        .filter(
            (a) =>
                Number(a.pid) === Number(user.id)
        )
        .reverse()
        .map((a) =>
            tpl("t-visit", {
                reason: a.reason,
                doctor: doctorPrefix(a),
                when: when(a),
                status: a.status,
                cls:
                    a.status === "Cancelled"
                        ? "no"
                        : a.status === "Completed"
                            ? "ok"
                            : "",
                notesHtml: noteList(a)
            })
        )
        .join("");

    return tpl("t-patient", {
        headerHtml: header(user),
        visitsHtml:
            visitsHtml ||
            empty("No requests yet.")
    });
}

// ============================================================
// ADMIN SCREEN
// ============================================================

function adminScreen(user) {

    const freeSlots = data.slots
        .filter((s) => !s.taken)
        .sort(byTime);

    const appts = [...data.appts].sort(
        (a, b) =>
            (a.status === "Requested" ? 0 : 1) -
                (b.status === "Requested" ? 0 : 1) ||
            b.id - a.id
    );

    const doctorsHtml = data.users
        .filter((u) => u.role === "doctor")
        .map((d) => {

            const times = freeSlots.filter(
                (s) =>
                    Number(s.did) ===
                    Number(d.id)
            );

            return tpl("t-doctor-row", {
                name: d.name,
                spec: d.spec || d.specialty || "",

                timesHtml: times.length
                    ? times
                        .map((s) =>
                            tpl("t-time", {
                                date: s.date,
                                time: s.time
                            })
                        )
                        .join("")
                    : tpl("t-no-times")
            });
        })
        .join("");

    const apptsHtml = appts
        .map((a) => {

            const finished =
                a.status === "Completed" ||
                a.status === "Cancelled";

            const optionsHtml = data.slots
                .filter(
                    (s) =>
                        !s.taken ||
                        Number(s.id) ===
                        Number(a.sid)
                )
                .sort(byTime)
                .map((s) =>
                    tpl(
                        Number(s.id) ===
                            Number(a.sid)
                            ? "t-option-selected"
                            : "t-option",
                        {
                            id: s.id,
                            label: slotLabel(s)
                        }
                    )
                )
                .join("");

            const controlsHtml = finished
                ? tpl("t-assign-done", {
                    doctor: doctorPrefix(a),
                    when: when(a)
                })
                : tpl("t-assign-controls", {
                    id: a.id,
                    optionsHtml,
                    action:
                        a.status === "Requested"
                            ? "Assign time"
                            : "Reschedule"
                });

            return tpl("t-assign", {
                id: a.id,
                patient:
                    userById(a.pid)?.name ||
                    "Unknown patient",
                reason: a.reason,
                pref: a.pref
                    ? " · prefers " + a.pref
                    : "",
                status: a.status,
                controlsHtml
            });
        })
        .join("");

    return tpl("t-admin", {
        headerHtml: header(user),

        doctorsHtml:
            doctorsHtml ||
            empty("No doctors registered yet."),

        apptsHtml:
            apptsHtml ||
            empty("No appointment requests yet.")
    });
}

// ============================================================
// DOCTOR SCREEN
// ============================================================

function doctorScreen(user) {

    const slotsHtml = data.slots
        .filter(
            (s) =>
                Number(s.did) ===
                Number(user.id)
        )
        .sort(byTime)
        .map((s) =>
            tpl("t-slot", {
                date: s.date,
                time: s.time,
                state: s.taken
                    ? "Booked by admin"
                    : "Free",

                removeHtml: s.taken
                    ? ""
                    : tpl("t-remove", {
                        id: s.id
                    })
            })
        )
        .join("");

    const patientsHtml = data.appts
        .filter(
            (a) =>
                Number(a.did) ===
                    Number(user.id) &&
                a.status !== "Cancelled"
        )
        .sort(
            (a, b) =>
                (a.status === "Scheduled"
                    ? 0
                    : 1) -
                    (b.status === "Scheduled"
                        ? 0
                        : 1) ||
                byTime(a, b)
        )
        .map((a) => {

            const earlier =
                data.appts.filter(
                    (o) =>
                        Number(o.pid) ===
                            Number(a.pid) &&
                        o.id !== a.id &&
                        (o.notes || []).length
                );

            return tpl("t-patient-form", {

                id: a.id,

                patient:
                    userById(a.pid)?.name ||
                    "Unknown patient",

                reason: a.reason,

                when: when(a),

                status: a.status,

                cls:
                    a.status === "Completed"
                        ? "ok"
                        : "",

                historyHtml:
                    earlier.length
                        ? tpl("t-history", {
                            notesHtml:
                                earlier
                                    .map(noteList)
                                    .join("")
                        })
                        : "",

                thisVisitHtml:
                    (a.notes || []).length
                        ? tpl("t-this-visit", {
                            notesHtml:
                                noteList(a)
                        })
                        : ""
            });
        })
        .join("");

    return tpl("t-doctor", {

        headerHtml: header(user),

        slotsHtml:
            slotsHtml ||
            empty(
                "You have not added any available times yet."
            ),

        patientsHtml:
            patientsHtml ||
            empty(
                "No patients assigned yet."
            )
    });
}

// ============================================================
// RENDER
// ============================================================

function render() {

    const user = me();

    if (meId && !user) {
        meId = null;
    }

    const screens = {
        patient: patientScreen,
        doctor: doctorScreen,
        admin: adminScreen
    };

    document.getElementById("app").innerHTML =
        user
            ? screens[user.role](user)
            : authScreen();
}

// ============================================================
// SIGN IN
// ============================================================

async function signIn(user) {
    meId = Number(user.id);
    await refreshData();

    auth = {
        role: "patient",
        email: "",
        step: 0,
        user: null,
        err: "",
        msg: ""
    };
}

// ============================================================
// BUTTON CLICKS
// ============================================================

document.addEventListener(
    "click",
    async (e) => {

        const btn =
            e.target.closest("button");

        if (!btn) return;

        const d = btn.dataset;

        if ("togglePassword" in d) {
            const passwordInput = document.getElementById("signin-password");
            if (!passwordInput) return;

            const isVisible = passwordInput.type === "text";
            passwordInput.type = isVisible ? "password" : "text";
            btn.setAttribute("aria-pressed", String(!isVisible));
            btn.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
            btn.title = isVisible ? "Show password" : "Hide password";
            passwordInput.focus();

        } else if (d.role) {

            auth = {
                ...auth,
                role: d.role,
                step: 0,
                chooseRole: false,
                resetMode: false,
                adminSetupRequired: false,
                user: null,
                err: "",
                msg: ""
            };

        } else if ("roleBack" in d) {

            auth.chooseRole = true;
            auth.resetMode = false;
            auth.adminSetupRequired = false;
            auth.resetStage = "";
            auth.err = "";
            auth.msg = "";
            auth.user = null;

        } else if ("forgot" in d) {

            auth.resetMode = true;
            auth.resetStage = "request";
            auth.err = "";
            auth.msg = "";

        } else if ("resetBack" in d) {

            auth.resetMode = false;
            auth.resetStage = "";
            auth.err = "";
            auth.msg = "";
            auth.mode = "signin";
            auth.step = 1;

        } else if ("back" in d) {

            auth = {
                ...auth,
                step: 0,
                resetMode: false,
                adminSetupRequired: false,
                err: "",
                msg: ""
            };

        } else if ("out" in d) {
            try {
                await request("/logout", { method: "POST" });
                meId = null;
                data = { users: [], appts: [], slots: [] };
            } catch (error) {
                window.alert(error.message);
                return;
            }

        } else if (d.delslot) {
            try {
                await request(`/slots/${d.delslot}`, { method: "DELETE" });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }

        } else if (d.cancel) {
            try {
                await request(`/appointments/${d.cancel}/cancel`, {
                    method: "POST"
                });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }

        } else {
            return;
        }

        render();
    }
);

// ============================================================
// FORM SUBMITS
// ============================================================

document.addEventListener(
    "submit",
    async (e) => {

        e.preventDefault();

        const form = e.target;

        const f = Object.fromEntries(
            new FormData(form)
        );

        if (form.id === "form-reset-request") {

            try {
                const result = await request("/users/password-reset/request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: auth.email, role: auth.role })
                });
                auth.resetStage = "complete";
                auth.msg = result.message;
                auth.err = "";
            } catch (error) {
                console.error(error);
                auth.err = error.message;
            }

        } else if (form.id === "form-reset-complete") {

            if (f.pw !== f.confirmPw) {
                auth.err = "The new passwords do not match.";
            } else {
                try {
                    const result = await request("/users/password-reset/complete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            email: auth.email,
                            role: auth.role,
                            code: f.code,
                            password: f.pw
                        })
                    });
                    auth.resetMode = false;
                    auth.resetStage = "";
                    auth.user = {
                        ...(auth.user || {}),
                        email: auth.email,
                        role: auth.role
                    };
                    auth.msg = result.message;
                    auth.err = "";
                } catch (error) {
                    console.error(error);
                    auth.err = error.message;
                }
            }

        }

        // ====================================================
        // EMAIL
        // ====================================================

        else if (form.id === "form-email") {

            auth.email =
                f.email
                    .trim()
                    .toLowerCase();

            auth.step = 1;
            auth.adminSetupRequired = false;
            auth.err = "";
            auth.msg = "";

            // Ask server whether this account exists
            try {

                const result = await request("/users/check", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: auth.email,
                        role: auth.role
                    })
                });

                if (result.exists) {

                    auth.user =
                        result.user;

                    auth.msg = "";

                } else {

                    auth.user = null;
                    auth.adminSetupRequired = auth.role === "admin";
                }

            } catch (error) {

                console.error(error);

                auth.err = error.message;

                auth.step = 0;
            }

        }

        // ====================================================
        // SIGN IN
        // ====================================================

        else if (
            form.id === "form-signin"
        ) {

            try {

                const result = await request("/users/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: auth.email,
                        password: f.pw,
                        role: auth.role
                    })
                });
                await signIn(result.user);

            } catch (error) {

                console.error(error);

                auth.err = error.message;
            }
        }

        // ====================================================
        // REGISTER
        // ====================================================

        else if (
            form.id === "form-register"
        ) {

            try {

                const result = await request("/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: f.name,
                        email: auth.email,
                        password: f.pw,
                        role: auth.role,
                        specialty: f.spec || null
                    })
                });

                auth.msg = "Account created successfully.";
                auth.step = 1;
                auth.user = {
                    id: result.id,
                    name: f.name,
                    email: auth.email,
                    role: auth.role,
                    specialty: f.spec || ""
                };

            } catch (error) {

                console.error(error);

                auth.err = error.message;
            }
        }

        // ====================================================
        // PATIENT BOOKING
        // ====================================================

        else if (
            form.id === "form-book"
        ) {
            try {
                await request("/appointments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        reason: f.reason,
                        preferred_date: f.pref || null
                    })
                });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }
        }

        // ====================================================
        // DOCTOR AVAILABLE TIME
        // ====================================================

        else if (
            form.id === "form-slot"
        ) {
            try {
                await request("/slots", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date: f.date, time: f.time })
                });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }
        }

        // ====================================================
        // ADMIN ASSIGNS APPOINTMENT
        // ====================================================

        else if (
            form.className ===
            "form-assign"
        ) {
            try {
                await request(`/appointments/${form.dataset.appt}/assign`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slot_id: f.sid })
                });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }
        }

        // ====================================================
        // DOCTOR MEDICAL RECORD
        // ====================================================

        else if (
            form.className ===
            "form-note"
        ) {
            try {
                await request(`/appointments/${form.dataset.appt}/notes`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: f.text })
                });
                await refreshData();
            } catch (error) {
                window.alert(error.message);
                return;
            }
        }

        render();
    }
);

// ============================================================
// INITIAL LOAD
// ============================================================

async function start() {
    try {
        const session = await request("/session");
        if (session.user) {
            await refreshData();
        } else {
            meId = null;
        }
    } catch (error) {
        console.error("Unable to connect to the Node.js backend:", error);
        auth.err = "Cannot connect to the server. Make sure the Node.js backend is running.";
    }
    render();
}

start();
