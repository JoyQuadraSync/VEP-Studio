const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const { createTikTokAccountConnectionId, serializeTikTokAccountConnectionId, isTikTokAccountConnectionId } = require('../dist/tiktok-data/authorization/tiktok-account-connection-id');
const { InMemoryTikTokAccountCredentialStore } = require('../dist/tiktok-data/authorization/tiktok-account-credential-store');
const { OfflineTikTokAccountDisconnectService } = require('../dist/tiktok-data/authorization/tiktok-account-disconnect-service');
const { FakeTikTokAccountDataClient } = require('../dist/tiktok-data/clients/fake-tiktok-account-data-client');
const { TikTokAccountDataValidator } = require('../dist/tiktok-data/validation/tiktok-account-data-validator');
const { TikTokNormalizedSnapshotValidator } = require('../dist/tiktok-data/validation/tiktok-normalized-snapshot-validator');
const { TikTokAccountDataNormalizer } = require('../dist/tiktok-data/normalization/tiktok-account-data-normalizer');
const { InMemoryTikTokProfileSnapshotRepository } = require('../dist/tiktok-data/repositories/tiktok-profile-snapshot-repository');
const { InMemoryTikTokVideoMetadataSnapshotRepository } = require('../dist/tiktok-data/repositories/tiktok-video-metadata-snapshot-repository');
const { InMemoryTikTokVideoMetricSnapshotRepository } = require('../dist/tiktok-data/repositories/tiktok-video-metric-snapshot-repository');
const { InMemoryTikTokSyncCheckpointRepository } = require('../dist/tiktok-data/repositories/tiktok-sync-checkpoint-repository');
const { InMemoryTikTokAccountPageSnapshotRepository } = require('../dist/tiktok-data/repositories/tiktok-account-page-snapshot-repository');
const { TikTokAccountSynchronizationService } = require('../dist/tiktok-data/synchronization/tiktok-account-synchronization-service');
const { TikTokAccountAnalyticsService } = require('../dist/tiktok-data/analytics/tiktok-account-analytics-service');
const { TikTokAccountFreshnessService } = require('../dist/tiktok-data/analytics/tiktok-account-freshness-service');
const { createTikTokAccountDataFailure } = require('../dist/tiktok-data/failures/tiktok-account-data-failure');

const connectionId = createTikTokAccountConnectionId('fixture-connection-001');
const profile = { providerAccountId: 'fixture-account-001', displayName: 'Fixture Account', avatarUrl: 'https://invalid.example/avatar', sourceUpdatedAt: '2026-08-01T00:00:00.000Z' };
function video(id = 'fixture-video-001', overrides = {}) { return { providerAccountId: 'fixture-account-001', videoId: id, createdAt: '2026-08-01T00:00:00.000Z', durationSeconds: 30, viewCount: 100, likeCount: 10, commentCount: 2, shareCount: 3, coverImageUrl: 'https://invalid.example/cover', ...overrides }; }
const context = { connectionId, apiVersion: 'v2', scopesUsed: ['user.info.basic', 'video.list'], fetchedAt: '2026-08-02T00:00:00.000Z', measuredAt: '2026-08-02T00:00:00.000Z', completeness: 'complete' };
const policy = { maxPages: 5, maxItems: 20, apiVersion: 'v2', scopesUsed: ['user.info.basic', 'video.list'] };
const analyticsPolicy = { topListLimit: 10, freshness: { profileMaxAgeMs: 86400000, recentVideoListMaxAgeMs: 21600000, recentVideoMetricsMaxAgeMs: 21600000, olderVideoMetricsMaxAgeMs: 86400000, analyticsSummaryMaxAgeMs: 86400000, recentVideoAgeBoundaryMs: 2592000000 } };

test('connection identity accepts opaque values and rejects malformed inputs', () => {
  assert.equal(serializeTikTokAccountConnectionId(connectionId), 'fixture-connection-001');
  assert.equal(isTikTokAccountConnectionId(connectionId), true);
  for (const value of ['', ' ', ' padded', 'bad\nvalue', 'x'.repeat(129), 4, null]) assert.throws(() => createTikTokAccountConnectionId(value));
  assert.equal(serializeTikTokAccountConnectionId(createTikTokAccountConnectionId('token-like-but-opaque')), 'token-like-but-opaque');
  const samePrototype = Object.create(Object.getPrototypeOf(connectionId)); Object.defineProperty(samePrototype, 'value', { value: 'fixture-connection-001' });
  for (const forged of ['fixture-connection-001', profile.providerAccountId, profile.displayName, { value: 'fixture-connection-001' }, { ...connectionId }, JSON.parse(JSON.stringify(connectionId)), structuredClone(connectionId), samePrototype, { value: 'fixture-connection-001', [Symbol('brand')]: true }]) {
    assert.equal(isTikTokAccountConnectionId(forged), false); assert.throws(() => serializeTikTokAccountConnectionId(forged));
  }
  assert.equal(serializeTikTokAccountConnectionId(createTikTokAccountConnectionId('x'.repeat(128))), 'x'.repeat(128));
});

