// In-memory store for Email OTPs
const emailOtpStore = new Map();

const DEBUG_MODE = process.env.DEBUG_OTP === 'true';
const DEBUG_CODE = process.env.DEBUG_OTP_CODE || '8492';

/**
 * Generate a 4-digit Email OTP
 */
const generateEmailOTP = (email) => {
  const key = email.toLowerCase().trim();
  let otp;

  if (DEBUG_MODE) {
    otp = DEBUG_CODE;
    console.log(`🔧 [DEBUG] Email OTP for ${key} → ${otp}`);
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
  }

  emailOtpStore.set(key, {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    attempts: 0,
    lastSentAt: Date.now(),
  });

  return otp;
};

/**
 * Verify Email OTP
 */
const verifyEmailOTP = (email, inputOtp) => {
  const key = email.toLowerCase().trim();
  const record = emailOtpStore.get(key);

  if (!record) {
    return { success: false, message: 'No OTP found. Request a new one.' };
  }

  if (Date.now() > record.expiresAt) {
    emailOtpStore.delete(key);
    return { success: false, message: 'OTP expired. Request a new one.' };
  }

  if (record.attempts >= 3) {
    emailOtpStore.delete(key);
    return { success: false, message: 'Too many attempts. Request a new OTP.' };
  }

  record.attempts += 1;

  if (record.otp !== inputOtp) {
    return {
      success: false,
      message: `Invalid OTP. ${3 - record.attempts} attempts remaining.`,
    };
  }

  emailOtpStore.delete(key);
  return { success: true, message: 'OTP verified successfully' };
};

/**
 * Rate limit check
 */
const canResendEmailOTP = (email) => {
  const key = email.toLowerCase().trim();
  const record = emailOtpStore.get(key);
  if (!record) return { allowed: true };

  const secondsPassed = (Date.now() - record.lastSentAt) / 1000;
  if (secondsPassed < 30) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(30 - secondsPassed),
    };
  }
  return { allowed: true };
};

/**
 * Get debug OTP (dev only)
 */
const getDebugEmailOTP = (email) => {
  if (!DEBUG_MODE) return null;
  const key = email.toLowerCase().trim();
  const record = emailOtpStore.get(key);
  return record ? record.otp : null;
};

module.exports = {
  generateEmailOTP,
  verifyEmailOTP,
  canResendEmailOTP,
  getDebugEmailOTP,
};