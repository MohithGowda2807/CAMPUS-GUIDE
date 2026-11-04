from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.app.config.database import get_mongo_db

REPO_ROOT = Path(__file__).resolve().parents[3]
FALLBACK_SEED_PATH = REPO_ROOT / "database" / "seed_data" / "rvce_campus_routing_network.json"

WALK_SPEED_MPS = 1.35  # ~4.85 km/h comfortable campus walking pace
VEHICLE_SPEED_MPS = 4.45  # ~16 km/h internal campus speed limit


@dataclass(frozen=True)
class GraphEdge:
    edge_id: int
    u: str
    v: str
    u_lat: float
    u_lng: float
    v_lat: float
    v_lng: float
    highway: str
    path_class: str  # 'VEHICLE_AND_WALK' | 'WALK_ONLY'
    name: str
    oneway: str  # 'yes' | '-1' | 'no'
    is_steps: bool
    length_m: float


@dataclass(frozen=True)
class SnapPoint:
    edge: GraphEdge
    t: float
    lat: float
    lng: float
    snap_distance_m: float


class CampusRoutingGraph:
    def __init__(self, edges: list[GraphEdge]) -> None:
        self.edges = edges
        self.nodes: dict[str, tuple[float, float]] = {}
        self.walk_adj: dict[str, list[tuple[str, float, GraphEdge]]] = {}
        self.veh_adj: dict[str, list[tuple[str, float, GraphEdge]]] = {}

        for e in edges:
            self.nodes[e.u] = (e.u_lat, e.u_lng)
            self.nodes[e.v] = (e.v_lat, e.v_lng)

            # Walking uses BOTH double-line roads (VEHICLE_AND_WALK) and red-dashed paths (WALK_ONLY)
            step_penalty = 1.25 if e.is_steps else 1.0
            w_cost = e.length_m * step_penalty
            self.walk_adj.setdefault(e.u, []).append((e.v, w_cost, e))
            self.walk_adj.setdefault(e.v, []).append((e.u, w_cost, e))

            # Vehicle uses ONLY double-line roads (VEHICLE_AND_WALK) and respects oneway tags
            if e.path_class == "VEHICLE_AND_WALK":
                if e.oneway == "yes":
                    self.veh_adj.setdefault(e.u, []).append((e.v, e.length_m, e))
                elif e.oneway == "-1":
                    self.veh_adj.setdefault(e.v, []).append((e.u, e.length_m, e))
                else:
                    self.veh_adj.setdefault(e.u, []).append((e.v, e.length_m, e))
                    self.veh_adj.setdefault(e.v, []).append((e.u, e.length_m, e))


_cached_graph: CampusRoutingGraph | None = None


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2.0 * r * math.asin(min(1.0, math.sqrt(a)))


