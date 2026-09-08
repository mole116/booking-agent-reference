import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const { expandSlots, validateReservation, getAvailabilityForDate } = await import('../server.js');

const pool = {
  id: 'pool',
  name: 'Swimming Pool',
  capacity: 2,
  operatingWindows: [{ from: '10:00', to: '13:00' }],
};

const emptyDb = () => ({ amenities: [pool], bookings: [] as any[] });

const fmt = (d: Date) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
const today = fmt(new Date());
const tomorrow = fmt(new Date(Date.now() + 86_400_000));
const yesterday = fmt(new Date(Date.now() - 86_400_000));

test('expandSlots expands one-hour slots across windows', () => {
  assert.deepEqual(expandSlots(pool), ['10:00', '11:00', '12:00']);
});

test('expandSlots handles multiple operating windows', () => {
  const court = { id: 'tennis', operatingWindows: [{ from: '07:00', to: '09:00' }, { from: '16:00', to: '18:00' }] };
  assert.deepEqual(expandSlots(court), ['07:00', '08:00', '16:00', '17:00']);
});

test('expandSlots rejects malformed times and inverted windows', () => {
  assert.throws(() => expandSlots({ id: 'x', operatingWindows: [{ from: '10:00', to: '09:00' }] }));
  assert.throws(() => expandSlots({ id: 'x', operatingWindows: [{ from: 'ten', to: '12:00' }] }));
  assert.throws(() => expandSlots({ id: 'x', operatingWindows: [{ from: '25:00', to: '26:00' }] }));
});

test('validateReservation rejects end time before start time', () => {
  const err = validateReservation({ db: emptyDb(), amenity: pool, date: tomorrow, startTime: '11:00', endTime: '10:00', guests: 1 });
  assert.equal(err, 'End time must be after start time.');
});

test('validateReservation rejects past dates', () => {
  const err = validateReservation({ db: emptyDb(), amenity: pool, date: yesterday, startTime: '10:00', endTime: '11:00', guests: 1 });
  assert.equal(err, 'Cannot book a date in the past.');
});

test('validateReservation allows a booking for today and tomorrow', () => {
  for (const date of [today, tomorrow]) {
    const err = validateReservation({ db: emptyDb(), amenity: pool, date, startTime: '10:00', endTime: '11:00', guests: 1 });
    assert.equal(err, null);
  }
});

test('validateReservation rejects times outside operating windows', () => {
  const err = validateReservation({ db: emptyDb(), amenity: pool, date: tomorrow, startTime: '20:00', endTime: '21:00', guests: 1 });
  assert.equal(err, 'Invalid time range for this amenity.');
});

test('validateReservation enforces capacity summed across overlapping bookings', () => {
  const db = emptyDb();
  db.bookings.push({ id: 'b1', amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1' });
  // capacity is 2 and the slot is full: one more guest overflows
  const err = validateReservation({ db, amenity: pool, date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1 });
  assert.equal(err, 'Capacity exceeded at 10:00.');
});

test('validateReservation allows booking exactly up to capacity', () => {
  const db = emptyDb();
  db.bookings.push({ id: 'b1', amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1, userId: 'user-1' });
  const err = validateReservation({ db, amenity: pool, date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 1 });
  assert.equal(err, null);
});

test('validateReservation treats adjacent non-overlapping bookings as free', () => {
  const db = emptyDb();
  db.bookings.push({ id: 'b1', amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1' });
  const err = validateReservation({ db, amenity: pool, date: tomorrow, startTime: '11:00', endTime: '12:00', guests: 2 });
  assert.equal(err, null);
});

test('validateReservation excludeBookingId lets a booking update itself', () => {
  const db = emptyDb();
  db.bookings.push({ id: 'b1', amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1' });
  const err = validateReservation({ db, amenity: pool, date: tomorrow, startTime: '10:00', endTime: '12:00', guests: 2, excludeBookingId: 'b1' });
  assert.equal(err, null);
});

test('getAvailabilityForDate reports per-slot guest counts and availability', () => {
  const db = emptyDb();
  db.bookings.push(
    { id: 'b1', amenityId: 'pool', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 2, userId: 'user-1' },
    { id: 'b2', amenityId: 'pool', date: tomorrow, startTime: '11:00', endTime: '12:00', guests: 1, userId: 'user-2' },
  );
  const availability = getAvailabilityForDate(db, pool, tomorrow);
  assert.equal(availability.length, 3);
  assert.deepEqual(availability[0], { timeSlot: '10:00', currentGuests: 2, capacity: 2, isAvailable: false });
  assert.deepEqual(availability[1], { timeSlot: '11:00', currentGuests: 1, capacity: 2, isAvailable: true });
  assert.deepEqual(availability[2], { timeSlot: '12:00', currentGuests: 0, capacity: 2, isAvailable: true });
});

test('getAvailabilityForDate ignores other amenities and other dates', () => {
  const db = emptyDb();
  db.bookings.push(
    { id: 'b1', amenityId: 'gym', date: tomorrow, startTime: '10:00', endTime: '11:00', guests: 9, userId: 'user-1' },
    { id: 'b2', amenityId: 'pool', date: yesterday, startTime: '10:00', endTime: '11:00', guests: 9, userId: 'user-1' },
  );
  const availability = getAvailabilityForDate(db, pool, tomorrow);
  assert.ok(availability.every((s: any) => s.currentGuests === 0 && s.isAvailable));
});
