const mongoose = require('mongoose');

const appConfigSchema = new mongoose.Schema(
  {
    configType: { type: String, required: true, unique: true, index: true },

    bottomNav: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    homeSections: {
      type: [
        {
          type: { type: String },
          sectionKey: String,
          title: String,
          enabled: { type: Boolean, default: true },
          order: { type: Number, default: 0 },
          limit: { type: Number, default: 10 },
          config: { type: mongoose.Schema.Types.Mixed, default: {} },
        },
      ],
      default: [],
    },

    version: { type: Number, default: 1 },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'appconfigs', strict: false }
);

module.exports = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);