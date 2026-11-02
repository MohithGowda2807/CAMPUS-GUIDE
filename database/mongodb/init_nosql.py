"""
MongoDB 9.0+ Geospatial, Indoor Floor-Plan Vector & Search Telemetry Bootstrap
Database: campusguide_nosql

Responsibilities strictly separated from MySQL (`campusguide`):
- `campus_geometries`: WGS84 GeoJSON campus boundary, building footprints & entrances (`2dsphere` indexed).
- `floor_plan_overlays`: Local-coordinate (0..1000 normalized) indoor SVG room polygons, corridors & landmarks.
  Indoor coordinates are strictly isolated from outdoor WGS84 coordinates.
- `search_telemetry`: High-write internal search event stream supporting aggregation analytics.
- `system_events`: Operational events with automatic 90-day TTL retention.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from pymongo import ASCENDING, DESCENDING, GEOSPHERE, MongoClient
from pymongo.database import Database


COLLECTION_VALIDATORS: dict[str, dict[str, Any]] = {
    "campus_geometries": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["entity_type", "mysql_id", "name", "geometry", "verification_status"],
            "properties": {
                "entity_type": {
                    "enum": ["CAMPUS_BOUNDARY", "BUILDING_FOOTPRINT", "ENTRANCE_NODE", "WALKWAY"]
                },
                "mysql_id": {"bsonType": "int"},
                "code": {"bsonType": "string"},
                "name": {"bsonType": "string"},
                "verification_status": {"enum": ["VERIFIED", "PENDING_REVIEW", "SAMPLE_DEV"]},
                "geometry": {
                    "bsonType": "object",
                    "required": ["type", "coordinates"],
                    "properties": {
                        "type": {"enum": ["Point", "Polygon", "LineString", "MultiPolygon"]},
                        "coordinates": {"bsonType": "array"},
                    },
                },
            },
        }
    },
    "floor_plan_overlays": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "floor_plan_id",
                "floor_id",
                "building_id",
                "coordinate_space",
                "canvas",
                "is_schematic_sample",
                "rooms",
            ],
            "properties": {
                "floor_plan_id": {"bsonType": "int"},
                "floor_id": {"bsonType": "int"},
                "building_id": {"bsonType": "int"},
                "coordinate_space": {"enum": ["NORMALIZED_1000", "LOCAL_PIXEL"]},
                "is_schematic_sample": {"bsonType": "bool"},
                "canvas": {
                    "bsonType": "object",
                    "required": ["width", "height"],
                    "properties": {
                        "width": {"bsonType": "int", "minimum": 100},
                        "height": {"bsonType": "int", "minimum": 100},
                    },
                },
                "rooms": {
                    "bsonType": "array",
                    "items": {
                        "bsonType": "object",
                        "required": ["room_id", "room_number", "bounds"],
                        "properties": {
                            "room_id": {"bsonType": "int"},
                            "room_number": {"bsonType": "string"},
                            "label": {"bsonType": "string"},
                            "category": {"bsonType": "string"},
                            "bounds": {
                                "bsonType": "object",
                                "required": ["x", "y", "w", "h"],
                                "properties": {
                                    "x": {"bsonType": ["int", "double"]},
                                    "y": {"bsonType": ["int", "double"]},
                                    "w": {"bsonType": ["int", "double"]},
                                    "h": {"bsonType": ["int", "double"]},
                                },
                            },
                        },
                    },
                },
            },
        }
    },
    "search_telemetry": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": ["query_text", "result_count", "created_at"],
            "properties": {
                "query_text": {"bsonType": "string"},
                "category_filter": {"bsonType": ["string", "null"]},
                "result_count": {"bsonType": "int", "minimum": 0},
                "duration_ms": {"bsonType": ["int", "double"]},
                "created_at": {"bsonType": "date"},
            },
        }
    },
}


def ensure_collections_and_indexes(db: Database) -> None:
    existing = set(db.list_collection_names())

    for coll_name, validator in COLLECTION_VALIDATORS.items():
        if coll_name not in existing:
            db.create_collection(coll_name, validator=validator, validationLevel="moderate")
        else:
            db.command("collMod", coll_name, validator=validator, validationLevel="moderate")

    if "system_events" not in existing:
        db.create_collection("system_events")

    # Geospatial 2dsphere index & lookup index on campus_geometries
    db.campus_geometries.create_index([("geometry", GEOSPHERE)], name="idx_geo_2dsphere")
    db.campus_geometries.create_index(
        [("entity_type", ASCENDING), ("mysql_id", ASCENDING)],
        unique=True,
        name="uq_entity_mysql_id",
    )

    # Indoor floor plan overlay lookup indexes
    db.floor_plan_overlays.create_index(
        [("floor_plan_id", ASCENDING)], unique=True, name="uq_floor_plan_id"
    )
    db.floor_plan_overlays.create_index(
        [("floor_id", ASCENDING), ("building_id", ASCENDING)], name="idx_floor_building"
    )

    # Search telemetry analytics indexes + 180-day retention
    db.search_telemetry.create_index(
        [("query_text", ASCENDING), ("created_at", DESCENDING)], name="idx_query_recent"
    )
    db.search_telemetry.create_index(
        [("created_at", ASCENDING)],
        expireAfterSeconds=180 * 24 * 3600,
        name="ttl_search_telemetry_180d",
    )

    # System events 90-day TTL index
    db.system_events.create_index(
        [("created_at", ASCENDING)],
        expireAfterSeconds=90 * 24 * 3600,
        name="ttl_system_events_90d",
    )


def seed_sample_nosql_documents(
    db: Database,
    campus_id: int,
    building_map: dict[str, int],
    floor_plan_map: dict[str, dict[str, Any]],
) -> None:
    """
    Seeds clearly flagged SAMPLE_DEV GeoJSON campus/building footprints and
    local-coordinate schematic indoor floor-plan overlays so the portal works
    end-to-end during development prior to official GIS/CAD upload.
    """
    now = datetime.now(timezone.utc)

    # Approximate schematic campus envelope around 12.923333, 77.499506 (tagged SAMPLE_DEV)
    geometries = [
        {
            "entity_type": "CAMPUS_BOUNDARY",
            "mysql_id": campus_id,
            "code": "RVCE-MAIN",
            "name": "RV College of Engineering — Campus Extent (Sample Envelope)",
            "verification_status": "SAMPLE_DEV",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [77.49690, 12.92550],
                        [77.50210, 12.92550],
                        [77.50210, 12.92110],
                        [77.49690, 12.92110],
                        [77.49690, 12.92550],
                    ]
                ],
            },
            "updated_at": now,
        }
    ]

    footprint_boxes = {
        "ADMIN": (12.92355, 77.49940, 0.00022, 0.00032),
        "CSE": (12.92392, 77.49875, 0.00024, 0.00035),
        "LIB": (12.92310, 77.49985, 0.00022, 0.00028),
        "ECE": (12.92282, 77.49895, 0.00023, 0.00034),
        "AUD": (12.92418, 77.50020, 0.00025, 0.00032),
        "GATE-1": (12.92488, 77.49952, 0.00010, 0.00014),
    }

    for code, b_id in building_map.items():
        if code in footprint_boxes:
            lat, lng, dlat, dlng = footprint_boxes[code]
            geometries.append(
                {
                    "entity_type": "BUILDING_FOOTPRINT",
                    "mysql_id": b_id,
                    "code": code,
                    "name": f"{code} Footprint (Sample Schematic)",
                    "verification_status": "SAMPLE_DEV",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [round(lng - dlng, 6), round(lat + dlat, 6)],
                                [round(lng + dlng, 6), round(lat + dlat, 6)],
                                [round(lng + dlng, 6), round(lat - dlat, 6)],
                                [round(lng - dlng, 6), round(lat - dlat, 6)],
                                [round(lng - dlng, 6), round(lat + dlat, 6)],
                            ]
                        ],
                    },
                    "updated_at": now,
                }
            )

    for doc in geometries:
        db.campus_geometries.replace_one(
            {"entity_type": doc["entity_type"], "mysql_id": doc["mysql_id"]},
            doc,
            upsert=True,
        )

    # Seed local-coordinate (NORMALIZED_1000: 1000x650) schematic indoor floor plans
    for plan_key, meta in floor_plan_map.items():
        rooms_payload = meta["rooms_overlay"]
        overlay_doc = {
            "floor_plan_id": meta["floor_plan_id"],
            "floor_id": meta["floor_id"],
            "building_id": meta["building_id"],
            "plan_key": plan_key,
            "coordinate_space": "NORMALIZED_1000",
            "is_schematic_sample": True,
            "canvas": {"width": 1000, "height": 650},
            "corridors": [
                {"x": 80, "y": 285, "w": 840, "h": 80, "label": "Central Academic Corridor"},
                {"x": 460, "y": 80, "w": 80, "h": 490, "label": "Main Lobby & Vertical Core"},
            ],
            "landmarks": [
                {"type": "ENTRANCE", "x": 500, "y": 595, "label": "Floor Lobby Access"},
                {"type": "LIFT", "x": 485, "y": 325, "label": "Passenger Lift"},
                {"type": "STAIRS", "x": 525, "y": 325, "label": "Main Stairwell"},
            ],
            "rooms": rooms_payload,
            "route_network": {
                "is_verified": False,
                "note": "Turn-by-turn indoor routing awaits surveyed corridor node verification.",
                "nodes": [],
                "edges": [],
            },
            "updated_at": now,
        }
        db.floor_plan_overlays.replace_one(
            {"floor_plan_id": meta["floor_plan_id"]},
            overlay_doc,
            upsert=True,
        )

    db.system_events.insert_one(
        {
            "event_type": "DATABASE_SEED_COMPLETED",
            "component": "database.mongodb.init_nosql",
            "summary": "Initialized campus_geometries, floor_plan_overlays, and search_telemetry.",
            "created_at": now,
        }
    )


def init_mongodb_standalone(uri: str, db_name: str) -> None:
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client[db_name]
    ensure_collections_and_indexes(db)
    client.close()
