"""
Unified Database Provisioning & Sample Seed Tool (MySQL 8.0+ & MongoDB 9.0+)

Usage:
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --seed
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --schema-only
    backend\\.venv\\Scripts\\python.exe database/setup_databases.py --mongo-only
"""

from __future__ import annotations

import argparse
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
    now = datetime.now(timezone.utc).replace(tzinfo=None)

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

        # 3. Sample Departments (Clearly marked SAMPLE_DEV until official import)
        depts = [
            ("CSE", "Department of Computer Science and Engineering", "Undergraduate, postgraduate, and research programmes in computing systems.", "cse.sample@rvce.edu.in"),
            ("ECE", "Department of Electronics and Communication Engineering", "Signal processing, VLSI, embedded systems, and communication engineering.", "ece.sample@rvce.edu.in"),
            ("ISE", "Department of Information Science and Engineering", "Software engineering, data systems, and enterprise computing.", "ise.sample@rvce.edu.in"),
            ("ADMIN", "Campus Administration & Student Affairs", "Central administrative offices, admissions, and institutional services.", "admin.sample@rvce.edu.in"),
            ("SEC", "Campus Security & Reception Services", "Main gate visitor management, campus safety, and reception desk.", "security.sample@rvce.edu.in"),
        ]
        dept_map: dict[str, int] = {}
        for code, name, desc, email in depts:
            cur.execute(
                """
                INSERT INTO departments (dept_code, dept_name, short_description, official_email, verification_status, status)
                VALUES (%s, %s, %s, %s, 'SAMPLE_DEV', 'ACTIVE')
                """,
                (code, name, desc, email),
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
            ("LIB", 0, "ADMIN", "LIB-G01", "Circulation & Issue Counter", "LIBRARY_ZONE", 25, "Library check-in and book circulation desk.", (80, 90, 365, 170)),
            ("LIB", 0, "ADMIN", "LIB-G02", "Reference & Reading Hall", "LIBRARY_ZONE", 150, "Quiet study and reference section.", (555, 90, 365, 170)),
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

        # 6. Staff / Faculty Sample Profiles & Users
        staff_seed = [
            ("CSE", "CSE-G04", "RV-SAMPLE-001", "Dr. Ananya Rao (Sample)", "Professor & Head (Sample)", "FACULTY", "hod.cse.sample@rvce.edu.in"),
            ("CSE", "CSE-G06", "RV-SAMPLE-002", "Dr. Karthik Murthy (Sample)", "Associate Professor (Sample)", "FACULTY", "karthik.sample@rvce.edu.in"),
            ("CSE", "CSE-104", "RV-SAMPLE-003", "Prof. Meera Nair (Sample)", "Assistant Professor (Sample)", "FACULTY", "meera.sample@rvce.edu.in"),
            ("ECE", "ECE-G01", "RV-SAMPLE-004", "Dr. Rajesh Kulkarni (Sample)", "Professor (Sample)", "FACULTY", "rajesh.sample@rvce.edu.in"),
            ("ADMIN", "ADM-G02", "RV-SAMPLE-005", "Suresh Babu (Sample)", "Facility Operations Coordinator (Sample)", "ADMIN_STAFF", "facilities.sample@rvce.edu.in"),
            ("SEC", "GATE-R1", "RV-SAMPLE-006", "Ramesh Naik (Sample)", "Chief Security Supervisor (Sample)", "SECURITY_STAFF", "gate.sample@rvce.edu.in"),
        ]
        staff_map: dict[str, int] = {}
        for dcode, rnum, emp, name, desig, stype, email in staff_seed:
            cur.execute(
                """
                INSERT INTO staff
                (dept_id, office_room_id, employee_code, display_name, designation, staff_type, public_email, profile_visibility, verification_status, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'PUBLIC', 'SAMPLE_DEV', 'ACTIVE')
                """,
                (dept_map[dcode], room_map.get(rnum), emp, name, desig, stype, email),
            )
            staff_map[emp] = cur.lastrowid

        # System & Staff Accounts (Role-based accounts for portal testing)
        users_seed = [
            (None, "sysadmin", "sysadmin@rvce.edu.in", ["SYSTEM_ADMIN", "FACILITY_ADMIN"]),
            (staff_map["RV-SAMPLE-005"], "facility.admin", "facilities.sample@rvce.edu.in", ["FACILITY_ADMIN"]),
            (staff_map["RV-SAMPLE-006"], "security.desk", "gate.sample@rvce.edu.in", ["SECURITY_RECEPTION"]),
            (staff_map["RV-SAMPLE-001"], "hod.cse", "hod.cse.sample@rvce.edu.in", ["FACULTY_STAFF", "DEPT_COORDINATOR"]),
            (staff_map["RV-SAMPLE-002"], "faculty.cse", "karthik.sample@rvce.edu.in", ["FACULTY_STAFF"]),
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
            (staff_map["RV-SAMPLE-001"], "AVAILABLE", "FACULTY_SELF", "Available for visitor/student consultation in CSE-G04.", now - timedelta(minutes=25), now + timedelta(hours=3), user_map["hod.cse"]),
            (staff_map["RV-SAMPLE-002"], "BUSY_SCHEDULED", "APPROVED_SCHEDULE", "Scheduled laboratory session in CSE-G03.", now - timedelta(minutes=15), now + timedelta(hours=2), user_map["faculty.cse"]),
            (staff_map["RV-SAMPLE-003"], "AVAILABLE", "DEPARTMENT_OFFICE", "Expired sample status — automatically resolves to Unknown.", now - timedelta(hours=6), now - timedelta(hours=2), user_map["hod.cse"]),
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
            (campus_id, building_map["CSE"], room_map["CSE-G04"], staff_map["RV-SAMPLE-001"], user_map["security.desk"]),
        )

    conn.commit()
    print("[MySQL] Seeded sample development records, roles, staff, floor plans, and visitor passes.")

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
