const test = require('node:test');

const enabled = process.env.TIKTOK_ACCOUNT_LIVE_TEST === 'true';
const safeStatus = Object.freeze({ providerRequestCount: 0, productionAdapterInstalled: false });

test('TikTok account Display API scaffold requires a separately installed adapter', { skip: !enabled }, () => {
  // This inert scaffold never initiates OAuth, requests tokens, or performs network I/O.
  // Enabling it fails safely until a production adapter receives separate approval.
  console.log(JSON.stringify(safeStatus));
  throw new Error('configuration: production TikTok Display API adapter is not installed');
});
