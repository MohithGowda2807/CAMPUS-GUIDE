import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { AlertTriangle, Compass, LocateFixed, MousePointerClick } from 'lucide-react';
import type {
  Building,
  CampusRouteResponse,
  FacilityItem,
  GeoGeometry,
  NavigationPoint,
} from '../types/campus';

const DEFAULT_RVCE_LAT = 12.92355;
const DEFAULT_RVCE_LNG = 77.49985;
const DEFAULT_ZOOM = 17;
const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION =
  "&copy; <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener noreferrer'>OpenStreetMap</a> contributors";

export interface MapMarkerTarget {
  type: 'BUILDING' | 'FACILITY';
  id: number;
  title: string;
  subtitle?: string;
  lat: number;
  lng: number;
}

interface CampusLeafletMapProps {
  center?: { lat: number; lng: number; zoom: number };
  tileUrl?: string;
  attribution?: string;
  buildings: Building[];
  facilities?: FacilityItem[];
  geometries?: GeoGeometry[];
  selectedBuildingId?: number | null;
  selectedFacilityId?: number | null;
  activeRoute?: CampusRouteResponse | null;
  originPoint?: NavigationPoint | null;
  destinationPoint?: NavigationPoint | null;
  pickingTarget?: 'ORIGIN' | 'DESTINATION' | null;
  focusedStepCoord?: { lat: number; lng: number } | null;
  onSelectBuilding?: (building: Building) => void;
  onSelectFacility?: (facility: FacilityItem) => void;
  onPickMapLocation?: (
    lat: number,
    lng: number,
    target: 'ORIGIN' | 'DESTINATION'
  ) => void;
  onCancelPicking?: () => void;
  onUserGpsLocated?: (lat: number, lng: number) => void;
  previewMode?: boolean;
  className?: string;
}

