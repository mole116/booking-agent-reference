import { Component, inject } from '@angular/core';
import { ChatComponent } from './components/chat/chat.component';
import { BookingsComponent } from './components/bookings/bookings.component';
import { AmenitiesComponent } from './components/amenities/amenities.component';
import { ChatService } from './services/chat.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ChatComponent, BookingsComponent, AmenitiesComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  agentAvailable = inject(ChatService).agentAvailable;
}
