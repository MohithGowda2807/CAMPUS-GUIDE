import { describe, expect, it } from 'vitest';
import { computeCampusRouteOffline, haversineM } from './campusRouter';
import cases from './__fixtures__/backendRoutes.json';
import type { CampusRouteResponse } from '../types/campus';

interface Case {
  req: {
    from_lat: number;
    from_lng: number;
    to_lat: number;
    to_lng: number;
    mode: 'WALKING' | 'VEHICLE';
    from_label: string;
    to_label: string;
  };
  expected: CampusRouteResponse;
}

const fixtures = cases as unknown as Case[];

function run(c: Case) {
  return computeCampusRouteOffline({
    fromLat: c.req.from_lat,
    fromLng: c.req.from_lng,
    toLat: c.req.to_lat,
    toLng: c.req.to_lng,
    mode: c.req.mode,
    fromLabel: c.req.from_label,
    toLabel: c.req.to_label,
  });
}

describe('offline campus router — parity with backend/app/services/routing.py', () => {
  it('has real backend fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of fixtures) {
    const name = `${c.req.from_label} -> ${c.req.to_label} (${c.req.mode})`;

    it(`${name}: distance, duration and leg structure match the backend`, () => {
      const got = run(c);
      expect(got.mode).toBe(c.expected.mode);
      expect(got.total_distance_m).toBeCloseTo(c.expected.total_distance_m, 0);
      expect(Math.abs(got.total_duration_seconds - c.expected.total_duration_seconds)).toBeLessThanOrEqual(2);
      expect(got.legs.map((l) => l.leg_type)).toEqual(c.expected.legs.map((l) => l.leg_type));
      expect(got.uses_steps).toBe(c.expected.uses_steps);
    });

    it(`${name}: polyline follows the identical road/walkway nodes`, () => {
      const got = run(c);
      expect(got.legs.length).toBe(c.expected.legs.length);
      got.legs.forEach((leg, i) => {
        const exp = c.expected.legs[i];
        expect(leg.coordinates.length).toBe(exp.coordinates.length);
        leg.coordinates.forEach(([lat, lng], j) => {
          expect(haversineM(lat, lng, exp.coordinates[j][0], exp.coordinates[j][1])).toBeLessThan(0.5);
        });
      });
    });

    it(`${name}: turn-by-turn instructions match`, () => {
      const got = run(c);
      expect(got.steps.map((s) => s.instruction)).toEqual(c.expected.steps.map((s) => s.instruction));
      expect(got.steps.map((s) => s.maneuver)).toEqual(c.expected.steps.map((s) => s.maneuver));
    });
  }
});

describe('offline campus router — regression: no straight line over buildings', () => {
  it('main-gate to CSE follows a multi-point network path, longer than the straight line', () => {
    const c = fixtures.find((f) => f.req.from_label === 'GATE-MAIN' && f.req.to_label === 'CSE' && f.req.mode === 'WALKING')!;
    const got = run(c);
    const walk = got.legs.find((l) => l.leg_type === 'WALK')!;
    expect(walk.coordinates.length).toBeGreaterThan(2);
    const straight = haversineM(c.req.from_lat, c.req.from_lng, c.req.to_lat, c.req.to_lng);
    expect(got.total_distance_m).toBeGreaterThan(straight);
    expect(got.steps.length).toBeGreaterThan(2);
  });

  it('vehicle routes contain a DRIVE leg on the road network', () => {
    const veh = fixtures.filter((f) => f.req.mode === 'VEHICLE');
    for (const c of veh) {
      expect(run(c).legs.some((l) => l.leg_type === 'DRIVE')).toBe(true);
    }
  });

  it('every route ends with an ARRIVE step at the destination', () => {
    for (const c of fixtures) {
      const steps = run(c).steps;
      expect(steps[steps.length - 1].maneuver).toBe('ARRIVE');
    }
  });
});
