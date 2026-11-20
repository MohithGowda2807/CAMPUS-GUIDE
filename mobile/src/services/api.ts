import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AdminUserAccount,
  AllowlistEntry,
  AuditLogEntry,
  AuthProviderConfig,
  Building,
  BuildingDetailResponse,
  CampusRouteResponse,
  DepartmentItem,
  DetailedStaffProfileResponse,
  FacilityItem,
  FacultyMember,
  FloorPlanResponse,
  MapConfigResponse,
  ReportsSummary,
  RoomItem,
  SearchResponse,
  SearchResultItem,
  SessionStatusResponse,
  TravelMode,
  UserProfile,
  VisitPassReceipt,
  VisitRecord,
} from '../types/campus';
import {
  FALLBACK_BUILDINGS,
  FALLBACK_DEPARTMENTS,
  FALLBACK_FACILITIES,
  FALLBACK_FACULTY,
  FALLBACK_MAP_CONFIG,
} from '../data/fallbackData';
import { computeCampusRouteOffline } from './campusRouter';
import { cognitoClient, loadStoredSession, saveStoredSession, setAuthProviderConfig } from './cognitoAuth';

const API_BASE_STORAGE_KEY = 'rvce_mobile_api_base';

// Default endpoints probed automatically when no custom URL is saved
export const DEFAULT_MOBILE_API_URL = 'http://10.0.2.2:8000/api/v1';
const AUTO_DISCOVERY_CANDIDATES = [
  'http://10.0.2.2:8000/api/v1',
  'http://127.0.0.1:8000/api/v1',
  'http://192.168.1.7:8000/api/v1',
];

let inMemoryApiBaseUrl: string = DEFAULT_MOBILE_API_URL;
let initialized = false;

async function probeEndpointHealth(baseUrl: string, timeoutMs = 1400): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

export async function initStorage(): Promise<void> {
  if (initialized) return;
  let hasCustomSavedUrl = false;
  try {
    const savedUrl = await AsyncStorage.getItem(API_BASE_STORAGE_KEY);
    if (savedUrl && savedUrl.trim()) {
      inMemoryApiBaseUrl = savedUrl.trim().replace(/\/+$/, '');
      hasCustomSavedUrl = true;
    }
  } catch {
    // Keep default
  }

  await loadStoredSession();

  // If no custom endpoint was saved (or saved endpoint is unreachable), auto-discover active backend
  const activeSaved = hasCustomSavedUrl ? await probeEndpointHealth(inMemoryApiBaseUrl, 1500) : false;
  if (activeSaved) {
    setConnectionState('ONLINE');
  } else {
    for (const candidate of AUTO_DISCOVERY_CANDIDATES) {
      if (await probeEndpointHealth(candidate, 1300)) {
        inMemoryApiBaseUrl = candidate;
        setConnectionState('ONLINE');
        break;
      }
    }
  }

  initialized = true;
}

export function getApiBaseUrl(): string {
  return inMemoryApiBaseUrl;
}

export async function setApiBaseUrl(url: string | null): Promise<void> {
  if (url && url.trim()) {
    let clean = url.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api/v1') && !clean.includes('/api/v1')) {
      clean = `${clean}/api/v1`;
    }
    inMemoryApiBaseUrl = clean;
    await AsyncStorage.setItem(API_BASE_STORAGE_KEY, clean);
  } else {
    inMemoryApiBaseUrl = DEFAULT_MOBILE_API_URL;
    await AsyncStorage.removeItem(API_BASE_STORAGE_KEY);
  }
}

export async function getStoredToken(): Promise<string | null> {
  return cognitoClient.getValidToken(inMemoryApiBaseUrl, false);
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (!token) {
    await saveStoredSession(null);
  }
}

export type ConnectionState = 'ONLINE' | 'OFFLINE_CACHE' | 'CHECKING';
let currentConnectionState: ConnectionState = 'CHECKING';
const connectionListeners: Array<(state: ConnectionState) => void> = [];

