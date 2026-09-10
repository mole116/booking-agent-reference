import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.NODE_ENV = 'test';
const TEST_DB = path.join(os.tmpdir(), `daisy-api-test-${process.pid}.json`);
process.env.DB_PATH = TEST_DB;

const { app } = await import('../server.js');
const { default: request } = await import('supertest');

const SEED = path.resolve(import.meta.dirname, '..', 'evals', 'seed.json');

const fmt = (d: Date) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const inDays = (n: number) => fmt(new Date(Date.now() + n * 86_400_000));
const tomorrow = inDays(1);
const yesterday = inDays(-1);

beforeEach(() => {
  fs.copyFileSync(SEED, TEST_DB);
});

test('GET /api/amenities returns all amenities with the age-restriction policy applied', async () => {
  const res = await request(app).get('/api/amenities');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 8);
  const gym = res.body.find((a: any) => a.id === 'gym');
  const wineRoom = res.body.find((a: any) => a.id === 'wine-room');
  assert.equal(gym.ageRestricted, undefined);
  assert.equal(wineRoom.ageRestricted, true);
});

test('GET availability for one date returns slot-by-slot capacity', async () => {
  const res = await request(app).get(`/api/amenities/pool/availability?date=${tomorrow}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.availability.length, 7); // 10:00-17:00
  assert.ok(res.body.availability.every((s: any) => s.isAvailable && s.currentGuests === 0));
});

test('GET availability validates its inputs', async () => {
  assert.equal((await request(app).get('/api/amenities/pool/availability')).status, 400);
  assert.equal((await request(app).get(`/api/amenities/nope/availability?date=${tomorrow}`)).status, 404);
});

test('GET availability range returns one entry per day', async () => {
  const res = await request(app).get(
    `/api/amenities/pool/availability/range?startDate=${tomorrow}&endDate=${inDays(3)}`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.range.length, 3);
});

test('GET availability range rejects ranges over 31 days and reversed ranges', async () => {
  const tooLong = await request(app).get(
    `/api/amenities/pool/availability/range?startDate=${tomorrow}&endDate=${inDays(40)}`,
  );
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.error, /31 days/);

  const reversed = await request(app).get(
    `/api/amenities/pool/availability/range?startDate=${inDays(5)}&endDate=${tomorrow}`,
  );
  assert.equal(reversed.status, 400);

  const missing = await request(app).get('/api/amenities/pool/availability/range');
  assert.equal(missing.status, 400);
});

test('POST /api/bookings creates a booking and rejects bad input', async () => {
  const bad = await request(app).post('/api/bookings').send({ amenityId: 'pool' });
  assert.equal(bad.status, 400);

  const res = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.amenityId, 'pool');

  const mine = await request(app).get('/api/bookings?userId=user-1');
  assert.equal(mine.body.length, 1);
});

test('POST /api/bookings rejects a date in the past', async () => {
  const res = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: yesterday, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1',
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /past/);
});

test('POST /api/bookings rejects an overlapping booking for the same user', async () => {
  const first = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1',
  });
  assert.equal(first.status, 201);

  const overlap = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:30', endTime: '11:30', guests: 1, userId: 'user-1',
  });
  assert.equal(overlap.status, 409);
  assert.match(overlap.body.error, /overlapping/);
});

test('POST /api/bookings enforces shared capacity across users', async () => {
  // sauna capacity is 2 in the seed data
  const first = await request(app).post('/api/bookings').send({
    amenityId: 'sauna', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1',
  });
  assert.equal(first.status, 201);

  const overCapacity = await request(app).post('/api/bookings').send({
    amenityId: 'sauna', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-2',
  });
  assert.equal(overCapacity.status, 409);
  assert.match(overCapacity.body.error, /Capacity exceeded/);
});

test('PATCH /api/bookings/:id updates a booking and rejects past dates', async () => {
  const created = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1',
  });
  const id = created.body.id;

  const moved = await request(app).patch(`/api/bookings/${id}`).send({
    date: inDays(2), startTime: '11:00', endTime: '12:00', guests: 2,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.startTime, '11:00');
  assert.equal(moved.body.guests, 2);

  const toPast = await request(app).patch(`/api/bookings/${id}`).send({
    date: yesterday, startTime: '11:00', endTime: '12:00', guests: 2,
  });
  assert.equal(toPast.status, 409);

  const missing = await request(app).patch('/api/bookings/nope').send({
    startTime: '11:00', endTime: '12:00', guests: 1,
  });
  assert.equal(missing.status, 404);
});

test('GET check-update mirrors the PATCH validation without mutating', async () => {
  const created = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1',
  });
  const id = created.body.id;

  const ok = await request(app).get(`/api/bookings/${id}/check-update?startTime=11:00&endTime=12:00&guests=3`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isPossible, true);

  const bad = await request(app).get(`/api/bookings/${id}/check-update?date=${yesterday}&startTime=11:00&endTime=12:00&guests=3`);
  assert.equal(bad.body.isPossible, false);

  const after = await request(app).get('/api/bookings?userId=user-1');
  assert.equal(after.body[0].startTime, '10:00'); // unchanged
});

test('DELETE /api/bookings/:id only lets the owner cancel', async () => {
  const created = await request(app).post('/api/bookings').send({
    amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1',
  });
  const id = created.body.id;

  assert.equal((await request(app).delete(`/api/bookings/${id}`)).status, 400);
  assert.equal((await request(app).delete(`/api/bookings/${id}?userId=user-2`)).status, 403);
  assert.equal((await request(app).delete(`/api/bookings/${id}?userId=user-1`)).status, 200);
  assert.equal((await request(app).get('/api/bookings')).body.length, 0);
});

test('POST /api/chat validates its input and reports an unavailable agent', async () => {
  assert.equal((await request(app).post('/api/chat').send({})).status, 400);
  const res = await request(app).post('/api/chat').send({ message: 'hi' });
  assert.equal(res.status, 503);
});

test('POST /api/agent-activity broadcasts the tool activity over the SSE channel', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const ctrl = new AbortController();
    const sse = await fetch(`http://127.0.0.1:${port}/api/agent-status`, { signal: ctrl.signal });
    const reader = sse.body!.getReader();
    await reader.read(); // first chunk is the current { alive } state

    const post = await fetch(`http://127.0.0.1:${port}/api/agent-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', tool: 'commitBooking' }),
    });
    assert.equal(post.status, 204);

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    const payload = JSON.parse(text.trim().replace(/^data: /, ''));
    assert.deepEqual(payload, { activity: { sessionId: 'session-1', tool: 'commitBooking' } });
    ctrl.abort();
  } finally {
    server.close();
  }
});

test('POST /api/agent-activity validates its inputs', async () => {
  assert.equal((await request(app).post('/api/agent-activity').send({})).status, 400);
  assert.equal((await request(app).post('/api/agent-activity').send({ sessionId: 's' })).status, 400);
  assert.equal((await request(app).post('/api/agent-activity').send({ tool: 'commitBooking' })).status, 400);
  assert.equal(
    (await request(app).post('/api/agent-activity').send({ sessionId: ' ', tool: 'commitBooking' })).status,
    400,
  );
});
