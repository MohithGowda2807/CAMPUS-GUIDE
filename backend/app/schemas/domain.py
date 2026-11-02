from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=60)
    password: str = Field(..., min_length=6, max_length=128)


class UserProfileOut(BaseModel):
    user_id: int
    username: str
    email: str
    linked_staff_id: int | None = None
    staff_name: str | None = None
    dept_id: int | None = None
    auth_provider: str
    roles: list[str]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfileOut


class AvailabilityUpdateRequest(BaseModel):
    availability_state: Literal["AVAILABLE", "BUSY_SCHEDULED", "UNAVAILABLE", "UNKNOWN"]
    public_note: str | None = Field(default=None, max_length=200)
    valid_minutes: int = Field(default=180, ge=15, le=720)
    staff_id: int | None = Field(
        default=None,
        description="Optional target staff_id when updated by Department Coordinator or System Admin.",
    )


class VisitorRegistrationRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    contact_phone: str = Field(..., min_length=7, max_length=20, pattern=r"^[0-9+\-\s()]{7,20}$")
    contact_email: EmailStr | None = None
    organization: str | None = Field(default=None, max_length=150)
    destination_building_id: int | None = None
    destination_room_id: int | None = None
    host_staff_id: int | None = None
    purpose: str = Field(..., min_length=3, max_length=255)
    gate_name: str = Field(default="Main Mysuru Road Gate", max_length=60)
    requires_host_approval: bool = False
    immediate_check_in: bool = False


class VisitPassReceiptOut(BaseModel):
    visit_id: int
    visit_pass_code: str
    visitor_name: str
    purpose: str
    gate_name: str
    approval_status: str
    visit_status: str
    destination_building_name: str | None = None
    destination_room_number: str | None = None
    host_name: str | None = None
    created_at: datetime | None = None


class GateActionRequest(BaseModel):
    action: Literal["CHECK_IN", "CHECK_OUT", "APPROVE_HOST", "REJECT_HOST", "CANCEL"]
    gate_name: str | None = Field(default=None, max_length=60)


class BuildingCreateUpdateRequest(BaseModel):
    building_code: str = Field(..., min_length=2, max_length=25)
    building_name: str = Field(..., min_length=3, max_length=150)
    building_type: Literal[
        "ACADEMIC_BLOCK",
        "ADMINISTRATION",
        "LIBRARY",
        "LABORATORY_COMPLEX",
        "AUDITORIUM",
        "HOSTEL",
        "AMENITIES",
        "SECURITY_GATE",
    ] = "ACADEMIC_BLOCK"
    description: str | None = Field(default=None, max_length=1000)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    total_floors: int = Field(default=1, ge=1, le=30)
    is_accessible: bool = True
    verification_status: Literal["VERIFIED", "PENDING_REVIEW", "SAMPLE_DEV"] = "PENDING_REVIEW"
    status: Literal["ACTIVE", "MAINTENANCE", "INACTIVE"] = "ACTIVE"
    footprint_geojson: dict[str, Any] | None = None


class FloorCreateRequest(BaseModel):
    building_id: int
    floor_number: int = Field(..., ge=-3, le=30)
    floor_name: str = Field(..., min_length=2, max_length=60)
    display_order: int = 0
    has_lift_access: bool = False


class RoomCreateUpdateRequest(BaseModel):
    floor_id: int
    dept_id: int | None = None
    room_number: str = Field(..., min_length=1, max_length=30)
    room_name: str = Field(..., min_length=2, max_length=150)
    room_type: Literal[
        "CLASSROOM",
        "LABORATORY",
        "SEMINAR_HALL",
        "FACULTY_OFFICE",
        "HOD_CABIN",
        "ADMIN_OFFICE",
        "LIBRARY_ZONE",
        "RESTROOM",
        "UTILITY",
        "RECEPTION",
    ] = "CLASSROOM"
    capacity: int | None = Field(default=None, ge=0, le=5000)
    description: str | None = Field(default=None, max_length=500)
    is_accessible: bool = True
    public_visibility: bool = True
    verification_status: Literal["VERIFIED", "PENDING_REVIEW", "SAMPLE_DEV"] = "PENDING_REVIEW"
    status: Literal["ACTIVE", "MAINTENANCE", "INACTIVE"] = "ACTIVE"
    overlay_bounds: dict[str, float] | None = Field(
        default=None,
        description="Optional normalized indoor coordinates {x, y, w, h} on active floor plan.",
    )


class StaffCreateUpdateRequest(BaseModel):
    dept_id: int
    office_room_id: int | None = None
    employee_code: str = Field(..., min_length=2, max_length=30)
    display_name: str = Field(..., min_length=2, max_length=120)
    designation: str = Field(..., min_length=2, max_length=120)
    staff_type: Literal["FACULTY", "ADMIN_STAFF", "TECHNICAL_STAFF", "SECURITY_STAFF"] = "FACULTY"
    public_email: EmailStr | None = None
    official_profile_url: str | None = None
    profile_visibility: Literal["PUBLIC", "INTERNAL_ONLY", "HIDDEN"] = "PUBLIC"
    verification_status: Literal["VERIFIED", "PENDING_REVIEW", "SAMPLE_DEV"] = "PENDING_REVIEW"
    status: Literal["ACTIVE", "ON_LEAVE", "INACTIVE"] = "ACTIVE"


class FacilityCreateUpdateRequest(BaseModel):
    building_id: int | None = None
    floor_id: int | None = None
    room_id: int | None = None
    facility_name: str = Field(..., min_length=2, max_length=150)
    category: Literal[
        "GATE_RECEPTION",
        "LIBRARY",
        "CAFETERIA_FOOD",
        "ADMIN_SERVICE",
        "BANK_ATM",
        "PARKING",
        "WASHROOM",
        "MEDICAL_FIRST_AID",
        "AUDITORIUM_HALL",
        "SPORTS_AMENITY",
        "ACCESSIBILITY_LIFT_RAMP",
    ]
    description: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)
    opening_hours: str | None = Field(default=None, max_length=120)
    is_accessible: bool = True
    public_visibility: bool = True
    verification_status: Literal["VERIFIED", "PENDING_REVIEW", "SAMPLE_DEV"] = "PENDING_REVIEW"
    status: Literal["ACTIVE", "MAINTENANCE", "INACTIVE"] = "ACTIVE"


class FloorPlanPublishRequest(BaseModel):
    floor_id: int
    version_label: str = Field(..., min_length=2, max_length=30)
    source_reference: str = Field(..., min_length=3, max_length=255)
    canvas_width: int = Field(default=1000, ge=200, le=10000)
    canvas_height: int = Field(default=650, ge=200, le=10000)
    is_schematic_sample: bool = False
    activate_immediately: bool = True
    corridors: list[dict[str, Any]] = Field(default_factory=list)
    landmarks: list[dict[str, Any]] = Field(default_factory=list)
    rooms_overlay: list[dict[str, Any]] = Field(default_factory=list)


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=60)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    linked_staff_id: int | None = None
    role_codes: list[str] = Field(min_length=1)
