// In-memory store (use Redis in production)
const otpStore = new Map();

const DEBUG_MODE = process.env.DEBUG_OTP === 'true';
const DEBUG_CODE = process.env.DEBUG_OTP_CODE || '8492';

/**
 * Generate a 4-digit OTP
 */
const generateOTP = (phoneNumber) => {
  let otp;

  if (DEBUG_MODE) {
    otp = DEBUG_CODE;
    console.log(`🔧 [DEBUG] OTP for +91 ${phoneNumber} → ${otp}`);
  } else {
    otp = Math.floor(1000 + Math.random() * 9000).toString();
  }

  otpStore.set(phoneNumber, {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0,
  });

  return otp;
};

/**
 * Verify OTP
 */
const verifyOTP = (phoneNumber, inputOtp) => {
  const record = otpStore.get(phoneNumber);

  if (!record) {
    return { success: false, message: 'No OTP found. Request a new one.' };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(phoneNumber);
    return { success: false, message: 'OTP expired. Request a new one.' };
  }

  if (record.attempts >= 3) {
    otpStore.delete(phoneNumber);
    return { success: false, message: 'Too many attempts. Request a new OTP.' };
  }

  record.attempts += 1;

  if (record.otp !== inputOtp) {
    return {
      success: false,
      message: `Invalid OTP. ${3 - record.attempts} attempts remaining.`,
    };
  }

  otpStore.delete(phoneNumber);
  return { success: true, message: 'OTP verified successfully' };
};

/**
 * Get debug OTP (dev only)
 */
const getDebugOTP = (phoneNumber) => {
  if (!DEBUG_MODE) return null;
  const record = otpStore.get(phoneNumber);
  return record ? record.otp : null;
};

module.exports = { generateOTP, verifyOTP, getDebugOTP };