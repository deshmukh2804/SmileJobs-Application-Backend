const mongoose = require('mongoose');
const Banner = require('../models/Banner');
const Job = require('../models/Job');

// ─────────────────────────────────────────────
// RAW collection access — safely handles buffering & schemas
// ─────────────────────────────────────────────
const rawCollection = (name) => {
  if (mongoose.connection && mongoose.connection.db) {
    return mongoose.connection.db.collection(name);
  }
  // Safe buffering fallback if the direct connection is not fully initialized on boot
  try {
    const model = mongoose.models.AppConfig || mongoose.model('AppConfig');
    if (model) return model.collection;
  } catch (e) {
    console.error('🧭 [DB] Mongoose model collection fallback failed:', e.message);
  }
  throw new Error('Database connection is not established yet.');
};

// ─────────────────────────────────────────────
// Banner visibility filter
// ─────────────────────────────────────────────
const activeBannerFilter = (placement = 'home_hero') => {
  const now = new Date();
  return {
    placement,
    isActive: true,
    status: { $in: ['active', 'Active', 'published', 'Published', 'live', 'Live'] },
    targetAudience: { $in: ['candidates', 'all', 'both', 'everyone'] },
    platform: { $in: ['mobile', 'both', 'all', 'android', 'ios'] },
    $and: [
      { $or: [{ startDate: { $lte: now } }, { startDate: null }, { startDate: { $exists: false } }] },
      { $or: [{ endDate:   { $gte: now } }, { endDate:   null }, { endDate:   { $exists: false } }] },
    ],
  };
};

