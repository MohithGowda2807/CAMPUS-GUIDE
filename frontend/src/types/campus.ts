export type VerificationStatus = 'VERIFIED' | 'PENDING_REVIEW' | 'SAMPLE_DEV';

export type AvailabilityState = 'AVAILABLE' | 'BUSY_SCHEDULED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface GeoGeometry {
  entity_type: 'CAMPUS_BOUNDARY' | 'BUILDING_FOOTPRINT' | 'ENTRANCE_NODE' | 'WALKWAY';
  mysql_id: number;
  code?: string;
  name: string;
  verification_status: VerificationStatus;
  geometry: {
    type: 'Point' | 'Polygon' | 'LineString' | 'MultiPolygon';
    coordinates: unknown;
  };
}

export interface MapConfigResponse {
  center: {
    lat: number;
    lng: number;
    zoom: number;
  };
  tile_layer: {
    url: string;
    attribution: string;
  };
  campus: {
    campus_id: number;
    campus_code: string;
    campus_name: string;
    address: string;
    latitude: number;
    longitude: number;
    default_zoom: number;
    verification_status: VerificationStatus;
  };
  geometries: GeoGeometry[];
}

export interface Building {
  building_id: number;
  campus_id: number;
  campus_name: string;
  building_code: string;
  building_name: string;
  building_type: string;
  description: string | null;
  latitude: number;
  longitude: number;
  total_floors: number;
  is_accessible: boolean;
  verification_status: VerificationStatus;
  status: string;
  mapped_floors_count: number;
  public_rooms_count: number;
  approved_plans_count: number;
}

export interface FloorSummary {
  floor_id: number;
  floor_number: number;
  floor_name: string;
  display_order: number;
  has_lift_access: boolean;
  room_count: number;
  has_floor_plan: boolean;
}

export interface FacilityItem {
  facility_id: number;
  facility_name: string;
  category: string;
  description: string | null;
  building_id: number | null;
  building_name?: string | null;
  building_code?: string | null;
  floor_id: number | null;
  floor_name?: string | null;
  room_id: number | null;
  room_number?: string | null;
  latitude: number | null;
  longitude: number | null;
  opening_hours: string | null;
  is_accessible: boolean;
  verification_status: VerificationStatus;
}

export interface BuildingDetailResponse {
  building: Building;
  floors: FloorSummary[];
  facilities: FacilityItem[];
  footprint: GeoGeometry | null;
}

