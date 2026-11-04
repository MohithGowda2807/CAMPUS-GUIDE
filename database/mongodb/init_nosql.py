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
    "campus_pathways": {
        "$jsonSchema": {
            "bsonType": "object",
            "required": [
                "edge_id",
                "u",
                "v",
                "highway",
                "path_class",
                "length_m",
                "geometry",
            ],
            "properties": {
                "edge_id": {"bsonType": "int"},
                "u": {"bsonType": "string"},
                "v": {"bsonType": "string"},
                "highway": {"bsonType": "string"},
                "path_class": {"enum": ["VEHICLE_AND_WALK", "WALK_ONLY"]},
                "name": {"bsonType": "string"},
                "oneway": {"enum": ["yes", "-1", "no"]},
                "is_steps": {"bsonType": "bool"},
                "length_m": {"bsonType": ["int", "double"]},
                "geometry": {
                    "bsonType": "object",
                    "required": ["type", "coordinates"],
                    "properties": {
                        "type": {"enum": ["LineString"]},
                        "coordinates": {"bsonType": "array"},
                    },
                },
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

    # Geospatial 2dsphere index & lookup indexes on campus_pathways (routing graph)
    db.campus_pathways.create_index([("geometry", GEOSPHERE)], name="idx_pathway_geo_2dsphere")
    db.campus_pathways.create_index([("edge_id", ASCENDING)], unique=True, name="uq_pathway_edge_id")
    db.campus_pathways.create_index([("path_class", ASCENDING)], name="idx_pathway_class")

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


def seed_routing_pathways(
    db: Database,
    routing_payload: dict[str, Any],
) -> int:
    """Seeds OpenStreetMap campus roads (VEHICLE_AND_WALK) and footpaths (WALK_ONLY) into MongoDB."""
    now = datetime.now(timezone.utc)
    nodes = routing_payload.get("nodes", {})
    edges = routing_payload.get("edges", [])

    db.campus_pathways.delete_many({})
    docs: list[dict[str, Any]] = []
    for edge in edges:
        u_id = str(edge["u"])
        v_id = str(edge["v"])
        u_node = nodes[u_id]
        v_node = nodes[v_id]
        docs.append(
            {
                "edge_id": int(edge["edge_id"]),
                "way_id": int(edge.get("way_id", 0)),
                "u": u_id,
                "v": v_id,
                "u_lat": float(u_node["lat"]),
                "u_lng": float(u_node["lng"]),
                "v_lat": float(v_node["lat"]),
                "v_lng": float(v_node["lng"]),
                "highway": edge["highway"],
                "path_class": edge["path_class"],
                "name": edge.get("name", ""),
                "oneway": edge.get("oneway", "no"),
                "is_steps": bool(edge.get("is_steps", False)),
                "length_m": float(edge["length_m"]),
                "geometry": {
                    "type": "LineString",
                    "coordinates": edge["coordinates"],
                },
                "updated_at": now,
            }
        )
    if docs:
        db.campus_pathways.insert_many(docs)
    return len(docs)


def seed_sample_nosql_documents(
    db: Database,
    campus_id: int,
    building_map: dict[str, int],
    floor_plan_map: dict[str, dict[str, Any]],
    osm_campus_payload: dict[str, Any] | None = None,
    routing_payload: dict[str, Any] | None = None,
) -> None:
    """
    Seeds verified OpenStreetMap GeoJSON campus perimeter and architectural
    building footprints into `campus_geometries` (2dsphere indexed), plus
    campus pathways (`campus_pathways`) and any indoor floor-plan vector overlays.
    """
    now = datetime.now(timezone.utc)

    db.campus_geometries.delete_many({})
    db.floor_plan_overlays.delete_many({})

    geometries: list[dict[str, Any]] = []

    if osm_campus_payload:
        campus_meta = osm_campus_payload["campus"]
        geometries.append(
            {
                "entity_type": "CAMPUS_BOUNDARY",
                "mysql_id": campus_id,
                "code": campus_meta["campus_code"],
                "name": "R. V. College of Engineering — Campus Perimeter",
                "verification_status": "VERIFIED",
                "geometry": campus_meta["boundary_geometry"],
                "updated_at": now,
            }
        )

        for b_item in osm_campus_payload["buildings"]:
            code = b_item["building_code"]
            if code in building_map:
                geometries.append(
                    {
                        "entity_type": "BUILDING_FOOTPRINT",
                        "mysql_id": building_map[code],
                        "code": code,
                        "name": b_item["building_name"],
                        "verification_status": "VERIFIED",
                        "geometry": b_item["footprint"],
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

    if routing_payload:
        seed_routing_pathways(db, routing_payload)

    db.system_events.insert_one(
        {
            "event_type": "DATABASE_SEED_COMPLETED",
            "component": "database.mongodb.init_nosql",
            "summary": "Initialized campus_geometries, campus_pathways, floor_plan_overlays, and search_telemetry.",
            "created_at": now,
        }
    )


def init_mongodb_standalone(uri: str, db_name: str) -> None:
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client[db_name]
    ensure_collections_and_indexes(db)
    client.close()
