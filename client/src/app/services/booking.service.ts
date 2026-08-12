import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Amenity, Booking } from '../models/amenity.model';

@Injectable({ providedIn: 'root' })
export class BookingService {
  private api = inject(ApiService);

  // Incremented whenever a booking is created, updated, or cancelled.
  // Components subscribe via toObservable(bookingService.lastChanged).
  readonly lastChanged = signal(0);

  notifyChanged(): void {
    this.lastChanged.update(v => v + 1);
  }

  getAmenities(): Observable<Amenity[]> {
    return this.api.getAmenities();
  }

  getUserBookings(userId = 'user-1'): Observable<Booking[]> {
    return this.api.getUserBookings(userId);
  }

  directCancel(bookingId: string, userId = 'user-1'): Observable<{ message: string }> {
    return this.api.cancelBooking(bookingId, userId);
  }
}
