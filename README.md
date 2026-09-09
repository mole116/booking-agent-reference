# AI Amenity Booking Agent

An AI-powered amenity reservation system for a residential building. Residents chat with an AI agent to browse amenities, check availability, and manage bookings — all through a conversational interface.

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
│                    │          │                    │          │  Any LLM via the   │
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
- **Agent** — Vercel AI SDK, model-agnostic (Anthropic Claude by default), runs as a separate microservice
- **Frontend** — Angular 22 (standalone components, signals)
- **Persistence** — JSON file (`database.json`)

## Prerequisites

- Node.js 22+
- An API key for your model provider — [Anthropic](https://console.anthropic.com/) by default, or OpenAI / Google / Groq / Amazon Bedrock / a local model (see [Switching models](#switching-models))

## Setup

1. Install dependencies:
   ```bash
   npm run install:all
   ```

2. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
   Then fill in your API key. `.env.example` documents every variable.

## Switching models

The agent is model-agnostic. Swapping the LLM is one env change — no code edits:

```
MODEL_PROVIDER=openai
MODEL_ID=gpt-4o-mini   # optional; every hosted provider has a default
```

`MAX_OUTPUT_TOKENS` optionally caps the output tokens per model call (unset = provider default). Set it when your provider rejects requests over a tier limit — for Groq's free tier, use `MAX_OUTPUT_TOKENS=800`.

| `MODEL_PROVIDER` | API-key env var | `MODEL_ID` default | Notes |
|---|---|---|---|
| `anthropic` (default) | `ANTHROPIC_AI_API_KEY` | `claude-sonnet-4-6` | First run works with just this key. |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.0-flash` | |
| `groq` | `GROQ_API_KEY` | `qwen/qwen3.8-27b` | Hosted, free tier ≈30 requests/min and ≈1K requests/day. Prefer the larger Llama/Qwen variants — their tool calling is the strongest on Groq. Free-tier output is capped at 1000 tokens/min (OTPM) and requests that exceed it are rejected — set `MAX_OUTPUT_TOKENS=800` to stay under the cap. |
| `bedrock` | see notes | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Amazon Bedrock. Auth resolves automatically: `AWS_BEARER_TOKEN_BEDROCK` (Bedrock API key) first, then SigV4 via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`; region from `AWS_REGION` (default `us-east-1`). Model access must be enabled in the Bedrock console, and the default model ID is a US cross-region inference profile — check availability in your region. Model IDs: [models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html). |
| `ollama` | — | `llama3.1` | Local. Override `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`). |
| `lmstudio` | — | none — `MODEL_ID` required | Local. Override `LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`). Set `MODEL_ID` to the model you loaded. |

Tool-calling quality varies by model. The agent relies on structured tool calls for every action, and smaller local models may struggle with them — expect degraded behavior (missed tool calls, malformed arguments) on weaker models.

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

To run the agent eval suite (requires the Express server running on port 3000 and a configured model — any provider works):

```bash
npm run eval
```

Results are written to `evals/results.json`.

### Comparing models and prompts

`npm run eval:matrix` runs the same scenario suite across several configurations — different models and/or system-prompt variants — and prints a case × configuration matrix. Configurations live in `evals/compare.config.ts`:

```ts
export const matrix: MatrixEntry[] = [
  { name: 'default' },        // the env-driven model + production prompt
  { name: 'gpt-4o-mini', provider: 'openai', modelId: 'gpt-4o-mini' },
  { name: 'llama-local', provider: 'ollama', modelId: 'llama3.1' },
  { name: 'strict-dates', prompt: (p) => p + '\nNever guess a date the user did not state.' },
];
```

Add one entry per configuration:

- **Model variant** — set `provider` (and optionally `modelId`; omitting it uses the provider's default).
- **Prompt variant** — set `prompt` to a function that receives the production prompt and returns a modified one.

Every entry runs the full suite from `evals/cases.ts`. Each run records pass/fail per case, the DB-state and tool-call assertion outcomes, and the model + prompt variant used. The JSON report is written to `evals/compare-results.json`.

### Smoke runs, timeouts, and metrics

Run a subset for a cheap smoke pass instead of the full matrix:

```bash
npm run eval:matrix -- --config llama-local --case book-pool-simple
```

- `--config <name>` — run only these matrix entries (repeatable, or comma-separated).
- `--case <id>` — run only these cases (repeatable, or comma-separated).
- `--timeout <seconds>` — per-case timeout (default 300). A case that exceeds it is marked failed with a timeout reason and the run **continues** with the next case. A configuration that fails outright (missing API key, model server down) is recorded as an error and the matrix continues with the next configuration.
- `--out <path>` — where to write the JSON report (default `evals/compare-results.json`).

Every case records wall-clock time and token usage (prompt / completion / total), and every configuration gets a summary row — pass count, total time, total tokens — in both the console matrix and `compare-results.json`. Note: a timed-out case's agent may still finish in the background; its late result is discarded.

## Known limitations

- **JSON file store.** `database.json` keeps the assignment simple, but it is a single-writer file with no transactions. The mutex makes it safe for one server process, not for horizontal scaling. A real deployment needs a transactional database.
- **No authentication.** Every booking is made as the hard-coded `"user-1"`. Ownership checks (e.g. cancel-your-own) work against that ID only; there are no sessions, roles, or per-user identity.
- **Age gating is prompt-enforced.** The 21+ Wine Room rule lives in the agent's system prompt, not in server-side validation. A direct API call can book the Wine Room without any age check.
- **In-memory chat sessions.** Conversation history lives in a server-side `Map` and is lost on restart.
- See `DECISIONS.md` for the full list of trade-offs and what would come next with more time.

## License

[MIT](LICENSE)
