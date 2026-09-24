const mongoose = require('mongoose');
const { jobDbConnection } = require('../config/db'); // Import the dedicated Job_db connection

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId },
    companyName: { type: String, index: true },
    companyWebsite: { type: String, default: '' },
    companyLogo: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },
    companyImages: {
      type: [{ url: String, publicId: String }],
      default: [],
    },
    companyInitials: { type: String, default: '' },

    location: {
      address: { type: String, default: '' },
      city: { type: String, default: '', index: true },
      state: { type: String, default: '', index: true },
      country: { type: String, default: '' },
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },
    },
    companyAddress: {
      country: { type: String, default: '' },
    },

    salary: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      period: { type: String, default: 'month' },
    },
    experience: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
      text: { type: String, default: '' },
    },

    jobType: { type: String, default: 'Full-Time', index: true },
    workMode: { type: String, default: 'On-site', index: true },
    department: { type: String, default: '', index: true },
    role: { type: String, default: '', index: true },
    qualification: { type: String, default: '' },
    skills: { type: [String], default: [], index: true },
    languages: { type: [String], default: [] },

    jobDescription: { type: String, default: '' },
    responsibilities: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    benefits: { type: [String], default: [] },

    jobTiming: { type: String, default: '' },
    workingDays: { type: String, default: '' },
    noticePeriod: { type: String, default: '' },

    contactPerson: {
      name: { type: String, default: '' },
      designation: { type: String, default: '' },
    },
    recruiterWhatsappNumber: { type: String, default: '' },
    recruiterMobileNumber: { type: String, default: '' },
    recruiterEmail: { type: String, default: '' },
    applicationUrl: { type: String, default: '' },
    noPaymentInvolved: { type: Boolean, default: true },

    contactVisibility: {
      whatsapp: { type: Boolean, default: true },
      mobile: { type: Boolean, default: true },
    },
    whatsappContactEnabled: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ['Live', 'Paused', 'Closed', 'Draft', 'Expired'],
      default: 'Live',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    featured: { type: Boolean, default: false, index: true },
    isNew: { type: Boolean, default: true, index: true },
    isCompanyVerified: { type: Boolean, default: false },

    industry: { type: String, default: '', index: true },
    establishedYear: { type: Number, default: 0 },
    organizationSize: { type: String, default: '' },

    applicantsCount: { type: Number, default: 0 },
    applicantsCap: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    priority: { type: Number, default: 0 },
    expiryDate: { type: Date },

    postedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    collection: 'jobs',
    suppressReservedKeysWarning: true,
  }
);

jobSchema.index({ status: 1, isActive: 1, postedAt: -1 });
jobSchema.index({ status: 1, isActive: 1, featured: 1 });
jobSchema.index({ 'location.lat': 1, 'location.lon': 1 });

// Compile schema into the specific Job_db connection context
module.exports = jobDbConnection.models.Job || jobDbConnection.model('Job', jobSchema);