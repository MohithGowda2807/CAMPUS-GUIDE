import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  ArrowUpDown,
  Building2,
  Car,
  ChevronDown,
  ChevronUp,
  Clock,
  CornerUpLeft,
  CornerUpRight,
  Footprints,
  Layers,
  LocateFixed,
  MapPin,
  MousePointerClick,
  Navigation,
  Search,
  X,
} from 'lucide-react';
import { CampusLeafletMap } from '../components/CampusLeafletMap';
import { Header } from '../components/Header';
import { AvailabilityBadge, VerificationBadge } from '../components/StatusBadge';
import { campusApi } from '../services/api';
import type {
  Building,
  BuildingDetailResponse,
  CampusRouteResponse,
  FacilityItem,
  MapConfigResponse,
  NavigationPoint,
  RouteStep,
  SearchResultItem,
  TravelMode,
} from '../types/campus';

const RECENT_STORAGE_KEY = 'rvce_recent_destinations';

const DEFAULT_GATE_ORIGIN: NavigationPoint = {
  label: 'Main Mysuru Road Entrance Gate',
  lat: 12.924631,
  lng: 77.49904,
  source: 'BUILDING',
};

const CATEGORY_FILTERS = [
  { code: 'ALL', label: 'All' },
  { code: 'ACADEMIC_BLOCK', label: 'Academic Blocks' },
  { code: 'LABORATORY_COMPLEX', label: 'Labs & Centres' },
  { code: 'ADMINISTRATION', label: 'Administration' },
  { code: 'LIBRARY', label: 'Libraries' },
  { code: 'AUDITORIUM', label: 'Auditorium' },
  { code: 'AMENITIES', label: 'Sports & Health' },
  { code: 'HOSTEL', label: 'Hostels' },
  { code: 'SECURITY_GATE', label: 'Gates' },
  { code: 'FACILITIES_ONLY', label: 'Facilities & Food' },
];

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return '< 1 min';
  }
  const mins = Math.max(1, Math.round(seconds / 60));
  return `${mins} min`;
}

