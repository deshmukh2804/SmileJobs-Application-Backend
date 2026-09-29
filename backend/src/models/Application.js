const mongoose = require('mongoose');
const { applicationDbConnection } = require('../config/db');

const applicationSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Candidate snapshot at time of applying
    candidateName: { type: String, default: '' },
    candidatePhone: { type: String, default: '' },
    candidateEmail: { type: String, default: '' },
    candidateCity: { type: String, default: '' },
    candidateSubLocation: { type: String, default: '' },
    candidateAvatarUrl: { type: String, default: '' },

    resumeUrl: { type: String, default: '' },
    resumeFileName: { type: String, default: '' },

    candidateSkills: { type: [String], default: [] },
    candidateLanguages: { type: [String], default: [] },
    candidateEnglishLevel: { type: String, default: '' },
    candidateExperience: { type: String, default: '' },
    candidateExperienceLevel: { type: String, default: '' },
    candidateJobTitle: { type: String, default: '' },
    candidateCurrentCompany: { type: String, default: '' },
    candidateCurrentSalary: { type: String, default: '' },
    candidateEducation: {
      collegeName: { type: String, default: '' },
      degree: { type: String, default: '' },
      specialization: { type: String, default: '' },
      endYear: { type: String, default: '' },
    },
    candidateAssets: { type: [String], default: [] },
    candidateCertifications: { type: [String], default: [] },

    // Job snapshot
    jobTitle: { type: String, default: '' },
    jobCompany: { type: String, default: '' },
    jobCompanyLogo: { type: String, default: '' },
    jobSalary: { type: String, default: '' },
    jobLocation: { type: String, default: '' },
    jobHrName: { type: String, default: '' },
    jobHrRole: { type: String, default: '' },
    jobHrPhone: { type: String, default: '' },
    jobHrWhatsapp: { type: String, default: '' },

    matchPercentage: { type: Number, default: 0 },
    coverNote: { type: String, default: '' },

    status: {
      type: String,
      enum: ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offered', 'Hired', 'Rejected', 'Withdrawn'],
      default: 'Applied',
    },
    category: {
      type: String,
      enum: ['pending', 'hr-responded', 'offers', 'expired'],
      default: 'pending',
    },

    hrNotes: { type: String, default: '' },

    milestones: {
      type: [
        {
          title: String,
          time: String,
          completed: { type: Boolean, default: false },
          statusText: { type: String, default: '' },
          isHighlight: { type: Boolean, default: false },
        },
      ],
      default: [],
    },

    // ✅ STATUS TIMESTAMPS — Updated by admin/recruiter panel to track when each stage happened
    // Mobile app uses these to display accurate timeline
    appliedAt: { type: Date, default: Date.now },
    viewedAt: { type: Date },
    shortlistedAt: { type: Date },
    interviewAt: { type: Date },
    offeredAt: { type: Date },
    hiredAt: { type: Date },
    rejectedAt: { type: Date },
    withdrawnAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'applications',
  }
);

applicationSchema.index({ jobId: 1, userId: 1 }, { unique: true });
applicationSchema.index({ userId: 1, appliedAt: -1 });
applicationSchema.index({ userId: 1, status: 1 });
applicationSchema.index({ status: 1, updatedAt: -1 });

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATE STATUS TIMESTAMPS ON STATUS CHANGE
// This runs when admin/recruiter updates status via their panel
// ═══════════════════════════════════════════════════════════════
applicationSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    const now = new Date();
    const statusFieldMap = {
      Viewed: 'viewedAt',
      Shortlisted: 'shortlistedAt',
      Interview: 'interviewAt',
      Offered: 'offeredAt',
      Hired: 'hiredAt',
      Rejected: 'rejectedAt',
      Withdrawn: 'withdrawnAt',
    };

    const field = statusFieldMap[this.status];
    if (field && !this[field]) {
      this[field] = now;
    }

    // Auto-update category based on status
    const categoryMap = {
      Applied: 'pending',
      Viewed: 'pending',
      Shortlisted: 'hr-responded',
      Interview: 'hr-responded',
      Offered: 'offers',
      Hired: 'offers',
      Rejected: 'expired',
      Withdrawn: 'expired',
    };
    this.category = categoryMap[this.status] || 'pending';
  }
  next();
});

// Also handle findOneAndUpdate for admin panel updates
applicationSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const newStatus = update.status || update.$set?.status;

  if (newStatus) {
    const now = new Date();
    const statusFieldMap = {
      Viewed: 'viewedAt',
      Shortlisted: 'shortlistedAt',
      Interview: 'interviewAt',
      Offered: 'offeredAt',
      Hired: 'hiredAt',
      Rejected: 'rejectedAt',
      Withdrawn: 'withdrawnAt',
    };

    const field = statusFieldMap[newStatus];
    if (field) {
      if (!update.$set) update.$set = {};
      update.$set[field] = now;
    }

    // Auto-set category based on status
    const categoryMap = {
      Applied: 'pending',
      Viewed: 'pending',
      Shortlisted: 'hr-responded',
      Interview: 'hr-responded',
      Offered: 'offers',
      Hired: 'offers',
      Rejected: 'expired',
      Withdrawn: 'expired',
    };
    if (!update.$set) update.$set = {};
    update.$set.category = categoryMap[newStatus] || 'pending';

    this.setUpdate(update);
  }
  next();
});

module.exports =
  applicationDbConnection.models.Application ||
  applicationDbConnection.model('Application', applicationSchema);