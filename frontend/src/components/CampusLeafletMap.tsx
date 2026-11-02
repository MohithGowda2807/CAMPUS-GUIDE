import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { AlertTriangle, Compass, LocateFixed } from 'lucide-react';
import type { Building, FacilityItem, GeoGeometry } from '../types/campus';

const DEFAULT_RVCE_LAT = 12.923333;
const DEFAULT_RVCE_LNG = 77.499506;
const DEFAULT_ZOOM = 18;
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
  onSelectBuilding?: (building: Building) => void;
  onSelectFacility?: (facility: FacilityItem) => void;
  previewMode?: boolean;
  className?: string;
}

function createPinIcon(selected: boolean, kind: 'BUILDING' | 'FACILITY'): L.DivIcon {
  const fill = selected ? '#1D3563' : kind === 'BUILDING' ? '#27447E' : '#335C67';
  const size = selected ? 34 : 26;
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

export function CampusLeafletMap({
  center,
  tileUrl = DEFAULT_TILE_URL,
  attribution = DEFAULT_ATTRIBUTION,
  buildings,
  facilities = [],
  geometries = [],
  selectedBuildingId = null,
  selectedFacilityId = null,
  onSelectBuilding,
  onSelectFacility,
  previewMode = false,
  className = 'h-full w-full',
}: CampusLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const geoLayerRef = useRef<L.LayerGroup | null>(null);
  const userLocationMarkerRef = useRef<L.CircleMarker | null>(null);

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
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 150);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render GeoJSON campus boundary & building footprints
  useEffect(() => {
    const geoGroup = geoLayerRef.current;
    if (!geoGroup) return;
    geoGroup.clearLayers();

    for (const item of geometries) {
      if (!item.geometry) continue;
      const isCampus = item.entity_type === 'CAMPUS_BOUNDARY';
      const isSelectedFootprint =
        item.entity_type === 'BUILDING_FOOTPRINT' && item.mysql_id === selectedBuildingId;

      try {
        L.geoJSON(
          {
            type: 'Feature',
            properties: { name: item.name },
            geometry: item.geometry,
          } as never,
          {
            style: () =>
              isCampus
                ? {
                    color: '#27447E',
                    weight: 2,
                    dashArray: '6 6',
                    fillColor: '#EDF2FA',
                    fillOpacity: 0.08,
                  }
                : {
                    color: isSelectedFootprint ? '#1D3563' : '#27447E',
                    weight: isSelectedFootprint ? 2.5 : 1.5,
                    fillColor: isSelectedFootprint ? '#27447E' : '#3B5998',
                    fillOpacity: isSelectedFootprint ? 0.28 : 0.14,
                  },
          }
        ).addTo(geoGroup);
      } catch {
        // Ignore malformed geometry
      }
    }
  }, [geometries, selectedBuildingId]);

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
        offset: [0, -24],
        className: 'rvce-map-tooltip',
      });

      marker.on('click', () => {
        onSelectBuilding?.(bldg);
      });

      marker.addTo(layer);

      if (isSelected) {
        map.flyTo([bldg.latitude, bldg.longitude], Math.max(map.getZoom(), 18), {
          duration: 0.55,
        });
      }
    }

    for (const fac of facilities) {
      if (fac.latitude === null || fac.longitude === null) continue;
      // Avoid overlapping pin if facility sits inside an already rendered building unless selected
      if (fac.building_id && fac.facility_id !== selectedFacilityId) continue;

      const isSelected = fac.facility_id === selectedFacilityId;
      const marker = L.marker([fac.latitude, fac.longitude], {
        icon: createPinIcon(isSelected, 'FACILITY'),
        zIndexOffset: isSelected ? 850 : 50,
      });

      marker.bindTooltip(fac.facility_name, {
        direction: 'top',
        offset: [0, -22],
        className: 'rvce-map-tooltip',
      });

      marker.on('click', () => {
        onSelectFacility?.(fac);
      });

      marker.addTo(layer);

      if (isSelected) {
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
      },
      () => {
        setGeoNotice(
          'Location permission was declined or unavailable. You can continue browsing the campus map normally.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full z-0" />

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

      {/* Tile Provider Offline / Fallback Banner */}
      {tileError && (
        <div className="absolute top-3 left-3 right-36 z-[500] bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2 text-xs text-amber-900 flex items-center gap-2 shadow-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Outdoor map tiles are temporarily unreachable. Campus directory search, building pins,
            and indoor floor plans remain available.
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