test('public boundaries reject plain strings that bypass the connection factory', async () => {
  const forged = 'fixture-connection-001'; const store = new InMemoryTikTokAccountCredentialStore();
  await assert.rejects(store.create({ connectionId: forged, providerAccountId: 'fixture-account-001', accessToken: 'fixture', expiresAt: '2026-08-02T00:00:00.000Z', revoked: false }));
  await assert.rejects(store.findStatus(forged)); await assert.rejects(store.replace(forged, { connectionId, providerAccountId: 'fixture-account-001', accessToken: 'fixture', expiresAt: '2026-08-02T00:00:00.000Z', revoked: false })); await assert.rejects(store.revoke(forged));
  await assert.rejects(store.createTrustedAdapter(() => new Date()).verifyCredential(forged)); await assert.rejects(new OfflineTikTokAccountDisconnectService(store).disconnect(forged));
  const client = new FakeTikTokAccountDataClient({ profile, pages: {} });
  await assert.rejects(client.getProfile(forged)); await assert.rejects(client.listVideosPage(forged)); await assert.rejects(client.getVideosByIds(forged, []));
  assert.throws(() => new TikTokAccountDataNormalizer().normalizeProfile(profile, { ...context, connectionId: forged }));
  await assert.rejects(new InMemoryTikTokProfileSnapshotRepository().findLatest(forged)); await assert.rejects(new InMemoryTikTokVideoMetadataSnapshotRepository().findLatestByVideoId(forged, 'video')); await assert.rejects(new InMemoryTikTokVideoMetricSnapshotRepository().listByVideoId(forged, 'video'));
  assert.throws(() => new TikTokAccountAnalyticsService({ now: () => new Date() }).analyze(forged, [], analyticsPolicy)); assert.throws(() => createTikTokAccountDataFailure({ code: 'unknown', operation: 'test', connectionId: forged }));
  await assert.rejects(service(client).value.synchronize(forged, policy)); await assert.rejects(service(client).value.resume(forged, 'sync-1', policy));
});

test('trusted adapter capability exposes safe status and distinguishes missing, revoked, and expired records', async () => {
  const store = new InMemoryTikTokAccountCredentialStore(); const adapter = store.createTrustedAdapter(() => new Date('2026-08-01T00:00:00.000Z'));
  await assert.rejects(adapter.verifyCredential(connectionId), (failure) => failure.code === 'authorization_required' && !('stack' in failure));
  await store.create({ connectionId, providerAccountId: 'fixture-account-001', accessToken: 'fixture-secret-not-real', expiresAt: '2026-08-02T00:00:00.000Z', revoked: false });
  assert.deepEqual(await adapter.verifyCredential(connectionId), { providerAccountId: 'fixture-account-001', expiresAt: '2026-08-02T00:00:00.000Z' });
  await store.revoke(connectionId);
  await assert.rejects(adapter.verifyCredential(connectionId), (failure) => failure.code === 'authorization_required' && JSON.stringify(failure).includes('fixture-secret') === false);
  const expired = createTikTokAccountConnectionId('expired');
  await store.create({ connectionId: expired, providerAccountId: 'fixture-account-002', accessToken: 'fixture-expired', expiresAt: '2025-01-01T00:00:00.000Z', revoked: false });
  await assert.rejects(adapter.verifyCredential(expired), (failure) => failure.code === 'authorization_expired');
});

test('credential store never serializes or returns secret-bearing records', async () => {
  const store = new InMemoryTikTokAccountCredentialStore(); const mutable = { connectionId, providerAccountId: 'fixture-account-001', accessToken: 'private-fixture-access', refreshToken: 'private-fixture-refresh', expiresAt: '2026-08-03T00:00:00.000Z', revoked: false };
  await store.create(mutable); mutable.accessToken = 'changed-after-save';
  const serialized = [JSON.stringify(store), JSON.stringify({ ...store }), inspect(store), JSON.stringify(structuredClone(store))].join('|');
  assert.equal(serialized.includes('private-fixture-access'), false); assert.equal(serialized.includes('private-fixture-refresh'), false); assert.equal(serialized.includes('changed-after-save'), false);
  assert.equal(Object.getOwnPropertyNames(store).includes('accessToken'), false); assert.equal(Object.getOwnPropertySymbols(store).length, 0);
  const status = await store.findStatus(connectionId); assert.deepEqual(Object.keys(status).sort(), ['connectionId','expiresAt','providerAccountId','revoked']);
  const adapter = store.createTrustedAdapter(() => new Date('2026-08-01T00:00:00.000Z')); const safe = await adapter.verifyCredential(connectionId);
  assert.deepEqual(Object.keys(safe).sort(), ['expiresAt','providerAccountId']); assert.equal(JSON.stringify(safe).includes('private-fixture'), false); assert.equal(Object.isFrozen(safe), true);
  assert.equal('withCredential' in store, false); assert.equal('createResolver' in store, false); assert.equal('accessToken' in safe, false);
});

test('strict source validation rejects unknown, unsafe, malformed, and credential-shaped data', () => {
  const validator = new TikTokAccountDataValidator(); validator.validateProfile(profile); validator.validateVideo(video());
  assert.throws(() => validator.validateProfile({ ...profile, profileUrl: undefined, rawPayload: {} }));
  assert.throws(() => validator.validateVideo({ ...video(), viewCount: -1 }));
  assert.throws(() => validator.validateVideo({ ...video(), durationSeconds: Infinity }));
  assert.throws(() => validator.validateVideo({ ...video(), createdAt: 'yesterday' }));
  const cyclic = { ...profile }; cyclic.self = cyclic; assert.throws(() => validator.validateProfile(cyclic));
});

