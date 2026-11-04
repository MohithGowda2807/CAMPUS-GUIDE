/**
 * On-device campus router.
 *
 * Faithful TypeScript port of backend/app/services/routing.py, running on the SAME verified
 * OSM-derived pathway network (database/seed_data/rvce_campus_routing_network.json).
 * It is used when the API is unreachable so routes still follow the real roads (double-line,
 * vehicle + walk) and red-dashed walkways instead of a straight line over buildings.
 *
 * Parity with the backend is enforced by src/services/campusRouter.test.ts.
 */
import type { CampusRouteResponse, RouteLeg, RouteStep, TravelMode } from '../types/campus';
import { ROUTING_NETWORK, type RawEdge } from '../data/routingNetwork';

const WALK_SPEED_MPS = 1.35;
const VEHICLE_SPEED_MPS = 4.45;
const REF_LAT = 12.92355;

interface GraphEdge {
  edgeId: number;
  u: string;
  v: string;
  uLat: number;
  uLng: number;
  vLat: number;
  vLng: number;
  walkOnly: boolean;
  name: string;
  oneway: string;
  isSteps: boolean;
  lengthM: number;
}

interface SnapPoint {
  edge: GraphEdge;
  t: number;
  lat: number;
  lng: number;
  snapDistanceM: number;
}

type Adj = Map<string, Array<[string, number, GraphEdge]>>;

interface Graph {
  edges: GraphEdge[];
  nodes: Map<string, [number, number]>;
  walkAdj: Adj;
  vehAdj: Adj;
}

type Coord = [number, number]; // [lat, lng]

export class NoRouteError extends Error {
  constructor(message = 'No valid campus route found between selected points.') {
    super(message);
    this.name = 'NoRouteError';
  }
}

function push(adj: Adj, key: string, val: [string, number, GraphEdge]) {
  const list = adj.get(key);
  if (list) list.push(val);
  else adj.set(key, [val]);
}

function buildGraph(raw: RawEdge[], nodeTable: Record<string, [number, number]>): Graph {
  const edges: GraphEdge[] = raw.map(([edgeId, u, v, , pathClass, name, oneway, isSteps, lengthM]) => ({
    edgeId,
    u,
    v,
    uLat: nodeTable[u][0],
    uLng: nodeTable[u][1],
    vLat: nodeTable[v][0],
    vLng: nodeTable[v][1],
    walkOnly: pathClass === 1,
    name,
    oneway,
    isSteps: isSteps === 1,
    lengthM,
  }));

  const nodes = new Map<string, [number, number]>();
  const walkAdj: Adj = new Map();
  const vehAdj: Adj = new Map();

  for (const e of edges) {
    nodes.set(e.u, [e.uLat, e.uLng]);
    nodes.set(e.v, [e.vLat, e.vLng]);

    const wCost = e.lengthM * (e.isSteps ? 1.25 : 1.0);
    push(walkAdj, e.u, [e.v, wCost, e]);
    push(walkAdj, e.v, [e.u, wCost, e]);

    if (!e.walkOnly) {
      if (e.oneway === 'yes') {
        push(vehAdj, e.u, [e.v, e.lengthM, e]);
      } else if (e.oneway === '-1') {
        push(vehAdj, e.v, [e.u, e.lengthM, e]);
      } else {
        push(vehAdj, e.u, [e.v, e.lengthM, e]);
        push(vehAdj, e.v, [e.u, e.lengthM, e]);
      }
    }
  }
  return { edges, nodes, walkAdj, vehAdj };
}

let cachedGraph: Graph | null = null;
function getGraph(): Graph {
  if (!cachedGraph) cachedGraph = buildGraph(ROUTING_NETWORK.edges, ROUTING_NETWORK.nodes);
  return cachedGraph;
}

/* ----------------------------- geometry helpers ----------------------------- */

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2.0 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  // Match Python's round-half-to-even closely enough for display; parity test uses tolerance.
  return Math.round(n * f) / f;
}

