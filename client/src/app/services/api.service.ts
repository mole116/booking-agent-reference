import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Amenity, Booking } from '../models/amenity.model';
import { ChatResponse } from '../models/chat.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getAmenities(): Observable<Amenity[]> {
    return this.http.get<Amenity[]>('/api/amenities');
  }

  getUserBookings(userId = 'user-1'): Observable<Booking[]> {
    return this.http.get<Booking[]>(`/api/bookings?userId=${userId}`);
  }

  cancelBooking(bookingId: string, userId = 'user-1'): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `/api/bookings/${encodeURIComponent(bookingId)}?userId=${encodeURIComponent(userId)}`,
    );
  }

  sendChat(message: string, sessionId?: string): Observable<ChatResponse> {
    const body: { message: string; sessionId?: string } = { message };
    if (sessionId) body.sessionId = sessionId;
    return this.http.post<ChatResponse>('/api/chat', body);
  }
}