test('strict validation rejects descriptor attacks while allowing repeated non-cyclic references', () => {
  const validator = new TikTokAccountDataValidator();
  for (const attack of [
    () => { const value = { ...profile }; Object.defineProperty(value, 'hidden', { value: 'x' }); return value; },
    () => { const value = { ...profile }; Object.defineProperty(value, 'displayName', { enumerable: true, get: () => 'getter' }); return value; },
    () => { const value = { ...profile }; value[Symbol('secret')] = 'x'; return value; },
    () => Object.assign(Object.create({ inherited: true }), profile)
  ]) assert.throws(() => validator.validateProfile(attack()));
  const shared = { safe: true }; const { canonicalizeTikTokValue } = require('../dist/tiktok-data/validation/tiktok-json-safety');
  assert.equal(canonicalizeTikTokValue({ left: shared, right: shared }), '{"left":{"safe":true},"right":{"safe":true}}');
});

test('page shape rules fail at page validation before any synchronization writes', async () => {
  const invalidPages = [
    { videos: [], hasMore: true },
    { videos: [], hasMore: false, nextCursor: 'unexpected' },
    { videos: [{ ...video(), viewCount: -1 }], hasMore: false }
  ];
  for (const invalid of invalidPages) {
    assert.throws(() => new FakeTikTokAccountDataClient({ profile, pages: { '': invalid } }));
  }
});

test('normalization omits missing fields, marks ephemeral URLs, splits metrics, and does not mutate input', () => {
  const normalizer = new TikTokAccountDataNormalizer(); const input = video(); const before = structuredClone(input);
  const first = normalizer.normalizeVideo(input, context); const second = normalizer.normalizeVideo({ ...input }, context);
  assert.deepEqual(input, before); assert.equal(first.metadata.snapshotId, second.metadata.snapshotId);
  assert.equal(first.metadata.coverImageUrl.persistenceKind, 'ephemeral_reference');
  assert.equal(first.metrics.viewCount, 100); assert.equal('viewCount' in first.metadata, false); assert.equal(Object.isFrozen(first.metadata), true);
  const normalizedProfile = normalizer.normalizeProfile({ providerAccountId: 'fixture-account-001' }, context);
  assert.equal('profileUrl' in normalizedProfile, false); assert.equal('displayName' in normalizedProfile, false);
});

test('normalized snapshot validators enforce every strict profile, metadata, metric, provenance, and descriptor boundary', () => {
  const validator = new TikTokNormalizedSnapshotValidator(); const normalizer = new TikTokAccountDataNormalizer();
  const normalizedProfile = normalizer.normalizeProfile(profile, context); const normalizedVideo = normalizer.normalizeVideo(video(), context);
  validator.validateProfile(normalizedProfile); validator.validateMetadata(normalizedVideo.metadata); validator.validateMetrics(normalizedVideo.metrics);
  const invalidProfiles = [{ ...normalizedProfile, displayName: 4 }, { ...normalizedProfile, unknown: true }, { ...normalizedProfile, profileUrl: 'not-a-url' }];
  const invalidMetadata = [{ ...normalizedVideo.metadata, videoId: '' }, { ...normalizedVideo.metadata, createdAt: 'yesterday' }, { ...normalizedVideo.metadata, shareUrl: 'file:///private' }, { ...normalizedVideo.metadata, durationSeconds: -1 }, { ...normalizedVideo.metadata, unknown: true }];
  const invalidMetrics = [{ ...normalizedVideo.metrics, viewCount: -1 }, { ...normalizedVideo.metrics, measuredAt: 'yesterday' }, { ...normalizedVideo.metrics, completeness: 'invalid' }, { ...normalizedVideo.metrics, unknown: true }];
  for (const value of invalidProfiles) assert.throws(() => validator.validateProfile(value)); for (const value of invalidMetadata) assert.throws(() => validator.validateMetadata(value)); for (const value of invalidMetrics) assert.throws(() => validator.validateMetrics(value));
  assert.throws(() => validator.validateProfile({ ...normalizedProfile, provenance: { ...normalizedProfile.provenance, sourceSystem: 'other' } }));
  assert.throws(() => validator.validateMetadata({ ...normalizedVideo.metadata, coverImageUrl: { ...normalizedVideo.metadata.coverImageUrl, persistenceKind: 'durable' } }));
  let getterInvoked = false; const accessor = { ...normalizedProfile }; Object.defineProperty(accessor, 'displayName', { enumerable: true, get: () => { getterInvoked = true; return 'hidden'; } }); assert.throws(() => validator.validateProfile(accessor)); assert.equal(getterInvoked, false);
  const symbolAttack = { ...normalizedProfile, [Symbol('hidden')]: 'value' }; assert.throws(() => validator.validateProfile(symbolAttack));
  const nonEnumerable = { ...normalizedProfile }; Object.defineProperty(nonEnumerable, 'displayName', { enumerable: false, value: 'hidden' }); assert.throws(() => validator.validateProfile(nonEnumerable));
  const customPrototype = Object.assign(Object.create({ inherited: true }), normalizedProfile); assert.throws(() => validator.validateProfile(customPrototype));
});

