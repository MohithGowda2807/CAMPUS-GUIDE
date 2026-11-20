from __future__ import annotations

from fastapi.testclient import TestClient
from pymongo import MongoClient
from sqlalchemy import text

from backend.app.auth.data_protection import (
    decrypt_sensitive_field,
    encrypt_sensitive_field,
    normalize_and_validate_rvce_email,
)
from backend.app.config.database import get_mysql_engine
from backend.app.config.settings import get_settings
from backend.app.main import app
from database.setup_databases import parse_sql_statements


client = TestClient(app)


def test_zero_password_database_and_aesgcm_roundtrip() -> None:
    # Verify NO password or password_hash column exists anywhere in MySQL `campusguide`
    with get_mysql_engine().connect() as conn:
        forbidden_cols = conn.execute(
            text(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND LOWER(column_name) IN ('password', 'password_hash', 'mfa_secret', 'refresh_token')
                """
            )
        ).scalars().all()
        assert list(forbidden_cols) == []

    # Verify AES-256-GCM authenticated encryption + AAD binding
    ct = encrypt_sensitive_field("Confidential-Staff-Ref-01", aad_context="sub:test-1")
    assert b"Confidential-Staff-Ref-01" not in ct
    assert decrypt_sensitive_field(ct, aad_context="sub:test-1") == "Confidential-Staff-Ref-01"

    assert normalize_and_validate_rvce_email("  HOD.CSE@RVCE.EDU.IN ") == "hod.cse@rvce.edu.in"


def test_protected_endpoints_enforce_authentication() -> None:
    # Visitor log listing must never be publicly readable
    r_visits = client.get("/api/v1/visits")
    assert r_visits.status_code == 401

    # Admin endpoints must reject unauthenticated requests
    r_admin_bldg = client.post(
        "/api/v1/admin/buildings",
        json={
            "building_code": "TEST",
            "building_name": "Unauthorized Block",
            "latitude": 12.9233,
            "longitude": 77.4995,
        },
    )
    assert r_admin_bldg.status_code == 401

    r_audit = client.get("/api/v1/admin/audit-logs")
    assert r_audit.status_code == 401


def test_mysql_ddl_scripts_parse_cleanly() -> None:
    from pathlib import Path

    sql_dir = Path(__file__).resolve().parents[2] / "database" / "mysql"
    expected_counts = {
        "01_schema.sql": 19,
        "02_views.sql": 6,
        "03_triggers.sql": 16,
        "04_procedures.sql": 11,
    }
    for fname, min_stmts in expected_counts.items():
        stmts = parse_sql_statements((sql_dir / fname).read_text(encoding="utf-8"))
        assert len(stmts) >= min_stmts, f"{fname} parsed {len(stmts)} statements"


def test_live_mongodb_collections_and_geospatial_index() -> None:
    settings = get_settings()
    mclient = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=3000)
    db = mclient[settings.MONGODB_DATABASE]

    collections = set(db.list_collection_names())
    assert {
        "campus_geometries",
        "campus_pathways",
        "floor_plan_overlays",
        "search_telemetry",
        "system_events",
    }.issubset(collections)

    geo_indexes = db.campus_geometries.index_information()
    assert "idx_geo_2dsphere" in geo_indexes

    pathway_indexes = db.campus_pathways.index_information()
    assert "idx_pathway_geo_2dsphere" in pathway_indexes
    mclient.close()


def test_official_rvce_faculty_directory_and_departments_seeded() -> None:
    r_depts = client.get("/api/v1/departments")
    assert r_depts.status_code == 200
    depts = r_depts.json()
    assert len(depts) >= 18

    r_fac = client.get("/api/v1/faculty")
    assert r_fac.status_code == 200
    fac = r_fac.json()
    assert len(fac) >= 280

    # Verify Principal Dr. Subramanya K N (ID 5716) is searchable via unified search
    r_search = client.get("/api/v1/search?q=5716&category=FACULTY")
    assert r_search.status_code == 200
    s_data = r_search.json()
    assert s_data["count"] >= 1
    assert "Subramanya" in s_data["results"][0]["title"]


def test_verified_campus_buildings_and_map_geometries() -> None:
    r_map = client.get("/api/v1/map/config")
    assert r_map.status_code == 200
    map_cfg = r_map.json()
    assert len(map_cfg["geometries"]) >= 29

    r_bldgs = client.get("/api/v1/buildings")
    assert r_bldgs.status_code == 200
    bldgs = r_bldgs.json()
    assert len(bldgs) >= 28
    codes = {b["building_code"] for b in bldgs}
    assert {"ADMIN", "CSE", "AIML", "ECE", "EEE", "ETE", "ME", "CV", "BT", "LIB", "AUD-KK"}.issubset(
        codes
    )


def test_campus_walking_and_vehicle_navigation_routing() -> None:
    # Main Gate -> Big Mingos Food Court (Walking vs Vehicle)
    r_walk = client.get(
        "/api/v1/navigation/route",
        params={
            "from_lat": 12.924631,
            "from_lng": 77.499040,
            "to_lat": 12.922401,
            "to_lng": 77.499706,
            "mode": "WALKING",
            "from_label": "Main Gate",
            "to_label": "Big Mingos Food Court",
        },
    )
    assert r_walk.status_code == 200
    w_data = r_walk.json()
    assert w_data["mode"] == "WALKING"
    assert w_data["total_distance_m"] > 200
    assert w_data["breakdown"]["walkway_distance_m"] > 50
    assert len(w_data["steps"]) >= 3

    r_veh = client.get(
        "/api/v1/navigation/route",
        params={
            "from_lat": 12.924631,
            "from_lng": 77.499040,
            "to_lat": 12.922401,
            "to_lng": 77.499706,
            "mode": "VEHICLE",
            "from_label": "Main Gate",
            "to_label": "Big Mingos Food Court",
        },
    )
    assert r_veh.status_code == 200
    v_data = r_veh.json()
    assert v_data["mode"] == "VEHICLE"
    assert any(leg["leg_type"] == "DRIVE" for leg in v_data["legs"])
    assert v_data["breakdown"]["road_distance_m"] > 250
