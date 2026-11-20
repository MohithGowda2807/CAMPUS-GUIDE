import type { AvailabilityState, Building, FacilityItem } from '../types/campus';

export interface VisitorFormInput {
  fullName: string;
  phone: string;
  email?: string;
  purpose: string;
  hostFacultyId?: number | null;
  destinationBuildingId?: number | null;
}

export interface VisitorValidationResult {
  valid: boolean;
  error?: string;
  cleanedPhone?: string;
}

export function validateVisitorForm(input: VisitorFormInput): VisitorValidationResult {
  const name = input.fullName.trim();
  if (name.length < 2) {
    return { valid: false, error: 'Please enter visitor full name.' };
  }

  const digits = input.phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, error: 'Please enter a valid 10-digit mobile number.' };
  }

  if (input.email && input.email.trim().length > 0) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(input.email.trim())) {
      return { valid: false, error: 'Please enter a valid email address.' };
    }
  }

  const purpose = input.purpose.trim();
  if (purpose.length < 3) {
    return { valid: false, error: 'Please specify your purpose of visit.' };
  }

  return { valid: true, cleanedPhone: digits };
}

const VALID_AVAILABILITY_STATES: ReadonlySet<string> = new Set([
  'AVAILABLE',
  'BUSY_SCHEDULED',
  'UNAVAILABLE',
  'UNKNOWN',
]);

export function normalizeAvailabilityState(raw?: string | null): AvailabilityState {
  if (!raw) return 'UNKNOWN';
  const upper = raw.trim().toUpperCase();
  if (VALID_AVAILABILITY_STATES.has(upper)) {
    return upper as AvailabilityState;
  }
  return 'UNKNOWN';
}

export type MapCategoryFilter =
  | 'ALL'
  | 'DEPARTMENTS'
  | 'LABS'
  | 'CAFETERIAS'
  | 'LIBRARIES'
  | 'HOSTELS'
  | 'MEDICAL_GATE';

export function filterCampusEntitiesByCategory(
  buildings: Building[],
  facilities: FacilityItem[],
  category: MapCategoryFilter
): { buildings: Building[]; facilities: FacilityItem[] } {
  switch (category) {
    case 'ALL':
      return { buildings, facilities };
    case 'DEPARTMENTS':
      return {
        buildings: buildings.filter((b) =>
          ['ACADEMIC', 'ADMINISTRATION'].includes(b.building_type.toUpperCase())
        ),
        facilities: [],
      };
    case 'LABS':
      return {
        buildings: buildings.filter(
          (b) =>
            b.building_type.toUpperCase().includes('LAB') ||
            b.building_name.toLowerCase().includes('lab') ||
            b.building_name.toLowerCase().includes('research')
        ),
        facilities: [],
      };
    case 'CAFETERIAS':
      return {
        buildings: buildings.filter((b) => b.building_type.toUpperCase().includes('AMENITY')),
        facilities: facilities.filter((f) => f.category === 'CAFETERIA_FOOD'),
      };
    case 'LIBRARIES':
      return {
        buildings: buildings.filter((b) => b.building_code === 'LIB'),
        facilities: facilities.filter((f) =>
          ['LIBRARY', 'AUDITORIUM_HALL'].includes(f.category)
        ),
      };
    case 'HOSTELS':
      return {
        buildings: buildings.filter((b) => b.building_type.toUpperCase().includes('HOSTEL')),
        facilities: [],
      };
    case 'MEDICAL_GATE':
      return {
        buildings: [],
        facilities: facilities.filter((f) =>
          ['MEDICAL_FIRST_AID', 'GATE_RECEPTION', 'BANK_ATM', 'PARKING'].includes(f.category)
        ),
      };
  }
}