test('canonical cycle in an allowed normalized field becomes sanitized snapshot_validation_failed before snapshot persistence', async () => {
  const validNormalizer = new TikTokAccountDataNormalizer(); const cyclicScopes = []; cyclicScopes.push(cyclicScopes); let profileRepositoryCalls = 0;
  const normalizer = { normalizeProfile: (...args) => { const value = validNormalizer.normalizeProfile(...args); return { ...value, provenance: { ...value.provenance, scopesUsed: cyclicScopes } }; }, normalizeVideo: (...args) => validNormalizer.normalizeVideo(...args) };
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [], hasMore: false } } });
  const result = await service(client, undefined, { normalizer, profiles: { save: async () => { profileRepositoryCalls += 1; } } }).value.synchronize(connectionId, policy);
  assert.equal(result.failure.code, 'snapshot_validation_failed'); assert.equal(profileRepositoryCalls, 0);
  assert.deepEqual(Object.keys(result.failure).sort(), ['code','connectionId','operation']); assert.equal(JSON.stringify(result.failure).includes('cycle'), false); assert.equal('stack' in result.failure, false); assert.equal('cause' in result.failure, false);
});

test('invalid normalized video snapshots fail before repositories with sanitized snapshot_validation_failed', async () => {
  const validNormalizer = new TikTokAccountDataNormalizer(); const validClient = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], hasMore: false } } });
  for (const corrupt of [
    (value) => ({ ...value, metadata: { ...value.metadata, videoId: '' } }),
    (value) => ({ ...value, metadata: { ...value.metadata, provenance: { ...value.metadata.provenance, connectionId: ' invalid ' } } }),
    (value) => ({ ...value, metrics: { ...value.metrics, viewCount: -1 } }),
    (value) => ({ ...value, metrics: { ...value.metrics, measuredAt: 'invalid' } }),
    (value) => ({ ...value, metrics: { ...value.metrics, completeness: 'invalid' } })
  ]) {
    let repositoryCalls = 0; const normalizer = { normalizeProfile: (...args) => validNormalizer.normalizeProfile(...args), normalizeVideo: (...args) => corrupt(validNormalizer.normalizeVideo(...args)) };
    const result = await service(validClient, undefined, { normalizer, pages: { savePage: async () => { repositoryCalls += 1; } } }).value.synchronize(connectionId, policy);
    assert.equal(result.failure.code, 'snapshot_validation_failed'); assert.equal(repositoryCalls, 0); assert.deepEqual(Object.keys(result.failure).sort(), ['code','connectionId','operation']); assert.equal(JSON.stringify(result.failure).includes('invalid'), false);
  }
});

test('profile, metadata, and metric repositories reject malformed snapshots without storing or allocating revisions', async () => {
  const normalizer = new TikTokAccountDataNormalizer(); const validProfile = normalizer.normalizeProfile(profile, context); const validVideo = normalizer.normalizeVideo(video('repository-validation'), context);

  const profiles = new InMemoryTikTokProfileSnapshotRepository(); const malformedProfile = { ...validProfile, unknown: 'not allowed' };
  await assert.rejects(profiles.save(malformedProfile)); assert.equal(await profiles.findById(validProfile.snapshotId), undefined); assert.equal((await profiles.save(validProfile)).revision, 1);

  const metadata = new InMemoryTikTokVideoMetadataSnapshotRepository(); const malformedMetadata = { ...validVideo.metadata, videoId: '' };
  await assert.rejects(metadata.save(malformedMetadata)); assert.equal(await metadata.findById(validVideo.metadata.snapshotId), undefined); assert.equal((await metadata.save(validVideo.metadata)).revision, 1);

  const metrics = new InMemoryTikTokVideoMetricSnapshotRepository(); const malformedMetric = { ...validVideo.metrics, viewCount: -1 };
  await assert.rejects(metrics.save(malformedMetric)); assert.equal(await metrics.findById(validVideo.metrics.snapshotId), undefined); assert.equal((await metrics.save(validVideo.metrics)).revision, 1);
});

test('repositories reuse identical snapshots, retain immutable revisions, reject identity conflicts, and detach reads', async () => {
  const normalizer = new TikTokAccountDataNormalizer(); const repo = new InMemoryTikTokVideoMetricSnapshotRepository();
  const first = normalizer.normalizeVideo(video(), context).metrics; const saved = await repo.save(first); const repeated = await repo.save(first);
  assert.deepEqual(repeated, saved); assert.equal(saved.revision, 1);
  const next = normalizer.normalizeVideo(video('fixture-video-001', { viewCount: 120 }), { ...context, measuredAt: '2026-08-03T00:00:00.000Z' }).metrics;
  assert.equal((await repo.save(next)).revision, 2); assert.equal((await repo.listByVideoId(connectionId, 'fixture-video-001')).length, 2);
  await assert.rejects(repo.save({ ...first, viewCount: 999 }), (failure) => failure.code === 'repository_conflict');
});

