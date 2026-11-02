from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.auth.security import hash_password, require_roles
from backend.app.config.database import get_db_connection, get_mongo_db
from backend.app.schemas.domain import (
    BuildingCreateUpdateRequest,
    FacilityCreateUpdateRequest,
    FloorCreateRequest,
    FloorPlanPublishRequest,
    RoomCreateUpdateRequest,
    StaffCreateUpdateRequest,
    UserCreateRequest,
)

router = APIRouter(prefix="/admin", tags=["Campus, Directory & System Administration"])


def _row_to_dict(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if isinstance(v, (datetime, date)):
            out[k] = v.isoformat()
        elif hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# -----------------------------------------------------------------------------
# Building, Floor & Room Administration
# -----------------------------------------------------------------------------
@router.post("/buildings", status_code=status.HTTP_201_CREATED)
async def create_building(
    payload: BuildingCreateUpdateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    campus_id = conn.execute(
        text("SELECT campus_id FROM campuses WHERE status = 'ACTIVE' ORDER BY campus_id ASC LIMIT 1")
    ).scalar()
    if not campus_id:
        raise HTTPException(status_code=503, detail="Campus record is not initialized.")

    res = conn.execute(
        text(
            """
            INSERT INTO buildings
            (campus_id, building_code, building_name, building_type, description,
             latitude, longitude, total_floors, is_accessible, verification_status, status)
            VALUES (:cid, :code, :name, :btype, :desc, :lat, :lng, :nfloors, :acc, :vstat, :stat)
            """
        ),
        {
            "cid": campus_id,
            "code": payload.building_code.strip().upper(),
            "name": payload.building_name.strip(),
            "btype": payload.building_type,
            "desc": payload.description,
            "lat": payload.latitude,
            "lng": payload.longitude,
            "nfloors": payload.total_floors,
            "acc": payload.is_accessible,
            "vstat": payload.verification_status,
            "stat": payload.status,
        },
    )
    building_id = int(res.lastrowid)
    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (:uid, 'INSERT', 'buildings', :bid, JSON_OBJECT('building_code', :code, 'building_name', :name))
            """
        ),
        {
            "uid": current_user["user_id"],
            "bid": building_id,
            "code": payload.building_code.strip().upper(),
            "name": payload.building_name.strip(),
        },
    )
    conn.commit()

    if payload.footprint_geojson:
        try:
            mdb = get_mongo_db()
            await mdb.campus_geometries.replace_one(
                {"entity_type": "BUILDING_FOOTPRINT", "mysql_id": building_id},
                {
                    "entity_type": "BUILDING_FOOTPRINT",
                    "mysql_id": building_id,
                    "code": payload.building_code.strip().upper(),
                    "name": payload.building_name.strip(),
                    "verification_status": payload.verification_status,
                    "geometry": payload.footprint_geojson,
                    "updated_at": datetime.now(timezone.utc),
                },
                upsert=True,
            )
        except Exception:
            pass

    row = conn.execute(
        text("SELECT * FROM buildings WHERE building_id = :bid"), {"bid": building_id}
    ).mappings().first()
    return _row_to_dict(row)


@router.patch("/buildings/{building_id}")
async def update_building(
    building_id: int,
    payload: BuildingCreateUpdateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    exists = conn.execute(
        text("SELECT building_id FROM buildings WHERE building_id = :bid"), {"bid": building_id}
    ).scalar()
    if not exists:
        raise HTTPException(status_code=404, detail="Building not found.")

    conn.execute(text("SET @current_app_user_id = :uid"), {"uid": current_user["user_id"]})
    conn.execute(
        text(
            """
            UPDATE buildings
            SET building_code = :code,
                building_name = :name,
                building_type = :btype,
                description = :desc,
                latitude = :lat,
                longitude = :lng,
                total_floors = :nfloors,
                is_accessible = :acc,
                verification_status = :vstat,
                status = :stat
            WHERE building_id = :bid
            """
        ),
        {
            "bid": building_id,
            "code": payload.building_code.strip().upper(),
            "name": payload.building_name.strip(),
            "btype": payload.building_type,
            "desc": payload.description,
            "lat": payload.latitude,
            "lng": payload.longitude,
            "nfloors": payload.total_floors,
            "acc": payload.is_accessible,
            "vstat": payload.verification_status,
            "stat": payload.status,
        },
    )
    conn.commit()
    row = conn.execute(
        text("SELECT * FROM buildings WHERE building_id = :bid"), {"bid": building_id}
    ).mappings().first()
    return _row_to_dict(row)


@router.post("/floors", status_code=status.HTTP_201_CREATED)
def create_floor(
    payload: FloorCreateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    res = conn.execute(
        text(
            """
            INSERT INTO floors (building_id, floor_number, floor_name, display_order, has_lift_access, status)
            VALUES (:bid, :fnum, :fname, :dord, :lift, 'ACTIVE')
            """
        ),
        {
            "bid": payload.building_id,
            "fnum": payload.floor_number,
            "fname": payload.floor_name.strip(),
            "dord": payload.display_order,
            "lift": payload.has_lift_access,
        },
    )
    floor_id = int(res.lastrowid)
    conn.commit()
    row = conn.execute(text("SELECT * FROM floors WHERE floor_id = :fid"), {"fid": floor_id}).mappings().first()
    return _row_to_dict(row)


@router.post("/rooms", status_code=status.HTTP_201_CREATED)
async def create_room(
    payload: RoomCreateUpdateRequest,
    current_user: dict[str, Any] = Depends(
        require_roles("DEPT_COORDINATOR", "FACILITY_ADMIN", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    res = conn.execute(
        text(
            """
            INSERT INTO rooms
            (floor_id, dept_id, room_number, room_name, room_type, capacity, description,
             is_accessible, public_visibility, verification_status, status)
            VALUES (:fid, :did, :rnum, :rname, :rtype, :cap, :desc, :acc, :vis, :vstat, :stat)
            """
        ),
        {
            "fid": payload.floor_id,
            "did": payload.dept_id,
            "rnum": payload.room_number.strip(),
            "rname": payload.room_name.strip(),
            "rtype": payload.room_type,
            "cap": payload.capacity,
            "desc": payload.description,
            "acc": payload.is_accessible,
            "vis": payload.public_visibility,
            "vstat": payload.verification_status,
            "stat": payload.status,
        },
    )
    room_id = int(res.lastrowid)
    conn.commit()

    # Sync indoor room polygon bounds to active MongoDB floor_plan_overlays if provided
    if payload.overlay_bounds:
        plan_id = conn.execute(
            text(
                """
                SELECT floor_plan_id FROM floor_plans
                WHERE floor_id = :fid AND is_active_public = TRUE
                LIMIT 1
                """
            ),
            {"fid": payload.floor_id},
        ).scalar()
        if plan_id:
            try:
                mdb = get_mongo_db()
                await mdb.floor_plan_overlays.update_one(
                    {"floor_plan_id": int(plan_id)},
                    {
                        "$push": {
                            "rooms": {
                                "room_id": room_id,
                                "room_number": payload.room_number.strip(),
                                "label": payload.room_name.strip(),
                                "category": payload.room_type,
                                "bounds": payload.overlay_bounds,
                            }
                        }
                    },
                )
            except Exception:
                pass

    row = conn.execute(text("SELECT * FROM rooms WHERE room_id = :rid"), {"rid": room_id}).mappings().first()
    return _row_to_dict(row)


# -----------------------------------------------------------------------------
# Staff, Facilities & Floor-Plan Publishing
# -----------------------------------------------------------------------------
@router.post("/staff", status_code=status.HTTP_201_CREATED)
def create_staff_member(
    payload: StaffCreateUpdateRequest,
    current_user: dict[str, Any] = Depends(
        require_roles("DEPT_COORDINATOR", "FACILITY_ADMIN", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    res = conn.execute(
        text(
            """
            INSERT INTO staff
            (dept_id, office_room_id, employee_code, display_name, qualification, designation,
             cadre_rank, program_name, leadership_role, staff_type, date_of_joining,
             professor_designated_date, association_nature, employment_mode, deputation_remarks,
             public_email, official_profile_url, profile_visibility, verification_status, status)
            VALUES (:did, :rid, :ecode, :name, :qual, :desig, :crank, :prog, :lrole, :stype,
                    :doj, :pdate, :assoc, :emode, :rem, :email, :url, :vis, :vstat, :stat)
            """
        ),
        {
            "did": payload.dept_id,
            "rid": payload.office_room_id,
            "ecode": payload.employee_code.strip(),
            "name": payload.display_name.strip(),
            "qual": payload.qualification.strip() if payload.qualification else None,
            "desig": payload.designation.strip(),
            "crank": payload.cadre_rank,
            "prog": payload.program_name.strip() if payload.program_name else None,
            "lrole": payload.leadership_role.strip() if payload.leadership_role else None,
            "stype": payload.staff_type,
            "doj": payload.date_of_joining,
            "pdate": payload.professor_designated_date,
            "assoc": payload.association_nature,
            "emode": payload.employment_mode,
            "rem": payload.deputation_remarks.strip() if payload.deputation_remarks else None,
            "email": str(payload.public_email) if payload.public_email else None,
            "url": payload.official_profile_url,
            "vis": payload.profile_visibility,
            "vstat": payload.verification_status,
            "stat": payload.status,
        },
    )
    staff_id = int(res.lastrowid)
    conn.commit()
    row = conn.execute(text("SELECT * FROM staff WHERE staff_id = :sid"), {"sid": staff_id}).mappings().first()
    return _row_to_dict(row)


@router.post("/facilities", status_code=status.HTTP_201_CREATED)
def create_facility(
    payload: FacilityCreateUpdateRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    campus_id = conn.execute(
        text("SELECT campus_id FROM campuses WHERE status = 'ACTIVE' ORDER BY campus_id ASC LIMIT 1")
    ).scalar()
    res = conn.execute(
        text(
            """
            INSERT INTO facilities
            (campus_id, building_id, floor_id, room_id, facility_name, category, description,
             latitude, longitude, opening_hours, is_accessible, public_visibility, verification_status, status)
            VALUES (:cid, :bid, :fid, :rid, :name, :cat, :desc, :lat, :lng, :hrs, :acc, :vis, :vstat, :stat)
            """
        ),
        {
            "cid": campus_id,
            "bid": payload.building_id,
            "fid": payload.floor_id,
            "rid": payload.room_id,
            "name": payload.facility_name.strip(),
            "cat": payload.category,
            "desc": payload.description,
            "lat": payload.latitude,
            "lng": payload.longitude,
            "hrs": payload.opening_hours,
            "acc": payload.is_accessible,
            "vis": payload.public_visibility,
            "vstat": payload.verification_status,
            "stat": payload.status,
        },
    )
    fac_id = int(res.lastrowid)
    conn.commit()
    row = conn.execute(
        text("SELECT * FROM facilities WHERE facility_id = :fid"), {"fid": fac_id}
    ).mappings().first()
    return _row_to_dict(row)


@router.post("/floor-plans", status_code=status.HTTP_201_CREATED)
async def publish_floor_plan_revision(
    payload: FloorPlanPublishRequest,
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    floor_row = conn.execute(
        text("SELECT floor_id, building_id FROM floors WHERE floor_id = :fid"),
        {"fid": payload.floor_id},
    ).mappings().first()
    if not floor_row:
        raise HTTPException(status_code=404, detail="Target floor not found.")

    res = conn.execute(
        text(
            """
            INSERT INTO floor_plans
            (floor_id, version_label, file_format, canvas_width, canvas_height, coordinate_space,
             source_reference, approval_status, is_active_public, is_schematic_sample)
            VALUES (:fid, :ver, 'VECTOR_OVERLAY', :cw, :ch, 'NORMALIZED_1000', :src, 'DRAFT', FALSE, :sample)
            """
        ),
        {
            "fid": payload.floor_id,
            "ver": payload.version_label.strip(),
            "cw": payload.canvas_width,
            "ch": payload.canvas_height,
            "src": payload.source_reference.strip(),
            "sample": payload.is_schematic_sample,
        },
    )
    fp_id = int(res.lastrowid)

    if payload.activate_immediately:
        conn.execute(
            text("CALL sp_activate_floor_plan(:fpid, :uid)"),
            {"fpid": fp_id, "uid": current_user["user_id"]},
        )

    conn.commit()

    try:
        mdb = get_mongo_db()
        await mdb.floor_plan_overlays.replace_one(
            {"floor_plan_id": fp_id},
            {
                "floor_plan_id": fp_id,
                "floor_id": payload.floor_id,
                "building_id": int(floor_row["building_id"]),
                "coordinate_space": "NORMALIZED_1000",
                "is_schematic_sample": payload.is_schematic_sample,
                "canvas": {"width": payload.canvas_width, "height": payload.canvas_height},
                "corridors": payload.corridors,
                "landmarks": payload.landmarks,
                "rooms": payload.rooms_overlay,
                "route_network": {"is_verified": False, "nodes": [], "edges": []},
                "updated_at": datetime.now(timezone.utc),
            },
            upsert=True,
        )
    except Exception:
        pass

    row = conn.execute(
        text("SELECT * FROM floor_plans WHERE floor_plan_id = :fpid"), {"fpid": fp_id}
    ).mappings().first()
    return _row_to_dict(row)


# -----------------------------------------------------------------------------
# Hybrid RDBMS + NoSQL Operational Reports, Users & Audit Logs
# -----------------------------------------------------------------------------
@router.get("/reports/summary")
async def get_operational_reports(
    days: int = Query(default=30, ge=1, le=365),
    current_user: dict[str, Any] = Depends(
        require_roles("SECURITY_RECEPTION", "FACILITY_ADMIN", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    start_date = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    end_date = datetime.now(timezone.utc).date().isoformat()

    kpis = conn.execute(
        text(
            """
            SELECT
                (SELECT COUNT(*) FROM buildings WHERE status = 'ACTIVE') AS active_buildings,
                (SELECT COUNT(*) FROM rooms WHERE status = 'ACTIVE' AND public_visibility = TRUE) AS public_rooms,
                (SELECT COUNT(*) FROM staff WHERE status = 'ACTIVE' AND profile_visibility = 'PUBLIC') AS listed_faculty,
                (SELECT COUNT(*) FROM facilities WHERE status = 'ACTIVE' AND public_visibility = TRUE) AS active_facilities,
                (SELECT COUNT(*) FROM visitor_logs WHERE DATE(created_at) BETWEEN :sd AND :ed) AS period_total_visits,
                (SELECT COUNT(*) FROM visitor_logs WHERE visit_status = 'CHECKED_IN') AS visitors_currently_inside,
                (SELECT COUNT(*) FROM visitor_logs WHERE approval_status = 'PENDING' AND visit_status = 'REGISTERED') AS pending_approvals
            """
        ),
        {"sd": start_date, "ed": end_date},
    ).mappings().first()

    daily_metrics = conn.execute(
        text(
            """
            SELECT *
            FROM vw_daily_visitor_analytics
            WHERE visit_date BETWEEN :sd AND :ed
            ORDER BY visit_date DESC, total_visits DESC
            LIMIT 30
            """
        ),
        {"sd": start_date, "ed": end_date},
    ).mappings().all()

    top_searches: list[dict[str, Any]] = []
    zero_result_queries: list[dict[str, Any]] = []
    try:
        mdb = get_mongo_db()
        top_pipeline = [
            {"$group": {"_id": "$query_text", "searches": {"$sum": 1}, "avg_ms": {"$avg": "$duration_ms"}}},
            {"$sort": {"searches": -1}},
            {"$limit": 8},
        ]
        zero_pipeline = [
            {"$match": {"result_count": 0}},
            {"$group": {"_id": "$query_text", "attempts": {"$sum": 1}}},
            {"$sort": {"attempts": -1}},
            {"$limit": 8},
        ]
        top_raw = await mdb.search_telemetry.aggregate(top_pipeline).to_list(length=8)
        zero_raw = await mdb.search_telemetry.aggregate(zero_pipeline).to_list(length=8)
        top_searches = [
            {"query": d["_id"], "searches": d["searches"], "avg_ms": round(d.get("avg_ms", 0.0), 2)}
            for d in top_raw
        ]
        zero_result_queries = [{"query": d["_id"], "attempts": d["attempts"]} for d in zero_raw]
    except Exception:
        pass

    return {
        "period": {"from": start_date, "to": end_date, "days": days},
        "kpis": _row_to_dict(kpis),
        "daily_visitor_analytics": [_row_to_dict(r) for r in daily_metrics],
        "search_insights": {
            "top_queries": top_searches,
            "unmatched_queries": zero_result_queries,
        },
    }


@router.get("/users")
def list_system_users(
    current_user: dict[str, Any] = Depends(require_roles("SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            SELECT u.user_id, u.username, u.email, u.auth_provider, u.is_active, u.last_login_at,
                   s.display_name AS staff_name,
                   GROUP_CONCAT(r.role_code ORDER BY r.role_code SEPARATOR ',') AS role_codes
            FROM users u
            LEFT JOIN staff s ON s.staff_id = u.linked_staff_id
            LEFT JOIN user_roles ur ON ur.user_id = u.user_id
            LEFT JOIN roles r ON r.role_id = ur.role_id
            GROUP BY u.user_id, u.username, u.email, u.auth_provider, u.is_active, u.last_login_at, s.display_name
            ORDER BY u.user_id ASC
            """
        )
    ).mappings().all()

    out = []
    for r in rows:
        d = _row_to_dict(r)
        d["roles"] = d.pop("role_codes").split(",") if d.get("role_codes") else []
        out.append(d)
    return out


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_system_user(
    payload: UserCreateRequest,
    current_user: dict[str, Any] = Depends(require_roles("SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    pwd_hash = hash_password(payload.password)
    res = conn.execute(
        text(
            """
            INSERT INTO users (linked_staff_id, username, email, password_hash, auth_provider, is_active)
            VALUES (:sid, :uname, :email, :phash, 'LOCAL', TRUE)
            """
        ),
        {
            "sid": payload.linked_staff_id,
            "uname": payload.username.strip(),
            "email": str(payload.email),
            "phash": pwd_hash,
        },
    )
    new_uid = int(res.lastrowid)

    for rcode in payload.role_codes:
        role_id = conn.execute(
            text("SELECT role_id FROM roles WHERE role_code = :rc"), {"rc": rcode}
        ).scalar()
        if role_id:
            conn.execute(
                text("INSERT INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"),
                {"uid": new_uid, "rid": int(role_id)},
            )

    conn.execute(
        text(
            """
            INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, new_value)
            VALUES (:actor, 'INSERT', 'users', :target, JSON_OBJECT('username', :uname))
            """
        ),
        {"actor": current_user["user_id"], "target": new_uid, "uname": payload.username.strip()},
    )
    conn.commit()
    return {"user_id": new_uid, "username": payload.username.strip(), "roles": payload.role_codes}


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict[str, Any] = Depends(require_roles("FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    rows = conn.execute(
        text(
            """
            SELECT cal.log_id, cal.user_id, u.username AS actor_username,
                   cal.action_type, cal.table_name, cal.record_id,
                   cal.old_value, cal.new_value, cal.changed_at
            FROM change_audit_log cal
            LEFT JOIN users u ON u.user_id = cal.user_id
            ORDER BY cal.changed_at DESC, cal.log_id DESC
            LIMIT :lim
            """
        ),
        {"lim": limit},
    ).mappings().all()
    return [_row_to_dict(r) for r in rows]