export function getConnectionState(): ConnectionState {
  return currentConnectionState;
}

export function subscribeConnectionState(listener: (state: ConnectionState) => void): () => void {
  connectionListeners.push(listener);
  listener(currentConnectionState);
  return () => {
    const idx = connectionListeners.indexOf(listener);
    if (idx >= 0) connectionListeners.splice(idx, 1);
  };
}

function setConnectionState(newState: ConnectionState) {
  if (currentConnectionState !== newState) {
    currentConnectionState = newState;
    for (const cb of connectionListeners) {
      try {
        cb(newState);
      } catch {
        // Ignore subscriber errors
      }
    }
  }
}

export class ApiHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 4500,
  preferIdToken = false
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const token = await cognitoClient.getValidToken(baseUrl, preferIdToken);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const errBody = await res.json();
        if (typeof errBody.detail === 'string') {
          detail = errBody.detail;
        } else if (Array.isArray(errBody.detail) && errBody.detail.length > 0) {
          detail = errBody.detail[0]?.msg || detail;
        }
      } catch {
        // Fallback to status text
      }
      setConnectionState('ONLINE');
      throw new ApiHttpError(detail, res.status);
    }

    setConnectionState('ONLINE');
    return (await res.json()) as T;
  } catch (err: unknown) {
    clearTimeout(timer);
    if (!(err instanceof ApiHttpError)) {
      setConnectionState('OFFLINE_CACHE');
    }
    throw err;
  }
}

