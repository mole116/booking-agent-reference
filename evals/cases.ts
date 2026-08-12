import type { EvalCase } from './run.js';

// Helper: flatten all turns into one list
const allCalls = (turns: string[][]) => turns.flat();

export const cases: EvalCase[] = [
  {
    id: 'book-pool-simple',
    description: 'Books the pool with all details upfront',
    turns: [
      'Book the pool for 2026-09-01 from 10:00 to 12:00 for 1 guest.',
      'Yes, confirm.',
    ],
    expect: (db: any) => db.bookings.some((b: any) =>
      b.amenityId === 'pool' && b.date === '2026-09-01' &&
      b.startTime === '10:00' && b.endTime === '12:00' && b.guests === 1,
    ),
    expectTools: (turns) => {
      // commitBooking must NOT appear in turn 1 (before user confirmed)
      if (turns[0]?.includes('commitBooking')) return false;
      // commitBooking must appear in turn 2 (after confirmation)
      if (!turns[1]?.includes('commitBooking')) return false;
      // checkAvailability must be called exactly once across the whole run
      if (allCalls(turns).filter(t => t === 'checkAvailability').length !== 1) return false;
      return true;
    },
  },

  {
    id: 'book-grill-no-guest-question',
    description: 'BBQ Grill capacity is 1 — books without asking for guest count',
    turns: [
      'Book the BBQ grill for 2026-09-02 from 14:00 to 16:00.',
      'Yes, confirm.',
    ],
    expect: (db: any) => db.bookings.some((b: any) =>
      b.amenityId === 'grill' && b.date === '2026-09-02' && b.guests === 1,
    ),
    expectTools: (turns) => {
      if (turns[0]?.includes('commitBooking')) return false;
      if (!turns[1]?.includes('commitBooking')) return false;
      return true;
    },
  },

  {
    id: 'book-conference-room-multi-guest',
    description: 'Books conference room for multiple guests',
    turns: [
      'Book the conference room on 2026-09-03 from 09:00 to 11:00 for 5 people.',
      'Yes, book it.',
    ],
    expect: (db: any) => db.bookings.some((b: any) =>
      b.amenityId === 'conference-room' && b.guests === 5,
    ),
    expectTools: (turns) => {
      if (turns[0]?.includes('commitBooking')) return false;
      if (!turns[1]?.includes('commitBooking')) return false;
      return true;
    },
  },

  {
    id: 'reject-over-capacity',
    description: 'Refuses booking that exceeds amenity capacity',
    turns: [
      'Book the sauna on 2026-09-04 from 10:00 to 11:00 for 5 guests.',
    ],
    expect: (db: any) => db.bookings.length === 0,
    expectTools: (turns) => !allCalls(turns).includes('commitBooking'),
  },

  {
    id: 'reject-outside-hours',
    description: 'Refuses booking outside operating windows',
    turns: [
      'Book the pool on 2026-09-05 from 20:00 to 21:00 for 1 guest.',
    ],
    expect: (db: any) => db.bookings.length === 0,
    expectTools: (turns) => !allCalls(turns).includes('commitBooking'),
  },

  {
    id: 'cancel-booking',
    description: 'Books then cancels — DB should be empty after',
    turns: [
      'Book the tennis court on 2026-09-06 from 08:00 to 09:00 for 2 guests.',
      'Yes, confirm.',
      'Cancel my tennis court booking on 2026-09-06.',
      'Yes, cancel it.',
    ],
    expect: (db: any) => db.bookings.length === 0,
    expectTools: (turns) => {
      // cancelBooking only on turn 4 (after user said yes)
      if (turns[2]?.includes('cancelBooking')) return false;
      if (!turns[3]?.includes('cancelBooking')) return false;
      // cancelBooking called exactly once
      if (allCalls(turns).filter(t => t === 'cancelBooking').length !== 1) return false;
      return true;
    },
  },

  {
    id: 'update-booking-time',
    description: 'Books the gym then moves it to a different time slot',
    turns: [
      'Book the gym on 2026-09-07 from 07:00 to 08:00 for 1 guest.',
      'Yes, confirm.',
      'Change my gym booking on 2026-09-07 to 09:00–10:00.',
      'Yes, update it.',
    ],
    expect: (db: any) => db.bookings.some((b: any) =>
      b.amenityId === 'gym' && b.startTime === '09:00' && b.endTime === '10:00',
    ),
    expectTools: (turns) => {
      // updateBooking only on turn 4, not before
      if (turns[2]?.includes('updateBooking')) return false;
      if (!turns[3]?.includes('updateBooking')) return false;
      // updateBooking called exactly once
      if (allCalls(turns).filter(t => t === 'updateBooking').length !== 1) return false;
      return true;
    },
  },
];
