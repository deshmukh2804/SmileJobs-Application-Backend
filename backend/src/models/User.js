const mongoose = require('mongoose');
const { careerflowAdminDbConnection } = require('../config/db');

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
    phoneNumber: { type: String, trim: true },
    phone: { type: String, trim: true }, 
    googleId: { type: String, trim: true },
    authProvider: {
      type: String,
      enum: ['phone', 'google', 'email', 'both', 'all'],
      default: 'phone',
    },
    isVerified: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ['job_seeker', 'recruiter', 'admin'],
      default: 'job_seeker',
    },
    lastLogin: { type: Date },

    name: { type: String, default: '' },
    email: { type: String, default: '', trim: true, lowercase: true },
    gender: { type: String, default: '' },
    birthday: { type: String, default: '' },

    city: { type: String, default: '' },
    subLocation: { type: String, default: '' },
    state: { type: String, default: '' },
    country: { type: String, default: 'India' },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    locationSource: { type: String, enum: ['gps', 'manual', ''], default: '' },
    locationUpdatedAt: { type: Date },

    avatarUrl: { type: String, default: '' },

    englishLevel: { type: String, default: '' },
    knownLanguages: { type: [String], default: [] },

    aboutMe: { type: String, default: '' },

    totalExperience: { type: String, default: '' },
    experienceLevel: { type: String, default: '' },
    workType: { type: String, default: '' },
    industry: { type: String, default: '' },
    currentSalary: { type: String, default: '' },
    currentCompany: { type: String, default: '' },
    startDate: { type: String, default: '' },
    jobTitle: { type: String, default: '' },

    skills: { type: [String], default: [] },
    assets: { type: [String], default: [] },

    collegeName: { type: String, default: '' },
    degree: { type: String, default: '' },
    endYear: { type: String, default: '' },
    specialization: { type: String, default: '' },

    certifications: { type: [String], default: [] },

    resumeUrl: { type: String, default: '' },
    resumeFileName: { type: String, default: '' },
    resumePublicId: { type: String, default: '' },

    profileCompletion: { type: Number, default: 0 },
    isVisibleToRecruiters: { type: Boolean, default: true },

    fcmTokens: { type: [fcmTokenSchema], default: [] },

    // Dynamic relationship references for global Bookmarks synchronization
    savedJobs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job' }]
  },
  { timestamps: true }
);

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

  if (this.phoneNumber && !this.phone) this.phone = this.phoneNumber;
  if (this.phone && !this.phoneNumber) this.phoneNumber = this.phone;

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

module.exports = careerflowAdminDbConnection.models.User || careerflowAdminDbConnection.model('User', userSchema);