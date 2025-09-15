// server.js (ESM)
// Run with: node server.js

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import AWS from "aws-sdk";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- MongoDB ----------
mongoose.set("strictQuery", true);
await mongoose
    .connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || undefined })
    .then(() => console.log("[mongo] connected"))
    .catch((err) => {
        console.error("[mongo] failed:", err.message);
        process.exit(1);
    });

// ---------- AWS S3 ----------
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const s3 = new AWS.S3();
const S3_BUCKET = process.env.AWS_S3_BUCKET;

// ---------- Models ----------
const Admin = mongoose.model(
    "Admin",
    new mongoose.Schema(
        {
            name: String,
            email: { type: String, unique: true, index: true },
            passwordHash: String,
            role: { type: String, default: "admin" },
        },
        { collection: "Admin", timestamps: true }
    )
);

const User = mongoose.model(
    "User",
    new mongoose.Schema(
        {
            username: { type: String, unique: true, index: true },
            email: { type: String, unique: true, index: true },
            passwordHash: String,
            phone: String,
            name: String,
            title: String,
            department: String,
            role: { type: String, default: "user" },
        },
        { collection: "users", timestamps: true }
    )
);

const Recording = mongoose.model(
    "Recording",
    new mongoose.Schema(
        {
            email: String,
            file_name: { type: String, index: true },
            s3_url: String,
            s3_key: String,
            uploaded_at: Date,
            interviewer: String,
            interviewee_name: String,
            question_set: String,
            transcript: String,
            summary: String,
            key_points: [String],
            action_items: [String],
            suggestions: [String],
            sentiment: String,
            summarized_at: Date,
        },
        { collection: "submitted" }
    )
);

const InterviewQuestion = mongoose.model(
    "Interview_Question",
    new mongoose.Schema(
        {
            setName: String,
            questionId: String,
            question: String,
        },
        { collection: "Interview_Questions" }
    )
);

// ---------- Helpers ----------
function issueToken(admin) {
    return jwt.sign(
        { id: admin._id, email: admin.email, role: admin.role, name: admin.name },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}
function safeAdmin(a) {
    return { id: a._id, email: a.email, name: a.name, role: a.role };
}
function auth(req, res, next) {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = decoded;
        next();
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}
async function presignIfPossible(rec) {
    if (!S3_BUCKET) return null;
    const key = rec.s3_key || rec.file_name;
    if (!key) return null;
    return await new Promise((resolve, reject) => {
        s3.getSignedUrl(
            "getObject",
            { Bucket: S3_BUCKET, Key: key, Expires: 600 },
            (err, url) => (err ? reject(err) : resolve(url))
        );
    });
}
function deriveSetNumber(setName) {
    const s = String(setName || "");
    const m = s.match(/(\d+(?:\.\d+)*)\s*$/);
    if (m) return m[1];
    const any = s.replace(/\D+/g, "");
    return any || s;
}
function shapeRecording(rec, { includeAudioUrl = false } = {}) {
    const shaped = {
        _id: rec._id,
        email: rec.email,
        file_name: rec.file_name,
        uploaded_at: rec.uploaded_at,
        interviewer: rec.interviewer,
        question_set: rec.question_set,
        transcript: rec.transcript,
        summary: rec.summary,
        key_points: rec.key_points,
        action_items: rec.action_items,
        suggestions: rec.suggestions,
        sentiment: rec.sentiment,
        summarized_at: rec.summarized_at,
    };
    if (includeAudioUrl && rec.s3_url) {
        shaped.s3_url = rec.s3_url;
    }
    return shaped;
}

// ---------- Seed env admin ----------
async function seedEnvAdminIfMissing() {
    const envEmail = process.env.ENV_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
    const envPass = process.env.ENV_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
    const envHash = process.env.ENV_ADMIN_HASH;
    if (!envEmail || (!envPass && !envHash)) return;
    const existing = await Admin.findOne({ email: envEmail }).lean();
    if (existing) return;
    const passwordHash = envHash ? envHash : await bcrypt.hash(envPass, 10);
    await Admin.create({
        name: "Environment Admin",
        email: envEmail,
        passwordHash,
        role: "super",
    });
    console.log(`[seed] Created DB admin for ${envEmail}`);
}
seedEnvAdminIfMissing().catch((err) => console.warn("[seed] failed:", err.message));

// ---------- Routes ----------

// Auth (Admin)
app.post("/api/admin/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: "Email and password required" });
        const a = await Admin.findOne({ email }).lean();
        if (!a || !a.passwordHash) return res.status(401).json({ error: "Invalid email or password" });
        const ok = await bcrypt.compare(password, a.passwordHash);
        if (!ok) return res.status(401).json({ error: "Invalid email or password" });
        return res.json({ token: issueToken(a) });
    } catch (err) {
        res.status(500).json({ error: err.message || "Login failed" });
    }
});
app.get("/api/admin/me", auth, async (req, res) => {
    const a = await Admin.findById(req.admin.id).lean();
    if (!a) return res.status(404).json({ error: "Not found" });
    res.json(safeAdmin(a));
});
app.post("/api/admin/create", auth, async (req, res) => {
    try {
        const { name, email, password, role = "admin" } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: "Email & password required" });
        const passwordHash = await bcrypt.hash(password, 10);
        const admin = await Admin.create({ name, email, passwordHash, role });
        res.json(safeAdmin(admin));
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to create admin" });
    }
});

