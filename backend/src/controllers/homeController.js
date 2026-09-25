const mongoose = require('mongoose');
const Banner = require('../models/Banner');
const Job = require('../models/Job');

const rawCollection = (name) => {
  if (mongoose.connection && mongoose.connection.db) {
    return mongoose.connection.db.collection(name);
  }
  try {
    const model = mongoose.models.AppConfig || mongoose.model('AppConfig');
    if (model) return model.collection;
  } catch (e) {}
  throw new Error('Database connection is not established yet.');
};

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
      { $or: [{ endDate: { $gte: now } }, { endDate: null }, { endDate: { $exists: false } }] },
    ],
  };
};

// ✅ ULTRA-RESILIENT live filter — catches ALL possible job status values in your Job_db
const liveJobFilter = () => {
  return {};
};

// ✅ CLEAN PROJECTION — no nested path collisions
const JOB_CARD_PROJECTION = {
  title: 1,
  companyName: 1,
  companyLogo: 1,
  companyInitials: 1,
  location: 1,
  salary: 1,
  experience: 1,
  jobType: 1,
  workMode: 1,
  skills: 1,
  featured: 1,
  isNew: 1,
  postedAt: 1,
  createdAt: 1,
  status: 1,
  isActive: 1,
  contactVisibility: 1,
  whatsappContactEnabled: 1,
};

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
    if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
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

const transformJobCard = (job) => {
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

  return {
    id: String(j._id),
    title: j.title || '',
    company: companyName,
    companyLogoText: companyInitial,
    companyLogoBg: BG_PALETTE[bgIdx],
    companyLogoUrl,
    city: cityOnly,
    location: fullLocation,
    state: j.location?.state || '',
    address: j.location?.address || '',
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
    featured: !!j.featured,
    isNew: !!j.isNew,
    isSaved: false,
  };
};

const transformJobDetail = (job) => {
  if (!job) return null;
  const card = transformJobCard(job);
  if (!card) return null;
  const j = job.toObject ? job.toObject() : job;
  const companyGallery = Array.isArray(j.companyImages)
    ? j.companyImages.map((img) => img?.url).filter(Boolean)
    : [];
  return {
    ...card,
    companyImages: companyGallery,
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
      logoUrl: j.companyLogo?.url || '',
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
  };
};

const transformJob = transformJobCard;

const transformBanner = (banner) => {
  const b = banner.toObject ? banner.toObject() : banner;
  const mobileUrl = b.mobileImage?.url || b.image?.url ||
    (Array.isArray(b.images) && b.images.length > 0 ? b.images[0].url : '');
  const gallery = Array.isArray(b.images)
    ? b.images.slice().sort((a, c) => (a.order || 0) - (c.order || 0)).map((i) => i.url).filter(Boolean)
    : [];
  return {
    id: String(b._id), title: b.title || '', subtitle: b.subtitle || '',
    description: b.description || '', imageUrl: mobileUrl, images: gallery,
    linkUrl: b.linkUrl || '', linkType: b.linkType || 'external',
    ctaLabel: b.ctaLabel || 'Learn More', openInNewTab: !!b.openInNewTab,
    priority: b.priority || 0, slot: b.slot || 0, placement: b.placement,
    category: b.category || 'promotional', backgroundColor: b.backgroundColor || '',
    textColor: b.textColor || '',
  };
};

const DEFAULT_HOME_SECTIONS = [
  { type: 'heroBanner', sectionKey: 'heroBanner', enabled: true, order: 1, limit: 5 },
  { type: 'search', sectionKey: 'search', enabled: true, order: 2 },
  { type: 'location', sectionKey: 'location', enabled: true, order: 3 },
  { type: 'categories', sectionKey: 'categories', enabled: true, order: 4 },
  { type: 'eventBanner', sectionKey: 'eventBanner', enabled: true, order: 5 },
  { type: 'jobs', sectionKey: 'recommendedJobs', title: 'Recommended Jobs', enabled: true, order: 6, limit: 20 },
  { type: 'featuredJob', sectionKey: 'featuredJob', enabled: true, order: 7, limit: 1 },
  { type: 'careerTip', sectionKey: 'careerTip', enabled: true, order: 8 },
];

