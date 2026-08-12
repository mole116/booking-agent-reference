# Daisy Booking Agent

An AI-powered amenity reservation system for a residential building. Residents chat with an AI agent (powered by Claude) to browse amenities, check availability, and manage bookings — all through a conversational interface.

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

## Eval suite

To run the agent eval suite:

```bash
npm run eval
```

Results are written to `evals/results.json`.