// Stats
app.get("/api/admin/stats", auth, async (req, res) => {
    try {
        const [totalRecordings, totalAdmins, totalUsers] = await Promise.all([
            Recording.estimatedDocumentCount(),
            Admin.estimatedDocumentCount(),
            User.estimatedDocumentCount(),
        ]);
        res.json({
            totalRecordings,
            totalAdmins,
            totalUsers,
            totalInterviewers: totalAdmins,
        });
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to load stats" });
    }
});

// Users
app.get("/api/admin/users", auth, async (req, res) => {
    try {
        const q = (req.query.q || "").trim();
        const filter = q
            ? { $or: [{ email: new RegExp(q, "i") }, { username: new RegExp(q, "i") }, { phone: new RegExp(q, "i") }, { name: new RegExp(q, "i") }] }
            : {};
        const users = await User.find(filter).sort({ createdAt: -1 }).lean();
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to load users" });
    }
});
app.get("/api/admin/users/:id", auth, async (req, res) => {
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: "Not found" });
    res.json(u);
});
app.get("/api/admin/users/:id/recordings", auth, async (req, res) => {
    const u = await User.findById(req.params.id).lean();
    if (!u) return res.status(404).json({ error: "User not found" });
    const items = await Recording.find({ email: u.email }).sort({ uploaded_at: -1 }).lean();
    res.json({ items: items.map((r) => shapeRecording(r, { includeAudioUrl: false })) });
});
app.post("/api/admin/users", auth, async (req, res) => {
    try {
        const { username, email, password, phone = "" } = req.body || {};
        if (!username || !email || !password) return res.status(400).json({ error: "username, email and password are required" });
        const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] }).lean();
        if (exists) return res.status(409).json({ error: "Username or email already exists" });
        const passwordHash = await bcrypt.hash(password, 10);
        const created = await User.create({
            username: String(username).trim(),
            email: String(email).trim().toLowerCase(),
            passwordHash,
            phone: String(phone || "").trim(),
            role: "user",
        });
        res.status(201).json({ _id: created._id, username: created.username, email: created.email, phone: created.phone, createdAt: created.createdAt, updatedAt: created.updatedAt });
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to create user" });
    }
});

