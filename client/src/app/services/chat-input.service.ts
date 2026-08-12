import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChatInputService {
  private readonly _send$ = new Subject<string>();
  readonly message$ = this._send$.asObservable();

  send(text: string): void {
    this._send$.next(text);
  }
}
