# Amenity Booking Agent — Decisions

## Technology choices

- **Backend:** Node.js 22, TypeScript 7, Express 5
- **Frontend:** Angular 22
- **Agent framework:** Vercel AI SDK
- **Model:** `claude-sonnet-4-6` via `@ai-sdk/anthropic` v4
- **Validation:** Zod tool input schemas
- **Persistence:** JSON file (`database.json`) — intentionally simple for this assignment
- **Current interface:** CLI and Angular UI
- **Agent health monitoring:** Server-Sent Events — the Express server polls the agent every 5 seconds and pushes `{ alive: boolean }` to all connected clients; the Angular UI enables/disables the chat input accordingly

I chose the Vercel AI SDK because it provides a straightforward tool-calling loop while letting me define and own the tools, prompts, and backend behavior. Using the Vercel AI SDK does not require deploying the project to Vercel.

A CLI was added before the UI to enable fast iteration on agent behavior and tool calling without running the full stack.

I decided that the agent should be a microservice of its own, not run inside the server, mainly for scaling reasons. It runs as a separate process and the server calls it when needed.

I also decided that a business cannot depend on an external service that may be unavailable, so when the agent is down the system should still provide a way to complete the task without it. (For now, for simplicity, cancellation is the only action allowed while the agent is unavailable. A complete solution would also support creating and editing bookings, but that requires more UI work.)

As can be seen in `agent.ts`, the system prompt is very directive. That is done on purpose: it lets me control the agent's behavior more easily and make sure it calls the tools in the correct order, which makes the whole system much more predictable.

## The business rules I chose to enforce

**Strict user consent.** The system explicitly prohibits the agent from mutating state (creating, updating, or canceling a booking) without presenting a confirmation UI and waiting for the user's explicit consent (*** STOP. Wait for the user. *** in the prompt).

**Dynamic capacity and overlap calculation.** The backend does not just look at raw time slots; it calculates overlapping durations (start time to end time) and sums the total guests across all simultaneous bookings to ensure the amenity's physical capacity is never exceeded.

**Age gating.** I implemented an explicit safety check where the agent must halt the booking flow to verify the user is 21 or older before they can book the restricted Wine Room.

**Double-booking prevention.** The server explicitly rejects requests if a user tries to create a second, overlapping reservation for the same amenity, forcing them to use the update workflow instead.

**Smart defaults (capacity-aware).** If an amenity (like the BBQ Grill) has a maximum capacity of exactly 1, the agent automatically assigns 1 guest and skips asking the user, removing unnecessary friction from the flow (as can be seen in the prompt).

## Tool boundaries

The agent owns the following tools:

**Granular validation tools.** Instead of forcing the LLM to guess whether an update is valid, I provided a dedicated `checkBookingUpdateAvailability` tool. This shifts the complex mathematical burden of checking overlapping capacity from the LLM (which is bad at math) to my Express server (which handles it deterministically).

**Range query tool.** The `checkAvailabilityRange` tool is a performance optimization. Instead of the agent making multiple sequential calls to `checkAvailability` for each day in a week, it makes one call. This reduces latency and token usage. I chose to add this tool because there was no guarantee that the model would batch the `checkAvailability` calls — it could call them sequentially by mistake.

I was very descriptive in the prompt about the fact that the agent cannot make decisions on its own and must always wait for the user's confirmation. I think this is a very important rule that should be enforced in any system that works with agents. The same goes for the tool descriptions: I was very descriptive about what each tool does and when to use it.

## What I would do with more time

- Replace JSON persistence with a transactional database.
- Add authentication and derive `userId` from the authenticated session.
- Add some cool steps, like: if the user wants to book an amenity that requires admin confirmation, the admin would receive a message in the admin UI or a text message, to which they respond with approve or dismiss.
- Add a special step for the Wine Room that asks the user to upload a picture of their ID to verify they are over 21, and sends it to a dedicated service (no admin required) for verification.
- Add support for multiple concurrent sessions for cases like the above, so the user could book another amenity while their ID is being verified.
- Add a compaction mechanism, like the one Claude uses, for each session's history so the conversation does not grow too large.
- Add a mechanism to switch between models in case of an error with the current model.
