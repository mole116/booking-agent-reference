import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { serverLog } from './logger.js';

const AGENT_URL = `http://localhost:${process.env.AGENT_PORT ?? 3001}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? 'http://localhost:4200');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Log every API request
app.use((req, _res, next) => {
  const body = Object.keys(req.body ?? {}).length ? req.body : undefined;
  serverLog.request(req.method, req.path, body);
  next();
});

// In-memory session store: sessionId → conversation history
const sessions = new Map<string, any[]>();

// ─── Agent health tracking ────────────────────────────────────────────────────

type SseClient = Response;

let agentAlive = false;
const sseClients = new Set<SseClient>();

function broadcastAgentStatus(alive: boolean): void {
  const data = `data: ${JSON.stringify({ alive })}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

async function checkAgentHealth(): Promise<void> {
  let alive: boolean;
  try {
    const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) });
    alive = res.ok;
  } catch {
    alive = false;
  }

  if (alive !== agentAlive) {
    agentAlive = alive;
    serverLog.request('HEALTH', '/agent', { alive });
    broadcastAgentStatus(alive);
  }
}

// Poll every 5 seconds
setInterval(checkAgentHealth, 5000);
// Also check immediately on startup
checkAgentHealth();

// GET /api/agent-status — SSE stream, pushes {alive} on every status change
app.get('/api/agent-status', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately so the client doesn't have to wait up to 5s
  res.write(`data: ${JSON.stringify({ alive: agentAlive })}\n\n`);

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

const DB_PATH = path.join(__dirname, 'database.json');

let dbCache: any = null;

const readDB = () => {
  if (!dbCache) dbCache = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  return dbCache;
};

// Promise-queue mutex — serialises all read-validate-write sections so
// concurrent requests cannot both pass validation against the same snapshot.
let dbLock = Promise.resolve<void>(undefined);
const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
  const result = dbLock.then(fn);
  dbLock = result.then(() => undefined, () => undefined);
  return result;
};

const writeDB = async (data: any): Promise<void> => {
  dbCache = data; // update cache synchronously before yielding
  await fs.promises.writeFile(DB_PATH, JSON.stringify(data, null, 2));
};

const parseMinutes = (time: string, context: string): number => {
  const parts = time.split(':');
  if (parts.length !== 2) throw new Error(`Invalid time "${time}" in ${context}`);
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59) {
    throw new Error(`Invalid time "${time}" in ${context}`);
  }
  return h * 60 + m;
};

const expandSlots = (amenity: any): string[] => {
  const slots: string[] = [];
  for (const window of amenity.operatingWindows as { from: string; to: string }[]) {
    const context = `amenity "${amenity.id}" operatingWindows`;
    const start = parseMinutes(window.from, context);
    const end = parseMinutes(window.to, context);
    if (start >= end) throw new Error(`"from" must be before "to" in ${context}`);
    for (let minutes = start; minutes < end; minutes += 60) {
      slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    }
  }
  return slots;
};

const getRequestedSlots = (
  amenity: any,
  startTime: string,
  endTime: string,
) => {
  return expandSlots(amenity).filter(
    (timeSlot: string) => timeSlot >= startTime && timeSlot < endTime,
  );
};

const getAvailabilityForDate = (db: any, amenity: any, date: string) => {
  const bookingsOnDate = db.bookings.filter(
    (booking: any) =>
      booking.amenityId === amenity.id && booking.date === date,
  );

  return expandSlots(amenity).map((timeSlot: string) => {
    const overlappingBookings = bookingsOnDate.filter(
      (booking: any) =>
        timeSlot >= booking.startTime && timeSlot < booking.endTime,
    );

    const currentGuests = overlappingBookings.reduce(
      (total: number, booking: any) => total + booking.guests,
      0,
    );

    return {
      timeSlot,
      currentGuests,
      capacity: amenity.capacity,
      isAvailable: currentGuests < amenity.capacity,
    };
  });
};

/*
 * Validates a proposed booking or update.
 * excludeBookingId is used when updating so the old version of the booking
 * does not count against its own new capacity calculation.
 */
const validateReservation = ({
  db,
  amenity,
  date,
  startTime,
  endTime,
  guests,
  excludeBookingId,
}: {
  db: any;
  amenity: any;
  date: string;
  startTime: string;
  endTime: string;
  guests: number;
  excludeBookingId?: string;
}): string | null => {
  if (startTime >= endTime) {
    return 'End time must be after start time.';
  }

  // Reject bookings in the past server-side; do not rely on the agent prompt
  // alone. date is YYYY-MM-DD, so a string compare against today's local date
  // is sufficient.
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (date < today) {
    return 'Cannot book a date in the past.';
  }

  const requestedSlots = getRequestedSlots(amenity, startTime, endTime);

  if (requestedSlots.length === 0) {
    return 'Invalid time range for this amenity.';
  }

  const otherBookings = db.bookings.filter(
    (booking: any) =>
      booking.id !== excludeBookingId &&
      booking.amenityId === amenity.id &&
      booking.date === date,
  );

  for (const timeSlot of requestedSlots) {
    const guestsInOtherBookings = otherBookings
      .filter(
        (booking: any) =>
          timeSlot >= booking.startTime && timeSlot < booking.endTime,
      )
      .reduce((total: number, booking: any) => total + booking.guests, 0);

    if (guestsInOtherBookings + guests > amenity.capacity) {
      return `Capacity exceeded at ${timeSlot}.`;
    }
  }

  return null;
};

