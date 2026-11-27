"""
Unified Database Provisioning & Institutional Seed Tool (MySQL 8.0+ & MongoDB 9.0+)

Usage:
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --seed
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --schema-only
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --mongo-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pymysql
from pymongo import MongoClient

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from database.mongodb.init_nosql import (  # noqa: E402
    ensure_collections_and_indexes,
    seed_sample_nosql_documents,
)

FLOOR_LABELS: dict[int, str] = {
    0: "Ground Floor",
    1: "First Floor",
    2: "Second Floor",
    3: "Third Floor",
    4: "Fourth Floor",
    5: "Fifth Floor",
}


def load_dotenv_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")
    return values


def parse_sql_statements(sql_text: str) -> list[str]:
    """Splits SQL script handling DELIMITER $$ blocks cleanly for PyMySQL execution."""
    lines = sql_text.splitlines()
    delimiter = ";"
    statements: list[str] = []
    buffer: list[str] = []

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        m = re.match(r"^DELIMITER\s+(\S+)\s*$", stripped, flags=re.IGNORECASE)
        if m:
            delimiter = m.group(1)
            continue

        if delimiter == ";":
            buffer.append(raw_line)
            if stripped.endswith(";"):
                joined = "\n".join(buffer).strip()
                if joined.endswith(";"):
                    joined = joined[:-1].strip()
                if joined:
                    statements.append(joined)
                buffer = []
        else:
            if stripped.endswith(delimiter):
                line_without_delim = raw_line[: raw_line.rfind(delimiter)]
                if line_without_delim.strip():
                    buffer.append(line_without_delim)
                joined = "\n".join(buffer).strip()
                if joined:
                    statements.append(joined)
                buffer = []
            else:
                buffer.append(raw_line)

    if buffer:
        tail = "\n".join(buffer).strip()
        if tail:
            statements.append(tail)
    return statements


def apply_mysql_schema(cfg: dict[str, str]) -> pymysql.connections.Connection:
    conn = pymysql.connect(
        host=cfg.get("MYSQL_HOST", "127.0.0.1"),
        port=int(cfg.get("MYSQL_PORT", "3306")),
        user=cfg.get("MYSQL_USER", "root"),
        password=cfg.get("MYSQL_PASSWORD", ""),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    sql_dir = ROOT_DIR / "database" / "mysql"
    for filename in ["01_schema.sql", "02_views.sql", "03_triggers.sql", "04_procedures.sql"]:
        sql_path = sql_dir / filename
        statements = parse_sql_statements(sql_path.read_text(encoding="utf-8"))
        with conn.cursor() as cur:
            for stmt in statements:
                cur.execute(stmt)
        conn.commit()
        print(f"[MySQL] Applied {filename} ({len(statements)} statements)")
    return conn


def seed_mysql_and_mongo(
    conn: pymysql.connections.Connection,
    mongo_uri: str,
    mongo_db_name: str,
) -> None:
    now = datetime.now()

    osm_path = ROOT_DIR / "database" / "seed_data" / "rvce_campus_osm_geometries.json"
    if not osm_path.exists():
        raise FileNotFoundError(f"Campus geospatial seed file missing: {osm_path}")
    osm_payload: dict[str, Any] = json.loads(osm_path.read_text(encoding="utf-8"))

    roster_path = ROOT_DIR / "database" / "seed_data" / "rvce_official_faculty_2026.json"
    if not roster_path.exists():
        raise FileNotFoundError(f"Official RVCE faculty seed file missing: {roster_path}")
    roster_payload: dict[str, Any] = json.loads(roster_path.read_text(encoding="utf-8"))
    faculty_records: list[dict[str, Any]] = roster_payload["faculty"]

    campus_meta = osm_payload["campus"]
    dept_primary_building: dict[str, str] = osm_payload["dept_primary_building"]
    osm_buildings: list[dict[str, Any]] = osm_payload["buildings"]
    osm_facilities: list[dict[str, Any]] = osm_payload["facilities"]

    with conn.cursor() as cur:
        cur.execute("USE campusguide")

        # 1. Institutional Roles (Canonical RBAC: PUBLIC, FACULTY, STAFF, ADMIN + Operational Scopes)
        roles = [
            ("PUBLIC", "Public User", "Unauthenticated access to campus map, buildings, rooms, facilities, and directory."),
            ("FACULTY", "RVCE Faculty", "Update own approved profile, availability, and host visitor approvals."),
            ("STAFF", "Authorised RVCE Staff", "Authorised non-teaching & security gate operations."),
            ("ADMIN", "Institutional Administrator", "Approve/suspend/revoke staff accounts, manage allowlist, directory, and audit logs."),
            ("PUBLIC_VISITOR", "Public Visitor", "Browse public map, buildings, rooms, facilities, and faculty directory."),
            ("SECURITY_RECEPTION", "Security & Reception", "Register visitors, manage gate check-in/check-out, and verify passes."),
            ("FACULTY_STAFF", "Faculty & Staff", "Update own availability status and review incoming host visit requests."),
            ("DEPT_COORDINATOR", "Department Coordinator", "Maintain delegated department rooms and faculty directory records."),
            ("FACILITY_ADMIN", "Facility Administrator", "Manage campus buildings, floors, rooms, facilities, and floor plans."),
            ("SYSTEM_ADMIN", "System Administrator", "Full platform configuration, user/role administration, and audit review."),
        ]
        cur.executemany(
            "INSERT INTO roles (role_code, role_name, description) VALUES (%s, %s, %s)",
            roles,
        )
        cur.execute("SELECT role_id, role_code FROM roles")
        role_map = {r["role_code"]: r["role_id"] for r in cur.fetchall()}

        # 2. Primary Campus Record (Verified RVCE Mysuru Road Campus)
        cur.execute(
            """
            INSERT INTO campuses (campus_code, campus_name, address, latitude, longitude, default_zoom, verification_status, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'VERIFIED', 'ACTIVE')
            """,
            (
                campus_meta["campus_code"],
                campus_meta["campus_name"],
                campus_meta["address"],
                campus_meta["center_latitude"],
                campus_meta["center_longitude"],
                campus_meta["default_zoom"],
            ),
        )
        campus_id = cur.lastrowid

        # 3. Verified RVCE Campus Buildings (28 surveyed OpenStreetMap footprints & coordinates)
        building_map: dict[str, int] = {}
        floor_map: dict[tuple[str, int], int] = {}

        for b_item in osm_buildings:
            bcode = b_item["building_code"]
            nfloors = int(b_item.get("total_floors", 1))
            cur.execute(
                """
                INSERT INTO buildings
                (campus_id, building_code, building_name, building_type, description, latitude, longitude,
                 total_floors, is_accessible, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'VERIFIED', 'ACTIVE')
                """,
                (
                    campus_id,
                    bcode,
                    b_item["building_name"],
                    b_item["building_type"],
                    b_item.get("description"),
                    b_item["latitude"],
                    b_item["longitude"],
                    nfloors,
                ),
            )
            bid = cur.lastrowid
            building_map[bcode] = bid

            has_lift = nfloors >= 2
            for fnum in range(nfloors):
                fname = FLOOR_LABELS.get(fnum, f"Floor {fnum}")
                cur.execute(
                    """
                    INSERT INTO floors (building_id, floor_number, floor_name, display_order, has_lift_access, status)
                    VALUES (%s, %s, %s, %s, %s, 'ACTIVE')
                    """,
                    (bid, fnum, fname, fnum, has_lift or fnum == 0),
                )
                floor_map[(bcode, fnum)] = cur.lastrowid

        # 4. Official RVCE Academic Departments & Institutional Units (Mapped to real primary buildings)
        depts = [
            ("ASE", "Department of Aerospace Engineering", "ENGINEERING", "Undergraduate and research programmes in aerodynamics, propulsion, avionics, and flight structures.", "ase@rvce.edu.in"),
            ("AIML", "Department of Artificial Intelligence and Machine Learning", "ENGINEERING", "Undergraduate and research programmes in machine learning, deep learning, and intelligent systems.", "aiml@rvce.edu.in"),
            ("BT", "Department of Biotechnology", "ENGINEERING", "Undergraduate, postgraduate, and doctoral programmes in bioprocess, genetics, and bioinformatics.", "bt@rvce.edu.in"),
            ("CH", "Department of Chemical Engineering", "ENGINEERING", "Process engineering, reaction engineering, environmental sustainability, and materials.", "che@rvce.edu.in"),
            ("CV", "Department of Civil Engineering", "ENGINEERING", "Structural, highway, geotechnical, environmental, and transportation engineering programmes.", "civil@rvce.edu.in"),
            ("CSE", "Department of Computer Science and Engineering", "ENGINEERING", "UG & PG programmes in Computer Science, Data Science, Cyber Security, AI & ML, and Computer Networks.", "cse@rvce.edu.in"),
            ("EEE", "Department of Electrical and Electronics Engineering", "ENGINEERING", "Power systems, power electronics, smart grids, high-voltage engineering, and control.", "eee@rvce.edu.in"),
            ("ECE", "Department of Electronics and Communication Engineering", "ENGINEERING", "UG & PG programmes in VLSI Design, Embedded Systems, Signal Processing, and Communication Systems.", "ece@rvce.edu.in"),
            ("EIE", "Department of Electronics and Instrumentation Engineering", "ENGINEERING", "Industrial automation, sensors, biomedical instrumentation, and embedded control.", "eie@rvce.edu.in"),
            ("ETE", "Department of Electronics and Telecommunication Engineering", "ENGINEERING", "RF, microwave, wireless networks, optical communication, and digital communication engineering.", "ete@rvce.edu.in"),
            ("IEM", "Department of Industrial Engineering and Management", "ENGINEERING", "Operations research, supply chain analytics, quality engineering, and institutional management.", "iem@rvce.edu.in"),
            ("ISE", "Department of Information Science and Engineering", "ENGINEERING", "UG & PG programmes in Software Engineering, Information Technology, and Enterprise Data Systems.", "ise@rvce.edu.in"),
            ("ME", "Department of Mechanical Engineering", "ENGINEERING", "UG & PG programmes in Machine Design, Product Design & Manufacturing, Thermal, and CIM.", "me@rvce.edu.in"),
            ("MCA", "Department of Master of Computer Applications", "PG_PROGRAMME", "Postgraduate applications computing, enterprise software architecture, and cloud systems.", "mca@rvce.edu.in"),
            ("PHY", "Department of Physics", "BASIC_SCIENCES", "Applied physics, materials science, optoelectronics, and foundational engineering sciences.", "physics@rvce.edu.in"),
            ("CHEM", "Department of Chemistry", "BASIC_SCIENCES", "Polymer science, nanomaterials, electrochemistry, and analytical chemistry.", "chemistry@rvce.edu.in"),
            ("MATH", "Department of Mathematics", "BASIC_SCIENCES", "Applied mathematics, linear algebra, stochastic modelling, optimization, and discrete structures.", "maths@rvce.edu.in"),
            ("SPORTS_LIB", "Central Library & Department of Physical Education", "CAMPUS_CENTRAL", "Institutional library & information services, digital knowledge centre, and campus sports.", "library@rvce.edu.in"),
            ("ADMIN", "Campus Administration & Student Affairs", "CAMPUS_CENTRAL", "Central administrative offices, admissions, examination section, and estate operations.", "admin@rvce.edu.in"),
            ("SEC", "Campus Security & Reception Services", "CAMPUS_CENTRAL", "Main Mysuru Road gate visitor management, campus safety, and reception helpdesk.", "security@rvce.edu.in"),
        ]
        dept_map: dict[str, int] = {}
        for code, name, cat, desc, email in depts:
            primary_bcode = dept_primary_building.get(code)
            primary_bid = building_map.get(primary_bcode) if primary_bcode else None
            cur.execute(
                """
                INSERT INTO departments
                (primary_building_id, dept_code, dept_name, dept_category, short_description, official_email, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, 'VERIFIED', 'ACTIVE')
                """,
                (primary_bid, code, name, cat, desc, email),
            )
            dept_map[code] = cur.lastrowid

        # 5. Institutional Offices, Departmental Offices & Reception Points
        # (Detailed room-by-room floor layouts are uploaded per department later)
        rooms_seed = [
            ("GATE-MAIN", 0, "SEC", "GATE-R1", "Main Gate Visitor Pass & Security Counter", "RECEPTION", 10, "Primary campus entry pass registration and visitor helpdesk."),
            ("ADMIN", 0, "ADMIN", "ADM-01", "Central Visitor & Admissions Helpdesk", "RECEPTION", 20, "Main administrative block reception and enquiry desk."),
            ("ADMIN", 0, "ADMIN", "ADM-02", "Admissions, Registrar & Academic Section", "ADMIN_OFFICE", 30, "Admissions verification, student records, and registrar services."),
            ("ADMIN", 0, "ADMIN", "ADM-03", "Office of the Principal", "ADMIN_OFFICE", 15, "Office of the Principal, R. V. College of Engineering."),
            ("ADMIN", 0, "ADMIN", "ADM-04", "Office of the Vice Principal", "ADMIN_OFFICE", 12, "Office of the Vice Principal, R. V. College of Engineering."),
            ("CSE", 0, "CSE", "CSE-OFF", "CSE Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Computer Science & Engineering office and HOD chamber."),
            ("AIML", 0, "AIML", "AIML-OFF", "AI & ML Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Artificial Intelligence & Machine Learning office."),
            ("ECE", 0, "ECE", "ECE-OFF", "ECE Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Electronics & Communication Engineering office."),
            ("EEE", 0, "EEE", "EEE-OFF", "EEE Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Electrical & Electronics Engineering office."),
            ("EEE", 1, "EIE", "EIE-OFF", "EIE Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Electronics & Instrumentation Engineering office."),
            ("ETE", 0, "ETE", "ETE-OFF", "Telecommunication Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Electronics & Telecommunication Engineering office."),
            ("ASE-ISE", 0, "ISE", "ISE-OFF", "ISE Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Information Science & Engineering office."),
            ("ASE-ISE", 1, "ASE", "ASE-OFF", "Aerospace Engineering Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Aerospace Engineering office."),
            ("ME", 0, "ME", "ME-OFF", "Mechanical Engineering Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Mechanical Engineering office."),
            ("CV", 0, "CV", "CV-OFF", "Civil Engineering Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Civil Engineering office."),
            ("BT", 0, "BT", "BT-OFF", "Biotechnology Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Biotechnology office."),
            ("CH-SCI", 0, "CH", "CH-OFF", "Chemical Engineering Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Chemical Engineering office."),
            ("CH-SCI", 1, "PHY", "PHY-OFF", "Physics Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Physics office."),
            ("CH-SCI", 1, "CHEM", "CHEM-OFF", "Chemistry Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Chemistry office."),
            ("CH-SCI", 2, "MATH", "MATH-OFF", "Mathematics Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Mathematics office."),
            ("IEM", 0, "IEM", "IEM-OFF", "IEM Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Industrial Engineering & Management office."),
            ("CC-HUB", 0, "MCA", "MCA-OFF", "MCA Department Office & HOD Cabin", "HOD_CABIN", 12, "Department of Master of Computer Applications office."),
            ("LIB", 0, "SPORTS_LIB", "LIB-01", "Central Library Circulation & Chief Librarian Office", "LIBRARY_ZONE", 40, "Central Library circulation counter and librarian office."),
        ]

        room_map: dict[str, int] = {}
        for bcode, fnum, dcode, rnum, rname, rtype, cap, desc in rooms_seed:
            fl_id = floor_map[(bcode, fnum)]
            cur.execute(
                """
                INSERT INTO rooms
                (floor_id, dept_id, room_number, room_name, room_type, capacity, description,
                 is_accessible, public_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, 'VERIFIED', 'ACTIVE')
                """,
                (fl_id, dept_map[dcode], rnum, rname, rtype, cap, desc),
            )
            room_map[rnum] = cur.lastrowid

        # 6. Official RVCE Faculty Roster (339 verified faculty) + Operational Portal Staff
        staff_map: dict[str, int] = {}
        cse_hod_staff_id: int | None = None
        cse_faculty_ids: list[int] = []

        dept_office_code_by_dept = {
            "CSE": "CSE-OFF",
            "AIML": "AIML-OFF",
            "ECE": "ECE-OFF",
            "EEE": "EEE-OFF",
            "EIE": "EIE-OFF",
            "ETE": "ETE-OFF",
            "ISE": "ISE-OFF",
            "ASE": "ASE-OFF",
            "ME": "ME-OFF",
            "CV": "CV-OFF",
            "BT": "BT-OFF",
            "CH": "CH-OFF",
            "PHY": "PHY-OFF",
            "CHEM": "CHEM-OFF",
            "MATH": "MATH-OFF",
            "IEM": "IEM-OFF",
            "MCA": "MCA-OFF",
        }

        for rec in faculty_records:
            emp = rec["employee_code"]
            dcode = rec["dept_code"]
            lrole = rec.get("leadership_role") or ""

            assigned_room_id: int | None = None
            if lrole == "Principal" or emp == "5716":
                assigned_room_id = room_map.get("ADM-03")
            elif lrole == "Vice Principal":
                assigned_room_id = room_map.get("ADM-04")
            elif dcode == "SPORTS_LIB" and "Librarian" in lrole:
                assigned_room_id = room_map.get("LIB-01")
            elif "HOD" in lrole and dcode in dept_office_code_by_dept:
                assigned_room_id = room_map.get(dept_office_code_by_dept[dcode])

            cur.execute(
                """
                INSERT INTO staff
                (dept_id, office_room_id, employee_code, display_name, qualification, designation,
                 cadre_rank, program_name, leadership_role, staff_type, date_of_joining,
                 professor_designated_date, currently_associated, association_nature,
                 employment_mode, deputation_remarks, public_email, profile_visibility,
                 verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, 'PUBLIC', 'VERIFIED', %s)
                """,
                (
                    dept_map[dcode],
                    assigned_room_id,
                    emp,
                    rec["display_name"],
                    rec.get("qualification"),
                    rec["designation"],
                    rec["cadre_rank"],
                    rec.get("program_name"),
                    rec.get("leadership_role"),
                    rec["staff_type"],
                    rec.get("date_of_joining"),
                    rec.get("professor_designated_date"),
                    bool(rec.get("currently_associated", True)),
                    rec.get("association_nature", "REGULAR"),
                    rec.get("employment_mode", "FULL_TIME"),
                    rec.get("deputation_remarks"),
                    rec.get("status", "ACTIVE"),
                ),
            )
            sid = cur.lastrowid
            staff_map[emp] = sid
            if dcode == "CSE" and "HOD" in lrole and cse_hod_staff_id is None:
                cse_hod_staff_id = sid
            elif dcode == "CSE" and rec.get("status") == "ACTIVE":
                cse_faculty_ids.append(sid)

        # Internal operational staff for facility & gate desk accounts (kept INTERNAL_ONLY)
        ops_staff = [
            ("ADMIN", "ADM-02", "RV-OPS-ADMIN", "Campus Estate & Facility Coordinator", "Facility Operations Coordinator", "ADMIN_STAFF"),
            ("SEC", "GATE-R1", "RV-OPS-SEC", "Main Gate Security Supervisor", "Chief Security Supervisor", "SECURITY_STAFF"),
        ]
        for dcode, rnum, emp, name, desig, stype in ops_staff:
            cur.execute(
                """
                INSERT INTO staff
                (dept_id, office_room_id, employee_code, display_name, designation, cadre_rank, staff_type,
                 profile_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, 7, %s, 'INTERNAL_ONLY', 'VERIFIED', 'ACTIVE')
                """,
                (dept_map[dcode], room_map.get(rnum), emp, name, desig, stype),
            )
            staff_map[emp] = cur.lastrowid

        primary_cse_hod = cse_hod_staff_id or cse_faculty_ids[0]
        primary_cse_fac = cse_faculty_ids[0]
        secondary_cse_fac = cse_faculty_ids[1] if len(cse_faculty_ids) > 1 else cse_faculty_ids[0]

        # 7. Cognito Identity Mapped Accounts & Controlled Staff Eligibility Allowlist
        #    NOTE: Zero passwords or password hashes exist in MySQL. `cognito_sub` holds
        #    the immutable external OIDC Subject UUID issued by Amazon Cognito.
        users_seed = [
            (
                "00000000-0000-4000-8000-000000000001",
                None,
                "sysadmin",
                "sysadmin@rvce.edu.in",
                "RVCE Portal Institutional Administrator",
                ["ADMIN", "SYSTEM_ADMIN", "FACILITY_ADMIN"],
            ),
            (
                "00000000-0000-4000-8000-000000000002",
                staff_map["RV-OPS-ADMIN"],
                "facility.admin",
                "facilities@rvce.edu.in",
                "Campus Estate & Facility Coordinator",
                ["ADMIN", "FACILITY_ADMIN"],
            ),
            (
                "00000000-0000-4000-8000-000000000003",
                staff_map["RV-OPS-SEC"],
                "security.desk",
                "security@rvce.edu.in",
                "Main Gate Security Supervisor",
                ["STAFF", "SECURITY_RECEPTION"],
            ),
            (
                "00000000-0000-4000-8000-000000000004",
                primary_cse_hod,
                "hod.cse",
                "hod.cse@rvce.edu.in",
                "Head of Department — CSE",
                ["FACULTY", "FACULTY_STAFF", "DEPT_COORDINATOR"],
            ),
            (
                "00000000-0000-4000-8000-000000000005",
                primary_cse_fac,
                "faculty.cse",
                "faculty.cse@rvce.edu.in",
                "Senior Faculty Member — CSE",
                ["FACULTY", "FACULTY_STAFF"],
            ),
        ]
        user_map: dict[str, int] = {}
        for cog_sub, linked_staff, uname, email, fname, rcodes in users_seed:
            cur.execute(
                """
                INSERT INTO users
                (cognito_sub, linked_staff_id, username, email, full_name, auth_provider,
                 email_verified, approval_status, terms_accepted_at, approved_at, tokens_valid_after, is_active)
                VALUES (
                    %s, %s, %s, %s, %s, 'COGNITO_OIDC',
                    TRUE, 'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 SECOND), TRUE
                )
                """,
                (cog_sub, linked_staff, uname, email, fname),
            )
            uid = cur.lastrowid
            user_map[uname] = uid
            for rc in rcodes:
                cur.execute(
                    "INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                    (uid, role_map[rc]),
                )

        # Controlled Administrator-Managed Staff Eligibility Allowlist (@rvce.edu.in)
        allowlist_seed = [
            ("hod.cse@rvce.edu.in", primary_cse_hod, "FACULTY", "Verified CSE Head of Department"),
            ("faculty.cse@rvce.edu.in", primary_cse_fac, "FACULTY", "Verified CSE Teaching Faculty"),
            ("cse.faculty2@rvce.edu.in", secondary_cse_fac, "FACULTY", "Pre-authorised CSE Faculty Member for self-registration"),
            ("security@rvce.edu.in", staff_map["RV-OPS-SEC"], "STAFF", "Authorised Main Gate Security Desk"),
        ]
        for al_email, al_staff_id, al_role, al_note in allowlist_seed:
            cur.execute(
                """
                INSERT INTO staff_eligibility_allowlist
                (email, linked_staff_id, assigned_role_code, is_active, added_by_user_id, notes)
                VALUES (%s, %s, %s, TRUE, %s, %s)
                """,
                (al_email, al_staff_id, al_role, user_map["sysadmin"], al_note),
            )

        # 8. Verified Campus Facilities / POIs (12 OpenStreetMap-surveyed RVCE locations)
        facility_room_links = {
            "GATE-MAIN": ("GATE-MAIN", 0, "GATE-R1"),
            "ADMIN": ("ADMIN", 0, "ADM-02"),
            "LIB": ("LIB", 0, "LIB-01"),
        }
        for fc in osm_facilities:
            bcode = fc.get("building_code")
            bid = building_map.get(bcode) if bcode else None
            fid: int | None = None
            rid: int | None = None
            if bcode in facility_room_links:
                fb_code, fb_floor, fb_room = facility_room_links[bcode]
                fid = floor_map.get((fb_code, fb_floor))
                rid = room_map.get(fb_room)

            cur.execute(
                """
                INSERT INTO facilities
                (campus_id, building_id, floor_id, room_id, facility_name, category, description,
                 latitude, longitude, opening_hours, is_accessible, public_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, 'VERIFIED', 'ACTIVE')
                """,
                (
                    campus_id,
                    bid,
                    fid,
                    rid,
                    fc["facility_name"],
                    fc["category"],
                    fc.get("description"),
                    fc["latitude"],
                    fc["longitude"],
                    fc.get("opening_hours"),
                ),
            )

        # 9. Faculty Availability Statuses (Demonstrates active, scheduled, and auto-expiring windows)
        avail_seed = [
            (primary_cse_hod, "AVAILABLE", "FACULTY_SELF", "Available for visitor and student consultation in CSE Department Office.", now - timedelta(minutes=25), now + timedelta(hours=4), user_map["hod.cse"]),
            (primary_cse_fac, "BUSY_SCHEDULED", "APPROVED_SCHEDULE", "In scheduled lecture session.", now - timedelta(minutes=15), now + timedelta(hours=2), user_map["faculty.cse"]),
            (secondary_cse_fac, "AVAILABLE", "DEPARTMENT_OFFICE", "Expired status window.", now - timedelta(hours=6), now - timedelta(hours=2), user_map["hod.cse"]),
        ]
        for sid, state, src, note, vfrom, vuntil, uid in avail_seed:
            cur.execute(
                """
                INSERT INTO faculty_availability
                (staff_id, availability_state, source_type, public_note, valid_from, valid_until, updated_by_user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (sid, state, src, note, vfrom, vuntil, uid),
            )

        # 10. Visitor Passes via Transactional Stored Procedure
        cur.execute(
            """
            CALL sp_register_visitor_pass(
                'Arjun Deshmukh', '+91-9845012345', 'arjun.deshmukh@example.org',
                'Parent / Prospective Applicant', %s, %s, %s, NULL,
                'Admissions & Campus Tour Enquiry', 'Main Mysuru Road Gate', FALSE, %s,
                @v_id1, @v_code1
            )
            """,
            (campus_id, building_map["ADMIN"], room_map["ADM-02"], user_map["security.desk"]),
        )
        cur.execute("SELECT @v_id1 AS vid")
        vid1 = cur.fetchone()["vid"]
        cur.execute("CALL sp_record_gate_action(%s, 'CHECK_IN', %s, 'Main Mysuru Road Gate')", (vid1, user_map["security.desk"]))

        cur.execute(
            """
            CALL sp_register_visitor_pass(
                'Priya Subramanian', '+91-9886098765', 'priya.s@techcorp.in',
                'Industry Research Collaborator', %s, %s, %s, %s,
                'Research collaboration meeting with CSE Department', 'Main Mysuru Road Gate', TRUE, %s,
                @v_id2, @v_code2
            )
            """,
            (campus_id, building_map["CSE"], room_map["CSE-OFF"], primary_cse_hod, user_map["security.desk"]),
        )

    conn.commit()
    print(
        f"[MySQL] Seeded {len(osm_buildings)} verified RVCE buildings, "
        f"{len(depts)} departments, {len(faculty_records)} official faculty records, "
        f"and {len(osm_facilities)} campus facilities."
    )

    # Seed MongoDB 9.0 Geospatial Polygons & Campus Routing Network
    routing_path = ROOT_DIR / "database" / "seed_data" / "rvce_campus_routing_network.json"
    routing_payload = (
        json.loads(routing_path.read_text(encoding="utf-8")) if routing_path.exists() else None
    )
    mclient = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    mdb = mclient[mongo_db_name]
    ensure_collections_and_indexes(mdb)
    seed_sample_nosql_documents(
        mdb,
        campus_id=campus_id,
        building_map=building_map,
        floor_plan_map={},
        osm_campus_payload=osm_payload,
        routing_payload=routing_payload,
    )
    seed_eee_building_floors_and_cabins(conn, mdb, building_map)
    mclient.close()
    print(f"[MongoDB] Initialized `{mongo_db_name}` with verified RVCE GeoJSON geometries, EEE 3-floor plans, & 479 routing pathway segments (2dsphere indexed).")


