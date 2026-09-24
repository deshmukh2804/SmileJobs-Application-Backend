const mongoose = require('mongoose');
const { applicationDbConnection } = require('../config/db'); // Import application_db connection

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
      enum: ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offered', 'Rejected', 'Withdrawn'],
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

    appliedAt: { type: Date, default: Date.now },
    viewedAt: { type: Date },
    shortlistedAt: { type: Date },
    interviewAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'applications',
  }
);

applicationSchema.index({ jobId: 1, userId: 1 }, { unique: true });
applicationSchema.index({ userId: 1, appliedAt: -1 });

// Compile Application schema onto application_db connection
module.exports =
  applicationDbConnection.models.Application ||
  applicationDbConnection.model('Application', applicationSchema);