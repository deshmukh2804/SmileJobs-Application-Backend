const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    sentBy: {
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      adminName: { type: String, default: '' },
      adminEmail: { type: String, default: '' },
    },

    title: { type: String, required: true },
    body: { type: String, required: true },
    imageUrl: { type: String, default: '' },

    targetAudience: {
      type: String,
      enum: ['all', 'specific', 'city', 'role', 'skills', 'candidates', 'recruiters'],
      default: 'all',
    },
    targetUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    targetCity: { type: String, default: '' },
    targetRole: { type: String, default: '' },

    filters: {
      skills: { type: [String], default: [] },
    },

    channels: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
      push: { type: Boolean, default: true },
    },

    type: {
      type: String,
      default: 'job_alert',
    },

    data: { type: Object, default: {} },

    sentAt: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'partial'],
      default: 'sent',
    },

    stats: {
      totalTargeted: { type: Number, default: 0 },
      inAppDelivered: { type: Number, default: 0 },
      emailSent: { type: Number, default: 0 },
      emailFailed: { type: Number, default: 0 },
      pushSent: { type: Number, default: 0 },
      pushFailed: { type: Number, default: 0 },
    },

    pushProcessed: { type: Boolean, default: false },
    errorLog: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'notifications',
  }
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ pushProcessed: 1, status: 1 });

module.exports = mongoose.model('Notification', notificationSchema);