export function CampusMapPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mapConfig, setMapConfig] = useState<MapConfigResponse | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  const [dbUnavailableMsg, setDbUnavailableMsg] = useState<string | null>(null);

  const [query, setQuery] = useState<string>(searchParams.get('q') || '');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState<boolean>(false);

  const [selectedBuildingId, setSelectedBuildingId] = useState<number | null>(() => {
    const b = searchParams.get('building');
    return b ? Number(b) : null;
  });
  const [selectedFacilityId, setSelectedFacilityId] = useState<number | null>(() => {
    const f = searchParams.get('facility');
    return f ? Number(f) : null;
  });
  const [selectedBuildingDetail, setSelectedBuildingDetail] =
    useState<BuildingDetailResponse | null>(null);

  // Campus Turn-by-Turn Navigation State
  const [directionsOpen, setDirectionsOpen] = useState<boolean>(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('WALKING');
  const [originPoint, setOriginPoint] = useState<NavigationPoint | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<NavigationPoint | null>(null);
  const [pickingTarget, setPickingTarget] = useState<'ORIGIN' | 'DESTINATION' | null>(null);
  const [activeRoute, setActiveRoute] = useState<CampusRouteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [focusedStepCoord, setFocusedStepCoord] = useState<{ lat: number; lng: number } | null>(
    null
  );

  const [recentItems, setRecentItems] = useState<SearchResultItem[]>(() => {
    try {
      const raw = sessionStorage.getItem(RECENT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SearchResultItem[]) : [];
    } catch {
      return [];
    }
  });

  const [mobileSheetExpanded, setMobileSheetExpanded] = useState<boolean>(true);

  const pushRecent = useCallback((item: SearchResultItem) => {
    setRecentItems((prev) => {
      const deduped = [
        item,
        ...prev.filter((x) => !(x.entity_type === item.entity_type && x.id === item.id)),
      ].slice(0, 5);
      sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(deduped));
      return deduped;
    });
  }, []);

  // Load initial map configuration, buildings & outdoor facilities
  useEffect(() => {
    Promise.all([
      campusApi.getMapConfig(),
      campusApi.getBuildings(),
      campusApi.getFacilities(),
    ])
      .then(([cfg, bldgs, facs]) => {
        setMapConfig(cfg);
        setBuildings(bldgs);
        setFacilities(facs);
        setDbUnavailableMsg(null);
      })
      .catch((err: Error) => {
        setDbUnavailableMsg(err.message);
      });
  }, []);

  // Combined list of named campus places (buildings + standalone facilities) for quick dropdown selection
  const quickPlaceOptions = useMemo(() => {
    const opts: Array<{ key: string; point: NavigationPoint; group: 'Buildings' | 'Facilities' }> =
      [];
    for (const b of buildings) {
      opts.push({
        key: `B-${b.building_id}`,
        group: 'Buildings',
        point: {
          label: `${b.building_name} (${b.building_code})`,
          lat: b.latitude,
          lng: b.longitude,
          source: 'BUILDING',
          entityId: b.building_id,
        },
      });
    }
    for (const fc of facilities) {
      if (fc.latitude !== null && fc.longitude !== null) {
        opts.push({
          key: `F-${fc.facility_id}`,
          group: 'Facilities',
          point: {
            label: fc.facility_name,
            lat: fc.latitude,
            lng: fc.longitude,
            source: 'FACILITY',
            entityId: fc.facility_id,
          },
        });
      }
    }
    return opts;
  }, [buildings, facilities]);

  // Compute campus route whenever origin, destination, or travelMode changes
  useEffect(() => {
    if (!originPoint || !destinationPoint) {
      setActiveRoute(null);
      setRouteError(null);
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);

    campusApi
      .getCampusRoute({
        from_lat: originPoint.lat,
        from_lng: originPoint.lng,
        to_lat: destinationPoint.lat,
        to_lng: destinationPoint.lng,
        mode: travelMode,
        from_label: originPoint.label,
        to_label: destinationPoint.label,
      })
      .then((res) => {
        if (!cancelled) {
          setActiveRoute(res);
          setRouteError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setActiveRoute(null);
          setRouteError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRouteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [originPoint, destinationPoint, travelMode]);

  // Run unified backend search when query changes
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      campusApi
        .search(trimmed)
        .then((res) => setSearchResults(res.results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query]);

  // Fetch building detail + floors whenever selectedBuildingId changes
  useEffect(() => {
    if (!selectedBuildingId) {
      setSelectedBuildingDetail(null);
      return;
    }
    campusApi
      .getBuildingDetail(selectedBuildingId)
      .then(setSelectedBuildingDetail)
      .catch(() => setSelectedBuildingDetail(null));
  }, [selectedBuildingId]);

  const filteredBuildings = useMemo(() => {
    if (activeCategory === 'ALL' || directionsOpen) return buildings;
    if (activeCategory === 'FACILITIES_ONLY') return [];
    return buildings.filter((b) => b.building_type === activeCategory);
  }, [buildings, activeCategory, directionsOpen]);

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.facility_id === selectedFacilityId) || null,
    [facilities, selectedFacilityId]
  );

  // Start navigation to a specific destination (defaults origin to Main Gate if none set yet)
  const startNavigationTo = useCallback(
    (dest: NavigationPoint) => {
      setDirectionsOpen(true);
      setQuery('');
      setPickingTarget(null);
      setMobileSheetExpanded(true);
      setDestinationPoint(dest);
      setOriginPoint((prev) => prev ?? DEFAULT_GATE_ORIGIN);
    },
    []
  );

  const handlePickMapLocation = useCallback(
    (lat: number, lng: number, target: 'ORIGIN' | 'DESTINATION') => {
      const customPoint: NavigationPoint = {
        label:
          target === 'ORIGIN'
            ? `Pinned Spot (${lat.toFixed(5)}, ${lng.toFixed(5)})`
            : `Pinned Destination (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        lat,
        lng,
        source: 'MAP_PIN',
      };
      setDirectionsOpen(true);
      setPickingTarget(null);
      setMobileSheetExpanded(true);

      if (target === 'ORIGIN') {
        setOriginPoint(customPoint);
      } else {
        setDestinationPoint(customPoint);
        setOriginPoint((prev) => prev ?? DEFAULT_GATE_ORIGIN);
      }
    },
    []
  );

  const handleUseGpsOrigin = () => {
    if (!navigator.geolocation) {
      setRouteError('Browser location is unavailable. Click "Pick on Map" to mark where you are standing.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginPoint({
          label: 'Your Live GPS Location',
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          source: 'GPS',
        });
        setPickingTarget(null);
      },
      () => {
        setRouteError(
          'Location permission declined. Use "Pick on Map" to click where you are standing on campus.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSelectBuilding = useCallback(
    (b: Building) => {
      if (pickingTarget) {
        const pt: NavigationPoint = {
          label: `${b.building_name} (${b.building_code})`,
          lat: b.latitude,
          lng: b.longitude,
          source: 'BUILDING',
          entityId: b.building_id,
        };
        if (pickingTarget === 'ORIGIN') {
          setOriginPoint(pt);
        } else {
          setDestinationPoint(pt);
          setOriginPoint((prev) => prev ?? DEFAULT_GATE_ORIGIN);
        }
        setPickingTarget(null);
        setDirectionsOpen(true);
        setMobileSheetExpanded(true);
        return;
      }

      setSelectedFacilityId(null);
      setSelectedBuildingId(b.building_id);
      setSearchParams({ building: String(b.building_id) }, { replace: true });
      setMobileSheetExpanded(true);
      pushRecent({
        entity_type: 'BUILDING',
        id: b.building_id,
        title: b.building_name,
        subtitle: `Code: ${b.building_code}`,
        building_id: b.building_id,
        floor_id: null,
        room_id: null,
        latitude: b.latitude,
        longitude: b.longitude,
        verification_status: b.verification_status,
      });
    },
    [pickingTarget, pushRecent, setSearchParams]
  );

  const handleSelectFacilityPin = useCallback(
    (fc: FacilityItem) => {
      if (pickingTarget && fc.latitude !== null && fc.longitude !== null) {
        const pt: NavigationPoint = {
          label: fc.facility_name,
          lat: fc.latitude,
          lng: fc.longitude,
          source: 'FACILITY',
          entityId: fc.facility_id,
        };
        if (pickingTarget === 'ORIGIN') {
          setOriginPoint(pt);
        } else {
          setDestinationPoint(pt);
          setOriginPoint((prev) => prev ?? DEFAULT_GATE_ORIGIN);
        }
        setPickingTarget(null);
        setDirectionsOpen(true);
        setMobileSheetExpanded(true);
        return;
      }

      setSelectedBuildingId(null);
      setSelectedFacilityId(fc.facility_id);
      setMobileSheetExpanded(true);
    },
    [pickingTarget]
  );

  const handleSelectSearchResult = (item: SearchResultItem) => {
    pushRecent(item);
    if (item.entity_type === 'BUILDING' && item.building_id) {
      setQuery('');
      setActiveCategory('ALL');
      setSelectedFacilityId(null);
      setSelectedBuildingId(item.building_id);
      setSearchParams({ building: String(item.building_id) }, { replace: true });
    } else if (item.entity_type === 'ROOM' && item.building_id) {
      navigate(
        `/buildings/${item.building_id}?floor=${item.floor_id ?? ''}&room=${item.room_id ?? ''}`
      );
    } else if (item.entity_type === 'FACULTY') {
      if (item.building_id) {
        setQuery('');
        setActiveCategory('ALL');
        setSelectedFacilityId(null);
        setSelectedBuildingId(item.building_id);
        setSearchParams({ building: String(item.building_id) }, { replace: true });
      } else {
        navigate(`/directory?tab=faculty&q=${encodeURIComponent(item.title)}`);
      }
    } else if (item.entity_type === 'FACILITY') {
      setQuery('');
      if (item.building_id) {
        setActiveCategory('ALL');
        setSelectedBuildingId(item.building_id);
        setSelectedFacilityId(null);
        setSearchParams({ building: String(item.building_id) }, { replace: true });
      } else {
        setSelectedBuildingId(null);
        setSelectedFacilityId(item.id);
        setSearchParams({ facility: String(item.id) }, { replace: true });
      }
    }
  };

  const clearSelection = () => {
    setSelectedBuildingId(null);
    setSelectedFacilityId(null);
    setSelectedBuildingDetail(null);
    setSearchParams({}, { replace: true });
  };

  const closeDirections = () => {
    setDirectionsOpen(false);
    setPickingTarget(null);
    setActiveRoute(null);
    setOriginPoint(null);
    setDestinationPoint(null);
    setRouteError(null);
    setFocusedStepCoord(null);
  };

  const swapEndpoints = () => {
    setOriginPoint(destinationPoint);
    setDestinationPoint(originPoint);
  };

  const renderStepIcon = (step: RouteStep) => {
    if (step.maneuver === 'ARRIVE') {
      return <MapPin className="w-4 h-4 text-[#DC2626] shrink-0" />;
    }
    if (step.maneuver === 'TURN_LEFT' || step.maneuver === 'SLIGHT_LEFT') {
      return <CornerUpLeft className="w-4 h-4 text-[#27447E] shrink-0" />;
    }
    if (step.maneuver === 'TURN_RIGHT' || step.maneuver === 'SLIGHT_RIGHT') {
      return <CornerUpRight className="w-4 h-4 text-[#27447E] shrink-0" />;
    }
    if (step.maneuver === 'DROPOFF_WALK' || step.path_type === 'WALKWAY' || step.path_type === 'STEPS') {
      return <Footprints className="w-4 h-4 text-[#0284C7] shrink-0" />;
    }
    return <Navigation className="w-4 h-4 text-[#27447E] shrink-0" />;
  };

  return (
    <div className="h-screen flex flex-col bg-[#F5F7FA] overflow-hidden">
      <Header compact />

      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Left Search, Directions & Building Info Sidebar */}
        <aside className="w-full lg:w-[410px] xl:w-[435px] bg-white border-t lg:border-t-0 lg:border-r border-[#E2E8F0] flex flex-col z-[600] order-2 lg:order-1 max-h-[54vh] lg:max-h-none shrink-0">
          {/* Mobile Sheet Handle */}
          <button
            type="button"
            onClick={() => setMobileSheetExpanded((v) => !v)}
            className="lg:hidden flex items-center justify-between px-4 py-2 bg-[#F5F7FA] border-b border-[#E2E8F0] text-xs font-semibold text-[#202938]"
          >
            <span>
              {directionsOpen ? 'Campus Turn-by-Turn Navigation' : 'Campus Search & Destinations'}
            </span>
            {mobileSheetExpanded ? (
              <ChevronDown className="w-4 h-4 text-[#64748B]" />
            ) : (
              <ChevronUp className="w-4 h-4 text-[#64748B]" />
            )}
          </button>

          <div
            className={`${
              mobileSheetExpanded ? 'flex' : 'hidden lg:flex'
            } flex-col flex-1 overflow-hidden`}
          >
            {/* Unified Top Search + Directions Toggle */}
            {!directionsOpen ? (
              <div className="p-4 border-b border-[#E2E8F0] space-y-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search buildings, Mingos, labs, faculty..."
                      className="w-full pl-9 pr-8 py-2 text-sm bg-[#F5F7FA] border border-[#E2E8F0] rounded-md focus:bg-white focus:border-[#27447E] outline-none"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#202938] cursor-pointer"
                        aria-label="Clear search"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDirectionsOpen(true);
                      setOriginPoint((prev) => prev ?? DEFAULT_GATE_ORIGIN);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] transition-colors shrink-0 cursor-pointer"
                    title="Open campus turn-by-turn directions"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    Directions
                  </button>
                </div>

                {/* Category Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {CATEGORY_FILTERS.map((cat) => {
                    const active = activeCategory === cat.code;
                    return (
                      <button
                        key={cat.code}
                        type="button"
                        onClick={() => setActiveCategory(cat.code)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap border transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#27447E] text-white border-[#27447E]'
                            : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#27447E] hover:text-[#27447E]'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Google-Maps-Style Campus Directions Header */
              <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-md border border-[#E2E8F0] bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setTravelMode('WALKING')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        travelMode === 'WALKING'
                          ? 'bg-[#27447E] text-white'
                          : 'text-[#64748B] hover:text-[#202938]'
                      }`}
                    >
                      <Footprints className="w-3.5 h-3.5" />
                      Walking
                    </button>
                    <button
                      type="button"
                      onClick={() => setTravelMode('VEHICLE')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                        travelMode === 'VEHICLE'
                          ? 'bg-[#27447E] text-white'
                          : 'text-[#64748B] hover:text-[#202938]'
                      }`}
                    >
                      <Car className="w-3.5 h-3.5" />
                      Vehicle
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={swapEndpoints}
                      disabled={!originPoint && !destinationPoint}
                      className="p-1.5 rounded border border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#27447E] disabled:opacity-40 cursor-pointer"
                      title="Swap Start and Destination"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={closeDirections}
                      className="p-1.5 rounded border border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#202938] cursor-pointer"
                      title="Close Directions"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Origin (A) Input Row */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#15803D] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      A
                    </span>
                    <select
                      aria-label="Starting Point"
                      value={
                        originPoint
                          ? quickPlaceOptions.find(
                              (o) =>
                                Math.abs(o.point.lat - originPoint.lat) < 1e-5 &&
                                Math.abs(o.point.lng - originPoint.lng) < 1e-5
                            )?.key ?? '__CUSTOM_ORIGIN__'
                          : ''
                      }
                      onChange={(e) => {
                        const found = quickPlaceOptions.find((o) => o.key === e.target.value);
                        if (found) {
                          setOriginPoint(found.point);
                          setPickingTarget(null);
                        }
                      }}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-[#CBD5E1] rounded-md text-[#202938] font-medium focus:border-[#27447E] outline-none"
                    >
                      <option value="">Select starting location…</option>
                      {originPoint &&
                        !quickPlaceOptions.some(
                          (o) =>
                            Math.abs(o.point.lat - originPoint.lat) < 1e-5 &&
                            Math.abs(o.point.lng - originPoint.lng) < 1e-5
                        ) && <option value="__CUSTOM_ORIGIN__">{originPoint.label}</option>}
                      <optgroup label="Popular Amenities & Gates">
                        {quickPlaceOptions
                          .filter((o) => o.group === 'Facilities')
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.point.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Campus Buildings & Departments">
                        {quickPlaceOptions
                          .filter((o) => o.group === 'Buildings')
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.point.label}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setPickingTarget((p) => (p === 'ORIGIN' ? null : 'ORIGIN'))
                      }
                      className={`p-1.5 rounded border text-xs cursor-pointer shrink-0 ${
                        pickingTarget === 'ORIGIN'
                          ? 'bg-[#27447E] text-white border-[#27447E]'
                          : 'bg-white text-[#27447E] border-[#CBD5E1] hover:bg-[#EDF2FA]'
                      }`}
                      title="Click anywhere on map to set where you are standing"
                    >
                      <MousePointerClick className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleUseGpsOrigin}
                      className="p-1.5 rounded border border-[#CBD5E1] bg-white text-[#27447E] hover:bg-[#EDF2FA] text-xs cursor-pointer shrink-0"
                      title="Use my live GPS location"
                    >
                      <LocateFixed className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Destination (B) Input Row */}
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      B
                    </span>
                    <select
                      aria-label="Destination"
                      value={
                        destinationPoint
                          ? quickPlaceOptions.find(
                              (o) =>
                                Math.abs(o.point.lat - destinationPoint.lat) < 1e-5 &&
                                Math.abs(o.point.lng - destinationPoint.lng) < 1e-5
                            )?.key ?? '__CUSTOM_DEST__'
                          : ''
                      }
                      onChange={(e) => {
                        const found = quickPlaceOptions.find((o) => o.key === e.target.value);
                        if (found) {
                          setDestinationPoint(found.point);
                          setPickingTarget(null);
                        }
                      }}
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-[#CBD5E1] rounded-md text-[#202938] font-medium focus:border-[#27447E] outline-none"
                    >
                      <option value="">Choose destination (e.g. Big Mingos, Admin)…</option>
                      {destinationPoint &&
                        !quickPlaceOptions.some(
                          (o) =>
                            Math.abs(o.point.lat - destinationPoint.lat) < 1e-5 &&
                            Math.abs(o.point.lng - destinationPoint.lng) < 1e-5
                        ) && <option value="__CUSTOM_DEST__">{destinationPoint.label}</option>}
                      <optgroup label="Popular Amenities, Food & Gates">
                        {quickPlaceOptions
                          .filter((o) => o.group === 'Facilities')
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.point.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Campus Buildings & Departments">
                        {quickPlaceOptions
                          .filter((o) => o.group === 'Buildings')
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.point.label}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setPickingTarget((p) => (p === 'DESTINATION' ? null : 'DESTINATION'))
                      }
                      className={`p-1.5 rounded border text-xs cursor-pointer shrink-0 ${
                        pickingTarget === 'DESTINATION'
                          ? 'bg-[#27447E] text-white border-[#27447E]'
                          : 'bg-white text-[#27447E] border-[#CBD5E1] hover:bg-[#EDF2FA]'
                      }`}
                      title="Click anywhere on map to pick destination"
                    >
                      <MousePointerClick className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable Content Region */}
            <div className="flex-1 overflow-y-auto">
              {dbUnavailableMsg && (
                <div className="m-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <div className="font-semibold">Directory Database Connection Pending</div>
                  <div className="mt-0.5 text-amber-800">{dbUnavailableMsg}</div>
                </div>
              )}

              {/* Active Directions Panel Body */}
              {directionsOpen ? (
                <div className="p-4 space-y-4">
                  {routeError && (
                    <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                      {routeError}
                    </div>
                  )}

                  {!destinationPoint ? (
                    <div className="p-5 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-center space-y-2">
                      <Navigation className="w-6 h-6 text-[#27447E] mx-auto" />
                      <div className="text-xs font-semibold text-[#202938]">
                        Select Where You Want to Go
                      </div>
                      <p className="text-xs text-[#64748B] leading-relaxed">
                        Choose a destination above (such as <strong>Big Mingos Food Court</strong>{' '}
                        or <strong>Administrative Block</strong>), or click anywhere directly on the
                        campus map.
                      </p>
                    </div>
                  ) : routeLoading ? (
                    <div className="p-6 text-center text-xs text-[#64748B]">
                      Calculating best campus route…
                    </div>
                  ) : activeRoute ? (
                    <>
                      {/* Route Summary Card */}
                      <div className="rounded-lg border border-[#CBD5E1] bg-[#EDF2FA]/65 p-3.5 space-y-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-lg font-bold text-[#1D3563]">
                            {formatDuration(activeRoute.total_duration_seconds)}
                            <span className="text-sm font-semibold text-[#202938] ml-2">
                              ({formatDistance(activeRoute.total_distance_m)})
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-white border border-[#CBD5E1] text-[11px] font-semibold text-[#27447E]">
                            {activeRoute.mode === 'WALKING' ? 'Walking Route' : 'Vehicle + Drop-off'}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#475569] flex flex-wrap items-center gap-x-3 gap-y-1">
                          {activeRoute.breakdown.road_distance_m > 0 && (
                            <span>
                              Campus roads: {formatDistance(activeRoute.breakdown.road_distance_m)}
                            </span>
                          )}
                          {activeRoute.breakdown.walkway_distance_m > 0 && (
                            <span>
                              Walking paths:{' '}
                              {formatDistance(activeRoute.breakdown.walkway_distance_m)}
                            </span>
                          )}
                          {activeRoute.uses_steps && (
                            <span className="text-amber-800 font-medium">• Includes steps</span>
                          )}
                        </div>
                      </div>

                      {/* Turn-by-Turn Instructions */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] px-1">
                          Step-by-Step Campus Directions
                        </div>
                        <div className="border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] bg-white">
                          {activeRoute.steps.map((step, idx) => (
                            <button
                              key={`${idx}-${step.instruction}`}
                              type="button"
                              onClick={() => setFocusedStepCoord({ lat: step.lat, lng: step.lng })}
                              className="w-full text-left px-3.5 py-2.5 hover:bg-[#F5F7FA] transition-colors flex items-start gap-2.5 cursor-pointer"
                            >
                              <div className="mt-0.5">{renderStepIcon(step)}</div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-[#202938]">
                                  {step.instruction}
                                </div>
                                {step.distance_m > 0 && (
                                  <div className="text-[11px] text-[#64748B] mt-0.5">
                                    {formatDistance(step.distance_m)} •{' '}
                                    {step.path_type === 'WALKWAY'
                                      ? 'Pedestrian footpath'
                                      : step.path_type === 'STEPS'
                                        ? 'Pedestrian steps'
                                        : 'Campus road'}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : query.trim() ? (
                /* Active Search Results */
                <div className="divide-y divide-[#E2E8F0]">
                  <div className="px-4 py-2 bg-[#F5F7FA] text-xs font-semibold text-[#64748B] flex items-center justify-between">
                    <span>Search Results</span>
                    <span>{searching ? 'Searching…' : `${searchResults.length} found`}</span>
                  </div>
                  {searchResults.length === 0 && !searching ? (
                    <div className="p-6 text-center text-sm text-[#64748B]">
                      No matching campus buildings, rooms, faculty, or facilities found for &ldquo;
                      {query}&rdquo;.
                    </div>
                  ) : (
                    searchResults.map((item) => (
                      <div
                        key={`${item.entity_type}-${item.id}`}
                        className="px-4 py-3 hover:bg-[#EDF2FA]/60 transition-colors flex items-center justify-between gap-2"
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(item)}
                          className="text-left flex-1 min-w-0 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#27447E]">
                              {item.entity_type}
                            </span>
                            {item.availability && item.availability !== 'UNKNOWN' && (
                              <AvailabilityBadge state={item.availability} />
                            )}
                            <VerificationBadge status={item.verification_status} />
                          </div>
                          <div className="text-sm font-semibold text-[#202938] mt-0.5 truncate">
                            {item.title}
                          </div>
                          <div className="text-xs text-[#64748B] mt-0.5 truncate">
                            {item.subtitle}
                          </div>
                        </button>

                        {item.latitude !== null && item.longitude !== null && (
                          <button
                            type="button"
                            onClick={() =>
                              startNavigationTo({
                                label: item.title,
                                lat: item.latitude!,
                                lng: item.longitude!,
                                source:
                                  item.entity_type === 'FACILITY' ? 'FACILITY' : 'BUILDING',
                                entityId: item.building_id ?? item.id,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#EDF2FA] text-[#27447E] hover:bg-[#27447E] hover:text-white text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                            title={`Navigate to ${item.title}`}
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            Go
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : selectedBuildingDetail ? (
                /* Selected Building Detail & Floor Selector */
                <div className="p-4 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                          {selectedBuildingDetail.building.building_code}
                        </span>
                        <VerificationBadge
                          status={selectedBuildingDetail.building.verification_status}
                        />
                      </div>
                      <h2 className="text-base font-bold text-[#202938] mt-1.5">
                        {selectedBuildingDetail.building.building_name}
                      </h2>
                      <p className="text-xs text-[#64748B] mt-0.5">
                        {selectedBuildingDetail.building.building_type.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="p-1.5 rounded border border-[#E2E8F0] text-[#64748B] hover:text-[#202938] hover:bg-[#F5F7FA] cursor-pointer"
                      title="Clear selection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {selectedBuildingDetail.building.description && (
                    <p className="text-xs text-[#202938] leading-relaxed bg-[#F5F7FA] p-3 rounded-md border border-[#E2E8F0]">
                      {selectedBuildingDetail.building.description}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-[#64748B]">
                    <span className="inline-flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-[#27447E]" />
                      {selectedBuildingDetail.building.total_floors} Floor(s)
                    </span>
                    {selectedBuildingDetail.building.is_accessible && (
                      <span className="inline-flex items-center gap-1">
                        <Accessibility className="w-3.5 h-3.5 text-[#27447E]" />
                        Accessible Entrance
                      </span>
                    )}
                  </div>

                  {/* Primary Actions: Directions Here + View Building & Offices */}
                  <div className="pt-1 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        startNavigationTo({
                          label: `${selectedBuildingDetail.building.building_name} (${selectedBuildingDetail.building.building_code})`,
                          lat: selectedBuildingDetail.building.latitude,
                          lng: selectedBuildingDetail.building.longitude,
                          source: 'BUILDING',
                          entityId: selectedBuildingDetail.building.building_id,
                        })
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] transition-colors cursor-pointer"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Directions Here
                    </button>
                    <Link
                      to={`/buildings/${selectedBuildingDetail.building.building_id}`}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md border border-[#27447E] text-[#27447E] text-xs font-semibold hover:bg-[#EDF2FA] transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Building &amp; Offices
                    </Link>
                  </div>

                  {/* Direct Floor Jump List */}
                  {selectedBuildingDetail.floors.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                        Floors
                      </h3>
                      <div className="space-y-1.5">
                        {selectedBuildingDetail.floors.map((fl) => (
                          <Link
                            key={fl.floor_id}
                            to={`/buildings/${selectedBuildingDetail.building.building_id}?floor=${fl.floor_id}`}
                            className="flex items-center justify-between px-3 py-2 rounded-md border border-[#E2E8F0] hover:border-[#27447E] hover:bg-[#EDF2FA]/40 transition-colors text-xs"
                          >
                            <span className="font-semibold text-[#202938]">{fl.floor_name}</span>
                            <span className="text-[#64748B]">
                              {fl.room_count > 0
                                ? `${fl.room_count} listed office${fl.room_count === 1 ? '' : 's'}`
                                : 'View floor'}
                              {fl.has_floor_plan ? ' • Layout Ready' : ''}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedFacility ? (
                /* Selected Standalone Outdoor Facility Detail (e.g. Big Mingos, MM Foods, ATM) */
                <div className="p-4 space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="px-2 py-0.5 rounded bg-[#EDF2FA] text-[#27447E] text-xs font-semibold">
                        {selectedFacility.category.replace(/_/g, ' ')}
                      </span>
                      <h2 className="text-base font-bold text-[#202938] mt-1.5">
                        {selectedFacility.facility_name}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="p-1.5 rounded border border-[#E2E8F0] text-[#64748B] hover:text-[#202938] cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {selectedFacility.description && (
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      {selectedFacility.description}
                    </p>
                  )}
                  {selectedFacility.opening_hours && (
                    <div className="text-xs text-[#202938] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#27447E]" />
                      <span>{selectedFacility.opening_hours}</span>
                    </div>
                  )}
                  {selectedFacility.latitude !== null && selectedFacility.longitude !== null && (
                    <button
                      type="button"
                      onClick={() =>
                        startNavigationTo({
                          label: selectedFacility.facility_name,
                          lat: selectedFacility.latitude!,
                          lng: selectedFacility.longitude!,
                          source: 'FACILITY',
                          entityId: selectedFacility.facility_id,
                        })
                      }
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] transition-colors cursor-pointer"
                    >
                      <Navigation className="w-4 h-4" />
                      Directions to {selectedFacility.facility_name}
                    </button>
                  )}
                </div>
              ) : (
                /* Default Directory Browse + Recent Destinations */
                <div>
                  {recentItems.length > 0 && activeCategory === 'ALL' && (
                    <div className="border-b border-[#E2E8F0]">
                      <div className="px-4 py-2 bg-[#F5F7FA] text-xs font-semibold text-[#64748B] flex items-center justify-between">
                        <span>Recent Destinations</span>
                        <button
                          type="button"
                          onClick={() => {
                            sessionStorage.removeItem(RECENT_STORAGE_KEY);
                            setRecentItems([]);
                          }}
                          className="text-[11px] text-[#27447E] hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="divide-y divide-[#E2E8F0]">
                        {recentItems.map((r) => (
                          <button
                            key={`rec-${r.entity_type}-${r.id}`}
                            type="button"
                            onClick={() => handleSelectSearchResult(r)}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#F5F7FA] text-xs flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <div className="truncate">
                              <span className="font-semibold text-[#202938]">{r.title}</span>
                              <span className="text-[#64748B] ml-2">{r.subtitle}</span>
                            </div>
                            <MapPin className="w-3.5 h-3.5 text-[#27447E] shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="px-4 py-2 bg-[#F5F7FA] text-xs font-semibold text-[#64748B]">
                    {activeCategory === 'FACILITIES_ONLY'
                      ? `Campus Facilities & Food (${facilities.length})`
                      : `Campus Buildings (${filteredBuildings.length})`}
                  </div>

                  {activeCategory === 'FACILITIES_ONLY' ? (
                    <div className="divide-y divide-[#E2E8F0]">
                      {facilities.map((fc) => (
                        <div
                          key={fc.facility_id}
                          className="px-4 py-3 hover:bg-[#EDF2FA]/50 transition-colors flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (fc.building_id) {
                                setSelectedBuildingId(fc.building_id);
                                setSelectedFacilityId(null);
                              } else {
                                setSelectedBuildingId(null);
                                setSelectedFacilityId(fc.facility_id);
                              }
                            }}
                            className="text-left flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[#202938] truncate">
                                {fc.facility_name}
                              </span>
                              <VerificationBadge status={fc.verification_status} />
                            </div>
                            <div className="text-xs text-[#64748B] mt-0.5 truncate">
                              {fc.building_name || fc.category.replace(/_/g, ' ')}
                            </div>
                          </button>
                          {fc.latitude !== null && fc.longitude !== null && (
                            <button
                              type="button"
                              onClick={() =>
                                startNavigationTo({
                                  label: fc.facility_name,
                                  lat: fc.latitude!,
                                  lng: fc.longitude!,
                                  source: 'FACILITY',
                                  entityId: fc.facility_id,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#EDF2FA] text-[#27447E] hover:bg-[#27447E] hover:text-white text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                              title={`Directions to ${fc.facility_name}`}
                            >
                              <Navigation className="w-3.5 h-3.5" />
                              Go
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E2E8F0]">
                      {filteredBuildings.map((b) => (
                        <div
                          key={b.building_id}
                          className="px-4 py-3 hover:bg-[#EDF2FA]/50 transition-colors flex items-center gap-3"
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectBuilding(b)}
                            className="flex items-start gap-3 flex-1 min-w-0 text-left cursor-pointer"
                          >
                            <div className="w-8 h-8 rounded bg-[#EDF2FA] text-[#27447E] flex items-center justify-center shrink-0 mt-0.5">
                              <Building2 className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-[#202938] truncate">
                                  {b.building_name}
                                </span>
                                <span className="text-[11px] font-semibold text-[#27447E] shrink-0">
                                  {b.building_code}
                                </span>
                              </div>
                              <div className="text-xs text-[#64748B] mt-0.5 flex items-center gap-2">
                                <span>
                                  {b.total_floors} {b.total_floors === 1 ? 'Floor' : 'Floors'}
                                </span>
                                <span>•</span>
                                <span>
                                  {b.public_rooms_count > 0
                                    ? `${b.public_rooms_count} Listed Office${b.public_rooms_count === 1 ? '' : 's'}`
                                    : b.building_type.replace(/_/g, ' ')}
                                </span>
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              startNavigationTo({
                                label: `${b.building_name} (${b.building_code})`,
                                lat: b.latitude,
                                lng: b.longitude,
                                source: 'BUILDING',
                                entityId: b.building_id,
                              })
                            }
                            className="p-2 rounded bg-[#EDF2FA] text-[#27447E] hover:bg-[#27447E] hover:text-white transition-colors shrink-0 cursor-pointer"
                            title={`Directions to ${b.building_name}`}
                          >
                            <Navigation className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Primary Interactive Outdoor Map Area */}
        <main className="flex-1 order-1 lg:order-2 relative min-h-[46vh] lg:min-h-0">
          <CampusLeafletMap
            center={mapConfig?.center}
            tileUrl={mapConfig?.tile_layer.url}
            attribution={mapConfig?.tile_layer.attribution}
            buildings={filteredBuildings}
            facilities={facilities}
            geometries={mapConfig?.geometries}
            selectedBuildingId={selectedBuildingId}
            selectedFacilityId={selectedFacilityId}
            activeRoute={activeRoute}
            originPoint={originPoint}
            destinationPoint={destinationPoint}
            pickingTarget={pickingTarget}
            focusedStepCoord={focusedStepCoord}
            onSelectBuilding={handleSelectBuilding}
            onSelectFacility={handleSelectFacilityPin}
            onPickMapLocation={handlePickMapLocation}
            onCancelPicking={() => setPickingTarget(null)}
            onUserGpsLocated={(lat, lng) => {
              if (directionsOpen) {
                setOriginPoint({
                  label: 'Your Live GPS Location',
                  lat: Number(lat.toFixed(6)),
                  lng: Number(lng.toFixed(6)),
                  source: 'GPS',
                });
              }
            }}
          />
        </main>
      </div>
    </div>
  );
}