// GET all amenities
app.get('/api/amenities', (_req: Request, res: Response) => {
  res.json(readDB().amenities);
});

// GET availability for one date
app.get(
  '/api/amenities/:id/availability',
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'date is required.' });
    }

    const db = readDB();
    const amenity = db.amenities.find((item: any) => item.id === id);

    if (!amenity) {
      return res.status(404).json({ error: 'Amenity not found.' });
    }

    res.json({
      amenityId: id,
      date,
      availability: getAvailabilityForDate(db, amenity, date),
    });
  },
);

// GET availability for a range of dates
app.get(
  '/api/amenities/:id/availability/range',
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    if (
      !startDate ||
      !endDate ||
      typeof startDate !== 'string' ||
      typeof endDate !== 'string'
    ) {
      return res
        .status(400)
        .json({ error: 'startDate and endDate are required.' });
    }

    const db = readDB();
    const amenity = db.amenities.find((item: any) => item.id === id);

    if (!amenity) {
      return res.status(404).json({ error: 'Amenity not found.' });
    }

    const range: any[] = [];
    const currentDate = new Date(`${startDate}T00:00:00`);
    const finalDate = new Date(`${endDate}T00:00:00`);

    if (Number.isNaN(currentDate.getTime()) || Number.isNaN(finalDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format.' });
    }

    if (currentDate > finalDate) {
      return res
        .status(400)
        .json({ error: 'startDate must be on or before endDate.' });
    }

    // Cap the range so one request cannot expand into an unbounded loop.
    const MAX_RANGE_DAYS = 31;
    const rangeDays = Math.round(
      (finalDate.getTime() - currentDate.getTime()) / 86_400_000,
    );
    if (rangeDays > MAX_RANGE_DAYS) {
      return res
        .status(400)
        .json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days.` });
    }

    while (currentDate <= finalDate) {
      const date = currentDate.toISOString().split('T')[0];

      range.push({
        date,
        availability: getAvailabilityForDate(db, amenity, date),
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({ amenityId: id, range });
  },
);

// GET bookings, optionally limited to one user
app.get('/api/bookings', (req: Request, res: Response) => {
  const { userId } = req.query;
  const db = readDB();

  const bookings =
    typeof userId === 'string'
      ? db.bookings.filter((booking: any) => booking.userId === userId)
      : db.bookings;

  res.json(bookings);
});

// Check whether an existing booking can be changed
app.get(
  '/api/bookings/:id/check-update',
  (req: Request, res: Response) => {
    const { id } = req.params;
    const { startTime, endTime, guests, date } = req.query;
    const totalGuests = Number(guests);

    if (
      typeof startTime !== 'string' ||
      typeof endTime !== 'string' ||
      !Number.isInteger(totalGuests) ||
      totalGuests <= 0
    ) {
      return res.status(400).json({
        error: 'startTime, endTime, and a positive integer guests value are required.',
      });
    }

    const db = readDB();
    const booking = db.bookings.find((item: any) => item.id === id);

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const amenity = db.amenities.find(
      (item: any) => item.id === booking.amenityId,
    );

    if (!amenity) {
      return res.status(404).json({ error: 'Amenity not found.' });
    }

    const effectiveDate = typeof date === 'string' && date.trim() ? date.trim() : booking.date;

    const error = validateReservation({
      db,
      amenity,
      date: effectiveDate,
      startTime,
      endTime,
      guests: totalGuests,
      excludeBookingId: booking.id,
    });

    if (error) {
      return res.json({
        isPossible: false,
        error,
        existingBooking: booking,
      });
    }

    res.json({
      isPossible: true,
      existingBooking: booking,
      proposedUpdate: {
        startTime,
        endTime,
        guests: totalGuests,
      },
    });
  },
);

// Create a new booking
app.post('/api/bookings', async (req: Request, res: Response) => {
  const { amenityId, date, startTime, endTime, guests, userId } = req.body;

  if (
    typeof amenityId !== 'string' ||
    typeof date !== 'string' ||
    typeof startTime !== 'string' ||
    typeof endTime !== 'string' ||
    typeof userId !== 'string' ||
    !Number.isInteger(guests) ||
    guests <= 0
  ) {
    return res.status(400).json({ error: 'Missing or invalid required fields.' });
  }

  return withLock(async () => {
    const db = readDB();
    const amenity = db.amenities.find((item: any) => item.id === amenityId);

    if (!amenity) {
      return res.status(404).json({ error: 'Amenity not found.' });
    }

    // A user cannot create a second overlapping booking for the same amenity.
    const existingOverlappingBooking = db.bookings.find(
      (booking: any) =>
        booking.userId === userId &&
        booking.amenityId === amenityId &&
        booking.date === date &&
        startTime < booking.endTime &&
        endTime > booking.startTime,
    );

    if (existingOverlappingBooking) {
      return res.status(409).json({
        error:
          'You already have an overlapping booking for this amenity. Update the existing booking instead.',
        existingBooking: existingOverlappingBooking,
      });
    }

    const error = validateReservation({ db, amenity, date, startTime, endTime, guests });

    if (error) {
      return res.status(409).json({ error });
    }

    const newBooking = {
      id: `booking-${Date.now()}`,
      amenityId,
      date,
      startTime,
      endTime,
      guests,
      userId,
    };

    db.bookings.push(newBooking);
    await writeDB(db);

    return res.status(201).json(newBooking);
  });
});

// Update an existing booking's date, time range and/or guest count
app.patch('/api/bookings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { startTime, endTime, guests, date } = req.body;

  if (
    typeof startTime !== 'string' ||
    typeof endTime !== 'string' ||
    !Number.isInteger(guests) ||
    guests <= 0
  ) {
    return res.status(400).json({
      error: 'startTime, endTime, and a positive integer guests value are required.',
    });
  }

  return withLock(async () => {
    const db = readDB();
    const bookingIndex = db.bookings.findIndex((item: any) => item.id === id);

    if (bookingIndex === -1) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = db.bookings[bookingIndex];
    const amenity = db.amenities.find((item: any) => item.id === booking.amenityId);

    if (!amenity) {
      return res.status(404).json({ error: 'Amenity not found.' });
    }

    const effectiveDate = typeof date === 'string' && date.trim() ? date.trim() : booking.date;

    const error = validateReservation({
      db, amenity, date: effectiveDate, startTime, endTime, guests,
      excludeBookingId: booking.id,
    });

    if (error) {
      return res.status(409).json({ error });
    }

    db.bookings[bookingIndex] = { ...booking, date: effectiveDate, startTime, endTime, guests };
    await writeDB(db);

    return res.json(db.bookings[bookingIndex]);
  });
});

// Cancel a booking
app.delete('/api/bookings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = req.query;

  if (typeof userId !== 'string' || !userId) {
    return res.status(400).json({
      error: 'userId query parameter is required.',
    });
  }

  return withLock(async () => {
    const db = readDB();
    const bookingIndex = db.bookings.findIndex((item: any) => item.id === id);

    if (bookingIndex === -1) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = db.bookings[bookingIndex];

    if (booking.userId !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own bookings.' });
    }

    db.bookings.splice(bookingIndex, 1);
    await writeDB(db);

    return res.json({
      message: 'Booking cancelled.',
      cancelledBooking: booking,
    });
  });
});

// POST /api/chat — proxies to the agent service; keeps history server-side
app.post('/api/chat', async (req: Request, res: Response) => {
  const { message, sessionId } = req.body as {
    message?: unknown;
    sessionId?: unknown;
  };

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  const sid: string =
    typeof sessionId === 'string' && sessionId.trim()
      ? sessionId
      : randomUUID();

  const history = sessions.get(sid) ?? [];

  let agentFetchRes: Awaited<ReturnType<typeof fetch>>;
  try {
    agentFetchRes = await fetch(`${AGENT_URL}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim(), history, sessionId: sid }),
    });
  } catch {
    // Agent service is unreachable (not started, crashed, etc.)
    serverLog.error('/api/chat', 'Agent service unavailable');
    return res.status(503).json({
      error: 'The assistant is temporarily unavailable. Please try again in a moment.',
    });
  }

  if (!agentFetchRes.ok) {
    const body = await agentFetchRes.json().catch(() => ({}));
    serverLog.error('/api/chat', `Agent returned ${agentFetchRes.status}: ${JSON.stringify(body)}`);
    return res.status(502).json({
      error: 'The assistant encountered an error. Please try again.',
    });
  }

  const agentResult = await agentFetchRes.json() as {
    text: string;
    history: any[];
    ui: { kind: string; actions: any[] };
    bookingChanged: boolean;
  };

  sessions.set(sid, agentResult.history);

  serverLog.response('POST', '/api/chat', 200, {
    sessionId: sid,
    ui: agentResult.ui,
    bookingChanged: agentResult.bookingChanged,
    replyPreview: agentResult.text.slice(0, 120),
  });

  return res.json({
    text: agentResult.text,
    sessionId: sid,
    ui: agentResult.ui,
    bookingChanged: agentResult.bookingChanged,
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});