test('profile and metadata repositories reuse identical content observed at a later fetchedAt', async () => {
  const normalizer = new TikTokAccountDataNormalizer();
  const profiles = new InMemoryTikTokProfileSnapshotRepository();
  const metadata = new InMemoryTikTokVideoMetadataSnapshotRepository();
  const firstProfile = normalizer.normalizeProfile(profile, context);
  const laterContext = { ...context, fetchedAt: '2026-08-03T00:00:00.000Z', measuredAt: '2026-08-03T00:00:00.000Z' };
  const laterProfile = normalizer.normalizeProfile(profile, laterContext);
  assert.deepEqual(await profiles.save(firstProfile), await profiles.save(laterProfile));
  const firstVideo = normalizer.normalizeVideo(video(), context).metadata;
  const laterVideo = normalizer.normalizeVideo(video(), laterContext).metadata;
  assert.deepEqual(await metadata.save(firstVideo), await metadata.save(laterVideo));
});

function service(client, clockValues = ['2026-08-02T00:00:00.000Z'], overrides = {}) {
  let index = 0; const clock = { now: () => new Date(clockValues[Math.min(index++, clockValues.length - 1)]) }; let ids = 0;
  const profiles = new InMemoryTikTokProfileSnapshotRepository(); const metadata = new InMemoryTikTokVideoMetadataSnapshotRepository(); const metrics = new InMemoryTikTokVideoMetricSnapshotRepository(); const checkpoints = new InMemoryTikTokSyncCheckpointRepository();
  const pages = new InMemoryTikTokAccountPageSnapshotRepository(metadata, metrics);
  return { profiles, metadata, metrics, checkpoints, pages, value: new TikTokAccountSynchronizationService(client, overrides.validator ?? new TikTokAccountDataValidator(), overrides.normalizer ?? new TikTokAccountDataNormalizer(), overrides.profiles ?? profiles, overrides.metadata ?? metadata, overrides.metrics ?? metrics, overrides.pages ?? pages, overrides.checkpoints ?? checkpoints, overrides.clock ?? clock, overrides.ids ?? { next: () => `sync-${++ids}` }) };
}

test('synchronization completes deterministic multi-page crawl and ignores duplicate entities', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], nextCursor: 'next', hasMore: true }, next: { videos: [video('a'), video('b')], hasMore: false } } });
  const setup = service(client); const result = await setup.value.synchronize(connectionId, policy);
  assert.equal(result.status, 'complete'); assert.equal(result.pagesCompleted, 2); assert.equal(result.itemsObserved, 2); assert.equal(client.callCount, 5);
  assert.equal((await setup.metadata.findLatestByVideoId(connectionId, 'b')).videoId, 'b');
});

test('selected-video queries use canonical deterministic batches and authoritative metrics', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('b'), video('a')], hasMore: false } } });
  const setup = service(client); const result = await setup.value.synchronize(connectionId, { ...policy, videoQueryBatchSize: 1 });
  assert.equal(result.status, 'complete');
  assert.deepEqual(client.observedCalls.filter((call) => call.method === 'getVideosByIds').map((call) => call.ids), [['a'], ['b']]);
});

test('selected-video queries reject missing, duplicate, extra, and conflicting metric results', async () => {
  const cases = [
    [],
    [video('a'), video('a')],
    [video('a'), video('extra')],
    [video('a', { viewCount: 999 })]
  ];
  for (const queriedVideos of cases) {
    const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], hasMore: false } }, queriedVideos });
    const result = await service(client).value.synchronize(connectionId, policy);
    assert.equal(result.status, 'partial'); assert.equal(result.failure.code, 'response_invalid');
  }
});

test('selected-video later-batch failure stops without automatic retry', async () => {
  const failure = createTikTokAccountDataFailure({ code: 'rate_limit', operation: 'query_video_metrics' });
  const base = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a'), video('b')], hasMore: false } } });
  let queryCalls = 0; const client = { getProfile: (id) => base.getProfile(id), listVideosPage: (id, cursor) => base.listVideosPage(id, cursor), getVideosByIds: async (id, ids) => { queryCalls += 1; if (queryCalls === 2) throw failure; return base.getVideosByIds(id, ids); } };
  const result = await service(client).value.synchronize(connectionId, { ...policy, videoQueryBatchSize: 1 });
  assert.equal(result.status, 'partial'); assert.equal(result.failure.code, 'rate_limit'); assert.equal(queryCalls, 2);
});

