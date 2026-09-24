const dotenv = require('dotenv');
const path = require('path');

// Always load .env from project root (backend/.env)
dotenv.config({ path: path.join(__dirname, '../../.env') });

const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error('❌ Cloudinary env missing!');
  console.error({
    CLOUDINARY_CLOUD_NAME: cloudName || 'MISSING',
    CLOUDINARY_API_KEY: apiKey ? 'OK' : 'MISSING',
    CLOUDINARY_API_SECRET: apiSecret ? 'OK' : 'MISSING',
  });
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

console.log('☁️  Cloudinary:', cloudName ? `OK (${cloudName})` : 'NOT CONFIGURED');

module.exports = cloudinary;