// ─────────────────────────────────────────────
// Live job filter
// ─────────────────────────────────────────────
const liveJobFilter = () => {
  const now = new Date();
  return {
    status: 'Live',
    isActive: true,
    $or: [{ expiryDate: { $gte: now } }, { expiryDate: null }, { expiryDate: { $exists: false } }],
  };
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function timeAgo(date) {
  if (!date) return 'Recently';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatSalary(sal) {
  if (!sal) return 'Not disclosed';
  const min = Number(sal.min) || 0;
  const max = Number(sal.max) || 0;
  if (!min && !max) return 'Not disclosed';
  const period = sal.period || 'month';
  const cur = sal.currency === 'INR' ? '₹' : (sal.currency || '');

  const fmt = (n) => {
    if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000)   return `${(n / 100000).toFixed(1)}L`;
    if (n >= 1000)     return `${Math.round(n / 1000)}k`;
    return `${n}`;
  };

  if (period === 'year' || period === 'annual' || period === 'yearly') {
    return `${cur}${fmt(min)}-${fmt(max)} LPA`;
  }
  return `${cur}${fmt(min)}-${fmt(max)}`;
}

function formatExperience(exp) {
  if (!exp) return 'Any';
  const min = Number(exp.min) || 0;
  const max = Number(exp.max) || 0;
  if (!min && !max) return 'Fresher';
  if (min === max) return `${min} Yrs`;
  return `${min}-${max} Yrs`;
}

const BG_PALETTE = ['#E0D4FC', '#FDE8D4', '#D4F5E9', '#FCE0E9', '#D4E9FC', '#F5E9D4'];

// ─────────────────────────────────────────────
// Transform Job → mobile shape
// ─────────────────────────────────────────────
const transformJob = (job) => {
  if (!job) return null;
  const j = job.toObject ? job.toObject() : job;

  const salaryStr = formatSalary(j.salary);
  const experienceStr = formatExperience(j.experience);

  const cityOnly = j.location?.city || j.location?.state || 'Remote';

  const fullLocation = j.location
    ? [j.location.city, j.location.state].filter(Boolean).join(', ') || 'Remote'
    : 'Remote';

  const companyName = j.companyName || 'Company';
  const companyInitial = (j.companyInitials || companyName.charAt(0) || 'C').toUpperCase();
  const bgIdx = (companyName.length || 0) % BG_PALETTE.length;

  const companyLogoUrl = j.companyLogo?.url || '';
  const companyGallery = Array.isArray(j.companyImages)
    ? j.companyImages.map((img) => img?.url).filter(Boolean)
    : [];

  return {
    id: String(j._id),
    title: j.title || '',
    company: companyName,
    companyLogoText: companyInitial,
    companyLogoBg: BG_PALETTE[bgIdx],
    companyLogoUrl,
    companyImages: companyGallery,

    city: cityOnly,
    location: fullLocation,
    state: j.location?.state || '',
    address: j.location?.address || '',

    distance: '5 km',
    salary: salaryStr,
    salaryPeriod: `/${j.salary?.period || 'month'}`,
    experience: experienceStr,
    workMode: j.workMode || 'On-site',
    jobType: j.jobType || 'Full-Time',
    skills: Array.isArray(j.skills) ? j.skills : [],
    tags: [j.jobType, j.workMode, ...(j.skills || []).slice(0, 2)].filter(Boolean),
    postedTime: timeAgo(j.postedAt || j.createdAt),
    badge: j.featured
      ? { text: 'FEATURED', type: 'featured' }
      : j.isNew
      ? { text: 'NEW', type: 'actively-hiring' }
      : undefined,
    description: j.jobDescription || '',
    noticePeriod: j.noticePeriod || '',
    requirements: {
      qualification: j.qualification || '',
      skills: j.skills || [],
      language: (j.languages || []).join(', '),
    },
    highlights: {
      skills: j.skills || [],
      languages: (j.languages || []).join(', '),
      timings: j.jobTiming || '9 AM - 6 PM',
      role: j.role || '',
    },
    additionalInfo: {
      timings: j.jobTiming || '9 AM - 6 PM',
      jobType: j.jobType || '',
      department: j.department || '',
      role: j.role || '',
      address: j.location?.address || '',
    },
    companyDetails: {
      established: j.establishedYear ? String(j.establishedYear) : '',
      size: j.organizationSize || '',
      industry: j.industry || '',
      perks: j.benefits || [],
      website: j.companyWebsite || '',
      logoUrl: companyLogoUrl,
      gallery: companyGallery,
    },
    hrContact: {
      name: j.contactPerson?.name || 'HR Team',
      role: j.contactPerson?.designation || 'Recruiter',
      phone: j.recruiterMobileNumber || '',
      whatsapp: j.recruiterWhatsappNumber || '',
      initials: (j.contactPerson?.name || 'HR')
        .split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase(),
    },
    contactVisibility: {
      whatsapp: j.contactVisibility?.whatsapp !== false && j.whatsappContactEnabled !== false,
      mobile: j.contactVisibility?.mobile !== false,
    },
    benefits: j.benefits || [],
    featured: !!j.featured,
    isNew: !!j.isNew,
    isSaved: false,
  };
};

// ─────────────────────────────────────────────
// Transform Banner
// ─────────────────────────────────────────────
const transformBanner = (banner) => {
  const b = banner.toObject ? banner.toObject() : banner;
  const mobileUrl =
    b.mobileImage?.url ||
    b.image?.url ||
    (Array.isArray(b.images) && b.images.length > 0 ? b.images[0].url : '');

  const gallery = Array.isArray(b.images)
    ? b.images.slice().sort((a, c) => (a.order || 0) - (c.order || 0)).map((i) => i.url).filter(Boolean)
    : [];

  return {
    id: String(b._id),
    title: b.title || '',
    subtitle: b.subtitle || '',
    description: b.description || '',
    imageUrl: mobileUrl,
    images: gallery,
    linkUrl: b.linkUrl || '',
    linkType: b.linkType || 'external',
    ctaLabel: b.ctaLabel || 'Learn More',
    openInNewTab: !!b.openInNewTab,
    priority: b.priority || 0,
    slot: b.slot || 0,
    placement: b.placement,
    category: b.category || 'promotional',
    backgroundColor: b.backgroundColor || '',
    textColor: b.textColor || '',
  };
};

// ─────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────
const DEFAULT_HOME_SECTIONS = [
  { type: 'heroBanner',  sectionKey: 'heroBanner',      enabled: true, order: 1, limit: 5 },
  { type: 'search',      sectionKey: 'search',          enabled: true, order: 2 },
  { type: 'location',    sectionKey: 'location',        enabled: true, order: 3 },
  { type: 'categories',  sectionKey: 'categories',      enabled: true, order: 4 },
  { type: 'eventBanner', sectionKey: 'eventBanner',     enabled: true, order: 5 },
  { type: 'jobs',        sectionKey: 'recommendedJobs', title: 'Recommended Jobs', enabled: true, order: 6, limit: 20 },
  { type: 'featuredJob', sectionKey: 'featuredJob',     enabled: true, order: 7, limit: 1 },
  { type: 'careerTip',   sectionKey: 'careerTip',       enabled: true, order: 8 },
];

const DEFAULT_BOTTOM_NAV = {
  items: [
    { key: 'home',     label: 'Home',     icon: 'Home',      enabled: true, order: 1 },
    { key: 'allJobs',  label: 'All Jobs', icon: 'Briefcase', enabled: true, order: 2 },
    { key: 'activity', label: 'Activity', icon: 'Activity',  enabled: true, order: 3 },
    { key: 'premium',  label: 'Premium',  icon: 'Crown',     enabled: true, order: 4 },
    { key: 'profile',  label: 'Profile',  icon: 'User',      enabled: true, order: 5 },
  ],
  size: { barHeight: 60, iconSize: 24, fontSize: 11, borderRadius: 0, horizontalPadding: 8, iconLabelGap: 4 },
  colors: { backgroundColor: '#FFFFFF', activeColor: '#4F46E5', inactiveColor: '#9CA3AF', badgeColor: '#EF4444' },
  isVisible: true,
};

// ─────────────────────────────────────────────
// Fetch bottom nav from RAW collection
// ─────────────────────────────────────────────
async function getBottomNavFromDB() {
  try {
    const col = rawCollection('appconfigs');
    const doc = await col.findOne({ configType: 'mobileBottomNav' });

    if (doc && doc.bottomNav && Array.isArray(doc.bottomNav.items) && doc.bottomNav.items.length > 0) {
      console.log('🧭 [DB] bottomNav found:',
        doc.bottomNav.items.map(i => `${i.key}(${i.enabled ? 'ON' : 'OFF'},o${i.order})`).join(' '));
      return doc.bottomNav;
    }

    console.log('🧭 [DB] No mobileBottomNav config found — using default');
    return DEFAULT_BOTTOM_NAV;
  } catch (err) {
    console.error('🧭 [DB] bottomNav read error:', err.message);
    return DEFAULT_BOTTOM_NAV;
  }
}

// ─────────────────────────────────────────────
// Fetch home sections config from RAW collection
// ─────────────────────────────────────────────
async function getHomeSectionsFromDB() {
  try {
    const col = rawCollection('appconfigs');
    const doc = await col.findOne({ configType: 'homeScreen' });
    if (doc && Array.isArray(doc.homeSections) && doc.homeSections.length > 0) {
      return { sections: doc.homeSections, version: doc.version || 1 };
    }
    return { sections: DEFAULT_HOME_SECTIONS, version: 1 };
  } catch (err) {
    console.error('🏠 [DB] homeSections read error:', err.message);
    return { sections: DEFAULT_HOME_SECTIONS, version: 1 };
  }
}

// ─────────────────────────────────────────────
// GET /api/v1/home
// ─────────────────────────────────────────────
exports.getHomeConfig = async (req, res) => {
  try {
    const { sections: sectionsRaw, version } = await getHomeSectionsFromDB();

    const sections = [...sectionsRaw]
      .filter((s) => s.enabled !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const totalBanners = await Banner.countDocuments({});
    const activeBanners = await Banner.countDocuments(activeBannerFilter('home_hero'));
    const totalJobs = await Job.countDocuments({});
    const liveJobs = await Job.countDocuments(liveJobFilter());
    console.log(`📊 Home: banners ${activeBanners}/${totalBanners} active | jobs ${liveJobs}/${totalJobs} live`);

    const results = await Promise.all(
      sections.map(async (section) => {
        try {
          if (section.type === 'heroBanner') {
            const banners = await Banner.find(activeBannerFilter('home_hero'))
              .sort({ priority: -1, slot: 1, order: 1, createdAt: -1 })
              .limit(section.limit || 5)
              .lean();
            return {
              type: 'heroBanner',
              sectionKey: section.sectionKey || 'heroBanner',
              enabled: true,
              order: section.order,
              items: banners.map(transformBanner),
            };
          }

          if (section.type === 'jobs') {
            let filter = liveJobFilter();
            let sort = { postedAt: -1 };
            if (section.sectionKey === 'featuredJobs') { filter.featured = true; sort = { priority: -1, postedAt: -1 }; }
            else if (section.sectionKey === 'newJobs') { filter.isNew = true; }

            const jobs = await Job.find(filter).sort(sort).limit(section.limit || 20).lean();
            return {
              type: 'jobs',
              sectionKey: section.sectionKey,
              title: section.title || 'Jobs',
              enabled: true,
              order: section.order,
              items: jobs.map(transformJob),
            };
          }

          if (section.type === 'featuredJob') {
            let job = await Job.findOne({ ...liveJobFilter(), featured: true })
              .sort({ priority: -1, postedAt: -1 }).lean();
            if (!job) job = await Job.findOne(liveJobFilter()).sort({ postedAt: -1 }).lean();
            return {
              type: 'featuredJob',
              sectionKey: section.sectionKey || 'featuredJob',
              enabled: true,
              order: section.order,
              items: job ? [transformJob(job)] : [],
            };
          }

          return {
            type: section.type,
            sectionKey: section.sectionKey || section.type,
            enabled: true,
            order: section.order,
            config: section.config || {},
          };
        } catch (err) {
          console.error(`⚠️ Section ${section.type} failed:`, err.message);
          return { type: section.type, sectionKey: section.sectionKey || section.type, enabled: true, order: section.order, items: [], error: true };
        }
      })
    );

    const bottomNav = await getBottomNavFromDB();
    const activeJobsCount = liveJobs;

    res.status(200).json({
      success: true,
      version,
      screen: 'home',
      sections: results,
      bottomNav,
      meta: {
        activeJobsCount,
        serverTime: new Date().toISOString(),
        debug: { totalBanners, activeBanners, totalJobs, liveJobs },
      },
    });
  } catch (error) {
    console.error('❌ getHomeConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/bottom-nav
// ─────────────────────────────────────────────
exports.getBottomNav = async (req, res) => {
  try {
    const bottomNav = await getBottomNavFromDB();
    res.status(200).json({ success: true, bottomNav });
  } catch (error) {
    console.error('❌ getBottomNav error:', error);
    res.status(500).json({ success: false, bottomNav: DEFAULT_BOTTOM_NAV, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/debug/appconfigs  (temporary diagnostic)
// ─────────────────────────────────────────────
exports.debugAppConfigs = async (req, res) => {
  try {
    const col = rawCollection('appconfigs');
    const docs = await col.find({}).toArray();
    const dbName = mongoose.connection.name;
    const collections = await mongoose.connection.db.listCollections().toArray();
    res.status(200).json({
      success: true,
      database: dbName,
      collections: collections.map((c) => c.name),
      appconfigsCount: docs.length,
      appconfigs: docs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports._helpers = { activeBannerFilter, liveJobFilter, transformJob, transformBanner };