def seed_eee_building_floors_and_cabins(
    conn: pymysql.connections.Connection,
    mdb: Any,
    building_map: dict[str, int],
) -> None:
    """Seeds authoritative EEE 3-floor architectural rooms, faculty cabin mappings (including door plaques & Kannada faculty), and MongoDB overlays."""
    from datetime import datetime, timezone

    eee_bid = building_map.get("EEE", 7)
    ground_rooms = [
        ("EEE-001", "HoD Room - Electrical & Electronics", "HOD_CABIN", 15, "Head of the Department Cabin, EEE"),
        ("EEE-002", "Office Room - EEE Department", "ADMIN_OFFICE", 12, "Department Administrative & Examination Office"),
        ("EEE-003", "Staff Room - EEE 003", "FACULTY_OFFICE", 10, "Faculty Workstations & Office"),
        ("EEE-004", "Lapp Cable Lab", "LABORATORY", 30, "Lapp Center of Excellence for Cable Technology & Testing"),
        ("EEE-005", "ADDC / Controls Lab", "LABORATORY", 35, "Analog & Digital Devices / Control Systems Laboratory"),
        ("EEE-006", "ELIC / PE Lab", "LABORATORY", 35, "Electronic Instrumentation & Power Electronics Laboratory"),
        ("EEE-007", "Simulation Lab", "LABORATORY", 40, "Power Systems & Electrical Circuit Simulation Lab"),
        ("EEE-010", "Restrooms (GF)", "RESTROOM", None, "Ground Floor Washrooms"),
        ("EEE-011", "Machines Lab", "LABORATORY", 50, "DC & AC Electrical Machines Laboratory"),
        ("EEE-011A", "E-Mobility Lab", "LABORATORY", 35, "Electric Vehicle, Battery & Powertrain Research Lab"),
        ("EEE-011B", "HV Lab (High Voltage)", "LABORATORY", 30, "High Voltage & Dielectric Testing Laboratory"),
    ]
    first_floor_rooms = [
        ("EEE-101", "Counselling Room & Staff Cabin - EEE 101", "FACULTY_OFFICE", 8, "Faculty & Counselling Cabin: Dr. Suresha C, Dr. Parth Sarathi Panigrahy"),
        ("EEE-102", "M.Tech Lab", "LABORATORY", 30, "Power Electronics & Energy Systems M.Tech Research Lab"),
        ("EEE-103", "Class Room - EEE 103", "CLASSROOM", 70, "UG Smart Lecture Hall"),
        ("EEE-104", "Staff Room - EEE 104", "FACULTY_OFFICE", 12, "Faculty Cabin: Dr. Adinath Jain, Dr. Madhu B R, Dr. Sushmita Sarkar, Dr. Raja Vidya, Dr. Abhilash Krishna, Ms. Lakshmi R K, Ms. Vanishree, Ms. Lalithamma"),
        ("EEE-105", "Department Library", "LIBRARY_ZONE", 40, "EEE & EIE Department Reference Library"),
        ("EEE-107", "Class Room - EEE 107", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-117", "Class Room - EEE 117", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-116", "Class Room - EEE 116", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-115", "Staff Room - EEE 115", "FACULTY_OFFICE", 10, "Faculty Cabin: Dr. Nagaraju P, Dr. Rachana S Akki, Dr. Sunanda C, Dr. Ajay K M, Dr. Pandry Narendra Rao"),
        ("EEE-114", "Class Room - EEE 114", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-113", "Class Room - EEE 113", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-112", "Class Room - EEE 112", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-108", "Toilets - EEE 108 to 111", "RESTROOM", None, "First Floor Restrooms & Washrooms"),
    ]
    second_floor_rooms = [
        ("EEE-201", "Staff Room - EEE 201", "FACULTY_OFFICE", 15, "Faculty Cabin: Shwetha Baliga, Dr. Anusha L S, Sujata Priyambada Mishra, Deepika P, Neeta B Malvi, Dr. Keshav M, Abhay Deshpande, Ravishankar Holla, Dr. Jagannatha Guptha V L, Dr. Rohini S Hallikar"),
        ("EEE-202A", "R & D Lab - EEE 202(A)", "LABORATORY", 30, "Research & Development Center"),
        ("EEE-202B", "Class Room - EEE 202(B)", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-203", "Class Room - EEE 203", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-204", "Class Room - EEE 204", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-205", "Staff Room - EEE 205", "FACULTY_OFFICE", 10, "Faculty Cabin: Dr. Ramesh K B, Dr. Anand Jatti, Dr. Shylashree N, Dr. S. Ravishankar, Dr. Mahesh A"),
        ("EEE-207", "ABB / Micro Grid Lab", "LABORATORY", 40, "ABB Smart Microgrid & Industrial Automation Laboratory"),
        ("EEE-215", "Class Room - EEE 215", "CLASSROOM", 70, "UG Lecture Hall"),
        ("EEE-214", "SSP / MC Lab - EEE 214", "LABORATORY", 40, "Signal Processing & Microcontroller Laboratory"),
        ("EEE-ECH", "ECE Seminar Hall", "SEMINAR_HALL", 150, "Air-Conditioned Audiovisual Seminar Hall & Auditorium"),
        ("EEE-208", "Toilets - EEE 208 to 210", "RESTROOM", None, "Second Floor Washrooms"),
    ]

    room_id_by_num: dict[str, int] = {}
    floor_id_by_num: dict[int, int] = {}
    plan_id_by_floor: dict[int, int] = {}

    with conn.cursor() as cur:
        cur.execute("SELECT floor_id, floor_number FROM floors WHERE building_id = %s", (eee_bid,))
        for r in cur.fetchall():
            floor_id_by_num[int(r["floor_number"])] = int(r["floor_id"])

        cur.execute("SELECT dept_id FROM departments WHERE dept_code = 'EEE' LIMIT 1")
        eee_dept_row = cur.fetchone()
        eee_dept_id = int(eee_dept_row["dept_id"]) if eee_dept_row else 7

        for fnum, room_defs in [(0, ground_rooms), (1, first_floor_rooms), (2, second_floor_rooms)]:
            fid = floor_id_by_num.get(fnum)
            if not fid:
                continue
            for rnum, rname, rtype, cap, desc in room_defs:
                cur.execute("SELECT room_id FROM rooms WHERE floor_id = %s AND room_number = %s", (fid, rnum))
                existing = cur.fetchone()
                if existing:
                    rid = int(existing["room_id"])
                    cur.execute(
                        "UPDATE rooms SET room_name=%s, room_type=%s, capacity=%s, description=%s WHERE room_id=%s",
                        (rname, rtype, cap, desc, rid),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO rooms (floor_id, dept_id, room_number, room_name, room_type, capacity, description, is_accessible, public_visibility, verification_status, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, 'VERIFIED', 'ACTIVE')
                        """,
                        (fid, eee_dept_id, rnum, rname, rtype, cap, desc),
                    )
                    rid = int(cur.lastrowid)
                room_id_by_num[rnum] = rid

        # Map faculty by staff_id to their verified EEE cabins
        cabin_staff_ids: dict[str, list[int]] = {
            "EEE-001": [181],
            "EEE-101": [172, 177],
            "EEE-104": [169, 174, 175, 176, 182, 222, 223, 224],
            "EEE-115": [193, 170, 171, 173, 178],
            "EEE-201": [152, 154, 149, 151, 150, 257, 130, 147, 273, 137],
            "EEE-205": [128, 187, 162, 159, 131],
        }
        for rnum, sids in cabin_staff_ids.items():
            rid = room_id_by_num.get(rnum)
            if not rid:
                continue
            for sid in sids:
                cur.execute("UPDATE staff SET office_room_id = %s WHERE staff_id = %s", (rid, sid))

        cur.execute(
            "UPDATE staff SET program_name = 'Kannada ( Humanities & Basic Sciences )' WHERE staff_id IN (222, 223, 224)"
        )

        # Create/approve floor_plans for GF, 1F, 2F
        for fnum, ver, src in [
            (0, "v2.0-GF-Architectural", "Official EEE Department Ground Floor Layout Plan"),
            (1, "v2.0-1F-Architectural", "Official EEE Department First Floor Layout Plan"),
            (2, "v2.0-2F-Architectural", "Official EEE Department Second Floor Layout Plan"),
        ]:
            fid = floor_id_by_num.get(fnum)
            if not fid:
                continue
            cur.execute("SELECT floor_plan_id FROM floor_plans WHERE floor_id = %s LIMIT 1", (fid,))
            fp_row = cur.fetchone()
            if fp_row:
                fpid = int(fp_row["floor_plan_id"])
                cur.execute(
                    "UPDATE floor_plans SET approval_status='APPROVED', is_active_public=TRUE, is_schematic_sample=FALSE, version_label=%s WHERE floor_plan_id=%s",
                    (ver, fpid),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO floor_plans (floor_id, version_label, file_format, canvas_width, canvas_height, coordinate_space, source_reference, approval_status, is_active_public, is_schematic_sample, approved_at)
                    VALUES (%s, %s, 'VECTOR_OVERLAY', 1000, 680, 'NORMALIZED_1000', %s, 'APPROVED', TRUE, FALSE, NOW())
                    """,
                    (fid, ver, src),
                )
                fpid = int(cur.lastrowid)
            plan_id_by_floor[fid] = fpid

    conn.commit()

    gf_bounds = {
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
    }
    f1_bounds = {
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
    }
    f2_bounds = {
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
    }

    for fnum, room_defs, bounds_map, clabel in [
        (0, ground_rooms, gf_bounds, "Ground Floor Central Corridor & Quadrangle"),
        (1, first_floor_rooms, f1_bounds, "First Floor Central Corridor & Open Atrium"),
        (2, second_floor_rooms, f2_bounds, "Second Floor Central Corridor & Open Atrium"),
    ]:
        fid = floor_id_by_num.get(fnum)
        if not fid or fid not in plan_id_by_floor:
            continue
        fpid = plan_id_by_floor[fid]
        ov_rooms = []
        for rnum, rname, rtype, _, _ in room_defs:
            rid = room_id_by_num.get(rnum)
            b = bounds_map.get(rnum)
            if rid and b:
                ov_rooms.append({
                    "room_id": rid,
                    "room_number": rnum,
                    "label": rname,
                    "category": rtype,
                    "bounds": b,
                })
        doc = {
            "floor_plan_id": fpid,
            "floor_id": fid,
            "building_id": eee_bid,
            "coordinate_space": "NORMALIZED_1000",
            "is_schematic_sample": False,
            "canvas": {"width": 1000, "height": 680},
            "corridors": [
                {"x": 360, "y": 60, "w": 20, "h": 540, "label": "West Wing Corridor"},
                {"x": 620, "y": 60, "w": 20, "h": 540, "label": "East Wing Corridor"},
                {"x": 360, "y": 180, "w": 280, "h": 20, "label": "Cross Corridor North"},
                {"x": 360, "y": 470, "w": 280, "h": 20, "label": "Cross Corridor South"},
                {"x": 380, "y": 200, "w": 240, "h": 270, "label": clabel},
            ],
            "landmarks": [
                {"type": "STAIRS", "x": 370, "y": 50, "label": "North Staircase"},
                {"type": "STAIRS", "x": 370, "y": 610, "label": "South Staircase"},
                {"type": "LIFT", "x": 630, "y": 50, "label": "Elevator"},
                {"type": "ENTRANCE", "x": 500, "y": 630, "label": "Main Floor Access"},
            ],
            "rooms": ov_rooms,
            "route_network": {"is_verified": True, "nodes": [], "edges": []},
            "updated_at": datetime.now(timezone.utc),
        }
        mdb.floor_plan_overlays.replace_one({"floor_plan_id": fpid}, doc, upsert=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision MySQL 8.0 and MongoDB 9.0 databases for RVCE Campus Navigator.")
    parser.add_argument("--seed", action="store_true", help="Seed institutional campus & faculty records after applying schema.")
    parser.add_argument("--schema-only", action="store_true", help="Apply MySQL DDL/Views/Triggers/Procedures and MongoDB validators without seed data.")
    parser.add_argument("--mongo-only", action="store_true", help="Initialize MongoDB collections and validators only.")
    args = parser.parse_args()

    file_env = load_dotenv_file(ROOT_DIR / ".env")
    cfg = {**load_dotenv_file(ROOT_DIR / ".env.example"), **file_env, **os.environ}

    mongo_uri = cfg.get("MONGODB_URI", "mongodb://127.0.0.1:27017")
    mongo_db = cfg.get("MONGODB_DATABASE", "campusguide_nosql")

    if args.mongo_only:
        mclient = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        ensure_collections_and_indexes(mclient[mongo_db])
        mclient.close()
        print(f"[MongoDB] `{mongo_db}` collections and indexes verified.")
        return

    conn = apply_mysql_schema(cfg)
    try:
        if args.seed and not args.schema_only:
            seed_mysql_and_mongo(
                conn,
                mongo_uri=mongo_uri,
                mongo_db_name=mongo_db,
            )
        else:
            mclient = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            ensure_collections_and_indexes(mclient[mongo_db])
            mclient.close()
            print(f"[MongoDB] `{mongo_db}` collections and indexes verified.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
