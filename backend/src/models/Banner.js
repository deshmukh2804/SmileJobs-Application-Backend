const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },

    image: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },
    images: {
      type: [{ url: String, publicId: String, order: Number }],
      default: [],
    },
    mobileImage: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },

    linkUrl: { type: String, default: '' },
    linkType: { type: String, default: 'external' },
    ctaLabel: { type: String, default: 'Learn More' },
    openInNewTab: { type: Boolean, default: true },

    priority: { type: Number, default: 0, index: true },
    slot: { type: Number, default: 0, index: true },
    order: { type: Number, default: 0 },

    platform: { type: [String], default: ['both'], index: true },
    targetAudience: { type: String, default: 'candidates', index: true },
    placement: { type: String, default: 'home_hero', index: true },
    category: { type: String, default: 'promotional' },
    tags: { type: [String], default: [] },

    startDate: { type: Date },
    endDate: { type: Date },

    status: {
      type: String,
      default: 'active',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },

    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    lastClickedAt: { type: Date },

    variant: { type: String, default: 'none' },
    experimentId: { type: String, default: '' },
    backgroundColor: { type: String, default: '' },
    textColor: { type: String, default: '' },
    overlayOpacity: { type: Number, default: 0.3 },
    notes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'banners' }
);

bannerSchema.index({ placement: 1, isActive: 1, status: 1 });

module.exports = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);