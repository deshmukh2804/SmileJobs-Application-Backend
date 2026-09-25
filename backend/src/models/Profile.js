const mongoose = require('mongoose');
const { careerflowAdminDbConnection } = require('../config/db');

const profileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // Automatically creates the unique index on userId
    },
    // ── Personal Info ──
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    gender: { type: String, enum: ['Male', 'Female', 'Other', ''], default: '' },
    birthday: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },

    // ── Location ──
    city: { type: String, default: '' },
    subLocation: { type: String, default: '' },

    // ── Languages ──
    englishLevel: {
      type: String,
      enum: ['No English', 'Basic English', 'Good English', 'Fluent English', ''],
      default: '',
    },
    knownLanguages: [{ type: String }],

    // ── Experience ──
    totalExperience: { type: String, default: '' },
    experienceLevel: {
      type: String,
      enum: ['Fresher', 'Experience', ''],
      default: '',
    },
    workType: {
      type: String,
      enum: ['Full Time', 'Part Time', 'Internship', 'Contract', ''],
      default: '',
    },
    industry: { type: String, default: '' },
    currentCompany: { type: String, default: '' },
    jobTitle: { type: String, default: '' },

    // ── Skills ──
    skills: [{ type: String }],

    // ── Resume ──
    resumeUrl: { type: String, default: '' },
    resumeFileName: { type: String, default: '' },
    resumePublicId: { type: String, default: '' },

    // ── Profile Completion ──
    profileCompletion: { type: Number, default: 0 },

    // ── Visibility for recruiters ──
    isVisibleToRecruiters: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for common queries (duplicate userId index removed)
profileSchema.index({ city: 1, isVisibleToRecruiters: 1 });

// Auto-calculate profile completion before save
profileSchema.pre('save', function (next) {
  let score = 0;
  const fields = [
    this.name, this.email, this.gender, this.birthday,
    this.city, this.englishLevel, this.totalExperience,
    this.jobTitle, this.currentCompany, this.resumeUrl,
  ];
  fields.forEach(f => { if (f) score += 8; });
  if (this.skills && this.skills.length > 0) score += 10;
  if (this.knownLanguages && this.knownLanguages.length > 0) score += 10;
  this.profileCompletion = Math.min(100, score);
  next();
});

// ✅ Bind Profile model to the careerflow_admin DB connection
module.exports =
  careerflowAdminDbConnection.models.Profile ||
  careerflowAdminDbConnection.model('Profile', profileSchema);