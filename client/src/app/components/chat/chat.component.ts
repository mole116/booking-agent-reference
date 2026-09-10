import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  viewChild,
  ElementRef,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { distinctUntilChanged } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { BookingService } from '../../services/booking.service';
import { ChatInputService } from '../../services/chat-input.service';
import { ChatMessage, UiAction } from '../../models/chat.model';
import { Nl2brPipe } from '../../pipes/nl2br.pipe';

const QUICK_ACTIONS: UiAction[] = [
  { id: 'qa-amenities', label: 'View amenities', message: 'What amenities are available?', variant: 'secondary' },
  { id: 'qa-bookings', label: 'My bookings', message: 'Show my current bookings.', variant: 'secondary' },
  { id: 'qa-pool', label: 'Book the pool', message: "I'd like to book the Swimming Pool", variant: 'secondary' },
  { id: 'qa-grill', label: 'Book the grill', message: "I'd like to book the BBQ Grill", variant: 'secondary' },
];

const OFFLINE_MESSAGE =
  "I'm sorry, the reservation assistant is currently unavailable. " +
  "You can still cancel an existing booking directly from the \"My Bookings\" panel on the right. " +
  "Please try again later.";

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, Nl2brPipe],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss'],
})
export class ChatComponent implements OnInit {
  private chatService = inject(ChatService);
  private bookingService = inject(BookingService);
  private chatInputService = inject(ChatInputService);
  private destroyRef = inject(DestroyRef);

  private scrollAnchor = viewChild<ElementRef>('scrollAnchor');

  readonly agentAvailable = this.chatService.agentAvailable;

  messages = signal<ChatMessage[]>([]);
  inputText = signal('');
  isLoading = signal(false);
  showQuickActions = signal(true);
  quickActions = QUICK_ACTIONS;

  inputDisabled = computed(() => this.isLoading() || !this.agentAvailable());

  /** Live loading label: reflects the tool the agent is currently executing. */
  readonly loadingLabel = computed(() => this.chatService.statusLabel() ?? 'Thinking…');

  constructor() {
    // Incoming messages from any component (amenities Book button, bookings Edit/Cancel)
    this.chatInputService.message$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(text => this.sendMessage(text));

    // React to agent availability changes
    toObservable(this.agentAvailable).pipe(
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(available => {
      if (!available) {
        this.showQuickActions.set(false);
        this.messages.update(msgs => [
          ...msgs.map(m => m.role === 'assistant' && m.ui ? { ...m, actionsConsumed: true } : m),
          { role: 'assistant' as const, text: OFFLINE_MESSAGE },
        ]);
        this.scrollToBottom();
      } else if (this.messages().length > 1) {
        this.messages.update(msgs => [
          ...msgs,
          { role: 'assistant' as const, text: "I'm back online! How can I help you?" },
        ]);
        this.scrollToBottom();
      }
    });
  }

  ngOnInit(): void {
    this.messages.set([{ role: 'assistant', text: 'What would you like to reserve?' }]);
  }

  sendMessage(text: string = this.inputText()): void {
    const trimmed = text.trim();
    if (!trimmed || this.inputDisabled()) return;

    this.showQuickActions.set(false);
    this.inputText.set('');
    this.isLoading.set(true);

    this.messages.update(msgs => [
      ...msgs.map(m => m.role === 'assistant' && m.ui ? { ...m, actionsConsumed: true } : m),
      { role: 'user' as const, text: trimmed },
    ]);
    this.scrollToBottom();

    this.chatService.send(trimmed).subscribe({
      next: (res) => {
        this.messages.update(msgs => [
          ...msgs,
          { role: 'assistant' as const, text: res.text, ui: res.ui, actionsConsumed: false },
        ]);
        this.isLoading.set(false);
        this.scrollToBottom();
        if (res.bookingChanged) {
          this.bookingService.notifyChanged();
        }
      },
      error: () => {
        const msg = !this.agentAvailable()
          ? OFFLINE_MESSAGE
          : 'Sorry, something went wrong. Please try again.';
        this.messages.update(msgs => [
          ...msgs,
          { role: 'assistant' as const, text: msg },
        ]);
        this.isLoading.set(false);
        this.scrollToBottom();
      },
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  clickAction(action: UiAction, msgIndex: number): void {
    if (this.inputDisabled()) return;
    this.messages.update(msgs =>
      msgs.map((m, i) => i === msgIndex ? { ...m, actionsConsumed: true } : m),
    );
    this.sendMessage(action.message);
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      try {
        this.scrollAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth' });
      } catch { /* ignore */ }
    }, 0);
  }
}