test('synchronization classifies source, normalization, repository, pagination, and unknown failures at narrow boundaries', async () => {
  const valid = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], hasMore: false } } });
  const client = (changes = {}) => ({ getProfile: (id) => valid.getProfile(id), listVideosPage: (id, cursor) => valid.listVideosPage(id, cursor), getVideosByIds: (id, ids) => valid.getVideosByIds(id, ids), ...changes });
  const cases = [
    ['response_invalid', client({ getProfile: async () => ({ providerAccountId: '' }) }), {}],
    ['response_invalid', client({ listVideosPage: async () => ({ videos: 'invalid', hasMore: false }) }), {}],
    ['response_invalid', client({ getVideosByIds: async () => [{ ...video('a'), viewCount: -1 }] }), {}],
    ['snapshot_validation_failed', client(), { normalizer: { normalizeProfile() { throw new Error('raw normalization detail'); }, normalizeVideo: (...args) => new TikTokAccountDataNormalizer().normalizeVideo(...args) } }],
    ['snapshot_validation_failed', client(), { normalizer: { normalizeProfile() { return { snapshotId: 'forged' }; }, normalizeVideo: (...args) => new TikTokAccountDataNormalizer().normalizeVideo(...args) } }],
    ['repository_unavailable', client(), { profiles: { save: async () => { throw new Error('raw profile repository detail'); }, findLatest: async () => undefined } }],
    ['repository_unavailable', client(), { pages: { savePage: async () => { throw new Error('raw atomic page detail'); } } }],
    ['unknown', client({ getProfile: async () => { throw new Error('genuinely unrelated raw detail'); } }), {}]
  ];
  for (const [expected, source, overrides] of cases) {
    const result = await service(source, undefined, overrides).value.synchronize(connectionId, policy);
    assert.equal(result.failure.code, expected); assert.equal('stack' in result.failure, false); assert.equal('cause' in result.failure, false); assert.equal(JSON.stringify(result.failure).includes('raw'), false);
  }
  const missingCursor = client({ listVideosPage: async () => ({ videos: [], hasMore: true }) });
  assert.equal((await service(missingCursor).value.synchronize(connectionId, policy)).failure.code, 'pagination_invalid');
  const typed = createTikTokAccountDataFailure({ code: 'rate_limit', operation: 'get_profile' });
  assert.equal((await service(client({ getProfile: async () => { throw typed; } })).value.synchronize(connectionId, policy)).failure, typed);
  const conflict = createTikTokAccountDataFailure({ code: 'repository_conflict', operation: 'save_video_page' });
  assert.equal((await service(client(), undefined, { pages: { savePage: async () => { throw conflict; } } }).value.synchronize(connectionId, policy)).failure, conflict);
  const checkpointFailure = { create: async () => { throw new Error('raw checkpoint detail'); }, save: async () => { throw new Error('raw'); }, find: async () => undefined };
  await assert.rejects(service(client(), undefined, { checkpoints: checkpointFailure }).value.synchronize(connectionId, policy), (failure) => failure.code === 'repository_unavailable' && !('stack' in failure));
  for (const boundary of ['metadata', 'metric']) {
    const result = await service(client(), undefined, { pages: { savePage: async () => { throw new Error(`raw ${boundary} repository detail`); } } }).value.synchronize(connectionId, policy);
    assert.equal(result.failure.code, 'repository_unavailable');
  }
});

test('empty video pages make zero selected-video queries', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [], hasMore: false } } });
  const result = await service(client).value.synchronize(connectionId, policy);
  assert.equal(result.status, 'complete'); assert.equal(client.observedCalls.some((call) => call.method === 'getVideosByIds'), false);
});

test('synchronization rejects cursor cycles without retry and preserves partial checkpoint', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], nextCursor: 'same', hasMore: true }, same: { videos: [video('b')], nextCursor: 'same', hasMore: true } } });
  const setup = service(client); const result = await setup.value.synchronize(connectionId, policy);
  assert.equal(result.status, 'partial'); assert.equal(result.failure.code, 'pagination_invalid'); assert.equal(client.callCount, 4); assert.equal(result.pagesCompleted, 1);
});

test('synchronization safeguards create partial results and resume validates ownership', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a')], nextCursor: 'next', hasMore: true }, next: { videos: [video('b')], hasMore: false } } });
  const setup = service(client); const result = await setup.value.synchronize(connectionId, { ...policy, maxPages: 1 });
  assert.equal(result.status, 'partial');
  await assert.rejects(setup.value.resume(createTikTokAccountConnectionId('other'), result.synchronizationId, { ...policy, maxPages: 2 }), (failure) => failure.code === 'pagination_invalid');
});

test('resume succeeds without duplicate inflation and retains cursor history', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [video('a'), video('a')], nextCursor: 'one', hasMore: true }, one: { videos: [video('a'), video('b')], hasMore: false } } });
  const setup = service(client); const partial = await setup.value.synchronize(connectionId, { ...policy, maxPages: 1 });
  const completed = await setup.value.resume(connectionId, partial.synchronizationId, { ...policy, maxPages: 2 });
  assert.equal(completed.status, 'complete'); assert.equal(completed.itemsObserved, 2); assert.deepEqual(completed.checkpoint.seenVideoIds, ['a','b']);
});

test('resume detects longer cursor cycles and validates API version and synchronization ID before calls', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: { '': { videos: [], nextCursor: 'a', hasMore: true }, a: { videos: [], nextCursor: 'b', hasMore: true }, b: { videos: [], nextCursor: 'a', hasMore: true } } });
  const setup = service(client); const first = await setup.value.synchronize(connectionId, { ...policy, maxPages: 1 }); const second = await setup.value.resume(connectionId, first.synchronizationId, { ...policy, maxPages: 2 }); const third = await setup.value.resume(connectionId, second.synchronizationId, { ...policy, maxPages: 3 });
  assert.equal(third.failure.code, 'pagination_invalid'); const calls = client.callCount;
  await assert.rejects(setup.value.resume(connectionId, 'missing-sync', policy)); await assert.rejects(setup.value.resume(connectionId, first.synchronizationId, { ...policy, apiVersion: 'other' })); assert.equal(client.callCount, calls);
});

