import { Capacitor } from '@capacitor/core';
import type {
  AuditLogEntry,
  Building,
  BuildingDetailResponse,
  CampusRouteResponse,
  DepartmentItem,
  FacilityItem,
  FacultyMember,
  FloorPlanResponse,
  MapConfigResponse,
  ReportsSummary,
  RoomItem,
  SearchResponse,
  SearchResultItem,
  TravelMode,
  UserProfile,
  VisitPassReceipt,
  VisitRecord,
} from '../types/campus';
import { computeCampusRouteOffline } from './campusRouter';
import {
  FALLBACK_BUILDINGS,
  FALLBACK_DEPARTMENTS,
  FALLBACK_FACILITIES,
  FALLBACK_FACULTY,
  FALLBACK_MAP_CONFIG,
} from '../data/fallbackData';

const API_BASE_STORAGE_KEY = 'rvce_api_base_url';
const TOKEN_STORAGE_KEY = 'rvce_navigator_token';

// Default remote cloud tunnel URL if configured (can be overridden anytime in the app UI)
export const DEFAULT_REMOTE_TUNNEL_URL = 'https://rvce-campus.trycloudflare.com/api/v1';

export function getApiBaseUrl(): string {
  const custom = localStorage.getItem(API_BASE_STORAGE_KEY);
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');
  }
  if (Capacitor.isNativePlatform()) {
    // Check if the user previously set a custom URL or fall back to local LAN IP or loopback
    return 'http://192.168.1.7:8000/api/v1';
  }
  return '/api/v1';
}

export function setApiBaseUrl(url: string | null): void {
  if (url && url.trim()) {
    let clean = url.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api/v1') && !clean.includes('/api/v1')) {
      clean = `${clean}/api/v1`;
    }
    localStorage.setItem(API_BASE_STORAGE_KEY, clean);
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY);
  }
}

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

// Global server connection status for UI badge
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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 6000): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const baseUrl = getApiBaseUrl();
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
      // The server answered, so we are online even though this request failed.
      setConnectionState('ONLINE');
      throw new ApiHttpError(detail, res.status);
    }

    setConnectionState('ONLINE');
    return (await res.json()) as T;
  } catch (err: unknown) {
    clearTimeout(timer);
    if (!(err instanceof ApiHttpError)) setConnectionState('OFFLINE_CACHE');
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
      }>('/health', undefined, 4000);
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
      return await request<MapConfigResponse>('/map/config', undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; using bundled campus GIS polygons & boundary.');
      return FALLBACK_MAP_CONFIG;
    }
  },

  getBuildings: async (params?: { building_type?: string; q?: string }): Promise<Building[]> => {
    try {
      const sp = new URLSearchParams();
      if (params?.building_type) sp.set('building_type', params.building_type);
      if (params?.q) sp.set('q', params.q);
      const qs = sp.toString();
      return await request<Building[]>(`/buildings${qs ? `?${qs}` : ''}`, undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; serving bundled building directory.');
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
      return await request<BuildingDetailResponse>(`/buildings/${buildingId}`, undefined, 4000);
    } catch {
      console.info(`[CampusApi] Backend unreachable; loading fallback for building ${buildingId}`);
      const b = FALLBACK_BUILDINGS.find((x) => x.building_id === buildingId) || FALLBACK_BUILDINGS[0];
      const geom = FALLBACK_MAP_CONFIG.geometries.find((g) => g.mysql_id === buildingId) || null;
      const facilities = FALLBACK_FACILITIES.filter((f) => f.building_id === buildingId);

      return {
        building: b,
        // Indoor floor data requires the server; never invent floors or rooms offline.
        floors: [],
        facilities,
        footprint: geom,
      };
    }
  },

  getFloorPlan: (floorId: number) =>
    request<FloorPlanResponse>(`/floors/${floorId}/floor-plan`),

  getRoomDetail: (roomId: number) =>
    request<{ room: RoomItem; occupants: FacultyMember[] }>(`/rooms/${roomId}`),

  getDepartments: async (): Promise<DepartmentItem[]> => {
    try {
      return await request<DepartmentItem[]>('/departments', undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; serving bundled department catalogue.');
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
      return await request<FacultyMember[]>(`/faculty${qs ? `?${qs}` : ''}`, undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; serving bundled faculty list (339 profiles).');
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
      return await request<FacilityItem[]>(`/facilities${qs ? `?${qs}` : ''}`, undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; serving bundled facilities.');
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
      return await request<SearchResponse>(`/search?${sp.toString()}`, undefined, 4000);
    } catch {
      console.info('[CampusApi] Backend unreachable; running offline campus search.');
      const queryLower = q.toLowerCase();
      const results: SearchResultItem[] = [];

      // Buildings
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
              subtitle: `${b.building_code} â€¢ ${b.building_type.replace(/_/g, ' ')}`,
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

      // Facilities
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
              subtitle: `${f.category.replace(/_/g, ' ')}${f.building_name ? ` â€¢ ${f.building_name}` : ''}`,
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

      // Faculty
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
              subtitle: `${faculty.designation} â€¢ ${faculty.dept_code}${faculty.building_name ? ` â€¢ ${faculty.building_name}` : ''}`,
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
      return await request<CampusRouteResponse>(`/navigation/route?${sp.toString()}`, undefined, 5000);
    } catch (err) {
      // Server answered with an HTTP error: surface it, never fabricate a route.
      if (err instanceof ApiHttpError) throw err;
      console.info('[CampusApi] Backend unreachable; routing on-device over the bundled campus pathway network.');
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

  login: (username: string, password: string) =>
    request<{ access_token: string; token_type: string; user: UserProfile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getMe: () => request<UserProfile>('/auth/me'),

  updateAvailability: (payload: {
    availability_state: string;
    public_note?: string;
    valid_minutes: number;
    staff_id?: number;
  }) =>
    request<{ staff_id: number; availability_state: string; valid_until: string }>(
      '/auth/availability',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

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

  createBuilding: (payload: Record<string, unknown>) =>
    request<Building>('/admin/buildings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createFloor: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/admin/floors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createRoom: (payload: Record<string, unknown>) =>
    request<RoomItem>('/admin/rooms', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createStaff: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/admin/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createFacility: (payload: Record<string, unknown>) =>
    request<FacilityItem>('/admin/facilities', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getReportsSummary: (days = 30) =>
    request<ReportsSummary>(`/admin/reports/summary?days=${days}`),

  getSystemUsers: () =>
    request<Array<UserProfile & { is_active: boolean; last_login_at: string | null }>>(
      '/admin/users'
    ),

  createSystemUser: (payload: Record<string, unknown>) =>
    request<Record<string, unknown>>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAuditLogs: (limit = 50) =>
    request<AuditLogEntry[]>(`/admin/audit-logs?limit=${limit}`),
};
