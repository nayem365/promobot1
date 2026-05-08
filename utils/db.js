// utils/db.js
const mongoose = require('mongoose');

// ── Schemas ────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  userId:    { type: Number, required: true, unique: true },
  username:  String,
  name:      String,
  language:  { type: String, default: 'en' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const submissionSchema = new mongoose.Schema({
  userId:    { type: Number, required: true },
  type:      { type: String, required: true },
  data:      mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const User       = mongoose.model('User',       userSchema);
const Submission = mongoose.model('Submission', submissionSchema);

// ── Connection ─────────────────────────────────────────────────────────────

let connected = false;

async function connectDB() {
  if (connected) return;
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    connected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.warn('⚠️  Running without DB — data will not persist.');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getUserData(userId) {
  try {
    return await User.findOne({ userId });
  } catch {
    return null;
  }
}

async function saveUserData(userId, fields) {
  try {
    return await User.findOneAndUpdate(
      { userId },
      { ...fields, userId, updatedAt: new Date() },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('saveUserData error:', err.message);
    return null;
  }
}

async function saveSubmission(payload) {
  try {
    const sub = new Submission(payload);
    await sub.save();
    return sub;
  } catch (err) {
    console.error('saveSubmission error:', err.message);
    return null;
  }
}

module.exports = { connectDB, getUserData, saveUserData, saveSubmission };
