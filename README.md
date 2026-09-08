# Daisy Booking Agent

An AI-powered amenity reservation system for a residential building. Residents chat with an AI agent (powered by Claude) to browse amenities, check availability, and manage bookings — all through a conversational interface.

## Key decisions

- **Deterministic capacity math, server-side.** All overlap and capacity arithmetic lives in the Express API, not in the model. The agent asks the server; the server decides.
- **Confirmation before mutation, via generative UI.** The agent never creates, updates, or cancels a booking in the same turn it is asked. It renders confirmation buttons and waits for an explicit yes.
- **The agent is a separate service, with offline degradation.** The agent runs as its own microservice. When it is unreachable, the UI knows (via an SSE health channel) and read-only/cancellation flows still work.
- **A mutex over shared state.** All read-validate-write sections against the JSON store are serialized through a promise-queue lock, so concurrent requests cannot double-book.
- **An eval suite that asserts tool-call order.** The evals check not only final DB state but also *when* tools were called — e.g. no `commitBooking` before the user confirms.

## Architecture

```
┌────────────────────┐          ┌────────────────────┐          ┌────────────────────┐
│   Angular client   │          │    Express API     │          │   Agent service    │
│   (port 4200)      │───HTTP──►│    (port 3000)     │───HTTP──►│   (port 3001)      │
│                    │          │                    │          │  Claude via the    │
│  chat + bookings + │◄──SSE────│  agent-health      │          │  Vercel AI SDK,    │
│  availability UI   │  agent   │  polling (5s)      │          │  Zod tool schemas  │
└────────────────────┘  status  └─────────┬──────────┘          └─────────┬──────────┘
                                          │                               │
                                          │ read/validate/write           │ tools call back
                                          ▼ (mutex-serialized)            ▼ into the Express API
                                   database.json                    bookings, availability,
                                                                    confirmations
```

Three processes: the Angular client, the Express API (source of truth for all booking rules), and the agent microservice (Claude + tools). The agent never touches the store directly — its tools are thin HTTP clients over the API.

## Features

- Conversational booking with generative UI: the agent renders time-slot choices and confirmation buttons inline in the chat.
- **Age gating:** the Wine Room is 21+. The agent must verify age before checking availability or booking it.
- **Capacity overlap math:** availability is computed per slot from all overlapping bookings, summed by guest count — an amenity is never overbooked.
- **Double-booking prevention:** the server rejects a second overlapping booking for the same user and amenity, and steers to the update flow instead.
- **Smart defaults:** amenities with capacity 1 (like the BBQ Grill) skip the guest-count question.
- Update and cancellation workflows, each with the same confirm-before-mutate rule.
- Availability range queries for multi-day checks in one call.
- Live agent-health indicator: the chat input disables when the agent service is down.
- CLI mode for talking to the agent without the UI.
- Agent eval suite with DB-state and tool-call-order assertions.

## Stack

- **Backend** — Node.js 22, TypeScript, Express 5
- **Agent** — Vercel AI SDK, Claude (`claude-sonnet-4-6`), runs as a separate microservice
- **Frontend** — Angular 22 (standalone components, signals)
- **Persistence** — JSON file (`database.json`)

## Prerequisites

- Node.js 22+
- An [Anthropic API key](https://console.anthropic.com/)

## Setup

1. Install dependencies:
   ```bash
   npm run install:all
   ```

2. Create a `.env` file in the project root:
   ```
   ANTHROPIC_AI_API_KEY=your_key_here
   AGENT_PORT=3001        # optional, defaults to 3001
   CORS_ORIGIN=http://localhost:4200  # optional, defaults to http://localhost:4200
   ```

## Running

Start all three processes (server + agent + Angular client) with one command:

```bash
npm start
```

Or run each separately:

```bash
npm run start:server   # Express API on port 3000
npm run start:agent    # Agent microservice on port 3001
npm run start:client   # Angular dev server on port 4200
```

Then open [http://localhost:4200](http://localhost:4200).

## CLI mode

To interact with the agent directly from the terminal (no UI):

```bash
npm run start:cli
```

## Tests

Unit tests for the booking logic plus a supertest pass over the API:

```bash
npm test
```

## Eval suite

To run the agent eval suite (requires the Express server running on port 3000 and an Anthropic API key):

```bash
npm run eval
```

Results are written to `evals/results.json`.

## Known limitations

- **JSON file store.** `database.json` keeps the assignment simple, but it is a single-writer file with no transactions. The mutex makes it safe for one server process, not for horizontal scaling. A real deployment needs a transactional database.
- **No authentication.** Every booking is made as the hard-coded `"user-1"`. Ownership checks (e.g. cancel-your-own) work against that ID only; there are no sessions, roles, or per-user identity.
- **Age gating is prompt-enforced.** The 21+ Wine Room rule lives in the agent's system prompt, not in server-side validation. A direct API call can book the Wine Room without any age check.
- **In-memory chat sessions.** Conversation history lives in a server-side `Map` and is lost on restart.
- See `DECISIONS.md` for the full list of trade-offs and what would come next with more time.

## License

[MIT](LICENSE)
