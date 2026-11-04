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

import bcrypt
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
    default_password: str,
) -> None:
    pwd_hash = bcrypt.hashpw(default_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
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

        # 1. Institutional Roles
        roles = [
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

        # 7. System & Staff Accounts (Role-based accounts for portal operations)
        users_seed = [
            (None, "sysadmin", "sysadmin@rvce.edu.in", ["SYSTEM_ADMIN", "FACILITY_ADMIN"]),
            (staff_map["RV-OPS-ADMIN"], "facility.admin", "facilities@rvce.edu.in", ["FACILITY_ADMIN"]),
            (staff_map["RV-OPS-SEC"], "security.desk", "security@rvce.edu.in", ["SECURITY_RECEPTION"]),
            (primary_cse_hod, "hod.cse", "hod.cse@rvce.edu.in", ["FACULTY_STAFF", "DEPT_COORDINATOR"]),
            (primary_cse_fac, "faculty.cse", "faculty.cse@rvce.edu.in", ["FACULTY_STAFF"]),
        ]
        user_map: dict[str, int] = {}
        for linked_staff, uname, email, rcodes in users_seed:
            cur.execute(
                """
                INSERT INTO users (linked_staff_id, username, email, password_hash, auth_provider, is_active)
                VALUES (%s, %s, %s, %s, 'LOCAL', TRUE)
                """,
                (linked_staff, uname, email, pwd_hash),
            )
            uid = cur.lastrowid
            user_map[uname] = uid
            for rc in rcodes:
                cur.execute(
                    "INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                    (uid, role_map[rc]),
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

    # Seed MongoDB 9.0 Geospatial Polygons (Campus Perimeter + 28 Building Footprints)
    mclient = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    mdb = mclient[mongo_db_name]
    ensure_collections_and_indexes(mdb)
    seed_sample_nosql_documents(
        mdb,
        campus_id=campus_id,
        building_map=building_map,
        floor_plan_map={},
        osm_campus_payload=osm_payload,
    )
    mclient.close()
    print(f"[MongoDB] Initialized `{mongo_db_name}` with 29 verified RVCE OpenStreetMap GeoJSON geometries (2dsphere indexed).")


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
                default_password=cfg.get("DEV_SEED_DEFAULT_PASSWORD", "RvcePortal@2026"),
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