// Recordings
app.get("/api/admin/recordings", async (req, res) => {
    try {
        const page = parseInt(req.query.page || "1");
        const limit = parseInt(req.query.limit || "20");
        const skip = (page - 1) * limit;
        const total = await Recording.countDocuments();
        let items = await Recording.find().sort({ uploaded_at: -1 }).skip(skip).limit(limit).lean();
        items = items.map((r) => {
            if (r.interviewee_name) r.interviewee_name = r.interviewee_name.replace(/"/g, "");
            return r;
        });
        res.json({ total, items });
    } catch (err) {
        console.error("Error fetching recordings:", err);
        res.status(500).json({ error: "Failed to fetch recordings" });
    }
});
app.get("/api/admin/recordings/:id", auth, async (req, res) => {
    try {
        const includeAudio = String(req.query.includeAudio || "").toLowerCase() === "true";
        const rec = await Recording.findById(req.params.id).lean();
        if (!rec) return res.status(404).json({ error: "Not found" });
        let shaped = shapeRecording(rec, { includeAudioUrl: false });
        if (includeAudio) {
            if (!rec.s3_url && S3_BUCKET) {
                try {
                    const url = await presignIfPossible(rec);
                    if (url) rec.s3_url = url;
                } catch { }
            }
            if (rec.s3_url) shaped.s3_url = rec.s3_url;
        }
        res.json(shaped);
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to load recording" });
    }
});
app.get("/api/admin/recordings/by-file/:fileName", auth, async (req, res) => {
    try {
        const includeAudio = String(req.query.includeAudio || "").toLowerCase() === "true";
        const rec = await Recording.findOne({ file_name: req.params.fileName }).lean();
        if (!rec) return res.status(404).json({ error: "Not found" });
        let shaped = shapeRecording(rec, { includeAudioUrl: false });
        if (includeAudio) {
            if (!rec.s3_url && S3_BUCKET) {
                try {
                    const url = await presignIfPossible(rec);
                    if (url) rec.s3_url = url;
                } catch { }
            }
            if (rec.s3_url) shaped.s3_url = rec.s3_url;
        }
        res.json(shaped);
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to load recording by file_name" });
    }
});
app.get("/api/admin/recordings/:id/audio", auth, async (req, res) => {
    try {
        const rec = await Recording.findById(req.params.id).lean();
        if (!rec) return res.status(404).json({ error: "Not found" });
        let url = rec.s3_url;
        if (!url && S3_BUCKET) {
            try {
                url = await presignIfPossible(rec);
            } catch (e) {
                return res.status(500).json({ error: "Failed to presign audio" });
            }
        }
        if (!url) return res.status(404).json({ error: "Audio unavailable" });
        res.json({ audio_url: url, expires_in: 600 });
    } catch (err) {
        res.status(500).json({ error: err.message || "Failed to get audio url" });
    }
});

// ---------- Question Sets ----------
app.post("/api/qsets", auth, async (req, res) => {
    const { setName, questions } = req.body || {};
    if (!setName || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: "setName and questions[] are required" });
    }
    await InterviewQuestion.deleteMany({ setName });
    const base = deriveSetNumber(setName);
    const docs = questions.map((q, i) => ({
        setName,
        questionId: `${base}.${i + 1}`,
        question: q,
    }));
    await InterviewQuestion.insertMany(docs);
    res.json({ success: true, inserted: docs.length });
});
app.put("/api/qsets/:setName", auth, async (req, res) => {
    const setName = decodeURIComponent(req.params.setName);
    const { questions } = req.body || {};
    await InterviewQuestion.deleteMany({ setName });
    const base = deriveSetNumber(setName);
    const docs = (questions || []).map((q, i) => ({
        setName,
        questionId: `${base}.${i + 1}`,
        question: q,
    }));
    const r = await InterviewQuestion.insertMany(docs);
    res.json({ success: true, replaced: r.length });
});
app.delete("/api/qsets/:setName", auth, async (req, res) => {
    const setName = decodeURIComponent(req.params.setName);
    const r = await InterviewQuestion.deleteMany({ setName });
    res.json({ success: true, deleted: r.deletedCount || 0 });
});
app.get("/api/qsets", auth, async (req, res) => {
    const grouped = req.query.grouped === "true";
    const all = await InterviewQuestion.find({}).sort({ setName: 1, questionId: 1 }).lean();
    if (!grouped) return res.json({ items: all });
    const map = new Map();
    for (const q of all) {
        if (!map.has(q.setName)) map.set(q.setName, []);
        map.get(q.setName).push(q.question);
    }
    const data = [...map.entries()].map(([setName, questions]) => ({
        setName,
        questions,
        count: questions.length,
    }));
    res.json({ data });
});

// ---------- Boot ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