export interface OverlayRoomPolygon {
  room_id: number;
  room_number: string;
  label: string;
  category: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface FloorPlanOverlay {
  floor_plan_id: number;
  floor_id: number;
  building_id: number;
  coordinate_space: 'NORMALIZED_1000' | 'LOCAL_PIXEL';
  is_schematic_sample: boolean;
  canvas: {
    width: number;
    height: number;
  };
  corridors: Array<{ x: number; y: number; w: number; h: number; label?: string }>;
  landmarks: Array<{ type: string; x: number; y: number; label: string }>;
  rooms: OverlayRoomPolygon[];
  route_network?: {
    is_verified: boolean;
    note?: string;
  };
}

export interface RoomItem {
  room_id: number;
  room_number: string;
  room_name: string;
  room_type: string;
  capacity: number | null;
  description: string | null;
  is_accessible: boolean;
  verification_status: VerificationStatus;
  dept_code?: string | null;
  dept_name?: string | null;
  floor_id?: number;
  floor_name?: string;
  building_id?: number;
  building_code?: string;
  building_name?: string;
}

export interface FloorPlanResponse {
  floor: {
    floor_id: number;
    floor_number: number;
    floor_name: string;
    has_lift_access: boolean;
    building_id: number;
    building_code: string;
    building_name: string;
    verification_status: VerificationStatus;
  };
  floor_plan: {
    floor_plan_id: number;
    floor_id: number;
    version_label: string;
    file_format: string;
    canvas_width: number;
    canvas_height: number;
    coordinate_space: string;
    source_reference: string;
    approval_status: string;
    is_schematic_sample: boolean;
    approved_at: string | null;
  } | null;
  overlay: FloorPlanOverlay | null;
  rooms: RoomItem[];
}

export interface DepartmentItem {
  dept_id: number;
  dept_code: string;
  dept_name: string;
  dept_category?: 'ENGINEERING' | 'PG_PROGRAMME' | 'BASIC_SCIENCES' | 'CAMPUS_CENTRAL';
  short_description: string | null;
  official_email: string | null;
  verification_status: VerificationStatus;
  primary_building_id?: number | null;
  primary_building_code?: string | null;
  primary_building_name?: string | null;
  faculty_count: number;
  phd_completed_count?: number;
  professors_count?: number;
  room_count: number;
  hod_name?: string | null;
}

export interface FacultyMember {
  staff_id: number;
  employee_code: string;
  display_name: string;
  qualification: string | null;
  designation: string;
  cadre_rank: number;
  program_name: string | null;
  leadership_role: string | null;
  staff_type: string;
  date_of_joining: string | null;
  professor_designated_date: string | null;
  years_at_rvce: number | null;
  association_nature: 'REGULAR' | 'CONTRACT' | 'ADJUNCT';
  employment_mode: 'FULL_TIME' | 'PART_TIME';
  deputation_remarks: string | null;
  public_email: string | null;
  official_profile_url: string | null;
  verification_status: VerificationStatus;
  staff_status?: string;
  dept_id: number;
  dept_code: string;
  dept_name: string;
  dept_category?: string;
  office_room_id: number | null;
  office_room_number: string | null;
  office_room_name: string | null;
  floor_id: number | null;
  floor_name: string | null;
  building_id: number | null;
  building_code: string | null;
  building_name: string | null;
  building_latitude: number | null;
  building_longitude: number | null;
  effective_availability: AvailabilityState;
  availability_source: string | null;
  availability_note: string | null;
  availability_valid_until: string | null;
  availability_updated_at: string | null;
}

export interface SearchResultItem {
  entity_type: 'BUILDING' | 'ROOM' | 'FACULTY' | 'FACILITY';
  id: number;
  title: string;
  subtitle: string;
  building_id: number | null;
  floor_id: number | null;
  room_id: number | null;
  latitude: number | null;
  longitude: number | null;
  availability?: AvailabilityState;
  verification_status: VerificationStatus;
}

export interface SearchResponse {
  query: string;
  count: number;
  duration_ms: number;
  results: SearchResultItem[];
}

export interface UserProfile {
  user_id: number;
  username: string;
  email: string;
  linked_staff_id: number | None | null;
  staff_name: string | null;
  dept_id: number | null;
  auth_provider: string;
  roles: string[];
}

export interface VisitPassReceipt {
  visit_id: number;
  visit_pass_code: string;
  visitor_name: string;
  purpose: string;
  gate_name: string;
  approval_status: string;
  visit_status: string;
  destination_building_name: string | null;
  destination_room_number: string | null;
  host_name: string | null;
  created_at: string | null;
}

export interface VisitRecord {
  visit_id: number;
  visit_pass_code: string;
  visitor_id: number;
  visitor_name: string;
  contact_phone: string;
  contact_email: string | null;
  organization: string | null;
  purpose: string;
  gate_name: string;
  approval_status: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  visit_status: 'REGISTERED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  scheduled_at: string;
  check_in_at: string | null;
  check_out_at: string | null;
  duration_minutes: number | null;
  destination_building_id: number | null;
  destination_building_name: string | null;
  destination_building_code: string | null;
  destination_room_id: number | null;
  destination_room_number: string | null;
  host_staff_id: number | null;
  host_name: string | null;
  host_dept_code: string | null;
}

export interface ReportsSummary {
  period: { from: string; to: string; days: number };
  kpis: {
    active_buildings: number;
    public_rooms: number;
    listed_faculty: number;
    active_facilities: number;
    period_total_visits: number;
    visitors_currently_inside: number;
    pending_approvals: number;
  };
  daily_visitor_analytics: Array<{
    visit_date: string;
    gate_name: string;
    destination_building: string;
    total_visits: number;
    currently_inside: number;
    completed_visits: number;
    pending_host_approvals: number;
    avg_visit_duration_minutes: number | null;
  }>;
  search_insights: {
    top_queries: Array<{ query: string; searches: number; avg_ms: number }>;
    unmatched_queries: Array<{ query: string; attempts: number }>;
  };
}

export interface AuditLogEntry {
  log_id: number;
  user_id: number | null;
  actor_username: string | null;
  action_type: string;
  table_name: string;
  record_id: number;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
}

type None = null;