def project_point_to_segment(
    plat: float,
    plng: float,
    alat: float,
    alng: float,
    blat: float,
    blng: float,
) -> tuple[float, float, float, float]:
    cos_lat = math.cos(math.radians(12.92355))
    px = (plng - alng) * 111320.0 * cos_lat
    py = (plat - alat) * 110540.0
    bx = (blng - alng) * 111320.0 * cos_lat
    by = (blat - alat) * 110540.0
    l2 = bx * bx + by * by
    t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, (px * bx + py * by) / l2))
    qx = t * bx
    qy = t * by
    dist = math.hypot(px - qx, py - qy)
    qlat = alat + qy / 110540.0
    qlng = alng + qx / (111320.0 * cos_lat)
    return dist, t, round(qlat, 7), round(qlng, 7)


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def compass_direction(brg: float) -> str:
    dirs = [
        "north",
        "northeast",
        "east",
        "southeast",
        "south",
        "southwest",
        "west",
        "northwest",
    ]
    return dirs[int((brg + 22.5) // 45.0) % 8]


def _build_graph_from_fallback_file() -> CampusRoutingGraph:
    payload = json.loads(FALLBACK_SEED_PATH.read_text(encoding="utf-8"))
    nodes = payload["nodes"]
    edges: list[GraphEdge] = []
    for item in payload["edges"]:
        u_id = str(item["u"])
        v_id = str(item["v"])
        edges.append(
            GraphEdge(
                edge_id=int(item["edge_id"]),
                u=u_id,
                v=v_id,
                u_lat=float(nodes[u_id]["lat"]),
                u_lng=float(nodes[u_id]["lng"]),
                v_lat=float(nodes[v_id]["lat"]),
                v_lng=float(nodes[v_id]["lng"]),
                highway=item["highway"],
                path_class=item["path_class"],
                name=item.get("name", ""),
                oneway=item.get("oneway", "no"),
                is_steps=bool(item.get("is_steps", False)),
                length_m=float(item["length_m"]),
            )
        )
    return CampusRoutingGraph(edges)


async def get_campus_routing_graph() -> CampusRoutingGraph:
    global _cached_graph
    if _cached_graph is not None:
        return _cached_graph

    try:
        mdb = get_mongo_db()
        docs = await mdb.campus_pathways.find({}, {"_id": 0, "updated_at": 0}).to_list(length=2000)
        if docs:
            edges = [
                GraphEdge(
                    edge_id=int(d["edge_id"]),
                    u=str(d["u"]),
                    v=str(d["v"]),
                    u_lat=float(d["u_lat"]),
                    u_lng=float(d["u_lng"]),
                    v_lat=float(d["v_lat"]),
                    v_lng=float(d["v_lng"]),
                    highway=d["highway"],
                    path_class=d["path_class"],
                    name=d.get("name", ""),
                    oneway=d.get("oneway", "no"),
                    is_steps=bool(d.get("is_steps", False)),
                    length_m=float(d["length_m"]),
                )
                for d in docs
            ]
            _cached_graph = CampusRoutingGraph(edges)
            return _cached_graph
    except Exception:
        pass

    _cached_graph = _build_graph_from_fallback_file()
    return _cached_graph


def _snap_point(graph: CampusRoutingGraph, lat: float, lng: float, mode: str) -> SnapPoint:
    best: SnapPoint | None = None
    for e in graph.edges:
        if mode == "VEHICLE" and e.path_class != "VEHICLE_AND_WALK":
            continue
        dist, t, qlat, qlng = project_point_to_segment(
            lat, lng, e.u_lat, e.u_lng, e.v_lat, e.v_lng
        )
        if best is None or dist < best.snap_distance_m:
            best = SnapPoint(edge=e, t=t, lat=qlat, lng=qlng, snap_distance_m=dist)
    if best is None:
        raise ValueError("Routing graph has no eligible campus edges.")
    return best


def _solve_network_leg(
    graph: CampusRoutingGraph,
    start_snap: SnapPoint,
    end_snap: SnapPoint,
    mode: str,
) -> tuple[list[list[float]], list[GraphEdge], float]:
    """
    Finds exact shortest path between two snapped points on the campus network.
    Returns (polyline_lat_lng, traversed_edges, total_distance_m).
    """
    START_ID = "__START__"
    END_ID = "__END__"

    base_adj = graph.veh_adj if mode == "VEHICLE" else graph.walk_adj

    # Check direct same-edge travel
    se = start_snap.edge
    ee = end_snap.edge
    same_edge_dist: float | None = None
    if se.edge_id == ee.edge_id:
        allowed = True
        if mode == "VEHICLE":
            if se.oneway == "yes" and start_snap.t > end_snap.t + 1e-6:
                allowed = False
            elif se.oneway == "-1" and start_snap.t < end_snap.t - 1e-6:
                allowed = False
        if allowed:
            same_edge_dist = abs(end_snap.t - start_snap.t) * se.length_m

    # Virtual outgoing edges from START_ID
    start_out: list[tuple[str, float, GraphEdge]] = []
    dist_to_u = start_snap.t * se.length_m
    dist_to_v = (1.0 - start_snap.t) * se.length_m
    pen_s = 1.25 if (mode == "WALKING" and se.is_steps) else 1.0

    if mode == "WALKING":
        start_out.append((se.u, dist_to_u * pen_s, se))
        start_out.append((se.v, dist_to_v * pen_s, se))
    else:
        if se.oneway == "yes":
            start_out.append((se.v, dist_to_v, se))
        elif se.oneway == "-1":
            start_out.append((se.u, dist_to_u, se))
        else:
            start_out.append((se.u, dist_to_u, se))
            start_out.append((se.v, dist_to_v, se))

    # Virtual incoming costs to END_ID from ee.u and ee.v
    end_in: dict[str, tuple[float, GraphEdge]] = {}
    dist_from_u = end_snap.t * ee.length_m
    dist_from_v = (1.0 - end_snap.t) * ee.length_m
    pen_e = 1.25 if (mode == "WALKING" and ee.is_steps) else 1.0

    if mode == "WALKING":
        end_in[ee.u] = (dist_from_u * pen_e, ee)
        end_in[ee.v] = (dist_from_v * pen_e, ee)
    else:
        if ee.oneway == "yes":
            end_in[ee.u] = (dist_from_u, ee)
        elif ee.oneway == "-1":
            end_in[ee.v] = (dist_from_v, ee)
        else:
            end_in[ee.u] = (dist_from_u, ee)
            end_in[ee.v] = (dist_from_v, ee)

    # Dijkstra search
    dist_map: dict[str, float] = {START_ID: 0.0}
    prev_map: dict[str, tuple[str, GraphEdge]] = {}
    pq: list[tuple[float, str]] = [(0.0, START_ID)]

    if same_edge_dist is not None:
        same_cost = same_edge_dist * pen_s
        dist_map[END_ID] = same_cost
        prev_map[END_ID] = (START_ID, se)
        heapq.heappush(pq, (same_cost, END_ID))

    while pq:
        d_cur, u = heapq.heappop(pq)
        if d_cur > dist_map.get(u, float("inf")) + 1e-9:
            continue
        if u == END_ID:
            break

        neighbors = start_out if u == START_ID else base_adj.get(u, [])
        for nxt, w_cost, edge_obj in neighbors:
            nd = d_cur + w_cost
            if nd < dist_map.get(nxt, float("inf")):
                dist_map[nxt] = nd
                prev_map[nxt] = (u, edge_obj)
                heapq.heappush(pq, (nd, nxt))

        if u in end_in:
            add_cost, edge_end = end_in[u]
            nd_end = d_cur + add_cost
            if nd_end < dist_map.get(END_ID, float("inf")):
                dist_map[END_ID] = nd_end
                prev_map[END_ID] = (u, edge_end)
                heapq.heappush(pq, (nd_end, END_ID))

    if END_ID not in prev_map:
        raise ValueError("No valid campus route found between selected points.")

    # Reconstruct node & edge sequence
    node_chain: list[str] = []
    edge_chain: list[GraphEdge] = []
    cur = END_ID
    while cur != START_ID:
        p_node, p_edge = prev_map[cur]
        node_chain.append(cur)
        edge_chain.append(p_edge)
        cur = p_node
    node_chain.append(START_ID)
    node_chain.reverse()
    edge_chain.reverse()

    # Build deduplicated coordinate list + exact geometric length
    coords: list[list[float]] = [[start_snap.lat, start_snap.lng]]
    for nid in node_chain[1:-1]:
        nlat, nlng = graph.nodes[nid]
        if haversine_m(coords[-1][0], coords[-1][1], nlat, nlng) > 0.35:
            coords.append([nlat, nlng])
    if haversine_m(coords[-1][0], coords[-1][1], end_snap.lat, end_snap.lng) > 0.35:
        coords.append([end_snap.lat, end_snap.lng])
    elif len(coords) == 1:
        coords.append([end_snap.lat, end_snap.lng])

    total_m = sum(
        haversine_m(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
        for i in range(len(coords) - 1)
    )
    return coords, edge_chain, round(total_m, 1)


def _describe_edge(edge: GraphEdge, mode: str) -> str:
    raw_name = (edge.name or "").strip()
    if raw_name and raw_name not in ("Campus Walkway Connector",):
        return raw_name
    if edge.is_steps:
        return "Campus Pedestrian Steps"
    if edge.path_class == "WALK_ONLY":
        return "Campus Pedestrian Walkway"
    return "Campus Internal Road" if mode == "VEHICLE" else "Campus Roadway"


def _build_turn_steps(
    coords: list[list[float]],
    edges: list[GraphEdge],
    mode: str,
    prefix_verb: str,
) -> list[dict[str, Any]]:
    if len(coords) < 2:
        return []

    # Group consecutive edges with identical descriptive label unless sharp turn occurs
    segments: list[dict[str, Any]] = []
    n_seg = len(coords) - 1
    for i in range(n_seg):
        p1, p2 = coords[i], coords[i + 1]
        seg_len = haversine_m(p1[0], p1[1], p2[0], p2[1])
        if seg_len < 0.8:
            continue
        edge_ref = edges[min(i, len(edges) - 1)] if edges else None
        way_label = _describe_edge(edge_ref, mode) if edge_ref else "Campus Path"
        brg = bearing_deg(p1[0], p1[1], p2[0], p2[1])
        is_walk_only = bool(edge_ref and edge_ref.path_class == "WALK_ONLY")
        is_steps = bool(edge_ref and edge_ref.is_steps)
        segments.append(
            {
                "label": way_label,
                "len": seg_len,
                "start_brg": brg,
                "end_brg": brg,
                "coord": p1,
                "is_walk_only": is_walk_only,
                "is_steps": is_steps,
            }
        )

    if not segments:
        return []

    merged: list[dict[str, Any]] = [segments[0].copy()]
    for seg in segments[1:]:
        prev = merged[-1]
        delta = (seg["start_brg"] - prev["end_brg"] + 540.0) % 360.0 - 180.0
        same_label = seg["label"] == prev["label"]
        # Merge if same road/path name and no sharp turn, OR very short jog (< 12m) with gentle turn
        if (same_label and abs(delta) < 52.0) or (seg["len"] < 10.0 and abs(delta) < 35.0):
            prev["len"] += seg["len"]
            prev["end_brg"] = seg["end_brg"]
            prev["is_steps"] = prev["is_steps"] or seg["is_steps"]
        else:
            merged.append(seg.copy())

    steps: list[dict[str, Any]] = []
    for idx, m in enumerate(merged):
        dist_round = max(1, int(round(m["len"])))
        if idx == 0:
            cdir = compass_direction(m["start_brg"])
            instr = f"{prefix_verb} {cdir} on {m['label']}"
            maneuver = "DEPART"
        else:
            prev_brg = merged[idx - 1]["end_brg"]
            delta = (m["start_brg"] - prev_brg + 540.0) % 360.0 - 180.0
            if delta > 42.0:
                instr = f"Turn right onto {m['label']}"
                maneuver = "TURN_RIGHT"
            elif delta > 18.0:
                instr = f"Keep slight right onto {m['label']}"
                maneuver = "SLIGHT_RIGHT"
            elif delta < -42.0:
                instr = f"Turn left onto {m['label']}"
                maneuver = "TURN_LEFT"
            elif delta < -18.0:
                instr = f"Keep slight left onto {m['label']}"
                maneuver = "SLIGHT_LEFT"
            else:
                instr = f"Continue straight onto {m['label']}"
                maneuver = "CONTINUE"

        steps.append(
            {
                "instruction": instr,
                "distance_m": dist_round,
                "maneuver": maneuver,
                "path_type": "STEPS"
                if m["is_steps"]
                else ("WALKWAY" if m["is_walk_only"] else "ROAD"),
                "lat": m["coord"][0],
                "lng": m["coord"][1],
            }
        )
    return steps


async def compute_campus_route(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
    mode: str = "WALKING",
    from_label: str = "Starting Point",
    to_label: str = "Destination",
) -> dict[str, Any]:
    mode_norm = "VEHICLE" if mode.upper() == "VEHICLE" else "WALKING"
    graph = await get_campus_routing_graph()

    legs: list[dict[str, Any]] = []
    all_steps: list[dict[str, Any]] = []
    uses_steps = False
    walkway_m = 0.0
    road_m = 0.0

    if mode_norm == "WALKING":
        s_snap = _snap_point(graph, from_lat, from_lng, "WALKING")
        e_snap = _snap_point(graph, to_lat, to_lng, "WALKING")
        coords, edges, net_m = _solve_network_leg(graph, s_snap, e_snap, "WALKING")

        if s_snap.snap_distance_m > 2.5:
            legs.append(
                {
                    "leg_type": "ACCESS_CONNECTOR",
                    "distance_m": round(s_snap.snap_distance_m, 1),
                    "duration_seconds": max(1, int(round(s_snap.snap_distance_m / WALK_SPEED_MPS))),
                    "summary": "Access path to campus walkway",
                    "coordinates": [[from_lat, from_lng], [s_snap.lat, s_snap.lng]],
                }
            )

        dur_s = max(5, int(round(net_m / WALK_SPEED_MPS)))
        legs.append(
            {
                "leg_type": "WALK",
                "distance_m": net_m,
                "duration_seconds": dur_s,
                "summary": f"Walk to {to_label}",
                "coordinates": coords,
            }
        )

        if e_snap.snap_distance_m > 2.5:
            legs.append(
                {
                    "leg_type": "ACCESS_CONNECTOR",
                    "distance_m": round(e_snap.snap_distance_m, 1),
                    "duration_seconds": max(1, int(round(e_snap.snap_distance_m / WALK_SPEED_MPS))),
                    "summary": f"Entrance approach to {to_label}",
                    "coordinates": [[e_snap.lat, e_snap.lng], [to_lat, to_lng]],
                }
            )

        for e in edges:
            if e.is_steps:
                uses_steps = True
            if e.path_class == "WALK_ONLY":
                walkway_m += e.length_m
            else:
                road_m += e.length_m

        all_steps.extend(_build_turn_steps(coords, edges, "WALKING", "Walk"))
        all_steps.append(
            {
                "instruction": f"Arrive at {to_label}",
                "distance_m": 0,
                "maneuver": "ARRIVE",
                "path_type": "DESTINATION",
                "lat": to_lat,
                "lng": to_lng,
            }
        )
    else:
        # VEHICLE MODE: Strictly follows double-line campus roads (VEHICLE_AND_WALK).
        # If origin or destination sits inside a pedestrian-only courtyard (> 14m from nearest road),
        # seamlessly provides the short walking connector to/from the road drop-off point!
        v_start = _snap_point(graph, from_lat, from_lng, "VEHICLE")
        v_end = _snap_point(graph, to_lat, to_lng, "VEHICLE")

        # Optional initial walk to parked vehicle / nearest road if standing inside pedestrian zone
        used_start_walk = False
        if v_start.snap_distance_m > 32.0:
            ws_start = _snap_point(graph, from_lat, from_lng, "WALKING")
            ws_end = _snap_point(graph, v_start.lat, v_start.lng, "WALKING")
            w_coords, w_edges, w_m = _solve_network_leg(graph, ws_start, ws_end, "WALKING")
            if 4.0 < w_m <= v_start.snap_distance_m * 2.4:
                used_start_walk = True
                legs.append(
                    {
                        "leg_type": "WALK",
                        "distance_m": w_m,
                        "duration_seconds": max(5, int(round(w_m / WALK_SPEED_MPS))),
                        "summary": "Walk to nearest campus vehicle road",
                        "coordinates": [[from_lat, from_lng], *w_coords],
                    }
                )
                walkway_m += w_m
                all_steps.extend(_build_turn_steps(w_coords, w_edges, "WALKING", "Walk"))
        if not used_start_walk and v_start.snap_distance_m > 2.5:
            legs.append(
                {
                    "leg_type": "ACCESS_CONNECTOR",
                    "distance_m": round(v_start.snap_distance_m, 1),
                    "duration_seconds": max(3, int(round(v_start.snap_distance_m / WALK_SPEED_MPS))),
                    "summary": "Join campus road",
                    "coordinates": [[from_lat, from_lng], [v_start.lat, v_start.lng]],
                }
            )

        # Primary vehicle drive leg strictly on double-line roads
        d_coords, d_edges, d_m = _solve_network_leg(graph, v_start, v_end, "VEHICLE")
        d_dur = max(5, int(round(d_m / VEHICLE_SPEED_MPS)))
        legs.append(
            {
                "leg_type": "DRIVE",
                "distance_m": d_m,
                "duration_seconds": d_dur,
                "summary": f"Drive along campus roads toward {to_label}",
                "coordinates": d_coords,
            }
        )
        road_m += d_m
        all_steps.extend(_build_turn_steps(d_coords, d_edges, "VEHICLE", "Drive"))

        # Final pedestrian walk from road drop-off point if destination is inside pedestrian zone (e.g. Big Mingos)
        used_end_walk = False
        if v_end.snap_distance_m > 32.0:
            we_start = _snap_point(graph, v_end.lat, v_end.lng, "WALKING")
            we_end = _snap_point(graph, to_lat, to_lng, "WALKING")
            wt_coords, wt_edges, wt_m = _solve_network_leg(graph, we_start, we_end, "WALKING")
            if wt_m <= v_end.snap_distance_m * 2.4:
                used_end_walk = True
                full_tail = [[v_end.lat, v_end.lng], *wt_coords]
                if we_end.snap_distance_m > 2.5:
                    full_tail.append([to_lat, to_lng])
                tail_total_m = round(wt_m + we_end.snap_distance_m, 1)
                legs.append(
                    {
                        "leg_type": "WALK",
                        "distance_m": tail_total_m,
                        "duration_seconds": max(5, int(round(tail_total_m / WALK_SPEED_MPS))),
                        "summary": f"Walk from vehicle drop-off to {to_label}",
                        "coordinates": full_tail,
                    }
                )
                walkway_m += tail_total_m
                for e in wt_edges:
                    if e.is_steps:
                        uses_steps = True
                all_steps.append(
                    {
                        "instruction": f"Vehicle drop-off — continue on foot toward {to_label}",
                        "distance_m": int(round(tail_total_m)),
                        "maneuver": "DROPOFF_WALK",
                        "path_type": "WALKWAY",
                        "lat": v_end.lat,
                        "lng": v_end.lng,
                    }
                )
        if not used_end_walk and v_end.snap_distance_m > 2.5:
            legs.append(
                {
                    "leg_type": "ACCESS_CONNECTOR",
                    "distance_m": round(v_end.snap_distance_m, 1),
                    "duration_seconds": max(2, int(round(v_end.snap_distance_m / WALK_SPEED_MPS))),
                    "summary": f"Entrance approach to {to_label}",
                    "coordinates": [[v_end.lat, v_end.lng], [to_lat, to_lng]],
                }
            )

        all_steps.append(
            {
                "instruction": f"Arrive at {to_label}",
                "distance_m": 0,
                "maneuver": "ARRIVE",
                "path_type": "DESTINATION",
                "lat": to_lat,
                "lng": to_lng,
            }
        )

    total_distance_m = round(sum(leg["distance_m"] for leg in legs), 1)
    total_duration_s = sum(int(leg["duration_seconds"]) for leg in legs)

    return {
        "mode": mode_norm,
        "from": {"label": from_label, "lat": from_lat, "lng": from_lng},
        "to": {"label": to_label, "lat": to_lat, "lng": to_lng},
        "total_distance_m": total_distance_m,
        "total_duration_seconds": total_duration_s,
        "uses_steps": uses_steps,
        "breakdown": {
            "road_distance_m": round(road_m, 1),
            "walkway_distance_m": round(walkway_m, 1),
        },
        "legs": legs,
        "steps": all_steps,
    }
