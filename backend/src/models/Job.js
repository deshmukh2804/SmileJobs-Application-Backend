const mongoose = require('mongoose');
const { jobDbConnection } = require('../config/db');

const jobSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    recruiterId: { type: mongoose.Schema.Types.ObjectId },
    companyName: { type: String },
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
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      country: { type: String, default: '' },
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },

      // ✅ GeoJSON Point for MongoDB $geoNear / $near / $geoWithin queries
      // Format: { type: "Point", coordinates: [longitude, latitude] }
      geo: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number], // [lon, lat] — GeoJSON convention
          default: undefined,
        },
      },
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

    jobType: { type: String, default: 'Full-Time' },
    workMode: { type: String, default: 'On-site' },
    department: { type: String, default: '' },
    role: { type: String, default: '' },
    qualification: { type: String, default: '' },
    skills: { type: [String], default: [] },
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
    },
    isActive: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    isNew: { type: Boolean, default: true },
    isCompanyVerified: { type: Boolean, default: false },

    industry: { type: String, default: '' },
    establishedYear: { type: Number, default: 0 },
    organizationSize: { type: String, default: '' },

    applicantsCount: { type: Number, default: 0 },
    applicantsCap: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    priority: { type: Number, default: 0 },
    expiryDate: { type: Date },

    postedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'jobs',
    suppressReservedKeysWarning: true,
  }
);

// ─────────────────────────────────────────────────────────────
// PRODUCTION INDEXES — designed based on actual query patterns
// ─────────────────────────────────────────────────────────────

// ✅ CRITICAL: 2dsphere index for geospatial $geoNear/$near queries
// This replaces the useless { 'location.lat': 1, 'location.lon': 1 } index
jobSchema.index({ 'location.geo': '2dsphere' });

// ✅ Main list query: status + isActive + sorted by postedAt
// Supports: Job.find({ status: 'Live', isActive: true }).sort({ postedAt: -1 })
jobSchema.index({ status: 1, isActive: 1, postedAt: -1 });

// ✅ Featured jobs query
jobSchema.index({ status: 1, isActive: 1, featured: 1, priority: -1, postedAt: -1 });

// ✅ City-based filtering (case-insensitive matches will use collation)
jobSchema.index({ status: 1, isActive: 1, 'location.city': 1, postedAt: -1 });

// ✅ Skills-based filtering
jobSchema.index({ status: 1, isActive: 1, skills: 1 });

// ✅ Text search index — replaces expensive regex $or queries
jobSchema.index(
  {
    title: 'text',
    role: 'text',
    companyName: 'text',
    department: 'text',
    industry: 'text',
    skills: 'text',
    'location.city': 'text',
    'location.state': 'text',
    jobDescription: 'text',
  },
  {
    weights: {
      title: 10,
      role: 8,
      skills: 7,
      companyName: 6,
      department: 5,
      industry: 4,
      'location.city': 3,
      'location.state': 2,
      jobDescription: 1,
    },
    name: 'JobTextSearchIndex',
  }
);

// ─────────────────────────────────────────────────────────────
// AUTO-SYNC GeoJSON coordinates from location.lat/location.lon
// Runs on save/update so admin doesn't need to know about GeoJSON
// ─────────────────────────────────────────────────────────────
jobSchema.pre('save', function (next) {
  if (this.location && this.location.lat != null && this.location.lon != null) {
    this.location.geo = {
      type: 'Point',
      coordinates: [
        parseFloat(this.location.lon),
        parseFloat(this.location.lat),
      ],
    };
  }
  next();
});

jobSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const lat = update['location.lat'] ?? update.location?.lat;
  const lon = update['location.lon'] ?? update.location?.lon;
  if (lat != null && lon != null) {
    if (!update.$set) update.$set = {};
    update.$set['location.geo'] = {
      type: 'Point',
      coordinates: [parseFloat(lon), parseFloat(lat)],
    };
    this.setUpdate(update);
  }
  next();
});

module.exports = jobDbConnection.models.Job || jobDbConnection.model('Job', jobSchema);