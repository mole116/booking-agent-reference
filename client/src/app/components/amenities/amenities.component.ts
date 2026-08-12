import { Component, OnInit, inject, signal } from '@angular/core';
import { BookingService } from '../../services/booking.service';
import { ChatInputService } from '../../services/chat-input.service';
import { Amenity } from '../../models/amenity.model';

@Component({
  selector: 'app-amenities',
  standalone: true,
  templateUrl: './amenities.component.html',
  styleUrls: ['./amenities.component.scss'],
})
export class AmenitiesComponent implements OnInit {
  private bookingService = inject(BookingService);
  private chatInputService = inject(ChatInputService);

  amenities = signal<Amenity[]>([]);
  loading = signal(false);

  readonly icons: Record<string, string> = {
    pool: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0M2 19c2-4 4-4 6 0s4 4 6 0 4-4 6 0',
    grill: 'M8 3h8M12 3v4M5 7h14l-1.5 9H6.5L5 7zM9 16v4m6-4v4',
    'wine-room': 'M8 2h8l2 6H6L8 2zM7 8c0 5 2 8 5 9s5-4 5-9',
    gym: 'M6 5v14M18 5v14M6 12h12M3 8h3M18 8h3M3 16h3M18 16h3',
    'tennis-court': 'M12 2a10 10 0 1 0 0 20M2 12h20M12 2c-4 4-4 12 0 20M12 2c4 4 4 12 0 20',
    sauna: 'M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM9 21v-4M15 21v-4M7 21h10',
    'conference-room': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    'media-room': 'M22 2H2v16h8v2H6v2h12v-2h-4v-2h8V2zM2 14V4h20v10H2z',
  };

  ngOnInit(): void {
    this.loading.set(true);
    this.bookingService.getAmenities().subscribe({
      next: (a) => { this.amenities.set(a); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onBook(amenity: Amenity): void {
    this.chatInputService.send(`I'd like to book the ${amenity.name}.`);
  }

  iconPath(id: string): string {
    return this.icons[id] ?? 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z';
  }
}
