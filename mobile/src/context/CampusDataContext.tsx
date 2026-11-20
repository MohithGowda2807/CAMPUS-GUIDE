import React, { createContext, useContext, useEffect, useState } from 'react';
import type {
  Building,
  CampusRouteResponse,
  DepartmentItem,
  FacilityItem,
  FacultyMember,
  GeoGeometry,
  SearchResultItem,
  TravelMode,
} from '../types/campus';
import {
  campusApi,
  getConnectionState,
  initStorage,
  subscribeConnectionState,
  type ConnectionState,
} from '../services/api';
import {
  FALLBACK_BUILDINGS,
  FALLBACK_DEPARTMENTS,
  FALLBACK_FACILITIES,
  FALLBACK_FACULTY,
  FALLBACK_MAP_CONFIG,
} from '../data/fallbackData';

interface CampusDataContextType {
  buildings: Building[];
  facilities: FacilityItem[];
  departments: DepartmentItem[];
  faculty: FacultyMember[];
  geometries: GeoGeometry[];
  selectedBuilding: Building | null;
  selectedFacility: FacilityItem | null;
  activeRoute: CampusRouteResponse | null;
  travelMode: TravelMode;
  connectionState: ConnectionState;
  loading: boolean;
  selectBuilding: (building: Building | null) => void;
  selectFacility: (facility: FacilityItem | null) => void;
  setTravelMode: (mode: TravelMode) => void;
  fetchRoute: (
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    mode?: TravelMode,
    fromLabel?: string,
    toLabel?: string
  ) => Promise<CampusRouteResponse | null>;
  clearRoute: () => void;
  searchCampus: (query: string) => Promise<SearchResultItem[]>;
  refreshData: () => Promise<void>;
}

const CampusDataContext = createContext<CampusDataContextType | null>(null);

export const CampusDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [buildings, setBuildings] = useState<Building[]>(FALLBACK_BUILDINGS);
  const [facilities, setFacilities] = useState<FacilityItem[]>(FALLBACK_FACILITIES);
  const [departments, setDepartments] = useState<DepartmentItem[]>(FALLBACK_DEPARTMENTS);
  const [faculty, setFaculty] = useState<FacultyMember[]>(FALLBACK_FACULTY);
  const [geometries, setGeometries] = useState<GeoGeometry[]>(FALLBACK_MAP_CONFIG.geometries);

  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<FacilityItem | null>(null);
  const [activeRoute, setActiveRoute] = useState<CampusRouteResponse | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');
  const [connectionState, setConnectionState] = useState<ConnectionState>(getConnectionState());
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    initStorage().then(() => {
      refreshData();
    });
    return subscribeConnectionState(setConnectionState);
  }, []);

  const refreshData = async () => {
    setLoading(true);
    try {
      const [bData, fData, dData, facData, mapCfg] = await Promise.all([
        campusApi.getBuildings(),
        campusApi.getFacilities(),
        campusApi.getDepartments(),
        campusApi.getFaculty(),
        campusApi.getMapConfig(),
      ]);

      if (bData && bData.length > 0) setBuildings(bData);
      if (fData && fData.length > 0) setFacilities(fData);
      if (dData && dData.length > 0) setDepartments(dData);
      if (facData && facData.length > 0) setFaculty(facData);
      if (mapCfg && mapCfg.geometries && mapCfg.geometries.length > 0) {
        setGeometries(mapCfg.geometries);
      }
    } catch {
      // Fallbacks already in state
    } finally {
      setLoading(false);
    }
  };

  const selectBuilding = (b: Building | null) => {
    setSelectedBuilding(b);
    if (b) setSelectedFacility(null);
  };

  const selectFacility = (f: FacilityItem | null) => {
    setSelectedFacility(f);
    if (f) setSelectedBuilding(null);
  };

  const fetchRoute = async (
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    mode: TravelMode = travelMode,
    fromLabel = 'Starting Point',
    toLabel = 'Destination'
  ) => {
    try {
      const route = await campusApi.getCampusRoute({
        from_lat: fromLat,
        from_lng: fromLng,
        to_lat: toLat,
        to_lng: toLng,
        mode,
        from_label: fromLabel,
        to_label: toLabel,
      });
      setActiveRoute(route);
      return route;
    } catch (e) {
      console.warn('Route calculation error:', e);
      return null;
    }
  };

  const clearRoute = () => {
    setActiveRoute(null);
  };

  const searchCampus = async (query: string): Promise<SearchResultItem[]> => {
    if (!query.trim()) return [];
    try {
      const res = await campusApi.search(query.trim());
      return res.results || [];
    } catch {
      return [];
    }
  };

  return (
    <CampusDataContext.Provider
      value={{
        buildings,
        facilities,
        departments,
        faculty,
        geometries,
        selectedBuilding,
        selectedFacility,
        activeRoute,
        travelMode,
        connectionState,
        loading,
        selectBuilding,
        selectFacility,
        setTravelMode,
        fetchRoute,
        clearRoute,
        searchCampus,
        refreshData,
      }}
    >
      {children}
    </CampusDataContext.Provider>
  );
};

export const useCampusData = () => {
  const ctx = useContext(CampusDataContext);
  if (!ctx) throw new Error('useCampusData must be used within CampusDataProvider');
  return ctx;
};