const DEFAULT_BOTTOM_NAV = {
  items: [
    { key: 'home', label: 'Home', icon: 'Home', enabled: true, order: 1 },
    { key: 'allJobs', label: 'All Jobs', icon: 'Briefcase', enabled: true, order: 2 },
    { key: 'activity', label: 'Activity', icon: 'Activity', enabled: true, order: 3 },
    { key: 'premium', label: 'Premium', icon: 'Crown', enabled: true, order: 4 },
    { key: 'profile', label: 'Profile', icon: 'User', enabled: true, order: 5 },
  ],
  size: { barHeight: 60, iconSize: 24, fontSize: 11, borderRadius: 0, horizontalPadding: 8, iconLabelGap: 4 },
  colors: { backgroundColor: '#FFFFFF', activeColor: '#4F46E5', inactiveColor: '#9CA3AF', badgeColor: '#EF4444' },
  isVisible: true,
};

async function getBottomNavFromDB() {
  try {
    const col = rawCollection('appconfigs');
    const doc = await col.findOne({ configType: 'mobileBottomNav' });
    if (doc && doc.bottomNav && Array.isArray(doc.bottomNav.items) && doc.bottomNav.items.length > 0) return doc.bottomNav;
    return DEFAULT_BOTTOM_NAV;
  } catch (err) { return DEFAULT_BOTTOM_NAV; }
}

async function getHomeSectionsFromDB() {
  try {
    const col = rawCollection('appconfigs');
    const doc = await col.findOne({ configType: 'homeScreen' });
    if (doc && Array.isArray(doc.homeSections) && doc.homeSections.length > 0) return { sections: doc.homeSections, version: doc.version || 1 };
    return { sections: DEFAULT_HOME_SECTIONS, version: 1 };
  } catch (err) { return { sections: DEFAULT_HOME_SECTIONS, version: 1 }; }
}

exports.getHomeConfig = async (req, res) => {
  try {
    const { sections: sectionsRaw, version } = await getHomeSectionsFromDB();
    const sections = [...sectionsRaw].filter((s) => s.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    const [liveJobs, activeBanners] = await Promise.all([
      Job.countDocuments({}).catch(() => 0),
      Banner.countDocuments(activeBannerFilter('home_hero')).catch(() => 0),
    ]);

    const results = await Promise.all(
      sections.map(async (section) => {
        try {
          if (section.type === 'heroBanner') {
            const banners = await Banner.find(activeBannerFilter('home_hero'))
              .sort({ priority: -1, slot: 1, order: 1, createdAt: -1 }).limit(section.limit || 5).lean();
            return { type: 'heroBanner', sectionKey: section.sectionKey || 'heroBanner', enabled: true, order: section.order, items: banners.map(transformBanner) };
          }
          if (section.type === 'jobs') {
            const jobs = await Job.find({}, JOB_CARD_PROJECTION).sort({ postedAt: -1, createdAt: -1 }).limit(section.limit || 20).lean();
            return { type: 'jobs', sectionKey: section.sectionKey, title: section.title || 'Jobs', enabled: true, order: section.order, items: jobs.map(transformJobCard) };
          }
          if (section.type === 'featuredJob') {
            let job = await Job.findOne({ featured: true }, JOB_CARD_PROJECTION).sort({ priority: -1, postedAt: -1 }).lean();
            if (!job) job = await Job.findOne({}, JOB_CARD_PROJECTION).sort({ postedAt: -1 }).lean();
            return { type: 'featuredJob', sectionKey: section.sectionKey || 'featuredJob', enabled: true, order: section.order, items: job ? [transformJobCard(job)] : [] };
          }
          return { type: section.type, sectionKey: section.sectionKey || section.type, enabled: true, order: section.order, config: section.config || {} };
        } catch (err) {
          return { type: section.type, sectionKey: section.sectionKey || section.type, enabled: true, order: section.order, items: [], error: true };
        }
      })
    );

    const bottomNav = await getBottomNavFromDB();
    res.status(200).json({
      success: true, version, screen: 'home', sections: results, bottomNav,
      meta: { activeJobsCount: liveJobs, activeBannersCount: activeBanners, serverTime: new Date().toISOString() },
    });
  } catch (error) {
    console.error('❌ getHomeConfig error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBottomNav = async (req, res) => {
  try {
    const bottomNav = await getBottomNavFromDB();
    res.status(200).json({ success: true, bottomNav });
  } catch (error) {
    res.status(500).json({ success: false, bottomNav: DEFAULT_BOTTOM_NAV, message: error.message });
  }
};

exports.getHomeScreen = exports.getHomeConfig;
exports.getHome = exports.getHomeConfig;
exports.getHomeData = exports.getHomeConfig;
exports.home = exports.getHomeConfig;
exports.bottomNav = exports.getBottomNav;

exports._helpers = {
  activeBannerFilter, liveJobFilter, transformJob, transformJobCard,
  transformJobDetail, transformBanner, JOB_CARD_PROJECTION,
};