function projectPointToSegment(
  plat: number,
  plng: number,
  alat: number,
  alng: number,
  blat: number,
  blng: number
): { dist: number; t: number; lat: number; lng: number } {
  const cosLat = Math.cos((REF_LAT * Math.PI) / 180);
  const px = (plng - alng) * 111320.0 * cosLat;
  const py = (plat - alat) * 110540.0;
  const bx = (blng - alng) * 111320.0 * cosLat;
  const by = (blat - alat) * 110540.0;
  const l2 = bx * bx + by * by;
  const t = l2 < 1e-12 ? 0.0 : Math.max(0.0, Math.min(1.0, (px * bx + py * by) / l2));
  const qx = t * bx;
  const qy = t * by;
  const dist = Math.hypot(px - qx, py - qy);
  return {
    dist,
    t,
    lat: round(alat + qy / 110540.0, 7),
    lng: round(alng + qx / (111320.0 * cosLat), 7),
  };
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360.0) % 360.0;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function compassDirection(brg: number): string {
  return COMPASS[Math.floor((brg + 22.5) / 45.0) % 8];
}

function snapPoint(graph: Graph, lat: number, lng: number, mode: TravelMode): SnapPoint {
  let best: SnapPoint | null = null;
  for (const e of graph.edges) {
    if (mode === 'VEHICLE' && e.walkOnly) continue;
    const p = projectPointToSegment(lat, lng, e.uLat, e.uLng, e.vLat, e.vLng);
    if (best === null || p.dist < best.snapDistanceM) {
      best = { edge: e, t: p.t, lat: p.lat, lng: p.lng, snapDistanceM: p.dist };
    }
  }
  if (best === null) throw new NoRouteError('Routing graph has no eligible campus edges.');
  return best;
}

/* ------------------------------ min-heap (PQ) ------------------------------ */

