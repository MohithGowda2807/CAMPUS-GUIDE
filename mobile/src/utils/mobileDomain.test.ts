import { describe, expect, it } from 'vitest';
import {
  filterCampusEntitiesByCategory,
  normalizeAvailabilityState,
  validateVisitorForm,
} from './mobileDomain';
import {
  FALLBACK_BUILDINGS,
  FALLBACK_DEPARTMENTS,
  FALLBACK_FACILITIES,
  FALLBACK_FACULTY,
  FALLBACK_MAP_CONFIG,
} from '../data/fallbackData';

describe('mobileDomain — visitor registration validation rules', () => {
  it('rejects empty or 1-char visitor name', () => {
    const res = validateVisitorForm({
      fullName: 'A',
      phone: '9845012345',
      purpose: 'Admissions Inquiry',
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('full name');
  });

  it('rejects incomplete phone numbers (<10 digits)', () => {
    const res = validateVisitorForm({
      fullName: 'Ramesh Rao',
      phone: '98450-12',
      purpose: 'Admissions Inquiry',
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('10-digit');
  });

  it('rejects malformed optional email while allowing empty email', () => {
    const bad = validateVisitorForm({
      fullName: 'Ramesh Rao',
      phone: '9845012345',
      email: 'not-an-email',
      purpose: 'Project Review',
    });
    expect(bad.valid).toBe(false);

    const okEmpty = validateVisitorForm({
      fullName: 'Ramesh Rao',
      phone: '+91 98450 12345',
      email: '',
      purpose: 'Project Review',
    });
    expect(okEmpty.valid).toBe(true);
    expect(okEmpty.cleanedPhone).toBe('919845012345');
  });

  it('rejects missing purpose of visit', () => {
    const res = validateVisitorForm({
      fullName: 'Ramesh Rao',
      phone: '9845012345',
      purpose: '  ',
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('purpose');
  });
});

describe('mobileDomain — faculty availability governance', () => {
  it('preserves exact backend enum states and defaults unverified/stale values to UNKNOWN', () => {
    expect(normalizeAvailabilityState('AVAILABLE')).toBe('AVAILABLE');
    expect(normalizeAvailabilityState('busy_scheduled')).toBe('BUSY_SCHEDULED');
    expect(normalizeAvailabilityState('UNAVAILABLE')).toBe('UNAVAILABLE');
    expect(normalizeAvailabilityState('UNKNOWN')).toBe('UNKNOWN');
    expect(normalizeAvailabilityState(null)).toBe('UNKNOWN');
    expect(normalizeAvailabilityState(undefined)).toBe('UNKNOWN');
    expect(normalizeAvailabilityState('IN_CLASS_TIMETABLE_GUESS')).toBe('UNKNOWN');
  });
});

describe('mobileDomain — verified campus dataset integrity & category filtering', () => {
  it('bundles all 28 buildings, 29 GeoJSON polygons, 20 departments, 339 faculty, and 12 facilities', () => {
    expect(FALLBACK_BUILDINGS).toHaveLength(28);
    expect(FALLBACK_MAP_CONFIG.geometries).toHaveLength(29);
    expect(FALLBACK_DEPARTMENTS).toHaveLength(20);
    expect(FALLBACK_FACULTY).toHaveLength(339);
    expect(FALLBACK_FACILITIES).toHaveLength(12);
  });

  it('preserves exact RVCE map center coordinates and OpenStreetMap tile URL', () => {
    expect(FALLBACK_MAP_CONFIG.center.lat).toBeCloseTo(12.92355, 5);
    expect(FALLBACK_MAP_CONFIG.center.lng).toBeCloseTo(77.49985, 5);
    expect(FALLBACK_MAP_CONFIG.tile_layer.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  });

  it('filters cafeterias and medical/gate facilities accurately', () => {
    const food = filterCampusEntitiesByCategory(
      FALLBACK_BUILDINGS,
      FALLBACK_FACILITIES,
      'CAFETERIAS'
    );
    expect(food.facilities.length).toBeGreaterThanOrEqual(2);
    expect(food.facilities.every((f) => f.category === 'CAFETERIA_FOOD')).toBe(true);

    const medGate = filterCampusEntitiesByCategory(
      FALLBACK_BUILDINGS,
      FALLBACK_FACILITIES,
      'MEDICAL_GATE'
    );
    expect(medGate.buildings).toHaveLength(0);
    expect(medGate.facilities.some((f) => f.category === 'MEDICAL_FIRST_AID')).toBe(true);
    expect(medGate.facilities.some((f) => f.category === 'GATE_RECEPTION')).toBe(true);
  });

  it('filters hostels and departments without cross-contamination', () => {
    const hostels = filterCampusEntitiesByCategory(
      FALLBACK_BUILDINGS,
      FALLBACK_FACILITIES,
      'HOSTELS'
    );
    expect(hostels.buildings.length).toBeGreaterThan(0);
    expect(hostels.facilities).toHaveLength(0);
  });
});