export const campusApi = {
  getHealth: async () => {
    try {
      const data = await request<{
        healthy: boolean;
        mysql: { connected: boolean; detail: string };
        mongodb: { connected: boolean; detail: string };
      }>('/health', undefined, 3500);
      setConnectionState('ONLINE');
      return data;
    } catch {
      setConnectionState('OFFLINE_CACHE');
      return {
        healthy: false,
        mysql: { connected: false, detail: 'Offline / local cache active' },
        mongodb: { connected: false, detail: 'Offline / local cache active' },
      };
    }
  },

  getMapConfig: async (): Promise<MapConfigResponse> => {
    try {
      return await request<MapConfigResponse>('/map/config', undefined, 3500);
    } catch {
      console.info('[CampusApi Mobile] Serving bundled campus GIS polygons.');
      return FALLBACK_MAP_CONFIG;
    }
  },

  getBuildings: async (params?: { building_type?: string; q?: string }): Promise<Building[]> => {
    try {
      const sp = new URLSearchParams();
      if (params?.building_type) sp.set('building_type', params.building_type);
      if (params?.q) sp.set('q', params.q);
      const qs = sp.toString();
      return await request<Building[]>(`/buildings${qs ? `?${qs}` : ''}`, undefined, 3500);
    } catch {
      let res = [...FALLBACK_BUILDINGS];
      if (params?.building_type) {
        res = res.filter((b) => b.building_type === params.building_type);
      }
      if (params?.q) {
        const q = params.q.toLowerCase();
        res = res.filter(
          (b) =>
            b.building_name.toLowerCase().includes(q) ||
            b.building_code.toLowerCase().includes(q) ||
            (b.description && b.description.toLowerCase().includes(q))
        );
      }
      return res;
    }
  },

  getBuildingDetail: async (buildingId: number): Promise<BuildingDetailResponse> => {
    try {
      return await request<BuildingDetailResponse>(`/buildings/${buildingId}`, undefined, 3500);
    } catch {
      const b = FALLBACK_BUILDINGS.find((x) => x.building_id === buildingId) || FALLBACK_BUILDINGS[0];
      const geom = FALLBACK_MAP_CONFIG.geometries.find((g) => g.mysql_id === buildingId) || null;
      const facilities = FALLBACK_FACILITIES.filter((f) => f.building_id === buildingId);

      const floors = Array.from({ length: Math.max(1, b.total_floors) }, (_, idx) => ({
        floor_id: b.building_id * 100 + idx,
        floor_number: idx,
        floor_name: idx === 0 ? 'Ground Floor' : `Floor ${idx}`,
        display_order: idx,
        has_lift_access: b.is_accessible,
        room_count: idx === 0 ? 4 : 3,
        has_floor_plan: idx === 0,
      }));

      return {
        building: b,
        floors,
        facilities,
        footprint: geom,
      };
    }
  },

  getFloorPlan: async (floorId: number): Promise<FloorPlanResponse> => {
    try {
      return await request<FloorPlanResponse>(`/floors/${floorId}/floor-plan`, undefined, 3500);
    } catch {
      const buildingId = Math.max(1, Math.floor(floorId / 100));
      const floorNum = floorId % 100;
      const b = FALLBACK_BUILDINGS.find((x) => x.building_id === buildingId) || FALLBACK_BUILDINGS[0];
      const prefix = b.building_code;
      const rooms: RoomItem[] = [
        {
          room_id: floorId * 10 + 1,
          room_number: `${prefix}-${floorNum}01`,
          room_name: `${b.building_code} Department Reception & Enquiry`,
          room_type: 'RECEPTION',
          capacity: 20,
          description: 'Offline cached directory entry — connect to server for live room records.',
          is_accessible: true,
          verification_status: 'SAMPLE_DEV',
          building_id: b.building_id,
          building_code: b.building_code,
          building_name: b.building_name,
        },
        {
          room_id: floorId * 10 + 2,
          room_number: `${prefix}-${floorNum}02`,
          room_name: `${b.building_code} Lecture Hall A`,
          room_type: 'CLASSROOM',
          capacity: 60,
          description: 'Primary academic lecture room.',
          is_accessible: true,
          verification_status: 'SAMPLE_DEV',
          building_id: b.building_id,
          building_code: b.building_code,
          building_name: b.building_name,
        },
        {
          room_id: floorId * 10 + 3,
          room_number: `${prefix}-${floorNum}03`,
          room_name: `${b.building_code} Computing / Research Lab`,
          room_type: 'LABORATORY',
          capacity: 40,
          description: 'Departmental laboratory space.',
          is_accessible: true,
          verification_status: 'SAMPLE_DEV',
          building_id: b.building_id,
          building_code: b.building_code,
          building_name: b.building_name,
        },
      ];
      return {
        floor: {
          floor_id: floorId,
          floor_number: floorNum,
          floor_name: floorNum === 0 ? 'Ground Floor' : `Floor ${floorNum}`,
          has_lift_access: b.is_accessible,
          building_id: b.building_id,
          building_code: b.building_code,
          building_name: b.building_name,
          verification_status: 'SAMPLE_DEV',
        },
        floor_plan: {
          floor_plan_id: floorId,
          floor_id: floorId,
          version_label: 'Offline Schematic',
          file_format: 'SVG_JSON',
          canvas_width: 1000,
          canvas_height: 650,
          coordinate_space: 'NORMALIZED_1000',
          source_reference: 'Offline Bundled Schematic Preview',
          approval_status: 'SAMPLE_DEV',
          is_schematic_sample: true,
          approved_at: null,
        },
        overlay: {
          floor_plan_id: floorId,
          floor_id: floorId,
          building_id: b.building_id,
          coordinate_space: 'NORMALIZED_1000',
          is_schematic_sample: true,
          canvas: { width: 1000, height: 650 },
          corridors: [{ x: 90, y: 280, w: 820, h: 90, label: 'Main Academic Corridor' }],
          landmarks: [
            { type: 'ENTRANCE', x: 130, y: 325, label: 'ENT' },
            { type: 'LIFT', x: 860, y: 325, label: 'LIFT' },
          ],
          rooms: [
            {
              room_id: rooms[0].room_id,
              room_number: rooms[0].room_number,
              label: 'Reception & Office',
              category: 'RECEPTION',
              bounds: { x: 100, y: 90, w: 250, h: 170 },
            },
            {
              room_id: rooms[1].room_id,
              room_number: rooms[1].room_number,
              label: 'Lecture Hall A',
              category: 'CLASSROOM',
              bounds: { x: 380, y: 90, w: 520, h: 170 },
            },
            {
              room_id: rooms[2].room_id,
              room_number: rooms[2].room_number,
              label: 'Laboratory',
              category: 'LABORATORY',
              bounds: { x: 100, y: 390, w: 800, h: 170 },
            },
          ],
        },
        rooms,
      };
    }
  },

  getRoomDetail: async (roomId: number): Promise<{ room: RoomItem; occupants: FacultyMember[] }> => {
    try {
      return await request<{ room: RoomItem; occupants: FacultyMember[] }>(`/rooms/${roomId}`, undefined, 3500);
    } catch {
      return {
        room: {
          room_id: roomId,
          room_number: `RM-${roomId}`,
          room_name: 'Campus Room',
          room_type: 'CLASSROOM',
          capacity: null,
          description: 'Offline room preview.',
          is_accessible: true,
          verification_status: 'SAMPLE_DEV',
        },
        occupants: [],
      };
    }
  },

  getDepartments: async (): Promise<DepartmentItem[]> => {
    try {
      return await request<DepartmentItem[]>('/departments', undefined, 3500);
    } catch {
      return FALLBACK_DEPARTMENTS;
    }
  },

  getFaculty: async (params?: {
    dept_id?: number;
    cadre?: string;
    qualification?: string;
    q?: string;
  }): Promise<FacultyMember[]> => {
    try {
      const sp = new URLSearchParams();
      if (params?.dept_id !== undefined) sp.set('dept_id', String(params.dept_id));
      if (params?.cadre) sp.set('cadre', params.cadre);
      if (params?.qualification) sp.set('qualification', params.qualification);
      if (params?.q) sp.set('q', params.q);
      const qs = sp.toString();
      return await request<FacultyMember[]>(`/faculty${qs ? `?${qs}` : ''}`, undefined, 3500);
    } catch {
      let list = [...FALLBACK_FACULTY];
      if (params?.dept_id !== undefined) {
        list = list.filter((f) => f.dept_id === params.dept_id);
      }
      if (params?.cadre) {
        list = list.filter((f) => f.designation.toLowerCase().includes(params.cadre!.toLowerCase()));
      }
      if (params?.qualification) {
        list = list.filter((f) => f.qualification === params.qualification);
      }
      if (params?.q) {
        const q = params.q.toLowerCase();
        list = list.filter(
          (f) =>
            f.display_name.toLowerCase().includes(q) ||
            f.employee_code.toLowerCase().includes(q) ||
            f.dept_name.toLowerCase().includes(q) ||
            f.designation.toLowerCase().includes(q)
        );
      }
      return list;
    }
  },

  getFacilities: async (params?: { category?: string; q?: string }): Promise<FacilityItem[]> => {
    try {
      const sp = new URLSearchParams();
      if (params?.category) sp.set('category', params.category);
      if (params?.q) sp.set('q', params.q);
      const qs = sp.toString();
      return await request<FacilityItem[]>(`/facilities${qs ? `?${qs}` : ''}`, undefined, 3500);
    } catch {
      let res = [...FALLBACK_FACILITIES];
      if (params?.category && params.category !== 'ALL') {
        res = res.filter((f) => f.category === params.category);
      }
      if (params?.q) {
        const q = params.q.toLowerCase();
        res = res.filter(
          (f) =>
            f.facility_name.toLowerCase().includes(q) ||
            (f.description && f.description.toLowerCase().includes(q))
        );
      }
      return res;
    }
  },

  search: async (q: string, category?: string): Promise<SearchResponse> => {
    try {
      const sp = new URLSearchParams({ q });
      if (category && category !== 'ALL') sp.set('category', category);
      return await request<SearchResponse>(`/search?${sp.toString()}`, undefined, 3500);
    } catch {
      const queryLower = q.toLowerCase();
      const results: SearchResultItem[] = [];

      if (!category || category === 'ALL' || category === 'BUILDING') {
        for (const b of FALLBACK_BUILDINGS) {
          if (
            b.building_name.toLowerCase().includes(queryLower) ||
            b.building_code.toLowerCase().includes(queryLower) ||
            (b.description && b.description.toLowerCase().includes(queryLower))
          ) {
            results.push({
              entity_type: 'BUILDING',
              id: b.building_id,
              title: b.building_name,
              subtitle: `${b.building_code} • ${b.building_type.replace(/_/g, ' ')}`,
              building_id: b.building_id,
              floor_id: null,
              room_id: null,
              latitude: b.latitude,
              longitude: b.longitude,
              verification_status: b.verification_status,
            });
          }
        }
      }

      if (!category || category === 'ALL' || category === 'FACILITY') {
        for (const f of FALLBACK_FACILITIES) {
          if (
            f.facility_name.toLowerCase().includes(queryLower) ||
            (f.description && f.description.toLowerCase().includes(queryLower))
          ) {
            results.push({
              entity_type: 'FACILITY',
              id: f.facility_id,
              title: f.facility_name,
              subtitle: `${f.category.replace(/_/g, ' ')}${f.building_name ? ` • ${f.building_name}` : ''}`,
              building_id: f.building_id,
              floor_id: f.floor_id,
              room_id: f.room_id,
              latitude: f.latitude,
              longitude: f.longitude,
              verification_status: f.verification_status,
            });
          }
        }
      }

      if (!category || category === 'ALL' || category === 'FACULTY') {
        for (const faculty of FALLBACK_FACULTY) {
          if (
            faculty.display_name.toLowerCase().includes(queryLower) ||
            faculty.employee_code.toLowerCase().includes(queryLower) ||
            faculty.dept_name.toLowerCase().includes(queryLower)
          ) {
            results.push({
              entity_type: 'FACULTY',
              id: faculty.staff_id,
              title: faculty.display_name,
              subtitle: `${faculty.designation} • ${faculty.dept_code}${faculty.building_name ? ` • ${faculty.building_name}` : ''}`,
              building_id: faculty.building_id,
              floor_id: faculty.floor_id,
              room_id: faculty.office_room_id,
              latitude: faculty.building_latitude,
              longitude: faculty.building_longitude,
              availability: faculty.effective_availability,
              verification_status: faculty.verification_status,
            });
          }
        }
      }

      return {
        query: q,
        count: results.length,
        duration_ms: 1,
        results: results.slice(0, 30),
      };
    }
  },

  getCampusRoute: async (params: {
    from_lat: number;
    from_lng: number;
    to_lat: number;
    to_lng: number;
    mode: TravelMode;
    from_label?: string;
    to_label?: string;
  }): Promise<CampusRouteResponse> => {
    try {
      const sp = new URLSearchParams({
        from_lat: String(params.from_lat),
        from_lng: String(params.from_lng),
        to_lat: String(params.to_lat),
        to_lng: String(params.to_lng),
        mode: params.mode,
      });
      if (params.from_label) sp.set('from_label', params.from_label);
      if (params.to_label) sp.set('to_label', params.to_label);
      return await request<CampusRouteResponse>(`/navigation/route?${sp.toString()}`, undefined, 4500);
    } catch (err) {
      if (err instanceof ApiHttpError) throw err;
      return computeCampusRouteOffline({
        fromLat: params.from_lat,
        fromLng: params.from_lng,
        toLat: params.to_lat,
        toLng: params.to_lng,
        mode: params.mode,
        fromLabel: params.from_label,
        toLabel: params.to_label,
      });
    }
  },

  getAuthConfig: async (): Promise<AuthProviderConfig> => {
    const cfg = await request<AuthProviderConfig>('/auth/config', undefined, 4500);
    setAuthProviderConfig(cfg);
    return cfg;
  },

  completeStaffRegistration: (payload: {
    full_name: string;
    email: string;
    terms_accepted: boolean;
  }) =>
    request<SessionStatusResponse>(
      '/auth/complete-registration',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      6000,
      true
    ),

  getSessionStatus: () => request<SessionStatusResponse>('/auth/session-status', undefined, 5000, true),

  getMe: () => request<UserProfile>('/auth/me'),

  getDetailedProfile: () => request<DetailedStaffProfileResponse>('/auth/profile'),

  updateMyProfile: (payload: {
    office_room_id: number | null;
    public_email: string | null;
    official_profile_url: string | null;
    profile_visibility: 'PUBLIC' | 'INTERNAL_ONLY' | 'HIDDEN';
  }) =>
    request<{
      updated: boolean;
      staff_id: number;
      office_room_id: number | null;
      public_email: string | null;
      official_profile_url: string | null;
      profile_visibility: string;
    }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updateAvailability: (payload: {
    availability_state: string;
    public_note?: string;
    valid_minutes: number;
    staff_id?: number;
  }) =>
    request<{
      availability_id: number;
      staff_id: number;
      availability_state: string;
      last_updated_at: string | null;
      valid_until: string | null;
    }>('/auth/availability', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  syncMfaEnabled: () =>
    request<{ mfa_enabled: boolean }>('/auth/mfa-sync', { method: 'POST' }),

  logoutBackendSession: () =>
    request<{ logged_out: boolean }>('/auth/logout', { method: 'POST' }),

  logoutAllBackendSessions: () =>
    request<{ logged_out_all_sessions: boolean }>('/auth/logout-all', { method: 'POST' }),

  listAdminUsers: (approvalStatus?: string) => {
    const qs = approvalStatus ? `?approval_status=${encodeURIComponent(approvalStatus)}` : '';
    return request<AdminUserAccount[]>(`/admin/users${qs}`);
  },

  decideAdminAccount: (
    userId: number,
    payload: {
      action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REVOKE';
      role_code?: 'FACULTY' | 'STAFF' | 'ADMIN';
      linked_staff_id?: number | null;
      reason?: string;
    }
  ) =>
    request<{
      user_id: number;
      approval_status: string;
      is_active: boolean;
      role_code?: string;
    }>(`/admin/accounts/${userId}/decision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listAllowlist: () => request<AllowlistEntry[]>('/admin/allowlist'),

  addAllowlistEntry: (payload: {
    email: string;
    linked_staff_id?: number | null;
    assigned_role_code: 'FACULTY' | 'STAFF';
    notes?: string;
  }) =>
    request<AllowlistEntry>('/admin/allowlist', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  removeAllowlistEntry: (allowlistId: number) =>
    request<{ allowlist_id: number; is_active: boolean }>(`/admin/allowlist/${allowlistId}`, {
      method: 'DELETE',
    }),

  preRegisterVisitor: (payload: Record<string, unknown>) =>
    request<VisitPassReceipt>('/visits/pre-register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  registerVisitorByStaff: (payload: Record<string, unknown>) =>
    request<VisitPassReceipt>('/visits', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listVisits: (params?: { visit_status?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.visit_status) sp.set('visit_status', params.visit_status);
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<VisitRecord[]>(`/visits${qs ? `?${qs}` : ''}`);
  },

  recordVisitAction: (visitId: number, action: string, gateName?: string) =>
    request<VisitRecord>(`/visits/${visitId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, gate_name: gateName }),
    }),

  getReportsSummary: (days = 30) =>
    request<ReportsSummary>(`/admin/reports/summary?days=${days}`),

  getAuditLogs: (limit = 50) =>
    request<AuditLogEntry[]>(`/admin/audit-logs?limit=${limit}`),
};
