from __future__ import annotations

from datetime import date, datetime, timezone
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.config.database import get_db_connection, get_mongo_db
from backend.app.config.settings import get_settings
from backend.app.services.campus_rag import answer_campus_query
from backend.app.services.routing import compute_campus_route

router = APIRouter(tags=["Public Campus Navigation & Directory"])


def _serialize_row(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
            out[k] = float(v)
        elif isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


@router.get("/map/config")
async def get_map_configuration(conn: Connection = Depends(get_db_connection)) -> dict[str, Any]:
    settings = get_settings()
    campus = conn.execute(
        text(
            """
            SELECT campus_id, campus_code, campus_name, address, latitude, longitude,
                   default_zoom, verification_status
            FROM campuses
            WHERE status = 'ACTIVE'
            ORDER BY campus_id ASC
            LIMIT 1
            """
        )
    ).mappings().first()

    geometries: list[dict[str, Any]] = []
    try:
        mdb = get_mongo_db()
        cursor = mdb.campus_geometries.find({}, {"_id": 0})
        geometries = await cursor.to_list(length=200)
        for doc in geometries:
            if isinstance(doc.get("updated_at"), datetime):
                doc["updated_at"] = doc["updated_at"].isoformat()
    except Exception:
        geometries = []

    campus_dict = _serialize_row(campus) if campus else {
        "campus_id": 1,
        "campus_code": "RVCE-MAIN",
        "campus_name": "R. V. College of Engineering",
        "address": "RV Vidyaniketan Post, 8th Mile, Mysuru Road, Bengaluru, Karnataka 560059",
        "latitude": settings.MAP_DEFAULT_LAT,
        "longitude": settings.MAP_DEFAULT_LNG,
        "default_zoom": settings.MAP_DEFAULT_ZOOM,
        "verification_status": "PENDING_REVIEW",
    }

    return {
        "center": {
            "lat": campus_dict["latitude"],
            "lng": campus_dict["longitude"],
            "zoom": campus_dict["default_zoom"],
        },
        "tile_layer": {
            "url": settings.MAP_TILE_URL,
            "attribution": settings.MAP_ATTRIBUTION,
        },
        "campus": campus_dict,
        "geometries": geometries,
    }


@router.get("/buildings")
def list_public_buildings(
    building_type: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: dict[str, Any] = {}
    if building_type:
        clauses.append("building_type = :btype")
        params["btype"] = building_type
    if q and q.strip():
        clauses.append("(building_name LIKE :q OR building_code LIKE :q OR description LIKE :q)")
        params["q"] = f"%{q.strip()}%"

    sql = f"""
        SELECT *
        FROM vw_public_building_directory
        WHERE {' AND '.join(clauses)}
        ORDER BY building_name ASC
    """
    rows = conn.execute(text(sql), params).mappings().all()
    return [_serialize_row(r) for r in rows]


@router.get("/buildings/{building_id}")
async def get_building_detail(
    building_id: int,
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    bldg = conn.execute(
        text("SELECT * FROM vw_public_building_directory WHERE building_id = :bid"),
        {"bid": building_id},
    ).mappings().first()
    if not bldg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building not found.")

    floors = conn.execute(
        text(
            """
            SELECT f.floor_id, f.floor_number, f.floor_name, f.display_order, f.has_lift_access,
                   (SELECT COUNT(*) FROM rooms r WHERE r.floor_id = f.floor_id AND r.public_visibility = TRUE AND r.status = 'ACTIVE') AS room_count,
                   EXISTS (
                       SELECT 1 FROM floor_plans fp
                       WHERE fp.floor_id = f.floor_id AND fp.is_active_public = TRUE AND fp.approval_status = 'APPROVED'
                   ) AS has_floor_plan
            FROM floors f
            WHERE f.building_id = :bid AND f.status = 'ACTIVE'
            ORDER BY f.display_order ASC, f.floor_number ASC
            """
        ),
        {"bid": building_id},
    ).mappings().all()

    facilities = conn.execute(
        text(
            """
            SELECT facility_id, facility_name, category, description, floor_id, room_id,
                   latitude, longitude, opening_hours, is_accessible, verification_status
            FROM facilities
            WHERE building_id = :bid AND public_visibility = TRUE AND status = 'ACTIVE'
            ORDER BY facility_name ASC
            """
        ),
        {"bid": building_id},
    ).mappings().all()

    footprint = None
    try:
        mdb = get_mongo_db()
        fp_doc = await mdb.campus_geometries.find_one(
            {"entity_type": "BUILDING_FOOTPRINT", "mysql_id": building_id},
            {"_id": 0, "updated_at": 0},
        )
        footprint = fp_doc
    except Exception:
        footprint = None

    return {
        "building": _serialize_row(bldg),
        "floors": [_serialize_row(f) for f in floors],
        "facilities": [_serialize_row(fc) for fc in facilities],
        "footprint": footprint,
    }


def _build_resilient_floor_overlay(
    floor_row: Any,
    plan_row: Any,
    rooms: list[Any],
) -> dict[str, Any] | None:
    """
    Provides an exact architectural vector overlay fallback when MongoDB is offline,
    keeping EEE 3-floor interactive SVG maps and all approved floor plans operational.
    """
    if not plan_row or not rooms:
        return None

    fid = int(floor_row["floor_id"])
    bid = int(floor_row["building_id"])
    fnum = int(floor_row["floor_number"])

    eee_bounds_by_floor: dict[int, dict[str, dict[str, int]]] = {
        0: {
            "EEE-006": {"x": 60, "y": 70, "w": 300, "h": 75},
            "EEE-005": {"x": 60, "y": 155, "w": 300, "h": 75},
            "EEE-004": {"x": 60, "y": 240, "w": 300, "h": 75},
            "EEE-003": {"x": 60, "y": 325, "w": 300, "h": 75},
            "EEE-002": {"x": 60, "y": 410, "w": 300, "h": 75},
            "EEE-001": {"x": 60, "y": 495, "w": 300, "h": 85},
            "EEE-007": {"x": 380, "y": 70, "w": 240, "h": 110},
            "EEE-010": {"x": 640, "y": 70, "w": 300, "h": 65},
            "EEE-011": {"x": 640, "y": 150, "w": 300, "h": 150},
            "EEE-011A": {"x": 640, "y": 315, "w": 300, "h": 120},
            "EEE-011B": {"x": 640, "y": 450, "w": 300, "h": 130},
        },
        1: {
            "EEE-105": {"x": 60, "y": 70, "w": 300, "h": 95},
            "EEE-104": {"x": 60, "y": 175, "w": 300, "h": 95},
            "EEE-103": {"x": 60, "y": 280, "w": 300, "h": 95},
            "EEE-102": {"x": 60, "y": 385, "w": 300, "h": 95},
            "EEE-101": {"x": 60, "y": 490, "w": 300, "h": 90},
            "EEE-107": {"x": 380, "y": 70, "w": 240, "h": 105},
            "EEE-117": {"x": 380, "y": 495, "w": 240, "h": 85},
            "EEE-108": {"x": 640, "y": 70, "w": 300, "h": 65},
            "EEE-112": {"x": 640, "y": 145, "w": 300, "h": 75},
            "EEE-113": {"x": 640, "y": 230, "w": 300, "h": 75},
            "EEE-114": {"x": 640, "y": 315, "w": 300, "h": 75},
            "EEE-115": {"x": 640, "y": 400, "w": 300, "h": 90},
            "EEE-116": {"x": 640, "y": 500, "w": 300, "h": 80},
        },
        2: {
            "EEE-205": {"x": 60, "y": 70, "w": 300, "h": 80},
            "EEE-204": {"x": 60, "y": 160, "w": 300, "h": 80},
            "EEE-203": {"x": 60, "y": 250, "w": 300, "h": 80},
            "EEE-202B": {"x": 60, "y": 340, "w": 300, "h": 80},
            "EEE-202A": {"x": 60, "y": 430, "w": 300, "h": 80},
            "EEE-201": {"x": 60, "y": 520, "w": 300, "h": 80},
            "EEE-207": {"x": 380, "y": 70, "w": 240, "h": 105},
            "EEE-215": {"x": 380, "y": 495, "w": 240, "h": 85},
            "EEE-208": {"x": 640, "y": 70, "w": 300, "h": 65},
            "EEE-ECH": {"x": 640, "y": 150, "w": 300, "h": 230},
            "EEE-214": {"x": 640, "y": 395, "w": 300, "h": 185},
        },
    }

    bounds_map = eee_bounds_by_floor.get(fnum, {}) if floor_row["building_code"] == "EEE" else {}
    ov_rooms: list[dict[str, Any]] = []

    for idx, r in enumerate(rooms):
        rnum = str(r["room_number"])
        b = bounds_map.get(rnum)
        if not b:
            col = idx % 2
            row_i = idx // 2
            b = {
                "x": 70 if col == 0 else 530,
                "y": 75 + row_i * 95,
                "w": 400,
                "h": 80,
            }
        ov_rooms.append(
            {
                "room_id": int(r["room_id"]),
                "room_number": rnum,
                "label": str(r["room_name"]),
                "category": str(r["room_type"]),
                "bounds": b,
            }
        )

    return {
        "floor_plan_id": int(plan_row["floor_plan_id"]),
        "floor_id": fid,
        "building_id": bid,
        "coordinate_space": str(plan_row["coordinate_space"] or "NORMALIZED_1000"),
        "is_schematic_sample": bool(plan_row["is_schematic_sample"]),
        "canvas": {
            "width": int(plan_row["canvas_width"] or 1000),
            "height": int(plan_row["canvas_height"] or 680),
        },
        "corridors": [
            {"x": 360, "y": 60, "w": 20, "h": 540, "label": "West Wing Corridor"},
            {"x": 620, "y": 60, "w": 20, "h": 540, "label": "East Wing Corridor"},
            {"x": 360, "y": 180, "w": 280, "h": 20, "label": "Cross Corridor North"},
            {"x": 360, "y": 470, "w": 280, "h": 20, "label": "Cross Corridor South"},
        ],
        "landmarks": [
            {"type": "STAIRS", "x": 370, "y": 50, "label": "North Staircase"},
            {"type": "STAIRS", "x": 370, "y": 610, "label": "South Staircase"},
            {"type": "LIFT", "x": 630, "y": 50, "label": "Elevator"},
            {"type": "ENTRANCE", "x": 500, "y": 630, "label": "Main Floor Access"},
        ],
        "rooms": ov_rooms,
    }


@router.get("/floors/{floor_id}/floor-plan")
async def get_floor_plan_and_rooms(
    floor_id: int,
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    floor_row = conn.execute(
        text(
            """
            SELECT f.floor_id, f.floor_number, f.floor_name, f.has_lift_access,
                   b.building_id, b.building_code, b.building_name, b.verification_status
            FROM floors f
            INNER JOIN buildings b ON b.building_id = f.building_id
            WHERE f.floor_id = :fid AND f.status = 'ACTIVE' AND b.status <> 'INACTIVE'
            """
        ),
        {"fid": floor_id},
    ).mappings().first()

    if not floor_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Floor not found.")

    plan_row = conn.execute(
        text(
            """
            SELECT floor_plan_id, floor_id, version_label, asset_url, file_format,
                   canvas_width, canvas_height, coordinate_space, source_reference,
                   approval_status, is_schematic_sample, approved_at
            FROM floor_plans
            WHERE floor_id = :fid AND is_active_public = TRUE AND approval_status = 'APPROVED'
            ORDER BY approved_at DESC, floor_plan_id DESC
            LIMIT 1
            """
        ),
        {"fid": floor_id},
    ).mappings().first()

    rooms = conn.execute(
        text(
            """
            SELECT room_id, room_number, room_name, room_type, capacity, description,
                   is_accessible, verification_status, dept_code, dept_name
            FROM vw_public_room_directory
            WHERE floor_id = :fid
            ORDER BY room_number ASC
            """
        ),
        {"fid": floor_id},
    ).mappings().all()

    overlay = None
    if plan_row:
        try:
            mdb = get_mongo_db()
            ov_doc = await mdb.floor_plan_overlays.find_one(
                {"floor_plan_id": plan_row["floor_plan_id"]},
                {"_id": 0, "updated_at": 0},
            )
            overlay = ov_doc
        except Exception:
            overlay = None

        if overlay is None:
            overlay = _build_resilient_floor_overlay(floor_row, plan_row, rooms)

    return {
        "floor": _serialize_row(floor_row),
        "floor_plan": _serialize_row(plan_row) if plan_row else None,
        "overlay": overlay,
        "rooms": [_serialize_row(r) for r in rooms],
    }


@router.get("/rooms/{room_id}")
def get_room_detail(
    room_id: int,
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    room = conn.execute(
        text("SELECT * FROM vw_public_room_directory WHERE room_id = :rid"),
        {"rid": room_id},
    ).mappings().first()
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found.")

    occupants = conn.execute(
        text(
            """
            SELECT staff_id, display_name, designation, dept_code, dept_name,
                   effective_availability, availability_updated_at
            FROM vw_public_faculty_directory
            WHERE office_room_id = :rid
            ORDER BY display_name ASC
            """
        ),
        {"rid": room_id},
    ).mappings().all()

    return {
        "room": _serialize_row(room),
        "occupants": [_serialize_row(o) for o in occupants],
    }


@router.get("/departments")
def list_departments(conn: Connection = Depends(get_db_connection)) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            SELECT *
            FROM vw_department_directory
            ORDER BY
                CASE dept_category
                    WHEN 'ENGINEERING' THEN 1
                    WHEN 'PG_PROGRAMME' THEN 2
                    WHEN 'BASIC_SCIENCES' THEN 3
                    WHEN 'CAMPUS_CENTRAL' THEN 4
                    ELSE 5
                END,
                dept_name ASC
            """
        )
    ).mappings().all()
    return [_serialize_row(r) for r in rows]


@router.get("/faculty")
def list_public_faculty(
    dept_id: int | None = Query(default=None),
    cadre: str | None = Query(
        default=None,
        description="Optional filter: LEADERSHIP, PROFESSOR, ASSOCIATE_PROFESSOR, ASSISTANT_PROFESSOR, VISITING",
    ),
    qualification: str | None = Query(
        default=None,
        description="Optional filter: PHD, PURSUING_PHD, POSTGRADUATE",
    ),
    q: str | None = Query(default=None, max_length=100),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    clauses = ["1=1"]
    params: dict[str, Any] = {}
    if dept_id is not None:
        clauses.append("dept_id = :did")
        params["did"] = dept_id
    if cadre:
        cadre_norm = cadre.strip().upper()
        if cadre_norm == "LEADERSHIP":
            clauses.append("(leadership_role IS NOT NULL OR cadre_rank = 1)")
        elif cadre_norm == "PROFESSOR":
            clauses.append("cadre_rank IN (1, 2)")
        elif cadre_norm == "ASSOCIATE_PROFESSOR":
            clauses.append("cadre_rank = 3")
        elif cadre_norm == "ASSISTANT_PROFESSOR":
            clauses.append("cadre_rank IN (4, 5, 6)")
        elif cadre_norm == "VISITING":
            clauses.append("(association_nature IN ('CONTRACT', 'ADJUNCT') OR cadre_rank >= 7)")
    if qualification:
        qual_norm = qualification.strip().upper()
        if qual_norm == "PHD":
            clauses.append("qualification = 'Ph.D'")
        elif qual_norm == "PURSUING_PHD":
            clauses.append("qualification = '(Ph.D)'")
        elif qual_norm == "POSTGRADUATE":
            clauses.append("(qualification IS NOT NULL AND qualification NOT IN ('Ph.D', '(Ph.D)'))")
    if q and q.strip():
        clauses.append(
            "("
            "display_name LIKE :q OR employee_code LIKE :q OR designation LIKE :q "
            "OR COALESCE(program_name, '') LIKE :q OR COALESCE(leadership_role, '') LIKE :q "
            "OR dept_name LIKE :q OR dept_code LIKE :q"
            ")"
        )
        params["q"] = f"%{q.strip()}%"

    rows = conn.execute(
        text(
            f"""
            SELECT *
            FROM vw_public_faculty_directory
            WHERE {' AND '.join(clauses)}
            ORDER BY
                CASE
                    WHEN leadership_role = 'Principal' THEN 0
                    WHEN leadership_role = 'Vice Principal' THEN 1
                    WHEN leadership_role LIKE '%HOD%' THEN 2
                    WHEN leadership_role IS NOT NULL THEN 3
                    ELSE 4
                END ASC,
                cadre_rank ASC,
                COALESCE(date_of_joining, DATE('2099-12-31')) ASC,
                display_name ASC
            """
        ),
        params,
    ).mappings().all()
    return [_serialize_row(r) for r in rows]


@router.get("/facilities")
def list_public_facilities(
    category: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    clauses = ["fc.public_visibility = TRUE", "fc.status = 'ACTIVE'"]
    params: dict[str, Any] = {}
    if category:
        clauses.append("fc.category = :cat")
        params["cat"] = category
    if q and q.strip():
        clauses.append("(fc.facility_name LIKE :q OR fc.description LIKE :q)")
        params["q"] = f"%{q.strip()}%"

    rows = conn.execute(
        text(
            f"""
            SELECT fc.facility_id, fc.facility_name, fc.category, fc.description,
                   fc.building_id, b.building_name, b.building_code,
                   fc.floor_id, fl.floor_name,
                   fc.room_id, r.room_number,
                   COALESCE(fc.latitude, b.latitude) AS latitude,
                   COALESCE(fc.longitude, b.longitude) AS longitude,
                   fc.opening_hours, fc.is_accessible, fc.verification_status
            FROM facilities fc
            LEFT JOIN buildings b ON b.building_id = fc.building_id
            LEFT JOIN floors fl ON fl.floor_id = fc.floor_id
            LEFT JOIN rooms r ON r.room_id = fc.room_id
            WHERE {' AND '.join(clauses)}
            ORDER BY fc.facility_name ASC
            """
        ),
        params,
    ).mappings().all()
    return [_serialize_row(r) for r in rows]


@router.get("/search")
async def unified_campus_search(
    q: str = Query(..., min_length=1, max_length=100),
    category: str | None = Query(default=None),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    t0 = time.perf_counter()
    term = q.strip()
    like_param = f"%{term}%"
    results: list[dict[str, Any]] = []

    if category in (None, "ALL", "BUILDING"):
        bldgs = conn.execute(
            text(
                """
                SELECT building_id, building_code, building_name, building_type,
                       description, latitude, longitude, verification_status
                FROM vw_public_building_directory
                WHERE building_name LIKE :lk OR building_code LIKE :lk OR description LIKE :lk
                LIMIT 10
                """
            ),
            {"lk": like_param},
        ).mappings().all()
        for b in bldgs:
            results.append(
                {
                    "entity_type": "BUILDING",
                    "id": b["building_id"],
                    "title": b["building_name"],
                    "subtitle": f"Code: {b['building_code']} • {b['building_type'].replace('_', ' ').title()}",
                    "building_id": b["building_id"],
                    "floor_id": None,
                    "room_id": None,
                    "latitude": float(b["latitude"]),
                    "longitude": float(b["longitude"]),
                    "verification_status": b["verification_status"],
                }
            )

    if category in (None, "ALL", "ROOM"):
        rooms = conn.execute(
            text(
                """
                SELECT room_id, room_number, room_name, room_type, floor_id, floor_name,
                       building_id, building_name, building_latitude, building_longitude, verification_status
                FROM vw_public_room_directory
                WHERE room_number LIKE :lk OR room_name LIKE :lk OR description LIKE :lk
                LIMIT 12
                """
            ),
            {"lk": like_param},
        ).mappings().all()
        for r in rooms:
            results.append(
                {
                    "entity_type": "ROOM",
                    "id": r["room_id"],
                    "title": f"{r['room_number']} — {r['room_name']}",
                    "subtitle": f"{r['building_name']} • {r['floor_name']}",
                    "building_id": r["building_id"],
                    "floor_id": r["floor_id"],
                    "room_id": r["room_id"],
                    "latitude": float(r["building_latitude"]),
                    "longitude": float(r["building_longitude"]),
                    "verification_status": r["verification_status"],
                }
            )

    if category in (None, "ALL", "FACULTY"):
        staff_rows = conn.execute(
            text(
                """
                SELECT staff_id, employee_code, display_name, designation, dept_code,
                       program_name, leadership_role, office_room_id,
                       office_room_number, floor_id, building_id, building_name,
                       building_latitude, building_longitude, effective_availability, verification_status
                FROM vw_public_faculty_directory
                WHERE display_name LIKE :lk
                   OR employee_code LIKE :lk
                   OR designation LIKE :lk
                   OR COALESCE(program_name, '') LIKE :lk
                   OR COALESCE(leadership_role, '') LIKE :lk
                   OR dept_code LIKE :lk
                ORDER BY cadre_rank ASC, display_name ASC
                LIMIT 12
                """
            ),
            {"lk": like_param},
        ).mappings().all()
        for s in staff_rows:
            if s["building_name"] and s["office_room_number"]:
                loc_label = f"{s['building_name']} • {s['office_room_number']}"
            elif s["building_name"]:
                loc_label = s["building_name"]
            else:
                loc_label = f"Department of {s['dept_code']}"
            results.append(
                {
                    "entity_type": "FACULTY",
                    "id": s["staff_id"],
                    "title": s["display_name"],
                    "subtitle": f"{s['designation']} • {loc_label}",
                    "building_id": s["building_id"],
                    "floor_id": s["floor_id"],
                    "room_id": s["office_room_id"],
                    "latitude": float(s["building_latitude"]) if s["building_latitude"] is not None else None,
                    "longitude": float(s["building_longitude"]) if s["building_longitude"] is not None else None,
                    "availability": s["effective_availability"],
                    "verification_status": s["verification_status"],
                }
            )

    if category in (None, "ALL", "FACILITY"):
        facs = conn.execute(
            text(
                """
                SELECT fc.facility_id, fc.facility_name, fc.category, fc.building_id,
                       b.building_name, fc.floor_id, fc.room_id,
                       COALESCE(fc.latitude, b.latitude) AS lat,
                       COALESCE(fc.longitude, b.longitude) AS lng,
                       fc.verification_status
                FROM facilities fc
                LEFT JOIN buildings b ON b.building_id = fc.building_id
                WHERE fc.public_visibility = TRUE AND fc.status = 'ACTIVE'
                  AND (fc.facility_name LIKE :lk OR fc.description LIKE :lk OR fc.category LIKE :lk)
                LIMIT 10
                """
            ),
            {"lk": like_param},
        ).mappings().all()
        for fc in facs:
            results.append(
                {
                    "entity_type": "FACILITY",
                    "id": fc["facility_id"],
                    "title": fc["facility_name"],
                    "subtitle": fc["building_name"] or fc["category"].replace("_", " ").title(),
                    "building_id": fc["building_id"],
                    "floor_id": fc["floor_id"],
                    "room_id": fc["room_id"],
                    "latitude": float(fc["lat"]) if fc["lat"] is not None else None,
                    "longitude": float(fc["lng"]) if fc["lng"] is not None else None,
                    "verification_status": fc["verification_status"],
                }
            )

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    # Record anonymous search telemetry in MongoDB (non-blocking if Mongo unavailable)
    try:
        mdb = get_mongo_db()
        await mdb.search_telemetry.insert_one(
            {
                "query_text": term.lower(),
                "category_filter": category or "ALL",
                "result_count": len(results),
                "duration_ms": elapsed_ms,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass

    return {"query": term, "count": len(results), "duration_ms": elapsed_ms, "results": results}


@router.get("/navigation/route")
async def get_campus_navigation_route(
    from_lat: float = Query(..., ge=12.90, le=12.95),
    from_lng: float = Query(..., ge=77.48, le=77.52),
    to_lat: float = Query(..., ge=12.90, le=12.95),
    to_lng: float = Query(..., ge=77.48, le=77.52),
    mode: str = Query(default="WALKING", pattern="^(WALKING|VEHICLE|walking|vehicle)$"),
    from_label: str = Query(default="Starting Point", max_length=140),
    to_label: str = Query(default="Destination", max_length=140),
) -> dict[str, Any]:
    try:
        return await compute_campus_route(
            from_lat=from_lat,
            from_lng=from_lng,
            to_lat=to_lat,
            to_lng=to_lng,
            mode=mode.upper(),
            from_label=from_label.strip() or "Starting Point",
            to_label=to_label.strip() or "Destination",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/assistant/ask")
async def ask_campus_rag_assistant(
    payload: dict[str, Any],
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    q = str(payload.get("query") or payload.get("q") or "").strip()
    if not q:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a question.")
    history = payload.get("history") if isinstance(payload.get("history"), list) else None
    result = await answer_campus_query(q, conn=conn, history=history)
    try:
        mdb = get_mongo_db()
        await mdb.search_telemetry.insert_one(
            {
                "query_text": q.lower(),
                "category_filter": "AI_RAG_ASSISTANT",
                "result_count": len(result.get("cards", [])),
                "duration_ms": result.get("latency_ms", 0.0),
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:
        pass
    return result


@router.get("/assistant/ask")
async def ask_campus_rag_assistant_get(
    q: str = Query(..., min_length=1, max_length=300),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    return await answer_campus_query(q, conn=conn, history=None)

