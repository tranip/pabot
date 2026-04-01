// Run this ONCE to generate your VAPID keys, then paste the output into .env
// Usage: node generate-vapid.js

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();

console.log('\nCopy these into your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:you@example.com`);
console.log('\nDone. You only ever need to run this once.\n');
