import { generateText, stepCountIs, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import dotenv from 'dotenv';
import { agentLog } from './logger.js';
import { getMaxOutputTokens, getModel } from './model.js';

dotenv.config();

export const API_BASE_URL = 'http://localhost:3000/api';
const DEFAULT_USER_ID = 'user-1';

export type ActionVariant = 'primary' | 'secondary' | 'danger';

export interface UiAction {
  id: string;
  label: string;
  message: string;
  variant: ActionVariant;
}

export interface UiBlock {
  kind: 'none' | 'choices' | 'confirmation';
  actions: UiAction[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentResult {
  text: string;
  history: any[];
  ui: UiBlock;
  bookingChanged: boolean;
  toolsCalled: string[];
  /** Tokens used across every step of the turn (total = input + output). */
  usage: TokenUsage;
}

export interface AgentOptions {
  /** Override the model (default: the env-driven selection from model.ts). Used by the eval matrix. */
  model?: LanguageModel;
  /** Override the system prompt (default: buildSystemPrompt). Used by the eval matrix. */
  systemPrompt?: string;
  /** Called whenever a tool starts executing. Used by the agent service to report live progress. */
  onToolStart?: (toolName: string) => void;
}


/** The production system prompt. `today` is the current date in YYYY-MM-DD. */
export function buildSystemPrompt(today: string): string {
  return `You are a helpful and polite amenity reservation assistant.

CURRENT DATE: ${today}
DEFAULT USER ID: ${DEFAULT_USER_ID}

━━━ BOOKING WORKFLOW ━━━

FAST PATH — user supplied amenity + date + start time + end time + guests all at once:
  → Jump directly to step (d). Skip all interactive collection steps.

INTERACTIVE PATH — one or more fields are missing:

  a. You need: amenity, date, start time, end time, and guest count.
     Call getAmenities to learn the exact amenity ID and its capacity.
     If the date is missing, ask for it (today is ${today}).
     *** STOP if amenity or date are still unknown. Wait for the user. ***

  b. Call checkAvailability for the amenity and date.
     Collect all slots where isAvailable = true.
     If there are NO available slots, tell the user and stop.

     If start time is NOT yet known:
       • Call setUiActions(kind="choices") — one action per available start time:
         { id:"start-<time>", label:"<time>", message:"Start time: <time>", variant:"secondary" }
       • Write ONE short sentence asking the user to pick a start time. Also state capacity:
           capacity = 1  → append "This amenity is for **1 person** only."
           capacity > 1  → append "This amenity fits up to **<capacity> guests**."
       • Do NOT list the time slots in prose — they appear as buttons already.
       *** STOP. Wait for the user to pick a start time. ***

  c. If end time is NOT yet known:
       • From the same checkAvailability result, collect valid end times
         (available slots strictly after the chosen start time).
       • Call setUiActions(kind="choices") — one action per valid end time:
         { id:"end-<time>", label:"<time>", message:"End time: <time>", variant:"secondary" }
       • Write ONE short sentence asking the user to pick an end time.
       • Do NOT list the time slots in prose — they appear as buttons already.
       *** STOP. Wait for the user to pick an end time. ***

  c2. Guest count (capacity-aware):
       • capacity = 1  → set guests = 1 automatically. Do NOT ask the user.
       • capacity > 1 AND guest count not yet provided:
           Ask how many guests (remind them the max is <capacity>).
           *** STOP. Wait for the user. ***
       • capacity > 1 AND user already provided a guest count → use it and continue.

SHARED STEPS (both paths merge here):

  d. Call getUserBookings("${DEFAULT_USER_ID}") to check for overlapping bookings.
     - Exact duplicate → tell the user and stop.
     - Overlapping with different times → treat as an update (use UPDATE WORKFLOW).
     - Requested guests exceed (capacity − currentGuests) for any slot →
       tell the user the limit and ask them to choose a lower guest count.
       Do NOT proceed until guest count is valid.

  e. Call setUiActions(kind="confirmation", actions=[
       {id:"confirm", label:"Confirm booking", message:"Yes, confirm the booking.", variant:"primary"},
       {id:"edit",    label:"Edit details",    message:"I want to change some details.", variant:"secondary"}
     ]).
     Write a friendly summary (amenity, date, start–end, guests) and ask the user to confirm.
     *** STOP. Wait for the user. ***

  f. When the user's message is "Yes, confirm the booking." → call commitBooking immediately.
     Do NOT call getUserBookings or checkAvailability again. Do NOT ask for confirmation again.
     After commitBooking succeeds, call setUiActions(kind="none", actions=[]) and report success.

━━━ UPDATE WORKFLOW ━━━
  a. Call getUserBookings("${DEFAULT_USER_ID}") to identify the booking to update.
  b. Call checkBookingUpdateAvailability for the proposed new times/guests.
  c. Call setUiActions(kind="confirmation", actions=[{id:"confirm",label:"Confirm update",message:"Yes, update my booking.",variant:"primary"},{id:"edit",label:"Edit details",message:"I want to change the details.",variant:"secondary"}]).
  d. Write the proposed changes and ask the user to confirm.
  *** STOP. Wait for the user. ***
  e. When the user's message is "Yes, update my booking." → call updateBooking immediately. Do NOT re-check or re-confirm.
  f. After updateBooking succeeds, call setUiActions(kind="none", actions=[]) and report success.

━━━ CANCELLATION WORKFLOW ━━━
  a. Call getUserBookings("${DEFAULT_USER_ID}") to find the booking to cancel.
  b. Call setUiActions(kind="confirmation", actions=[{id:"confirm-cancel",label:"Cancel booking",message:"Yes, cancel my booking.",variant:"danger"},{id:"keep",label:"Keep booking",message:"No, keep my booking.",variant:"secondary"}]).
  c. Present the booking details and ask the user to confirm the cancellation.
  *** STOP. Wait for the user. ***
  d. When the user's message is "Yes, cancel my booking." → call cancelBooking immediately. Do NOT re-check or re-confirm.
  e. After cancelBooking succeeds, call setUiActions(kind="none", actions=[]) and report success.

━━━ RULES ━━━
1. For the Wine Room, ask the user to confirm they are 21 or older before checking availability or booking.
2. Use "${DEFAULT_USER_ID}" for all bookings and user-booking lookups. Never invent IDs.
3. If commitBooking / updateBooking / cancelBooking returns an error, call setUiActions(kind="none", actions=[]) and report the error clearly.
4. STRUCTURED UI — call setUiActions exactly once per turn, BEFORE writing your reply:
   - Presenting a confirmation summary → kind="confirmation"
   - Presenting selectable choices (amenities, time slots) → kind="choices", one action per option
   - Any informational response → kind="none", empty actions array
5. After calling setUiActions, ALWAYS write your conversational reply. Never end a turn with only a tool call.`;
}

export async function runAgent(
  userMessage: string,
  history: any[] = [],
  sessionId = 'cli',
  options: AgentOptions = {},
): Promise<AgentResult> {
  let uiBlock: UiBlock = { kind: 'none', actions: [] };
  let bookingChanged = false;
  const toolsCalled: string[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const messages = [...history, { role: 'user' as const, content: userMessage }];
  const today = new Date().toISOString().split('T')[0];

  agentLog.turnStart(sessionId, userMessage);

  // Wrap a tool's execute fn so every result is logged
  function logged<T extends Record<string, any>>(
    name: string,
    execute: (args: T) => Promise<unknown>,
  ): (args: T) => Promise<unknown> {
    return async (args: T) => {
      toolsCalled.push(name);
      options.onToolStart?.(name);
      const result = await execute(args);
      agentLog.toolResult(sessionId, name, result);
      return result;
    };
  }

  try {
    const result = await generateText({
      model: options.model ?? getModel(),

      system: options.systemPrompt ?? buildSystemPrompt(today),

      messages,
      maxOutputTokens: getMaxOutputTokens(),
      stopWhen: stepCountIs(10),

      onStepEnd: (step) => {
        usage.inputTokens += step.usage?.inputTokens ?? 0;
        usage.outputTokens += step.usage?.outputTokens ?? 0;
        usage.totalTokens = usage.inputTokens + usage.outputTokens;
        agentLog.step(sessionId, {
          stepNumber: step.stepNumber,
          text: step.text,
          toolCalls: step.toolCalls.map((tc: any) => ({
            toolName: tc.toolName,
            args: tc.input ?? tc.args,
          })),
          finishReason: step.finishReason,
          usage: step.usage
            ? { inputTokens: step.usage.inputTokens, outputTokens: step.usage.outputTokens }
            : undefined,
        });
      },

      tools: {
        setUiActions: tool({
          description:
            'REQUIRED. Call once per turn with the UI action buttons to render alongside your reply. kind="none" for informational responses, "choices" for option lists, "confirmation" for yes/no confirmations.',
          inputSchema: z.object({
            kind: z.enum(['none', 'choices', 'confirmation']),
            actions: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                message: z.string(),
                variant: z.enum(['primary', 'secondary', 'danger']),
              }),
            ),
          }),
          execute: logged('setUiActions', async ({ kind, actions }) => {
            uiBlock = { kind, actions };
            agentLog.uiActions(sessionId, { kind, actions });
            return { recorded: true }; //just a response for the model to know the call succeeded
          }),
        }),

        getAmenities: tool({
          description: 'Get all amenities, including their exact database IDs.',
          inputSchema: z.object({}),
          execute: logged('getAmenities', async () => {
            const response = await fetch(`${API_BASE_URL}/amenities`);
            return response.json();
          }),
        }),

        getUserBookings: tool({
          description:
            'Get all reservations for a user. Call this before creating or updating a booking.',
          inputSchema: z.object({
            userId: z.string().describe('Use "user-1".'),
          }),
          execute: logged('getUserBookings', async ({ userId }) => {
            const response = await fetch(
              `${API_BASE_URL}/bookings?userId=${encodeURIComponent(userId)}`,
            );
            return response.json();
          }),
        }),

        checkAvailability: tool({
          description:
            'Check capacity and available time slots for an amenity on one date before creating a new booking.',
          inputSchema: z.object({
            amenityId: z.string().describe('Exact amenity ID, such as "pool".'),
            date: z.string().describe('Date in YYYY-MM-DD format.'),
          }),
          execute: logged('checkAvailability', async ({ amenityId, date }) => {
            const response = await fetch(
              `${API_BASE_URL}/amenities/${encodeURIComponent(amenityId)}/availability?date=${encodeURIComponent(date)}`,
            );
            return response.json();
          }),
        }),

        checkAvailabilityRange: tool({
          description:
            'Check amenity capacity for every date in a consecutive date range.',
          inputSchema: z.object({
            amenityId: z.string(),
            startDate: z.string().describe('Date in YYYY-MM-DD format.'),
            endDate: z.string().describe('Date in YYYY-MM-DD format.'),
          }),
          execute: logged('checkAvailabilityRange', async ({ amenityId, startDate, endDate }) => {
            const response = await fetch(
              `${API_BASE_URL}/amenities/${encodeURIComponent(amenityId)}/availability/range?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
            );
            return response.json();
          }),
        }),

        checkBookingUpdateAvailability: tool({
          description:
            'Check whether changing an existing booking to a new date, start time, end time, and/or total guest count is possible. Call before updating a booking.',
          inputSchema: z.object({
            bookingId: z.string(),
            date: z.string().optional().describe('New date in YYYY-MM-DD format. Omit to keep the existing date.'),
            startTime: z.string().describe('Example: "10:00".'),
            endTime: z.string().describe('Example: "12:00".'),
            guests: z.number().int().positive().describe(
              'The new total guest count, not the number of additional guests.',
            ),
          }),
          execute: logged('checkBookingUpdateAvailability', async ({ bookingId, date, startTime, endTime, guests }) => {
            const params = new URLSearchParams({ startTime, endTime, guests: String(guests) });
            if (date) params.set('date', date);
            const response = await fetch(
              `${API_BASE_URL}/bookings/${encodeURIComponent(bookingId)}/check-update?${params}`,
            );
            return response.json();
          }),
        }),

        commitBooking: tool({
          description:
            'Create a new reservation. Use only after checking availability, checking user bookings, and receiving explicit user confirmation.',
          inputSchema: z.object({
            amenityId: z.string(),
            date: z.string().describe('Date in YYYY-MM-DD format.'),
            startTime: z.string().describe('Example: "10:00".'),
            endTime: z.string().describe('Example: "12:00".'),
            guests: z.number().int().positive(),
            userId: z.string().describe('Use "user-1".'),
          }),
          execute: logged('commitBooking', async ({ amenityId, date, startTime, endTime, guests, userId }) => {
            const response = await fetch(`${API_BASE_URL}/bookings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ amenityId, date, startTime, endTime, guests, userId }),
            });
            const data = await response.json();
            if (response.ok) {
              bookingChanged = true;
              return { success: true, booking: data };
            }
            return { success: false, error: data.error };
          }),
        }),

        updateBooking: tool({
          description:
            'Update the date, time range and/or total guest count of an existing booking. Use only after availability was checked and the user explicitly confirmed.',
          inputSchema: z.object({
            bookingId: z.string(),
            date: z.string().optional().describe('New date in YYYY-MM-DD format. Omit to keep the existing date.'),
            startTime: z.string().describe('Example: "10:00".'),
            endTime: z.string().describe('Example: "12:00".'),
            guests: z.number().int().positive().describe('The new total guest count.'),
          }),
          execute: logged('updateBooking', async ({ bookingId, date, startTime, endTime, guests }) => {
            const response = await fetch(
              `${API_BASE_URL}/bookings/${encodeURIComponent(bookingId)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...(date ? { date } : {}), startTime, endTime, guests }),
              },
            );
            const data = await response.json();
            if (response.ok) {
              bookingChanged = true;
              return { success: true, booking: data };
            }
            return { success: false, error: data.error };
          }),
        }),

        cancelBooking: tool({
          description: 'Cancel an existing booking by booking ID.',
          inputSchema: z.object({
            bookingId: z.string(),
            userId: z.string().describe('Use "user-1".'),
          }),
          execute: logged('cancelBooking', async ({ bookingId, userId }) => {
            const response = await fetch(
              `${API_BASE_URL}/bookings/${encodeURIComponent(bookingId)}?userId=${encodeURIComponent(userId)}`,
              { method: 'DELETE' },
            );
            const data = await response.json();
            if (response.ok) {
              bookingChanged = true;
              return { success: true, message: data.message };
            }
            return { success: false, error: data.error };
          }),
        }),
      },
    });

    // result.text is empty when the last action in the turn was a tool call.
    // Fall back to the last assistant text content in the response messages.
    let text = result.text;
    if (!text) {
      for (let i = result.responseMessages.length - 1; i >= 0; i--) {
        const msg = result.responseMessages[i];
        if (msg.role !== 'assistant') continue;
        const content = Array.isArray(msg.content) ? msg.content : [msg.content];
        const textPart = content.find(
          (p: any) => typeof p === 'string' || p?.type === 'text',
        );
        if (textPart) {
          text = typeof textPart === 'string' ? textPart : (textPart as any).text;
          break;
        }
      }
    }

    const finalText = text || 'Done! Is there anything else I can help you with?';
    agentLog.turnEnd(sessionId, finalText, bookingChanged);

    return {
      text: finalText,
      history: [...messages, ...result.responseMessages],
      ui: uiBlock,
      bookingChanged,
      toolsCalled,
      usage,
    };
  } catch (error) {
    agentLog.error(sessionId, error);
    console.error('Agent execution error:', error);

    return {
      text: 'Sorry, I encountered an error.',
      history: messages,
      ui: { kind: 'none', actions: [] },
      bookingChanged: false,
      usage,
      toolsCalled,
    };
  }
}
