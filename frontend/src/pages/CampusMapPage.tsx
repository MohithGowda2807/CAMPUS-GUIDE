import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  Building2,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  MapPin,
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
  FacilityItem,
  MapConfigResponse,
  SearchResultItem,
} from '../types/campus';

const RECENT_STORAGE_KEY = 'rvce_recent_destinations';

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
  { code: 'FACILITIES_ONLY', label: 'Facilities & Parking' },
];

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
    if (activeCategory === 'ALL') return buildings;
    if (activeCategory === 'FACILITIES_ONLY') return [];
    return buildings.filter((b) => b.building_type === activeCategory);
  }, [buildings, activeCategory]);

  const selectedFacility = useMemo(
    () => facilities.find((f) => f.facility_id === selectedFacilityId) || null,
    [facilities, selectedFacilityId]
  );

  const handleSelectBuilding = useCallback(
    (b: Building) => {
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
    [pushRecent, setSearchParams]
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

  return (
    <div className="h-screen flex flex-col bg-[#F5F7FA] overflow-hidden">
      <Header compact />

      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Left Search, Category & Building Info Sidebar (Collapsible Sheet on Mobile) */}
        <aside className="w-full lg:w-[400px] xl:w-[420px] bg-white border-t lg:border-t-0 lg:border-r border-[#E2E8F0] flex flex-col z-[600] order-2 lg:order-1 max-h-[52vh] lg:max-h-none shrink-0">
          {/* Mobile Sheet Handle */}
          <button
            type="button"
            onClick={() => setMobileSheetExpanded((v) => !v)}
            className="lg:hidden flex items-center justify-between px-4 py-2 bg-[#F5F7FA] border-b border-[#E2E8F0] text-xs font-semibold text-[#202938]"
          >
            <span>Campus Search &amp; Destinations</span>
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
            {/* Unified Search Input */}
            <div className="p-4 border-b border-[#E2E8F0] space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search buildings, rooms, labs, faculty..."
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

            {/* Scrollable Content Region */}
            <div className="flex-1 overflow-y-auto">
              {dbUnavailableMsg && (
                <div className="m-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <div className="font-semibold">Directory Database Connection Pending</div>
                  <div className="mt-0.5 text-amber-800">{dbUnavailableMsg}</div>
                </div>
              )}

              {/* Active Search Results */}
              {query.trim() ? (
                <div className="divide-y divide-[#E2E8F0]">
                  <div className="px-4 py-2 bg-[#F5F7FA] text-xs font-semibold text-[#64748B] flex items-center justify-between">
                    <span>Search Results</span>
                    <span>{searching ? 'Searching…' : `${searchResults.length} found`}</span>
                  </div>
                  {searchResults.length === 0 && !searching ? (
                    <div className="p-6 text-center text-sm text-[#64748B]">
                      No matching campus buildings, rooms, faculty, or facilities found for "{query}".
                    </div>
                  ) : (
                    searchResults.map((item) => (
                      <button
                        key={`${item.entity_type}-${item.id}`}
                        type="button"
                        onClick={() => handleSelectSearchResult(item)}
                        className="w-full text-left px-4 py-3 hover:bg-[#EDF2FA]/60 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#27447E]">
                            {item.entity_type}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {item.availability && item.availability !== 'UNKNOWN' && (
                              <AvailabilityBadge state={item.availability} />
                            )}
                            <VerificationBadge status={item.verification_status} />
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-[#202938] mt-0.5">
                          {item.title}
                        </div>
                        <div className="text-xs text-[#64748B] mt-0.5">{item.subtitle}</div>
                      </button>
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

                  {/* Primary Action: Open Building & Offices */}
                  <div className="pt-1 flex gap-2">
                    <Link
                      to={`/buildings/${selectedBuildingDetail.building.building_id}`}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#27447E] text-white text-xs font-semibold hover:bg-[#1E3666] transition-colors"
                    >
                      <Layers className="w-4 h-4" />
                      View Building &amp; Offices
                    </Link>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="px-3 py-2.5 rounded-md border border-[#E2E8F0] text-xs font-medium text-[#202938] hover:bg-[#F5F7FA] cursor-pointer"
                    >
                      Clear
                    </button>
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
                /* Selected Standalone Outdoor Facility Detail */
                <div className="p-4 space-y-3">
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
                      ? `Campus Facilities (${facilities.length})`
                      : `Campus Buildings (${filteredBuildings.length})`}
                  </div>

                  {activeCategory === 'FACILITIES_ONLY' ? (
                    <div className="divide-y divide-[#E2E8F0]">
                      {facilities.map((fc) => (
                        <button
                          key={fc.facility_id}
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
                          className="w-full text-left px-4 py-3 hover:bg-[#EDF2FA]/50 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[#202938]">
                              {fc.facility_name}
                            </span>
                            <VerificationBadge status={fc.verification_status} />
                          </div>
                          <div className="text-xs text-[#64748B] mt-0.5">
                            {fc.building_name || fc.category.replace(/_/g, ' ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E2E8F0]">
                      {filteredBuildings.map((b) => (
                        <button
                          key={b.building_id}
                          type="button"
                          onClick={() => handleSelectBuilding(b)}
                          className="w-full text-left px-4 py-3 hover:bg-[#EDF2FA]/50 transition-colors cursor-pointer flex items-start gap-3"
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
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Primary Interactive Outdoor Map Area */}
        <main className="flex-1 order-1 lg:order-2 relative min-h-[48vh] lg:min-h-0">
          <CampusLeafletMap
            center={mapConfig?.center}
            tileUrl={mapConfig?.tile_layer.url}
            attribution={mapConfig?.tile_layer.attribution}
            buildings={filteredBuildings}
            facilities={facilities}
            geometries={mapConfig?.geometries}
            selectedBuildingId={selectedBuildingId}
            selectedFacilityId={selectedFacilityId}
            onSelectBuilding={handleSelectBuilding}
            onSelectFacility={(fc) => {
              setSelectedBuildingId(null);
              setSelectedFacilityId(fc.facility_id);
              setMobileSheetExpanded(true);
            }}
          />
        </main>
      </div>
    </div>
  );
}