test('atomic page persistence rolls back metadata when metric commit fails', async () => {
  class FailingMetricRepository extends InMemoryTikTokVideoMetricSnapshotRepository { constructor() { super(); this.fail = true; } async save(snapshot) { if (this.fail) { this.fail = false; throw new Error('injected metric failure'); } return super.save(snapshot); } }
  const metadata = new InMemoryTikTokVideoMetadataSnapshotRepository(); const metrics = new FailingMetricRepository(); const pageRepo = new InMemoryTikTokAccountPageSnapshotRepository(metadata, metrics);
  const normalized = new TikTokAccountDataNormalizer().normalizeVideo(video('atomic'), context);
  await assert.rejects(pageRepo.savePage({ metadata: [normalized.metadata], metrics: [normalized.metrics] }));
  assert.equal(await metadata.findById(normalized.metadata.snapshotId), undefined); assert.equal(await metrics.findById(normalized.metrics.snapshotId), undefined);
  await pageRepo.savePage({ metadata: [normalized.metadata], metrics: [normalized.metrics] }); assert.ok(await metadata.findById(normalized.metadata.snapshotId));
});

test('atomic page preflight rejects metadata or metric conflicts without touching other records', async () => {
  const normalizer = new TikTokAccountDataNormalizer();
  for (const conflictKind of ['metadata', 'metric']) {
    const metadata = new InMemoryTikTokVideoMetadataSnapshotRepository(); const metrics = new InMemoryTikTokVideoMetricSnapshotRepository(); const pageRepo = new InMemoryTikTokAccountPageSnapshotRepository(metadata, metrics);
    const first = normalizer.normalizeVideo(video('first'), context); const second = normalizer.normalizeVideo(video('second'), context);
    if (conflictKind === 'metadata') await metadata.save({ ...second.metadata, title: 'seeded conflict' }); else await metrics.save({ ...second.metrics, viewCount: 999 });
    await assert.rejects(pageRepo.savePage({ metadata: [first.metadata, second.metadata], metrics: [first.metrics, second.metrics] }), (failure) => failure.code === 'repository_conflict');
    assert.equal(await metadata.findById(first.metadata.snapshotId), undefined); assert.equal(await metrics.findById(first.metrics.snapshotId), undefined);
  }
});

test('fake client detaches construction fixtures, returned values, and call observations', async () => {
  const mutableProfile = { ...profile }; const options = { profile: mutableProfile, pages: { '': { videos: [video('a')], hasMore: false } } }; const client = new FakeTikTokAccountDataClient(options);
  mutableProfile.displayName = 'mutated'; options.pages[''].videos[0].title = 'mutated';
  const returned = await client.getProfile(connectionId); assert.equal(returned.displayName, 'Fixture Account'); returned.displayName = 'caller mutation';
  const calls = client.observedCalls; calls[0].method = 'mutated'; assert.equal(client.observedCalls[0].method, 'getProfile');
  assert.equal((await client.listVideosPage(connectionId)).videos[0].title, undefined);
});

test('synchronization sanitizes profile provider failures and does not retry', async () => {
  const client = new FakeTikTokAccountDataClient({ profile, pages: {}, failures: { getProfile: createTikTokAccountDataFailure({ code: 'provider_unavailable', operation: 'get_profile' }) } });
  const result = await service(client).value.synchronize(connectionId, policy);
  assert.equal(result.status, 'partial'); assert.equal(result.failure.code, 'provider_unavailable'); assert.equal(client.callCount, 1);
});

test('analytics calculates deterministic metrics, ordering, observation window, and summary identity', () => {
  const normalizer = new TikTokAccountDataNormalizer();
  const oldA = normalizer.normalizeVideo(video('a', { viewCount: 50 }), { ...context, measuredAt: '2026-08-01T00:00:00.000Z' }).metrics;
  const newA = normalizer.normalizeVideo(video('a', { viewCount: 100 }), { ...context, measuredAt: '2026-08-02T00:00:00.000Z' }).metrics;
  const b = normalizer.normalizeVideo(video('b', { viewCount: 200 }), { ...context, measuredAt: '2026-08-02T00:00:00.000Z' }).metrics;
  const analytics = new TikTokAccountAnalyticsService({ now: () => new Date('2026-08-02T01:00:00.000Z') });
  const first = analytics.analyze(connectionId, [b, newA, oldA], analyticsPolicy); const second = analytics.analyze(connectionId, [oldA, b, newA], analyticsPolicy);
  assert.deepEqual(first, second); assert.equal(first.sampleSize, 2); assert.equal(first.videos.find((item) => item.videoId === 'a').viewsPerDay, 50);
  assert.deepEqual(first.topVideosByViews.map((item) => item.videoId), ['b', 'a']); assert.equal(JSON.stringify(first).includes('focus'), false);
});

test('analytics reports missing, zero, partial, regression, and time failures without clamping', () => {
  const normalizer = new TikTokAccountDataNormalizer(); const analytics = new TikTokAccountAnalyticsService({ now: () => new Date('2026-08-02T01:00:00.000Z') });
  const old = normalizer.normalizeVideo(video('a', { viewCount: 100 }), { ...context, measuredAt: '2026-08-01T00:00:00.000Z' }).metrics;
  const withoutLike = video('a', { viewCount: 0 }); delete withoutLike.likeCount;
  const current = normalizer.normalizeVideo(withoutLike, { ...context, measuredAt: '2026-08-02T00:00:00.000Z', completeness: 'partial' }).metrics;
  const item = analytics.analyze(connectionId, [old, current], analyticsPolicy).videos[0];
  assert.ok(item.unavailableReasons.includes('zero_view_count')); assert.ok(item.unavailableReasons.includes('missing_engagement_counter')); assert.ok(item.unavailableReasons.includes('partial_snapshot')); assert.equal(item.viewsPerDay, undefined);
});

