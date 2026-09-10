import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { ChatResponse } from '../models/chat.model';

/**
 * Maps each user-visible agent tool to the loading label shown while it runs.
 * Tools absent from this map (setUiActions — an internal, near-instant UI-state
 * call) never change the label, so the last meaningful status stays on screen.
 */
const TOOL_STATUS_LABELS: Record<string, string> = {
  getAmenities: 'Getting amenity details…',
  getUserBookings: 'Looking up your bookings…',
  checkAvailability: 'Checking availability…',
  checkAvailabilityRange: 'Checking availability…',
  checkBookingUpdateAvailability: 'Checking availability…',
  commitBooking: 'Confirming your booking…',
  updateBooking: 'Updating your booking…',
  cancelBooking: 'Cancelling your booking…',
};

interface AgentActivity {
  sessionId: string;
  tool: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private api = inject(ApiService);

  // Generated client-side so live activity events can be matched to this
  // session from the very first message. The server accepts a provided id.
  private sessionId: string = crypto.randomUUID();
  private readonly _agentAvailable = signal(true);
  private readonly _activity = signal<AgentActivity | null>(null);
  private eventSource: EventSource | null = null;

  readonly agentAvailable = this._agentAvailable.asReadonly();

  /** Loading label for the tool currently executing in this session, if any. */
  readonly statusLabel = computed(() => {
    const activity = this._activity();
    return activity && activity.sessionId === this.sessionId
      ? TOOL_STATUS_LABELS[activity.tool]
      : null;
  });

  constructor() {
    this.connectStatusStream();
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }

  send(message: string): Observable<ChatResponse> {
    this._activity.set(null); // new turn: fall back to the generic label until the first tool starts
    return this.api.sendChat(message, this.sessionId).pipe(
      catchError((err: unknown) => throwError(() => err)),
    );
  }

  resetSession(): void {
    this.sessionId = crypto.randomUUID();
    this._activity.set(null);
  }

  private connectStatusStream(): void {
    // EventSource goes directly to the dev server proxy target (port 3000)
    this.eventSource = new EventSource('/api/agent-status');

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { alive?: boolean; activity?: AgentActivity };
        if (typeof data.alive === 'boolean') {
          this._agentAvailable.set(data.alive);
        } else if (data.activity && data.activity.tool in TOOL_STATUS_LABELS) {
          this._activity.set(data.activity);
        }
      } catch { /* malformed event — ignore */ }
    };

    this.eventSource.onerror = () => {
      // SSE connection itself dropped (server restarted etc.) — mark unavailable
      // and let the browser auto-reconnect (EventSource does this natively)
      this._agentAvailable.set(false);
    };
  }
}
