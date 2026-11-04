from __future__ import annotations

from fastapi.testclient import TestClient
from pymongo import MongoClient

from backend.app.auth.security import create_access_token, hash_password, verify_password
from backend.app.config.settings import get_settings
from backend.app.main import app
from database.setup_databases import parse_sql_statements


client = TestClient(app)


def test_password_hashing_and_jwt_roundtrip() -> None:
    hashed = hash_password("InstitutionalPass#2026")
    assert hashed != "InstitutionalPass#2026"
    assert verify_password("InstitutionalPass#2026", hashed) is True
    assert verify_password("WrongPassword", hashed) is False

    token = create_access_token(user_id=10, username="security.desk", roles=["SECURITY_RECEPTION"])
    assert isinstance(token, str) and len(token) > 30


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
    assert {"campus_geometries", "floor_plan_overlays", "search_telemetry", "system_events"}.issubset(
        collections
    )

    geo_indexes = db.campus_geometries.index_information()
    assert "idx_geo_2dsphere" in geo_indexes
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
