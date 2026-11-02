import type {
  AuditLogEntry,
  Building,
  BuildingDetailResponse,
  DepartmentItem,
  FacilityItem,
  FacultyMember,
  FloorPlanResponse,
  MapConfigResponse,
  ReportsSummary,
  RoomItem,
  SearchResponse,
  UserProfile,
  VisitPassReceipt,
  VisitRecord,
} from '../types/campus';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const TOKEN_STORAGE_KEY = 'rvce_navigator_token';

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

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
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

export const campusApi = {
  getHealth: () =>
    request<{
      healthy: boolean;
      mysql: { connected: boolean; detail: string };
      mongodb: { connected: boolean; detail: string };
    }>('/health'),

  getMapConfig: () => request<MapConfigResponse>('/map/config'),

  getBuildings: (params?: { building_type?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.building_type) sp.set('building_type', params.building_type);
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<Building[]>(`/buildings${qs ? `?${qs}` : ''}`);
  },

  getBuildingDetail: (buildingId: number) =>
    request<BuildingDetailResponse>(`/buildings/${buildingId}`),

  getFloorPlan: (floorId: number) =>
    request<FloorPlanResponse>(`/floors/${floorId}/floor-plan`),

  getRoomDetail: (roomId: number) =>
    request<{ room: RoomItem; occupants: FacultyMember[] }>(`/rooms/${roomId}`),

  getDepartments: () => request<DepartmentItem[]>('/departments'),

  getFaculty: (params?: { dept_id?: number; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.dept_id !== undefined) sp.set('dept_id', String(params.dept_id));
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<FacultyMember[]>(`/faculty${qs ? `?${qs}` : ''}`);
  },

  getFacilities: (params?: { category?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params?.category) sp.set('category', params.category);
    if (params?.q) sp.set('q', params.q);
    const qs = sp.toString();
    return request<FacilityItem[]>(`/facilities${qs ? `?${qs}` : ''}`);
  },

  search: (q: string, category?: string) => {
    const sp = new URLSearchParams({ q });
    if (category && category !== 'ALL') sp.set('category', category);
    return request<SearchResponse>(`/search?${sp.toString()}`);
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