class MinHeap {
  private items: Array<[number, string]> = [];
  get size() {
    return this.items.length;
  }
  push(item: [number, string]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): [number, string] | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/* --------------------------------- solver --------------------------------- */

const START_ID = '__START__';
const END_ID = '__END__';

function solveNetworkLeg(
  graph: Graph,
  startSnap: SnapPoint,
  endSnap: SnapPoint,
  mode: TravelMode
): { coords: Coord[]; edges: GraphEdge[]; totalM: number } {
  const baseAdj = mode === 'VEHICLE' ? graph.vehAdj : graph.walkAdj;
  const se = startSnap.edge;
  const ee = endSnap.edge;

  let sameEdgeDist: number | null = null;
  if (se.edgeId === ee.edgeId) {
    let allowed = true;
    if (mode === 'VEHICLE') {
      if (se.oneway === 'yes' && startSnap.t > endSnap.t + 1e-6) allowed = false;
      else if (se.oneway === '-1' && startSnap.t < endSnap.t - 1e-6) allowed = false;
    }
    if (allowed) sameEdgeDist = Math.abs(endSnap.t - startSnap.t) * se.lengthM;
  }

  const startOut: Array<[string, number, GraphEdge]> = [];
  const distToU = startSnap.t * se.lengthM;
  const distToV = (1.0 - startSnap.t) * se.lengthM;
  const penS = mode === 'WALKING' && se.isSteps ? 1.25 : 1.0;

  if (mode === 'WALKING') {
    startOut.push([se.u, distToU * penS, se]);
    startOut.push([se.v, distToV * penS, se]);
  } else if (se.oneway === 'yes') {
    startOut.push([se.v, distToV, se]);
  } else if (se.oneway === '-1') {
    startOut.push([se.u, distToU, se]);
  } else {
    startOut.push([se.u, distToU, se]);
    startOut.push([se.v, distToV, se]);
  }

  const endIn = new Map<string, [number, GraphEdge]>();
  const distFromU = endSnap.t * ee.lengthM;
  const distFromV = (1.0 - endSnap.t) * ee.lengthM;
  const penE = mode === 'WALKING' && ee.isSteps ? 1.25 : 1.0;

  if (mode === 'WALKING') {
    endIn.set(ee.u, [distFromU * penE, ee]);
    endIn.set(ee.v, [distFromV * penE, ee]);
  } else if (ee.oneway === 'yes') {
    endIn.set(ee.u, [distFromU, ee]);
  } else if (ee.oneway === '-1') {
    endIn.set(ee.v, [distFromV, ee]);
  } else {
    endIn.set(ee.u, [distFromU, ee]);
    endIn.set(ee.v, [distFromV, ee]);
  }

  const distMap = new Map<string, number>([[START_ID, 0.0]]);
  const prevMap = new Map<string, [string, GraphEdge]>();
  const pq = new MinHeap();
  pq.push([0.0, START_ID]);

  if (sameEdgeDist !== null) {
    const sameCost = sameEdgeDist * penS;
    distMap.set(END_ID, sameCost);
    prevMap.set(END_ID, [START_ID, se]);
    pq.push([sameCost, END_ID]);
  }

  for (;;) {
    const popped = pq.pop();
    if (!popped) break;
    const [dCur, u] = popped;
    if (dCur > (distMap.get(u) ?? Infinity) + 1e-9) continue;
    if (u === END_ID) break;

    const neighbors = u === START_ID ? startOut : (baseAdj.get(u) ?? []);
    for (const [nxt, wCost, edgeObj] of neighbors) {
      const nd = dCur + wCost;
      if (nd < (distMap.get(nxt) ?? Infinity)) {
        distMap.set(nxt, nd);
        prevMap.set(nxt, [u, edgeObj]);
        pq.push([nd, nxt]);
      }
    }

    const endLink = endIn.get(u);
    if (endLink) {
      const [addCost, edgeEnd] = endLink;
      const ndEnd = dCur + addCost;
      if (ndEnd < (distMap.get(END_ID) ?? Infinity)) {
        distMap.set(END_ID, ndEnd);
        prevMap.set(END_ID, [u, edgeEnd]);
        pq.push([ndEnd, END_ID]);
      }
    }
  }

  if (!prevMap.has(END_ID)) throw new NoRouteError();

  const nodeChain: string[] = [];
  const edgeChain: GraphEdge[] = [];
  let cur = END_ID;
  while (cur !== START_ID) {
    const [pNode, pEdge] = prevMap.get(cur)!;
    nodeChain.push(cur);
    edgeChain.push(pEdge);
    cur = pNode;
  }
  nodeChain.push(START_ID);
  nodeChain.reverse();
  edgeChain.reverse();

  const coords: Coord[] = [[startSnap.lat, startSnap.lng]];
  for (const nid of nodeChain.slice(1, -1)) {
    const [nlat, nlng] = graph.nodes.get(nid)!;
    const last = coords[coords.length - 1];
    if (haversineM(last[0], last[1], nlat, nlng) > 0.35) coords.push([nlat, nlng]);
  }
  const last = coords[coords.length - 1];
  if (haversineM(last[0], last[1], endSnap.lat, endSnap.lng) > 0.35) {
    coords.push([endSnap.lat, endSnap.lng]);
  } else if (coords.length === 1) {
    coords.push([endSnap.lat, endSnap.lng]);
  }

  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineM(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
  }
  return { coords, edges: edgeChain, totalM: round(total, 1) };
}

/* ------------------------------ turn-by-turn ------------------------------ */

function describeEdge(edge: GraphEdge, mode: TravelMode): string {
  const raw = (edge.name || '').trim();
  if (raw && raw !== 'Campus Walkway Connector') return raw;
  if (edge.isSteps) return 'Campus Pedestrian Steps';
  if (edge.walkOnly) return 'Campus Pedestrian Walkway';
  return mode === 'VEHICLE' ? 'Campus Internal Road' : 'Campus Roadway';
}

interface Segment {
  label: string;
  len: number;
  startBrg: number;
  endBrg: number;
  coord: Coord;
  isWalkOnly: boolean;
  isSteps: boolean;
}

function buildTurnSteps(
  coords: Coord[],
  edges: GraphEdge[],
  mode: TravelMode,
  prefixVerb: string
): RouteStep[] {
  if (coords.length < 2) return [];

  const segments: Segment[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const segLen = haversineM(p1[0], p1[1], p2[0], p2[1]);
    if (segLen < 0.8) continue;
    const edgeRef = edges.length ? edges[Math.min(i, edges.length - 1)] : null;
    const brg = bearingDeg(p1[0], p1[1], p2[0], p2[1]);
    segments.push({
      label: edgeRef ? describeEdge(edgeRef, mode) : 'Campus Path',
      len: segLen,
      startBrg: brg,
      endBrg: brg,
      coord: p1,
      isWalkOnly: !!edgeRef && edgeRef.walkOnly,
      isSteps: !!edgeRef && edgeRef.isSteps,
    });
  }
  if (segments.length === 0) return [];

  const merged: Segment[] = [{ ...segments[0] }];
  for (const seg of segments.slice(1)) {
    const prev = merged[merged.length - 1];
    const delta = ((seg.startBrg - prev.endBrg + 540.0) % 360.0) - 180.0;
    const sameLabel = seg.label === prev.label;
    if ((sameLabel && Math.abs(delta) < 52.0) || (seg.len < 10.0 && Math.abs(delta) < 35.0)) {
      prev.len += seg.len;
      prev.endBrg = seg.endBrg;
      prev.isSteps = prev.isSteps || seg.isSteps;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged.map((m, idx): RouteStep => {
    const distRound = Math.max(1, Math.round(m.len));
    let instruction: string;
    let maneuver: RouteStep['maneuver'];
    if (idx === 0) {
      instruction = `${prefixVerb} ${compassDirection(m.startBrg)} on ${m.label}`;
      maneuver = 'DEPART';
    } else {
      const prevBrg = merged[idx - 1].endBrg;
      const delta = ((m.startBrg - prevBrg + 540.0) % 360.0) - 180.0;
      if (delta > 42.0) {
        instruction = `Turn right onto ${m.label}`;
        maneuver = 'TURN_RIGHT';
      } else if (delta > 18.0) {
        instruction = `Keep slight right onto ${m.label}`;
        maneuver = 'SLIGHT_RIGHT';
      } else if (delta < -42.0) {
        instruction = `Turn left onto ${m.label}`;
        maneuver = 'TURN_LEFT';
      } else if (delta < -18.0) {
        instruction = `Keep slight left onto ${m.label}`;
        maneuver = 'SLIGHT_LEFT';
      } else {
        instruction = `Continue straight onto ${m.label}`;
        maneuver = 'CONTINUE';
      }
    }
    return {
      instruction,
      distance_m: distRound,
      maneuver,
      path_type: m.isSteps ? 'STEPS' : m.isWalkOnly ? 'WALKWAY' : 'ROAD',
      lat: m.coord[0],
      lng: m.coord[1],
    };
  });
}

/* ------------------------------- public API ------------------------------- */

export interface RouteRequest {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: TravelMode;
  fromLabel?: string;
  toLabel?: string;
}

export function computeCampusRouteOffline(req: RouteRequest): CampusRouteResponse {
  const { fromLat, fromLng, toLat, toLng } = req;
  const mode: TravelMode = req.mode === 'VEHICLE' ? 'VEHICLE' : 'WALKING';
  const fromLabel = req.fromLabel?.trim() || 'Starting Point';
  const toLabel = req.toLabel?.trim() || 'Destination';
  const graph = getGraph();

  const legs: RouteLeg[] = [];
  const allSteps: RouteStep[] = [];
  let usesSteps = false;
  let walkwayM = 0;
  let roadM = 0;

  const connector = (a: Coord, b: Coord, dist: number, summary: string, minSec: number): RouteLeg => ({
    leg_type: 'ACCESS_CONNECTOR',
    distance_m: round(dist, 1),
    duration_seconds: Math.max(minSec, Math.round(dist / WALK_SPEED_MPS)),
    summary,
    coordinates: [a, b],
  });

  if (mode === 'WALKING') {
    const sSnap = snapPoint(graph, fromLat, fromLng, 'WALKING');
    const eSnap = snapPoint(graph, toLat, toLng, 'WALKING');
    const { coords, edges, totalM } = solveNetworkLeg(graph, sSnap, eSnap, 'WALKING');

    if (sSnap.snapDistanceM > 2.5) {
      legs.push(
        connector([fromLat, fromLng], [sSnap.lat, sSnap.lng], sSnap.snapDistanceM, 'Access path to campus walkway', 1)
      );
    }
    legs.push({
      leg_type: 'WALK',
      distance_m: totalM,
      duration_seconds: Math.max(5, Math.round(totalM / WALK_SPEED_MPS)),
      summary: `Walk to ${toLabel}`,
      coordinates: coords,
    });
    if (eSnap.snapDistanceM > 2.5) {
      legs.push(
        connector([eSnap.lat, eSnap.lng], [toLat, toLng], eSnap.snapDistanceM, `Entrance approach to ${toLabel}`, 1)
      );
    }
    for (const e of edges) {
      if (e.isSteps) usesSteps = true;
      if (e.walkOnly) walkwayM += e.lengthM;
      else roadM += e.lengthM;
    }
    allSteps.push(...buildTurnSteps(coords, edges, 'WALKING', 'Walk'));
    allSteps.push({
      instruction: `Arrive at ${toLabel}`,
      distance_m: 0,
      maneuver: 'ARRIVE',
      path_type: 'DESTINATION',
      lat: toLat,
      lng: toLng,
    });
  } else {
    const vStart = snapPoint(graph, fromLat, fromLng, 'VEHICLE');
    const vEnd = snapPoint(graph, toLat, toLng, 'VEHICLE');

    let usedStartWalk = false;
    if (vStart.snapDistanceM > 32.0) {
      const wsStart = snapPoint(graph, fromLat, fromLng, 'WALKING');
      const wsEnd = snapPoint(graph, vStart.lat, vStart.lng, 'WALKING');
      const w = solveNetworkLeg(graph, wsStart, wsEnd, 'WALKING');
      if (w.totalM > 4.0 && w.totalM <= vStart.snapDistanceM * 2.4) {
        usedStartWalk = true;
        legs.push({
          leg_type: 'WALK',
          distance_m: w.totalM,
          duration_seconds: Math.max(5, Math.round(w.totalM / WALK_SPEED_MPS)),
          summary: 'Walk to nearest campus vehicle road',
          coordinates: [[fromLat, fromLng], ...w.coords],
        });
        walkwayM += w.totalM;
        allSteps.push(...buildTurnSteps(w.coords, w.edges, 'WALKING', 'Walk'));
      }
    }
    if (!usedStartWalk && vStart.snapDistanceM > 2.5) {
      legs.push(connector([fromLat, fromLng], [vStart.lat, vStart.lng], vStart.snapDistanceM, 'Join campus road', 3));
    }

    const d = solveNetworkLeg(graph, vStart, vEnd, 'VEHICLE');
    legs.push({
      leg_type: 'DRIVE',
      distance_m: d.totalM,
      duration_seconds: Math.max(5, Math.round(d.totalM / VEHICLE_SPEED_MPS)),
      summary: `Drive along campus roads toward ${toLabel}`,
      coordinates: d.coords,
    });
    roadM += d.totalM;
    allSteps.push(...buildTurnSteps(d.coords, d.edges, 'VEHICLE', 'Drive'));

    let usedEndWalk = false;
    if (vEnd.snapDistanceM > 32.0) {
      const weStart = snapPoint(graph, vEnd.lat, vEnd.lng, 'WALKING');
      const weEnd = snapPoint(graph, toLat, toLng, 'WALKING');
      const t = solveNetworkLeg(graph, weStart, weEnd, 'WALKING');
      if (t.totalM <= vEnd.snapDistanceM * 2.4) {
        usedEndWalk = true;
        const fullTail: Coord[] = [[vEnd.lat, vEnd.lng], ...t.coords];
        if (weEnd.snapDistanceM > 2.5) fullTail.push([toLat, toLng]);
        const tailTotal = round(t.totalM + weEnd.snapDistanceM, 1);
        legs.push({
          leg_type: 'WALK',
          distance_m: tailTotal,
          duration_seconds: Math.max(5, Math.round(tailTotal / WALK_SPEED_MPS)),
          summary: `Walk from vehicle drop-off to ${toLabel}`,
          coordinates: fullTail,
        });
        walkwayM += tailTotal;
        if (t.edges.some((e) => e.isSteps)) usesSteps = true;
        allSteps.push({
          instruction: `Vehicle drop-off — continue on foot toward ${toLabel}`,
          distance_m: Math.round(tailTotal),
          maneuver: 'DROPOFF_WALK',
          path_type: 'WALKWAY',
          lat: vEnd.lat,
          lng: vEnd.lng,
        });
      }
    }
    if (!usedEndWalk && vEnd.snapDistanceM > 2.5) {
      legs.push(connector([vEnd.lat, vEnd.lng], [toLat, toLng], vEnd.snapDistanceM, `Entrance approach to ${toLabel}`, 2));
    }
    allSteps.push({
      instruction: `Arrive at ${toLabel}`,
      distance_m: 0,
      maneuver: 'ARRIVE',
      path_type: 'DESTINATION',
      lat: toLat,
      lng: toLng,
    });
  }

  return {
    mode,
    from: { label: fromLabel, lat: fromLat, lng: fromLng },
    to: { label: toLabel, lat: toLat, lng: toLng },
    total_distance_m: round(legs.reduce((s, l) => s + l.distance_m, 0), 1),
    total_duration_seconds: legs.reduce((s, l) => s + l.duration_seconds, 0),
    uses_steps: usesSteps,
    breakdown: { road_distance_m: round(roadM, 1), walkway_distance_m: round(walkwayM, 1) },
    legs,
    steps: allSteps,
  };
}
