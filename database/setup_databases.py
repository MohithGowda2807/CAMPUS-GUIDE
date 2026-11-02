"""
Unified Database Provisioning & Sample Seed Tool (MySQL 8.0+ & MongoDB 9.0+)

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
from datetime import datetime, timedelta, timezone
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

        # 2. Primary Campus Record (Supplied RVCE Centre: 12.923333, 77.499506, Zoom 18)
        cur.execute(
            """
            INSERT INTO campuses (campus_code, campus_name, address, latitude, longitude, default_zoom, verification_status, status)
            VALUES (%s, %s, %s, %s, %s, %s, 'SAMPLE_DEV', 'ACTIVE')
            """,
            (
                "RVCE-MAIN",
                "R. V. College of Engineering",
                "RV Vidyaniketan Post, 8th Mile, Mysuru Road, Bengaluru, Karnataka 560059",
                12.923333,
                77.499506,
                18,
            ),
        )
        campus_id = cur.lastrowid

        # 3. Official RVCE Academic Departments & Institutional Units
        depts = [
            ("ASE", "Department of Aerospace Engineering", "ENGINEERING", "Undergraduate and research programmes in aerodynamics, propulsion, avionics, and flight structures.", "ase@rvce.edu.in", "VERIFIED"),
            ("AIML", "Department of Artificial Intelligence and Machine Learning", "ENGINEERING", "Undergraduate and research programmes in machine learning, deep learning, and intelligent systems.", "aiml@rvce.edu.in", "VERIFIED"),
            ("BT", "Department of Biotechnology", "ENGINEERING", "Undergraduate, postgraduate, and doctoral programmes in bioprocess, genetics, and bioinformatics.", "bt@rvce.edu.in", "VERIFIED"),
            ("CH", "Department of Chemical Engineering", "ENGINEERING", "Process engineering, reaction engineering, environmental sustainability, and materials.", "che@rvce.edu.in", "VERIFIED"),
            ("CV", "Department of Civil Engineering", "ENGINEERING", "Structural, highway, geotechnical, environmental, and transportation engineering programmes.", "civil@rvce.edu.in", "VERIFIED"),
            ("CSE", "Department of Computer Science and Engineering", "ENGINEERING", "UG & PG programmes in Computer Science, Data Science, Cyber Security, AI & ML, and Computer Networks.", "cse@rvce.edu.in", "VERIFIED"),
            ("EEE", "Department of Electrical and Electronics Engineering", "ENGINEERING", "Power systems, power electronics, smart grids, high-voltage engineering, and control.", "eee@rvce.edu.in", "VERIFIED"),
            ("ECE", "Department of Electronics and Communication Engineering", "ENGINEERING", "UG & PG programmes in VLSI Design, Embedded Systems, Signal Processing, and Communication Systems.", "ece@rvce.edu.in", "VERIFIED"),
            ("EIE", "Department of Electronics and Instrumentation Engineering", "ENGINEERING", "Industrial automation, sensors, biomedical instrumentation, and embedded control.", "eie@rvce.edu.in", "VERIFIED"),
            ("ETE", "Department of Electronics and Telecommunication Engineering", "ENGINEERING", "RF, microwave, wireless networks, optical communication, and digital communication engineering.", "ete@rvce.edu.in", "VERIFIED"),
            ("IEM", "Department of Industrial Engineering and Management", "ENGINEERING", "Operations research, supply chain analytics, quality engineering, and institutional management.", "iem@rvce.edu.in", "VERIFIED"),
            ("ISE", "Department of Information Science and Engineering", "ENGINEERING", "UG & PG programmes in Software Engineering, Information Technology, and Enterprise Data Systems.", "ise@rvce.edu.in", "VERIFIED"),
            ("ME", "Department of Mechanical Engineering", "ENGINEERING", "UG & PG programmes in Machine Design, Product Design & Manufacturing, Thermal, and CIM.", "me@rvce.edu.in", "VERIFIED"),
            ("MCA", "Department of Master of Computer Applications", "PG_PROGRAMME", "Postgraduate applications computing, enterprise software architecture, and cloud systems.", "mca@rvce.edu.in", "VERIFIED"),
            ("PHY", "Department of Physics", "BASIC_SCIENCES", "Applied physics, materials science, optoelectronics, and foundational engineering sciences.", "physics@rvce.edu.in", "VERIFIED"),
            ("CHEM", "Department of Chemistry", "BASIC_SCIENCES", "Polymer science, nanomaterials, electrochemistry, and analytical chemistry.", "chemistry@rvce.edu.in", "VERIFIED"),
            ("MATH", "Department of Mathematics", "BASIC_SCIENCES", "Applied mathematics, linear algebra, stochastic modelling, optimization, and discrete structures.", "maths@rvce.edu.in", "VERIFIED"),
            ("SPORTS_LIB", "Central Library & Department of Physical Education", "CAMPUS_CENTRAL", "Institutional library & information services, digital knowledge centre, and campus sports.", "library@rvce.edu.in", "VERIFIED"),
            ("ADMIN", "Campus Administration & Student Affairs", "CAMPUS_CENTRAL", "Central administrative offices, admissions, examination section, and estate operations.", "admin@rvce.edu.in", "SAMPLE_DEV"),
            ("SEC", "Campus Security & Reception Services", "CAMPUS_CENTRAL", "Main Mysuru Road gate visitor management, campus safety, and reception helpdesk.", "security@rvce.edu.in", "SAMPLE_DEV"),
        ]
        dept_map: dict[str, int] = {}
        for code, name, cat, desc, email, vstat in depts:
            cur.execute(
                """
                INSERT INTO departments (dept_code, dept_name, dept_category, short_description, official_email, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')
                """,
                (code, name, cat, desc, email, vstat),
            )
            dept_map[code] = cur.lastrowid

        # 4. Sample Buildings (Marked SAMPLE_DEV — coordinates near RVCE center for development preview)
        buildings_seed = [
            ("ADMIN", "Administrative Block (Sample)", "ADMINISTRATION", "Principal office, admissions inquiry, registrar, and central administration.", 12.923550, 77.499400, 3, True),
            ("CSE", "Computer Science Block (Sample)", "ACADEMIC_BLOCK", "Classrooms, computing laboratories, seminar hall, and CSE faculty cabins.", 12.923920, 77.498750, 4, True),
            ("LIB", "Central Library & Digital Resource Centre (Sample)", "LIBRARY", "Reference halls, digital library terminals, periodicals, and reading zones.", 12.923100, 77.499850, 3, True),
            ("ECE", "Electronics & Communication Block (Sample)", "ACADEMIC_BLOCK", "ECE lecture halls, VLSI/embedded labs, and department offices.", 12.922820, 77.498950, 4, True),
            ("AUD", "Campus Auditorium & Seminar Complex (Sample)", "AUDITORIUM", "Institutional convocations, technical symposia, and guest lectures.", 12.924180, 77.500200, 2, True),
            ("GATE-1", "Main Mysuru Road Entrance & Visitor Reception (Sample)", "SECURITY_GATE", "Primary visitor registration desk, security checkpoint, and campus map kiosk.", 12.924880, 77.499520, 1, True),
        ]
        building_map: dict[str, int] = {}
        for code, name, btype, desc, lat, lng, nfloors, acc in buildings_seed:
            cur.execute(
                """
                INSERT INTO buildings
                (campus_id, building_code, building_name, building_type, description, latitude, longitude, total_floors, is_accessible, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'SAMPLE_DEV', 'ACTIVE')
                """,
                (campus_id, code, name, btype, desc, lat, lng, nfloors, acc),
            )
            building_map[code] = cur.lastrowid

        # 5. Floors & Rooms for Key Buildings
        floor_map: dict[tuple[str, int], int] = {}
        for bcode in ["ADMIN", "CSE", "LIB", "ECE", "GATE-1"]:
            floor_defs = (
                [(0, "Ground Floor", 0, True)]
                if bcode == "GATE-1"
                else [(0, "Ground Floor", 0, True), (1, "First Floor", 1, True), (2, "Second Floor", 2, True)]
            )
            for fnum, fname, order, lift in floor_defs:
                cur.execute(
                    """
                    INSERT INTO floors (building_id, floor_number, floor_name, display_order, has_lift_access, status)
                    VALUES (%s, %s, %s, %s, %s, 'ACTIVE')
                    """,
                    (building_map[bcode], fnum, fname, order, lift),
                )
                floor_map[(bcode, fnum)] = cur.lastrowid

        rooms_seed = [
            # CSE Ground Floor
            ("CSE", 0, "CSE", "CSE-G01", "Department Reception & Enquiry", "RECEPTION", 15, "Ground floor CSE reception and notice desk.", (80, 90, 175, 170)),
            ("CSE", 0, "CSE", "CSE-G02", "Lecture Hall G02", "CLASSROOM", 72, "Undergraduate smart classroom with projection.", (275, 90, 170, 170)),
            ("CSE", 0, "CSE", "CSE-G03", "Database & Systems Laboratory", "LABORATORY", 60, "Enterprise database and distributed systems lab.", (555, 90, 180, 170)),
            ("CSE", 0, "CSE", "CSE-G04", "HOD Cabin — CSE", "HOD_CABIN", 10, "Office of the Head of Department (Sample).", (755, 90, 165, 170)),
            ("CSE", 0, "CSE", "CSE-G05", "CSE Seminar Hall", "SEMINAR_HALL", 120, "Department seminar and project review hall.", (80, 385, 365, 180)),
            ("CSE", 0, "CSE", "CSE-G06", "Faculty Cabin Wing A", "FACULTY_OFFICE", 12, "Faculty consultation cabins (Sample).", (555, 385, 365, 180)),
            # CSE First Floor
            ("CSE", 1, "CSE", "CSE-101", "Lecture Hall 101", "CLASSROOM", 72, "First floor classroom.", (80, 90, 175, 170)),
            ("CSE", 1, "CSE", "CSE-102", "Algorithms & AI Laboratory", "LABORATORY", 60, "Computing laboratory on First Floor.", (275, 90, 170, 170)),
            ("CSE", 1, "CSE", "CSE-103", "Networks & Security Lab", "LABORATORY", 60, "Computer networks laboratory.", (555, 90, 180, 170)),
            ("CSE", 1, "CSE", "CSE-104", "Faculty Cabin Wing B", "FACULTY_OFFICE", 10, "Faculty offices on First Floor (Sample).", (755, 90, 165, 170)),
            # ADMIN Ground Floor
            ("ADMIN", 0, "ADMIN", "ADM-G01", "Central Visitor Helpdesk", "RECEPTION", 20, "Main administrative enquiry counter.", (80, 90, 175, 170)),
            ("ADMIN", 0, "ADMIN", "ADM-G02", "Admissions & Academic Section", "ADMIN_OFFICE", 30, "Admissions verification and student records.", (275, 90, 170, 170)),
            ("ADMIN", 0, "ADMIN", "ADM-G03", "Office of the Principal (Sample)", "ADMIN_OFFICE", 15, "Institutional leadership office.", (555, 90, 365, 170)),
            ("ADMIN", 0, "ADMIN", "ADM-G04", "Board Room", "SEMINAR_HALL", 40, "Institutional conference room.", (80, 385, 365, 180)),
            # LIB Ground Floor
            ("LIB", 0, "SPORTS_LIB", "LIB-G01", "Circulation & Issue Counter", "LIBRARY_ZONE", 25, "Library check-in and book circulation desk.", (80, 90, 365, 170)),
            ("LIB", 0, "SPORTS_LIB", "LIB-G02", "Reference & Reading Hall", "LIBRARY_ZONE", 150, "Quiet study and reference section.", (555, 90, 365, 170)),
            # ECE Ground Floor
            ("ECE", 0, "ECE", "ECE-G01", "ECE Department Office", "FACULTY_OFFICE", 12, "ECE department administrative & faculty office.", (80, 90, 365, 170)),
            ("ECE", 0, "ECE", "ECE-G02", "Embedded Systems Lab", "LABORATORY", 50, "Microcontrollers and digital systems lab.", (555, 90, 365, 170)),
            # Gate Reception
            ("GATE-1", 0, "SEC", "GATE-R1", "Main Gate Security Pass Counter", "RECEPTION", 10, "Visitor registration and pass check-in terminal.", (250, 180, 500, 260)),
        ]

        room_map: dict[str, int] = {}
        overlay_rooms_by_floor: dict[tuple[str, int], list[dict[str, Any]]] = {}

        for bcode, fnum, dcode, rnum, rname, rtype, cap, desc, bounds in rooms_seed:
            fl_id = floor_map[(bcode, fnum)]
            cur.execute(
                """
                INSERT INTO rooms
                (floor_id, dept_id, room_number, room_name, room_type, capacity, description, is_accessible, public_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, 'SAMPLE_DEV', 'ACTIVE')
                """,
                (fl_id, dept_map[dcode], rnum, rname, rtype, cap, desc),
            )
            rid = cur.lastrowid
            room_map[rnum] = rid
            x, y, w, h = bounds
            overlay_rooms_by_floor.setdefault((bcode, fnum), []).append(
                {
                    "room_id": rid,
                    "room_number": rnum,
                    "label": rname,
                    "category": rtype,
                    "bounds": {"x": x, "y": y, "w": w, "h": h},
                }
            )

        # 6. Official RVCE Faculty Roster (from database/seed_data/rvce_official_faculty_2026.json) + Operational Portal Staff
        roster_path = ROOT_DIR / "database" / "seed_data" / "rvce_official_faculty_2026.json"
        if not roster_path.exists():
            raise FileNotFoundError(f"Official RVCE faculty seed file missing: {roster_path}")
        roster_payload = json.loads(roster_path.read_text(encoding="utf-8"))
        faculty_records: list[dict[str, Any]] = roster_payload["faculty"]

        staff_map: dict[str, int] = {}
        cse_hod_staff_id: int | None = None
        cse_faculty_ids: list[int] = []

        for rec in faculty_records:
            emp = rec["employee_code"]
            dcode = rec["dept_code"]
            lrole = rec.get("leadership_role") or ""

            # Link representative cabins where sample floor-plan rooms exist
            assigned_room_id: int | None = None
            if lrole == "Principal" or emp == "5716":
                assigned_room_id = room_map.get("ADM-G03")
            elif dcode == "CSE" and "HOD" in lrole:
                assigned_room_id = room_map.get("CSE-G04")
            elif dcode == "ECE" and "HOD" in lrole:
                assigned_room_id = room_map.get("ECE-G01")
            elif dcode == "SPORTS_LIB" and "Librarian" in lrole:
                assigned_room_id = room_map.get("LIB-G01")
            elif dcode == "CSE" and len(cse_faculty_ids) == 0:
                assigned_room_id = room_map.get("CSE-G06")
            elif dcode == "CSE" and len(cse_faculty_ids) == 1:
                assigned_room_id = room_map.get("CSE-104")

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

        # Internal operational staff for facility & gate desk accounts (kept INTERNAL_ONLY so public directory is 100% official roster)
        ops_staff = [
            ("ADMIN", "ADM-G02", "RV-OPS-ADMIN", "Campus Estate & Facility Coordinator", "Facility Operations Coordinator", "ADMIN_STAFF"),
            ("SEC", "GATE-R1", "RV-OPS-SEC", "Main Gate Security Supervisor", "Chief Security Supervisor", "SECURITY_STAFF"),
        ]
        for dcode, rnum, emp, name, desig, stype in ops_staff:
            cur.execute(
                """
                INSERT INTO staff
                (dept_id, office_room_id, employee_code, display_name, designation, cadre_rank, staff_type,
                 profile_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, 7, %s, 'INTERNAL_ONLY', 'SAMPLE_DEV', 'ACTIVE')
                """,
                (dept_map[dcode], room_map.get(rnum), emp, name, desig, stype),
            )
            staff_map[emp] = cur.lastrowid

        primary_cse_hod = cse_hod_staff_id or cse_faculty_ids[0]
        primary_cse_fac = cse_faculty_ids[0]
        secondary_cse_fac = cse_faculty_ids[1] if len(cse_faculty_ids) > 1 else cse_faculty_ids[0]

        # System & Staff Accounts (Role-based accounts for portal operations)
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

        # 7. Sample Floor Plans (Approved schematic samples linked to MongoDB overlays)
        floor_plan_map: dict[str, dict[str, Any]] = {}
        for (bcode, fnum), rooms_ov in overlay_rooms_by_floor.items():
            fl_id = floor_map[(bcode, fnum)]
            cur.execute(
                """
                INSERT INTO floor_plans
                (floor_id, version_label, file_format, canvas_width, canvas_height, coordinate_space,
                 source_reference, approval_status, is_active_public, is_schematic_sample, approved_by_user_id, approved_at)
                VALUES (%s, 'v1.0-sample', 'VECTOR_OVERLAY', 1000, 650, 'NORMALIZED_1000',
                        'Development Schematic — Replace with Official RVCE Estate Drawing',
                        'APPROVED', TRUE, TRUE, %s, CURRENT_TIMESTAMP)
                """,
                (fl_id, user_map["facility.admin"]),
            )
            fp_id = cur.lastrowid
            floor_plan_map[f"{bcode}-F{fnum}"] = {
                "floor_plan_id": fp_id,
                "floor_id": fl_id,
                "building_id": building_map[bcode],
                "rooms_overlay": rooms_ov,
            }

        # 8. Sample Facilities / POIs (Indoor & Outdoor)
        facilities_seed = [
            (building_map["GATE-1"], floor_map[("GATE-1", 0)], room_map["GATE-R1"], "Main Gate Visitor Reception Desk (Sample)", "GATE_RECEPTION", "Visitor pass registration, enquiry, and campus map helpdesk.", 12.924880, 77.499520, "24x7 Security / Reception 08:30–17:30"),
            (building_map["LIB"], floor_map[("LIB", 0)], room_map["LIB-G01"], "Central Library Circulation Desk (Sample)", "LIBRARY", "Institutional library services and reading rooms.", 12.923100, 77.499850, "Mon–Sat: 08:30–20:00"),
            (None, None, None, "Campus Cafeteria & Food Court (Sample)", "CAFETERIA_FOOD", "Refreshments and dining area for students, staff, and visitors.", 12.922650, 77.499950, "Mon–Sat: 08:00–18:30"),
            (None, None, None, "Visitor Vehicle Parking Zone (Sample)", "PARKING", "Designated two-wheeler and four-wheeler visitor parking near main entrance.", 12.924620, 77.499180, "07:00–20:00"),
            (None, None, None, "Campus Bank & ATM Counter (Sample)", "BANK_ATM", "Banking and 24-hour ATM facility near entrance.", 12.924700, 77.499820, "ATM 24x7 / Branch 10:00–16:00"),
            (building_map["ADMIN"], floor_map[("ADMIN", 0)], room_map["ADM-G02"], "Admissions & Student Helpdesk (Sample)", "ADMIN_SERVICE", "Official admissions enquiry and document verification counter.", 12.923550, 77.499400, "Mon–Fri: 09:00–16:45, Sat: 09:00–13:00"),
        ]
        for bid, fid, rid, fname, cat, desc, lat, lng, hours in facilities_seed:
            cur.execute(
                """
                INSERT INTO facilities
                (campus_id, building_id, floor_id, room_id, facility_name, category, description, latitude, longitude, opening_hours, is_accessible, public_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, TRUE, 'SAMPLE_DEV', 'ACTIVE')
                """,
                (campus_id, bid, fid, rid, fname, cat, desc, lat, lng, hours),
            )

        # 9. Sample Faculty Availability (Demonstrates active, scheduled, and unknown/expired states)
        avail_seed = [
            (primary_cse_hod, "AVAILABLE", "FACULTY_SELF", "Available for visitor and student consultation in CSE-G04.", now - timedelta(minutes=25), now + timedelta(hours=3), user_map["hod.cse"]),
            (primary_cse_fac, "BUSY_SCHEDULED", "APPROVED_SCHEDULE", "Scheduled laboratory session in CSE-G03.", now - timedelta(minutes=15), now + timedelta(hours=2), user_map["faculty.cse"]),
            (secondary_cse_fac, "AVAILABLE", "DEPARTMENT_OFFICE", "Expired status window — automatically resolves to Unknown.", now - timedelta(hours=6), now - timedelta(hours=2), user_map["hod.cse"]),
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

        # 10. Sample Visitor Passes via Transactional Stored Procedure
        cur.execute(
            """
            CALL sp_register_visitor_pass(
                'Arjun Deshmukh (Sample Visitor)', '+91-9845012345', 'arjun.sample@example.org',
                'Parent / Prospective Applicant', %s, %s, %s, NULL,
                'Admissions & Campus Tour Enquiry', 'Main Mysuru Road Gate', FALSE, %s,
                @v_id1, @v_code1
            )
            """,
            (campus_id, building_map["ADMIN"], room_map["ADM-G02"], user_map["security.desk"]),
        )
        cur.execute("SELECT @v_id1 AS vid")
        vid1 = cur.fetchone()["vid"]
        cur.execute("CALL sp_record_gate_action(%s, 'CHECK_IN', %s, 'Main Mysuru Road Gate')", (vid1, user_map["security.desk"]))

        cur.execute(
            """
            CALL sp_register_visitor_pass(
                'Priya Subramanian (Sample Guest)', '+91-9886098765', 'priya.sample@techcorp.in',
                'Industry Research Collaborator', %s, %s, %s, %s,
                'Research collaboration meeting with CSE Department', 'Main Mysuru Road Gate', TRUE, %s,
                @v_id2, @v_code2
            )
            """,
            (campus_id, building_map["CSE"], room_map["CSE-G04"], primary_cse_hod, user_map["security.desk"]),
        )

    conn.commit()
    print(f"[MySQL] Seeded {len(faculty_records)} official RVCE faculty records, 20 institutional units, floor plans, and visitor passes.")

    # Seed MongoDB 9.0 Geospatial & Indoor Floor-Plan Vector Overlays
    mclient = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    mdb = mclient[mongo_db_name]
    ensure_collections_and_indexes(mdb)
    seed_sample_nosql_documents(mdb, campus_id, building_map, floor_plan_map)
    mclient.close()
    print(f"[MongoDB] Initialized `{mongo_db_name}` collections, $jsonSchema validators, 2dsphere index, and overlays.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Provision MySQL 8.0 and MongoDB 9.0 databases for RVCE Campus Navigator.")
    parser.add_argument("--seed", action="store_true", help="Seed sample development records after applying schema.")
    parser.add_argument("--schema-only", action="store_true", help="Apply MySQL DDL/Views/Triggers/Procedures and MongoDB validators without sample data.")
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
