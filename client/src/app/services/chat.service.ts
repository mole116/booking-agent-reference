import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { ChatResponse } from '../models/chat.model';

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private api = inject(ApiService);

  private sessionId: string | null = null;
  private readonly _agentAvailable = signal(true);
  private eventSource: EventSource | null = null;

  readonly agentAvailable = this._agentAvailable.asReadonly();

  constructor() {
    this.connectStatusStream();
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }

  send(message: string): Observable<ChatResponse> {
    return this.api.sendChat(message, this.sessionId ?? undefined).pipe(
      tap((res) => {
        this.sessionId = res.sessionId;
      }),
      catchError((err: unknown) => throwError(() => err)),
    );
  }

  resetSession(): void {
    this.sessionId = null;
  }

  private connectStatusStream(): void {
    // EventSource goes directly to the dev server proxy target (port 3000)
    this.eventSource = new EventSource('/api/agent-status');

    this.eventSource.onmessage = (event) => {
      try {
        const { alive } = JSON.parse(event.data) as { alive: boolean };
        this._agentAvailable.set(alive);
      } catch { /* malformed event — ignore */ }
    };

    this.eventSource.onerror = () => {
      // SSE connection itself dropped (server restarted etc.) — mark unavailable
      // and let the browser auto-reconnect (EventSource does this natively)
      this._agentAvailable.set(false);
    };
  }
}
