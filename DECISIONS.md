# Daisy Amenity Reservation System — Decisions


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

A CLI was added before the UI to enable fast iteration on agent behaviour and tool calling without running the full stack.

I decided that the agent should be a microservice on its own and not to run it from the server for scaling reason mainly. It will run as a separate process and the server will call it when needed.

i also decided that a buisness cannot be dependent on an external service that may not be available, so in case the agent is not available, the system should provide a way to complete the task without the agent. (for now just for simplicity a cancelation is the only thing that is allowd when the agent is not available, a perfect solution will support also the edit and the create booking, but this will require some more ui works).

AS CAN BE SEEN in the agent.ts the system prompt is very direcetive. that is done on purpose, in this way i can more easily control the behavior of the agent and make sure that it is calling the tools in the correct order and by that it will be much more predictable.

## The Business Rules I Chose to Enforce
Strict User Consent: The system explicitly prohibits the agent from mutating state (creating, updating, or canceling a booking) without presenting a confirmation UI and waiting for the user's explicit consent (*** STOP. Wait for the user. ***) like in the prompt.

Dynamic Capacity & Overlap Calculation: The backend does not just look at raw time slots; it calculates overlapping durations (Start Time to End Time) and sums the total guests across all simultaneous bookings to ensure the room's physical capacity is never exceeded

Age Gating: I implemented an explicit safety check where the agent must halt the booking flow to verify the user is 21 or older before they can book the restricted Wine Room

Double-Booking Prevention: The server explicitly rejects requests if a user tries to create a second, overlapping reservation for the same amenity, forcing them to use the update workflow instead

Smart Defaults (Capacity-Aware): If an amenity (like the BBQ Grill) has a maximum capacity of exactly 1, the agent automatically assigns 1 guest and skips asking the user, removing unnecessary friction from the flow (as can be seen in the prompt)

## Tools boundaries

The agent owns the following tools:

Granular Validation Tools: Instead of forcing the LLM to guess if an update is valid, I provided a dedicated checkBookingUpdateAvailability tool. This shifts the complex mathematical burden of checking overlapping capacity from the LLM (which is bad at math) to my Express server (which handles it deterministically)

Range Query Tool: The checkAvailabilityRange tool is a performance optimization. Instead of the agent making multiple sequential calls to checkAvailability for each day in a week, it makes one call. This reduces latency and token usage.
i chose to use this tool as there eas no guarantee that the model will batch the checkAvailability call, (it could call it sequentially by mistake).

I was very descriptive in the prompt about the fact that the agent cannot make decisions on its own and must always wait for the user's confirmation. I think that this is a very importent rule that should be enforced in any system that works with agents.
Same for the tools description, I was very descriptive about what each tool does and when to use it.


## What I would do with more time

- Replace JSON persistence with a transactional database.
- Add authentication and derive `userId` from the authenticated session.
- Add some cool steps like if the user would like to book an amenity that require Admin confirmation then the admin shold recieve a message in the Admin ui or a text message and which he will need to reponds with approve or dissmiss
- Add a special step for the wine room which will assks the user to upload a picture of his id to verify he is over 21 and will send this into a special service (no admin required in here) to verify it.
- Add the opertunity to use multiple session just for the case this session needs an approve like the above, so if the user would like to book other emenity while the id is sent for verification then he will be able to do so.
- Add a compact mechanism just like claude use for every session history so the conversation will not grow too large.
- Add a mechanism to switch between models in case of an error with the current model.
