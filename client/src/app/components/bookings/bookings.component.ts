import {
  Component,
  OnInit,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { skip, filter } from 'rxjs/operators';
import { BookingService } from '../../services/booking.service';
import { ChatService } from '../../services/chat.service';
import { ChatInputService } from '../../services/chat-input.service';
import { Booking, Amenity } from '../../models/amenity.model';

const CANCELLED_PHASE_MS = 320;
const COLLAPSE_PHASE_MS = 380;

@Component({
  selector: 'app-bookings',
  standalone: true,
  templateUrl: './bookings.component.html',
  styleUrls: ['./bookings.component.scss'],
})
export class BookingsComponent implements OnInit {
  private bookingService = inject(BookingService);
  private chatService = inject(ChatService);
  private chatInputService = inject(ChatInputService);
  private destroyRef = inject(DestroyRef);

  readonly agentAvailable = this.chatService.agentAvailable;

  private amenities = signal<Amenity[]>([]);
  bookings = signal<Booking[]>([]);
  loading = signal(false);
  error = signal('');

  confirmingCancelId = signal<string | null>(null);
  cancellingId = signal<string | null>(null);
  cancelError = signal('');

  cancelledIds = signal(new Set<string>());
  collapsingIds = signal(new Set<string>());

  constructor() {
    // Reload whenever any booking mutation happens (chat or direct cancel)
    toObservable(this.bookingService.lastChanged).pipe(
      skip(1),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.loadAll());

    // Clear the inline-cancel state when agent comes back online
    toObservable(this.agentAvailable).pipe(
      filter(available => available),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      this.confirmingCancelId.set(null);
      this.cancelError.set('');
    });
  }

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set('');
    this.confirmingCancelId.set(null);
    this.cancelError.set('');

    forkJoin({
      amenities: this.bookingService.getAmenities(),
      bookings: this.bookingService.getUserBookings(),
    }).subscribe({
      next: ({ amenities, bookings: incoming }) => {
        this.amenities.set(amenities);
        this.loading.set(false);

        const agentCancelledIds = this.bookings()
          .map(b => b.id)
          .filter(id =>
            !incoming.find(b => b.id === id) &&
            !this.cancelledIds().has(id),
          );

        if (agentCancelledIds.length > 0) {
          this.animateOut(agentCancelledIds, () => this.bookings.set(incoming));
        } else {
          this.bookings.set(incoming);
          this.cancelledIds.set(new Set());
          this.collapsingIds.set(new Set());
        }
      },
      error: () => {
        this.error.set('Could not load bookings.');
        this.loading.set(false);
      },
    });
  }

  amenityName(amenityId: string): string {
    return this.amenities().find(a => a.id === amenityId)?.name ?? amenityId;
  }

  onEdit(booking: Booking): void {
    const name = this.amenityName(booking.amenityId);
    const msg =
      `I'd like to edit my booking for the ${name} on ${booking.date} ` +
      `(booking ID: ${booking.id}). What can I change?`;
    this.chatInputService.send(msg);
  }

  onCancel(booking: Booking): void {
    if (!this.agentAvailable()) {
      this.confirmingCancelId.set(booking.id);
      this.cancelError.set('');
      return;
    }
    const name = this.amenityName(booking.amenityId);
    const msg = `I want to cancel booking ${booking.id} for the ${name} on ${booking.date}.`;
    this.chatInputService.send(msg);
  }

  confirmDirectCancel(bookingId: string): void {
    this.cancellingId.set(bookingId);
    this.cancelError.set('');

    this.bookingService.directCancel(bookingId).subscribe({
      next: () => {
        this.cancellingId.set(null);
        this.confirmingCancelId.set(null);
        this.animateOut([bookingId], () => {
          this.bookingService.notifyChanged();
          this.loadAll();
        });
      },
      error: () => {
        this.cancellingId.set(null);
        this.cancelError.set('Cancellation failed. Please try again.');
      },
    });
  }

  dismissDirectCancel(): void {
    this.confirmingCancelId.set(null);
    this.cancelError.set('');
  }

  private animateOut(ids: string[], done: () => void): void {
    this.cancelledIds.update(s => new Set([...s, ...ids]));

    setTimeout(() => {
      this.collapsingIds.update(s => new Set([...s, ...ids]));

      setTimeout(() => {
        this.cancelledIds.update(s => { ids.forEach(id => s.delete(id)); return new Set(s); });
        this.collapsingIds.update(s => { ids.forEach(id => s.delete(id)); return new Set(s); });
        done();
      }, COLLAPSE_PHASE_MS);
    }, CANCELLED_PHASE_MS);
  }
}