test('analytics equal-time selection is permutation-stable and rejects unsafe engagement sums', () => {
  const normalizer = new TikTokAccountDataNormalizer(); const analytics = new TikTokAccountAnalyticsService({ now: () => new Date('2026-08-02T01:00:00.000Z') });
  const first = normalizer.normalizeVideo(video('same', { viewCount: 10 }), context).metrics;
  const second = { ...normalizer.normalizeVideo(video('same', { viewCount: 20 }), context).metrics, revision: 2, snapshotId: 'f'.repeat(64) };
  assert.deepEqual(analytics.analyze(connectionId, [first, second], analyticsPolicy), analytics.analyze(connectionId, [second, first], analyticsPolicy));
  const huge = normalizer.normalizeVideo(video('huge', { likeCount: Number.MAX_SAFE_INTEGER, commentCount: 1, shareCount: 0 }), context).metrics;
  const item = analytics.analyze(connectionId, [huge], analyticsPolicy).videos[0]; assert.equal(item.engagementCount, undefined); assert.ok(item.unavailableReasons.includes('unsafe_aggregate'));
});

test('freshness policy is validated and stale state uses injected clock', () => {
  const metric = new TikTokAccountDataNormalizer().normalizeVideo(video(), context).metrics;
  const stale = new TikTokAccountAnalyticsService({ now: () => new Date('2026-08-10T00:00:00.000Z') }).analyze(connectionId, [metric], analyticsPolicy);
  assert.equal(stale.freshness, 'stale'); assert.throws(() => new TikTokAccountAnalyticsService({ now: () => new Date() }).analyze(connectionId, [metric], { ...analyticsPolicy, topListLimit: 0 }));
});

test('freshness covers every policy boundary with equality fresh and future or invalid unknown', () => {
  const now = new Date('2026-08-02T00:00:00.000Z'); const service = new TikTokAccountFreshnessService({ now: () => now }); const p = analyticsPolicy.freshness;
  assert.equal(service.profile('2026-08-01T00:00:00.000Z', p), 'fresh');
  assert.equal(service.videoList('2026-08-01T18:00:00.000Z', p), 'fresh');
  assert.equal(service.videoMetric('2026-08-01T00:00:00.000Z', '2026-08-01T18:00:00.000Z', p), 'fresh');
  assert.equal(service.videoMetric('2020-01-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', p), 'fresh');
  assert.equal(service.analyticsSummary('2026-08-01T00:00:00.000Z', p), 'fresh');
  assert.equal(service.profile('2026-08-03T00:00:00.000Z', p), 'unknown'); assert.equal(service.profile('invalid', p), 'unknown');
});

test('all closed failure codes create sanitized plain values', () => {
  const codes = ['configuration','authorization_required','authentication','authorization_expired','permission_denied','rate_limit','invalid_request','resource_not_found','provider_unavailable','timeout','network','response_invalid','pagination_invalid','snapshot_validation_failed','repository_conflict','repository_unavailable','unknown'];
  for (const code of codes) { const failure = createTikTokAccountDataFailure({ code, operation: 'fixture_operation', connectionId }); assert.equal(failure.code, code); assert.equal('stack' in failure, false); assert.equal('cause' in failure, false); }
  assert.throws(() => createTikTokAccountDataFailure({ code: 'unknown', operation: 'x', safeRequestId: 'unsafe value' }));
});

test('failure factory rejects every property-smuggling and descriptor attack', () => {
  const bases = [
    { code: 'invalid-code', operation: 'x' },
    { code: 'unknown', operation: 'x', rawProviderMessage: 'private' },
    { code: 'unknown', operation: 'x', headers: {} }, { code: 'unknown', operation: 'x', payload: {} }, { code: 'unknown', operation: 'x', token: 'private' },
    { code: 'unknown', operation: 'x', connectionId: ' bypass ' }
  ];
  for (const value of bases) assert.throws(() => createTikTokAccountDataFailure(value));
  const hidden = { code: 'unknown', operation: 'x' }; Object.defineProperty(hidden, 'hidden', { value: 'private' }); assert.throws(() => createTikTokAccountDataFailure(hidden));
  const accessor = { code: 'unknown', operation: 'x' }; Object.defineProperty(accessor, 'operation', { enumerable: true, get: () => 'x' }); assert.throws(() => createTikTokAccountDataFailure(accessor));
  const symbol = { code: 'unknown', operation: 'x', [Symbol('secret')]: 'private' }; assert.throws(() => createTikTokAccountDataFailure(symbol));
  const mutable = { code: 'unknown', operation: 'x' }; const result = createTikTokAccountDataFailure(mutable); mutable.operation = 'changed'; assert.equal(result.operation, 'x'); assert.equal(Object.isFrozen(result), true);
});