function createPinIcon(selected: boolean, kind: 'BUILDING' | 'FACILITY'): L.DivIcon {
  const fill = selected ? '#1D3563' : kind === 'BUILDING' ? '#27447E' : '#335C67';
  const size = selected ? 32 : 24;
  const ring = selected
    ? `<circle cx="18" cy="18" r="16" fill="none" stroke="#27447E" stroke-width="2" stroke-opacity="0.35"/>`
    : '';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
      ${ring}
      <path d="M18 4C11.9 4 7 8.9 7 15c0 8.2 11 17 11 17s11-8.8 11-17c0-6.1-4.9-11-11-11z"
            fill="${fill}" stroke="#FFFFFF" stroke-width="2"/>
      <circle cx="18" cy="15" r="4.2" fill="#FFFFFF"/>
    </svg>
  `;
  return L.divIcon({
    html: svg,
    className: 'rvce-custom-pin',
    iconSize: [size, size],
    iconAnchor: [size / 2, size - 2],
    popupAnchor: [0, -size + 6],
  });
}

function createEndpointIcon(kind: 'ORIGIN' | 'DESTINATION'): L.DivIcon {
  const bg = kind === 'ORIGIN' ? '#15803D' : '#DC2626';
  const badge = kind === 'ORIGIN' ? 'A' : 'B';
  const html = `
    <div style="
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background: ${bg};
      color: #FFFFFF;
      border: 2.5px solid #FFFFFF;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      font-family: Inter, system-ui, sans-serif;
    ">${badge}</div>
  `;
  return L.divIcon({
    html,
    className: 'rvce-endpoint-pin',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export function CampusLeafletMap({
  center,
  tileUrl = DEFAULT_TILE_URL,
  attribution = DEFAULT_ATTRIBUTION,
  buildings,
  facilities = [],
  geometries = [],
  selectedBuildingId = null,
  selectedFacilityId = null,
  activeRoute = null,
  originPoint = null,
  destinationPoint = null,
  pickingTarget = null,
  focusedStepCoord = null,
  onSelectBuilding,
  onSelectFacility,
  onPickMapLocation,
  onCancelPicking,
  onUserGpsLocated,
  previewMode = false,
  className = 'h-full w-full',
}: CampusLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const userLocationMarkerRef = useRef<L.CircleMarker | null>(null);
  const syncedCenterRef = useRef<boolean>(false);

  const pickingTargetRef = useRef(pickingTarget);
  pickingTargetRef.current = pickingTarget;
  const onPickMapLocationRef = useRef(onPickMapLocation);
  onPickMapLocationRef.current = onPickMapLocation;

  const [tileError, setTileError] = useState(false);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);

  const initLat = center?.lat ?? DEFAULT_RVCE_LAT;
  const initLng = center?.lng ?? DEFAULT_RVCE_LNG;
  const initZoom = center?.zoom ?? DEFAULT_ZOOM;

  // Initialize Leaflet map instance
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [initLat, initLng],
      zoom: initZoom,
      zoomControl: false,
      scrollWheelZoom: !previewMode,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const tiles = L.tileLayer(tileUrl, {
      attribution,
      maxZoom: 20,
      crossOrigin: true,
    });

    let errorCount = 0;
    tiles.on('tileerror', () => {
      errorCount += 1;
      if (errorCount >= 4) {
        setTileError(true);
      }
    });
    tiles.on('tileload', () => {
      setTileError(false);
    });

    tiles.addTo(map);

    geoLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (!previewMode) {
      map.on('click', (ev: L.LeafletMouseEvent) => {
        const lat = Number(ev.latlng.lat.toFixed(6));
        const lng = Number(ev.latlng.lng.toFixed(6));

        if (pickingTargetRef.current && onPickMapLocationRef.current) {
          onPickMapLocationRef.current(lat, lng, pickingTargetRef.current);
          return;
        }

        if (!onPickMapLocationRef.current) return;

        const popupContainer = document.createElement('div');
        popupContainer.style.fontFamily = 'Inter, system-ui, sans-serif';
        popupContainer.style.minWidth = '185px';
        popupContainer.innerHTML = `
          <div style="font-size:11px;font-weight:600;color:#64748B;margin-bottom:6px;">
            Selected Campus Spot
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            <button type="button" data-nav-action="ORIGIN" style="
              padding:6px 10px;border-radius:5px;border:1px solid #CBD5E1;
              background:#F8FAFC;color:#202938;font-size:12px;font-weight:600;
              cursor:pointer;text-align:left;
            ">Stand Here (Set Start)</button>
            <button type="button" data-nav-action="DESTINATION" style="
              padding:6px 10px;border-radius:5px;border:none;
              background:#27447E;color:#FFFFFF;font-size:12px;font-weight:600;
              cursor:pointer;text-align:left;
            ">Navigate Here</button>
          </div>
        `;

        const popup = L.popup({ closeButton: true, offset: [0, -4] })
          .setLatLng(ev.latlng)
          .setContent(popupContainer)
          .openOn(map);

        popupContainer.querySelectorAll('button[data-nav-action]').forEach((btn) => {
          btn.addEventListener('click', (clickEv) => {
            clickEv.stopPropagation();
            const role = (btn as HTMLButtonElement).dataset.navAction as
              | 'ORIGIN'
              | 'DESTINATION';
            map.closePopup(popup);
            onPickMapLocationRef.current?.(lat, lng, role);
          });
        });
      });
    }

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map cursor when picking a point on the map
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.cursor = pickingTarget ? 'crosshair' : '';
  }, [pickingTarget]);

  // Sync map view once when backend campus center loads if no specific pin or route is active
  useEffect(() => {
    if (
      center &&
      mapRef.current &&
      !syncedCenterRef.current &&
      !selectedBuildingId &&
      !selectedFacilityId &&
      !activeRoute
    ) {
      syncedCenterRef.current = true;
      mapRef.current.setView([center.lat, center.lng], center.zoom);
    }
  }, [center, selectedBuildingId, selectedFacilityId, activeRoute]);

  // Fly to a specific turn-by-turn step when clicked in the directions list
  useEffect(() => {
    if (focusedStepCoord && mapRef.current) {
      mapRef.current.flyTo([focusedStepCoord.lat, focusedStepCoord.lng], 19, {
        duration: 0.45,
      });
    }
  }, [focusedStepCoord]);

  // Render verified GeoJSON campus perimeter & clickable building footprints
  useEffect(() => {
    const geoGroup = geoLayerRef.current;
    if (!geoGroup) return;
    geoGroup.clearLayers();

    const buildingById = new Map<number, Building>();
    for (const b of buildings) {
      buildingById.set(b.building_id, b);
    }

    for (const item of geometries) {
      if (!item.geometry) continue;
      const isCampus = item.entity_type === 'CAMPUS_BOUNDARY';
      const matchedBuilding =
        item.entity_type === 'BUILDING_FOOTPRINT' ? buildingById.get(item.mysql_id) : undefined;

      if (!isCampus && buildings.length > 0 && !matchedBuilding) {
        continue;
      }

      const isSelectedFootprint =
        item.entity_type === 'BUILDING_FOOTPRINT' && item.mysql_id === selectedBuildingId;

      try {
        const layer = L.geoJSON(
          {
            type: 'Feature',
            properties: { name: item.name },
            geometry: item.geometry,
          } as never,
          {
            interactive: !isCampus && Boolean(matchedBuilding),
            style: () =>
              isCampus
                ? {
                    color: '#27447E',
                    weight: 2,
                    dashArray: '6 5',
                    fillColor: '#EDF2FA',
                    fillOpacity: 0.03,
                  }
                : {
                    color: isSelectedFootprint ? '#1D3563' : '#27447E',
                    weight: isSelectedFootprint ? 2.5 : 1.25,
                    fillColor: isSelectedFootprint ? '#27447E' : '#3B5998',
                    fillOpacity: isSelectedFootprint ? 0.28 : 0.08,
                  },
          }
        );

        if (matchedBuilding) {
          layer.bindTooltip(
            `${matchedBuilding.building_name} (${matchedBuilding.building_code})`,
            {
              sticky: true,
              direction: 'top',
              className: 'rvce-map-tooltip',
            }
          );
          layer.on('click', (ev: L.LeafletEvent) => {
            L.DomEvent.stopPropagation(ev);
            onSelectBuilding?.(matchedBuilding);
          });
        }

        layer.addTo(geoGroup);
      } catch {
        // Ignore malformed geometry
      }
    }
  }, [geometries, buildings, selectedBuildingId, onSelectBuilding]);

  // Render Active Campus Navigation Route + Origin (A) / Destination (B) Pins
  useEffect(() => {
    const rLayer = routeLayerRef.current;
    const map = mapRef.current;
    if (!rLayer || !map) return;

    rLayer.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [];

    if (activeRoute) {
      for (const leg of activeRoute.legs) {
        if (!leg.coordinates || leg.coordinates.length < 2) continue;
        for (const pt of leg.coordinates) {
          boundsPoints.push([pt[0], pt[1]]);
        }

        if (leg.leg_type === 'DRIVE') {
          // Vehicle Road Casing + Solid Primary Line
          L.polyline(leg.coordinates, {
            color: '#FFFFFF',
            weight: 9,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(rLayer);

          L.polyline(leg.coordinates, {
            color: '#1D4ED8',
            weight: 5.5,
            opacity: 0.96,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(rLayer);
        } else if (leg.leg_type === 'WALK') {
          // Pedestrian Walkway Halo + High-Contrast Dashed Walking Line
          L.polyline(leg.coordinates, {
            color: '#FFFFFF',
            weight: 8,
            opacity: 0.94,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(rLayer);

          L.polyline(leg.coordinates, {
            color: '#0284C7',
            weight: 5,
            opacity: 0.98,
            dashArray: '8 9',
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(rLayer);
        } else {
          // Short Entrance / Access Connector
          L.polyline(leg.coordinates, {
            color: '#475569',
            weight: 3.5,
            opacity: 0.85,
            dashArray: '3 7',
            lineCap: 'round',
            interactive: false,
          }).addTo(rLayer);
        }
      }
    }

    if (originPoint) {
      const mOrigin = L.marker([originPoint.lat, originPoint.lng], {
        icon: createEndpointIcon('ORIGIN'),
        zIndexOffset: 1100,
      }).bindTooltip(`Start: ${originPoint.label}`, {
        direction: 'top',
        offset: [0, -14],
        className: 'rvce-map-tooltip',
      });
      mOrigin.addTo(rLayer);
      boundsPoints.push([originPoint.lat, originPoint.lng]);
    }

    if (destinationPoint) {
      const mDest = L.marker([destinationPoint.lat, destinationPoint.lng], {
        icon: createEndpointIcon('DESTINATION'),
        zIndexOffset: 1120,
      }).bindTooltip(`Destination: ${destinationPoint.label}`, {
        direction: 'top',
        offset: [0, -14],
        className: 'rvce-map-tooltip',
      });
      mDest.addTo(rLayer);
      boundsPoints.push([destinationPoint.lat, destinationPoint.lng]);
    }

    if (activeRoute && boundsPoints.length >= 2) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [54, 54], maxZoom: 18 });
    }
  }, [activeRoute, originPoint, destinationPoint]);

  // Render Building & Outdoor Facility Markers
  useEffect(() => {
    const layer = markersLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();

    for (const bldg of buildings) {
      const isSelected = bldg.building_id === selectedBuildingId;
      const marker = L.marker([bldg.latitude, bldg.longitude], {
        icon: createPinIcon(isSelected, 'BUILDING'),
        zIndexOffset: isSelected ? 900 : 100,
      });

      marker.bindTooltip(`${bldg.building_name} (${bldg.building_code})`, {
        direction: 'top',
        offset: [0, -20],
        className: 'rvce-map-tooltip',
      });

      marker.on('click', () => {
        onSelectBuilding?.(bldg);
      });

      marker.addTo(layer);

      if (isSelected && !activeRoute) {
        map.flyTo([bldg.latitude, bldg.longitude], Math.max(map.getZoom(), 18), {
          duration: 0.55,
        });
      }
    }

    for (const fac of facilities) {
      if (fac.latitude === null || fac.longitude === null) continue;
      if (fac.building_id && fac.facility_id !== selectedFacilityId) continue;

      const isSelected = fac.facility_id === selectedFacilityId;
      const marker = L.marker([fac.latitude, fac.longitude], {
        icon: createPinIcon(isSelected, 'FACILITY'),
        zIndexOffset: isSelected ? 850 : 50,
      });

      marker.bindTooltip(fac.facility_name, {
        direction: 'top',
        offset: [0, -20],
        className: 'rvce-map-tooltip',
      });

      marker.on('click', () => {
        onSelectFacility?.(fac);
      });

      marker.addTo(layer);

      if (isSelected && !activeRoute) {
        map.flyTo([fac.latitude, fac.longitude], Math.max(map.getZoom(), 18), {
          duration: 0.55,
        });
      }
    }
  }, [
    buildings,
    facilities,
    selectedBuildingId,
    selectedFacilityId,
    activeRoute,
    onSelectBuilding,
    onSelectFacility,
  ]);

  const handleResetToCampus = () => {
    setGeoNotice(null);
    mapRef.current?.flyTo([initLat, initLng], initZoom, { duration: 0.5 });
  };

  const handleLocateUser = () => {
    setGeoNotice(null);
    if (!navigator.geolocation) {
      setGeoNotice('Device location is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!mapRef.current) return;
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.remove();
        }
        userLocationMarkerRef.current = L.circleMarker([latitude, longitude], {
          radius: 8,
          color: '#FFFFFF',
          weight: 2.5,
          fillColor: '#0284C7',
          fillOpacity: 1,
        })
          .bindTooltip('Your Current Location', { direction: 'top', className: 'rvce-map-tooltip' })
          .addTo(mapRef.current);

        mapRef.current.flyTo([latitude, longitude], 18, { duration: 0.6 });
        onUserGpsLocated?.(latitude, longitude);
      },
      () => {
        setGeoNotice(
          'Location permission was declined or unavailable. You can click anywhere on the campus map to set your starting spot.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full z-0" />

      {/* Active Map Point-Picking Banner */}
      {pickingTarget && !previewMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[550] bg-[#202938] text-white px-4 py-2 rounded-full shadow-md text-xs font-semibold flex items-center gap-2.5">
          <MousePointerClick className="w-4 h-4 text-sky-300 shrink-0" />
          <span>
            Click anywhere on the campus map (or select a building) to set{' '}
            {pickingTarget === 'ORIGIN' ? 'your Starting Spot' : 'your Destination'}
          </span>
          {onCancelPicking && (
            <button
              type="button"
              onClick={onCancelPicking}
              className="ml-1 px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[11px] cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Map Floating Controls (Reset to Campus + Optional Device Location) */}
      {!previewMode && (
        <div className="absolute top-3 right-3 z-[500] flex flex-col gap-2">
          <button
            type="button"
            onClick={handleResetToCampus}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white text-xs font-semibold text-[#202938] border border-[#E2E8F0] shadow-sm hover:bg-[#EDF2FA] hover:text-[#27447E] transition-colors cursor-pointer"
            title="Reset map view to RVCE campus centre"
          >
            <Compass className="w-4 h-4 text-[#27447E]" />
            Reset to Campus
          </button>
          <button
            type="button"
            onClick={handleLocateUser}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white text-xs font-semibold text-[#202938] border border-[#E2E8F0] shadow-sm hover:bg-[#EDF2FA] hover:text-[#27447E] transition-colors cursor-pointer"
            title="Show your current device position (requires permission)"
          >
            <LocateFixed className="w-4 h-4 text-[#27447E]" />
            My Location
          </button>
        </div>
      )}

      {/* Route Legend Pill when Active Route is Drawn */}
      {activeRoute && !previewMode && (
        <div className="absolute bottom-7 left-3 z-[500] bg-white/95 backdrop-blur-xs border border-[#E2E8F0] rounded-md px-3 py-2 shadow-sm flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#202938]">
          {activeRoute.mode === 'VEHICLE' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-1.5 rounded-full bg-[#1D4ED8] inline-block" />
              Vehicle Road
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed border-[#0284C7] inline-block" />
            Walking Path
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full bg-[#15803D] text-white text-[9px] font-bold inline-flex items-center justify-center">
              A
            </span>
            Start
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3.5 h-3.5 rounded-full bg-[#DC2626] text-white text-[9px] font-bold inline-flex items-center justify-center">
              B
            </span>
            Destination
          </span>
        </div>
      )}

      {/* Tile Provider Offline / Fallback Banner */}
      {tileError && (
        <div className="absolute top-3 left-3 right-36 z-[500] bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2 text-xs text-amber-900 flex items-center gap-2 shadow-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Outdoor map tiles are temporarily unreachable. Campus directory search, building pins,
            and routing remain available.
          </span>
        </div>
      )}

      {/* Geolocation Permission Notice */}
      {geoNotice && (
        <div className="absolute bottom-8 left-3 max-w-sm z-[500] bg-white border border-[#E2E8F0] rounded-md px-3 py-2 text-xs text-[#202938] shadow-sm flex items-center justify-between gap-3">
          <span>{geoNotice}</span>
          <button
            type="button"
            onClick={() => setGeoNotice(null)}
            className="text-[#27447E] font-semibold hover:underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
