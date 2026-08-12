export interface Amenity {
  id: string;
  name: string;
  capacity: number;
  operatingWindows: { from: string; to: string }[];
  ageRestricted?: boolean;
}

export interface Booking {
  id: string;
  amenityId: string;
  date: string;
  startTime: string;
  endTime: string;
  guests: number;
  userId: string;
}
