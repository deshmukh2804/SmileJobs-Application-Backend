const mongoose = require('mongoose');
const { careerflowAdminDbConnection } = require('../config/db');

// ── FCM Token Subschema ──
const fcmTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, trim: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    deviceId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // ── Auth Identifiers ──
    phoneNumber: { type: String, trim: true },
    phone: { type: String, trim: true }, // phone alias
    googleId: { type: String, trim: true },
    authProvider: {
      type: String,
      enum: ['phone', 'google', 'both'],
      default: 'phone',
    },
    isVerified: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ['job_seeker', 'recruiter', 'admin'],
      default: 'job_seeker',
    },
    lastLogin: { type: Date },

    // Personal
    name: { type: String, default: '' },
    email: { type: String, default: '', trim: true, lowercase: true },
    gender: { type: String, default: '' },
    birthday: { type: String, default: '' },

    // Canonical Location
    city: { type: String, default: '' },
    subLocation: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'India' },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    locationSource: { type: String, enum: ['gps', 'manual', ''], default: '' },
    locationUpdatedAt: { type: Date },

    avatarUrl: { type: String, default: '' },

    // Languages
    englishLevel: { type: String, default: '' },
    knownLanguages: { type: [String], default: [] },

    // About
    aboutMe: { type: String, default: '' },

    // Experience
    totalExperience: { type: String, default: '' },
    experienceLevel: { type: String, default: '' },
    workType: { type: String, default: '' },
    industry: { type: String, default: '' },
    currentSalary: { type: String, default: '' },
    currentCompany: { type: String, default: '' },
    startDate: { type: String, default: '' },
    jobTitle: { type: String, default: '' },

    // Skills & Assets
    skills: { type: [String], default: [] },
    assets: { type: [String], default: [] },

    // Education
    collegeName: { type: String, default: '' },
    degree: { type: String, default: '' },
    endYear: { type: String, default: '' },
    specialization: { type: String, default: '' },

    // Certifications
    certifications: { type: [String], default: [] },

    // Resume
    resumeUrl: { type: String, default: '' },
    resumeFileName: { type: String, default: '' },
    resumePublicId: { type: String, default: '' },

    // Completion
    profileCompletion: { type: Number, default: 0 },
    isVisibleToRecruiters: { type: Boolean, default: true },

    // FCM Push Notification Tokens
    fcmTokens: { type: [fcmTokenSchema], default: [] },
  },
  { timestamps: true }
);

// ── Partial Unique Indexes ──
userSchema.index(
  { phoneNumber: 1 },
  { unique: true, partialFilterExpression: { phoneNumber: { $type: 'string', $gt: '' } } }
);

userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string', $gt: '' } } }
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string', $gt: '' } } }
);

userSchema.index({ 'fcmTokens.token': 1 });

userSchema.pre('save', function (next) {
  // Safe Cleanup: Prevent index collisions by setting empty values to undefined
  if (this.email) {
    this.email = this.email.trim().toLowerCase();
    if (this.email === '') {
      this.email = undefined;
    }
  }

  if (this.phoneNumber) {
    this.phoneNumber = this.phoneNumber.trim();
    if (this.phoneNumber === '') {
      this.phoneNumber = undefined;
    }
  }

  if (this.phone) {
    this.phone = this.phone.trim();
    if (this.phone === '') {
      this.phone = undefined;
    }
  }

  if (this.googleId) {
    this.googleId = this.googleId.trim();
    if (this.googleId === '') {
      this.googleId = undefined;
    }
  }

  // Synchronize phone fields
  if (this.phoneNumber && !this.phone) this.phone = this.phoneNumber;
  if (this.phone && !this.phoneNumber) this.phoneNumber = this.phone;

  // Score completion check
  let score = 0;
  const checks = [
    this.name, (this.phoneNumber || this.phone), this.email, this.gender, this.birthday, this.city,
    this.englishLevel, this.aboutMe, this.totalExperience, this.jobTitle,
    this.currentCompany, this.collegeName, this.resumeUrl, this.avatarUrl,
  ];
  checks.forEach((f) => { if (f) score += 6; });
  if (this.skills?.length) score += 10;
  if (this.knownLanguages?.length) score += 6;
  if (this.assets?.length) score += 6;
  this.profileCompletion = Math.min(100, score);
  next();
});

module.exports = careerflowAdminDbConnection.model('User', userSchema);