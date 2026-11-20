import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import {
  Map,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  Building,
  CampusRouteResponse,
  FacilityItem,
  GeoGeometry,
  NavigationPoint,
  TravelMode,
} from '../types/campus';
import { Colors } from '../theme/colors';
import { Radius, Spacing } from '../theme/spacing';

// RVCE Campus Master Coordinates (Exact same baseline as website)
export const RVCE_CENTER_LNG = 77.49985;
export const RVCE_CENTER_LAT = 12.92355;
export const DEFAULT_ZOOM = 16.8;

// MapLibre Raster Style for OpenStreetMap (Exact tile URL as website)
const OSM_RASTER_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster' as const,
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

interface NativeCampusMapProps {
  buildings: Building[];
  facilities: FacilityItem[];
  geometries: GeoGeometry[];
  selectedBuildingId?: number | null;
  selectedFacilityId?: number | null;
  originPoint?: NavigationPoint | null;
  destinationPoint?: NavigationPoint | null;
  activeRoute?: CampusRouteResponse | null;
  pickingTarget?: 'ORIGIN' | 'DESTINATION' | null;
  directionsOpen?: boolean;
  travelMode?: TravelMode;
  userCoords?: { lat: number; lng: number } | null;
  focusedCoord?: { lat: number; lng: number } | null;
  hasBottomOverlay?: boolean;
  onSelectBuilding?: (building: Building) => void;
  onSelectFacility?: (facility: FacilityItem) => void;
  onMapCoordinatePress?: (lat: number, lng: number) => void;
  onLocateUser?: () => void;
  onToggleTravelMode?: () => void;
  onResetCampus?: () => void;
}

export const NativeCampusMap: React.FC<NativeCampusMapProps> = ({
  buildings,
  facilities,
  geometries,
  selectedBuildingId,
  selectedFacilityId,
  originPoint = null,
  destinationPoint = null,
  activeRoute = null,
  pickingTarget = null,
  directionsOpen = false,
  travelMode = 'WALKING',
  userCoords = null,
  focusedCoord = null,
  hasBottomOverlay = false,
  onSelectBuilding,
  onSelectFacility,
  onMapCoordinatePress,
  onLocateUser,
  onToggleTravelMode,
  onResetCampus,
}) => {
  const mapRef = useRef<MapRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const lastMarkerTapRef = useRef<number>(0);
  const zoomTrackRef = useRef<number>(DEFAULT_ZOOM);

  // Deduplicated marker press helper so touch works reliably whether dispatched by
  // MapLibre native MarkerViewManager or inner React Native TouchableOpacity
  const triggerOnce = (fn: () => void) => {
    const now = Date.now();
    if (now - lastMarkerTapRef.current < 280) return;
    lastMarkerTapRef.current = now;
    fn();
  };

  // 1. Sync camera smoothly when selected building changes
  useEffect(() => {
    if (!selectedBuildingId || activeRoute) return;
    const b = buildings.find((x) => x.building_id === selectedBuildingId);
    if (b) {
      zoomTrackRef.current = 18;
      cameraRef.current?.easeTo({
        center: [b.longitude, b.latitude],
        zoom: 18,
        duration: 450,
      });
    }
  }, [selectedBuildingId, buildings, activeRoute]);

  // 2. Sync camera smoothly when selected facility changes
  useEffect(() => {
    if (!selectedFacilityId || activeRoute) return;
    const f = facilities.find((x) => x.facility_id === selectedFacilityId);
    if (f && f.latitude && f.longitude) {
      zoomTrackRef.current = 18.1;
      cameraRef.current?.easeTo({
        center: [f.longitude, f.latitude],
        zoom: 18.1,
        duration: 450,
      });
    }
  }, [selectedFacilityId, facilities, activeRoute]);

  // 3. Frame entire active route cleanly between top planner card and bottom route card
  useEffect(() => {
    if (!activeRoute || !activeRoute.legs || activeRoute.legs.length === 0) return;
    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    let count = 0;

    for (const leg of activeRoute.legs) {
      for (const [lat, lng] of leg.coordinates) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        count += 1;
      }
    }

    if (count >= 2) {
      // Ensure non-zero bounding box
      const padDelta = 0.00025;
      const west = minLng - padDelta;
      const south = minLat - padDelta;
      const east = maxLng + padDelta;
      const north = maxLat + padDelta;

      cameraRef.current?.fitBounds([west, south, east, north], {
        padding: {
          top: directionsOpen ? 235 : 140,
          bottom: 245,
          left: 48,
          right: 64,
        },
        duration: 550,
      });
    }
  }, [activeRoute, directionsOpen]);

  // 4. Focus specific step maneuver or GPS coordinate when requested
  useEffect(() => {
    if (!focusedCoord) return;
    zoomTrackRef.current = 18.5;
    cameraRef.current?.easeTo({
      center: [focusedCoord.lng, focusedCoord.lat],
      zoom: 18.5,
      duration: 400,
    });
  }, [focusedCoord]);

  // Separate Campus Boundary and Building Footprints
  const { boundaryGeoJson, buildingsGeoJson } = useMemo(() => {
    const boundaryFeatures: any[] = [];
    const buildingFeatures: any[] = [];

    for (const g of geometries) {
      if (!g.geometry) continue;

      if (g.entity_type === 'CAMPUS_BOUNDARY') {
        boundaryFeatures.push({
          type: 'Feature',
          properties: { name: g.name },
          geometry: g.geometry,
        });
      } else if (g.entity_type === 'BUILDING_FOOTPRINT') {
        const isSelected =
          g.mysql_id === selectedBuildingId ||
          (originPoint?.source === 'BUILDING' && originPoint.entityId === g.mysql_id) ||
          (destinationPoint?.source === 'BUILDING' && destinationPoint.entityId === g.mysql_id);
        buildingFeatures.push({
          type: 'Feature',
          properties: {
            mysql_id: g.mysql_id,
            name: g.name,
            code: g.code,
            isSelected,
          },
          geometry: g.geometry,
        });
      }
    }

    return {
      boundaryGeoJson: {
        type: 'FeatureCollection',
        features: boundaryFeatures,
      } as GeoJSON.FeatureCollection,
      buildingsGeoJson: {
        type: 'FeatureCollection',
        features: buildingFeatures,
      } as GeoJSON.FeatureCollection,
    };
  }, [geometries, selectedBuildingId, originPoint, destinationPoint]);

  // Active Route Multi-Segment GeoJSON + Endpoint A/B GeoJSON (so A/B never block marker touches!)
  const { routeGeoJson, endpointsGeoJson } = useMemo(() => {
    const lineFeatures: any[] = [];
    if (activeRoute && activeRoute.legs) {
      activeRoute.legs.forEach((leg, idx) => {
        if (!leg.coordinates || leg.coordinates.length < 2) return;
        const coords = leg.coordinates.map(([lat, lng]) => [lng, lat]);

        lineFeatures.push({
          type: 'Feature',
          properties: {
            legIndex: idx,
            legType: leg.leg_type,
            isDrive: leg.leg_type === 'DRIVE',
            isWalk: leg.leg_type === 'WALK',
            isConnector: leg.leg_type === 'ACCESS_CONNECTOR',
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        });
      });
    }

    const ptFeatures: any[] = [];
    const fromPt = activeRoute?.from ?? originPoint;
    const toPt = activeRoute?.to ?? destinationPoint;

    if (directionsOpen && fromPt) {
      ptFeatures.push({
        type: 'Feature',
        properties: { role: 'ORIGIN', label: 'A' },
        geometry: { type: 'Point', coordinates: [fromPt.lng, fromPt.lat] },
      });
    }
    if (directionsOpen && toPt) {
      ptFeatures.push({
        type: 'Feature',
        properties: { role: 'DEST', label: 'B' },
        geometry: { type: 'Point', coordinates: [toPt.lng, toPt.lat] },
      });
    }

    return {
      routeGeoJson:
        lineFeatures.length > 0
          ? ({ type: 'FeatureCollection', features: lineFeatures } as GeoJSON.FeatureCollection)
          : null,
      endpointsGeoJson:
        ptFeatures.length > 0
          ? ({ type: 'FeatureCollection', features: ptFeatures } as GeoJSON.FeatureCollection)
          : null,
    };
  }, [activeRoute, originPoint, destinationPoint, directionsOpen]);

  const handleBuildingSelect = (b: Building) => {
    if (!pickingTarget && !directionsOpen) {
      zoomTrackRef.current = 18;
      cameraRef.current?.easeTo({
        center: [b.longitude, b.latitude],
        zoom: 18,
        duration: 380,
      });
    }
    onSelectBuilding?.(b);
  };

  const handleFacilitySelect = (f: FacilityItem) => {
    if (!pickingTarget && !directionsOpen && f.latitude && f.longitude) {
      zoomTrackRef.current = 18.1;
      cameraRef.current?.easeTo({
        center: [f.longitude, f.latitude],
        zoom: 18.1,
        duration: 380,
      });
    }
    onSelectFacility?.(f);
  };

  const handleZoomBy = async (delta: number) => {
    try {
      const currentZoom = await mapRef.current?.getZoom();
      const base = typeof currentZoom === 'number' ? currentZoom : zoomTrackRef.current;
      const next = Math.max(14.5, Math.min(19, base + delta));
      zoomTrackRef.current = next;
      cameraRef.current?.zoomTo(next, { duration: 220 });
    } catch {
      const next = Math.max(14.5, Math.min(19, zoomTrackRef.current + delta));
      zoomTrackRef.current = next;
      cameraRef.current?.zoomTo(next, { duration: 220 });
    }
  };

  const handleReset = () => {
    zoomTrackRef.current = DEFAULT_ZOOM;
    cameraRef.current?.easeTo({
      center: [RVCE_CENTER_LNG, RVCE_CENTER_LAT],
      zoom: DEFAULT_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 450,
    });
    onResetCampus?.();
  };

  return (
    <View style={styles.container}>
      <Map
        ref={mapRef}
        style={styles.map}
        androidView="texture"
        mapStyle={OSM_RASTER_STYLE as any}
        logo={false}
        attribution={false}
        onRegionDidChange={(e: any) => {
          const z = e?.nativeEvent?.zoom;
          if (typeof z === 'number') zoomTrackRef.current = z;
        }}
        onPress={(e: any) => {
          // Guard against synthetic bubble right after a marker/polygon press
          if (Date.now() - lastMarkerTapRef.current < 300) return;

          const features = e?.nativeEvent?.features ?? e?.features;
          if (Array.isArray(features) && features.length > 0) {
            const bFeat = features.find((f: any) => f?.properties?.mysql_id);
            if (bFeat) {
              const matched = buildings.find(
                (b) => b.building_id === Number(bFeat.properties.mysql_id)
              );
              if (matched) {
                triggerOnce(() => handleBuildingSelect(matched));
                return;
              }
            }
          }

          const lngLat = e?.nativeEvent?.lngLat ?? e?.lngLat;
          if (Array.isArray(lngLat) && lngLat.length >= 2) {
            const [lng, lat] = lngLat;
            onMapCoordinatePress?.(Number(lat), Number(lng));
          }
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [RVCE_CENTER_LNG, RVCE_CENTER_LAT],
            zoom: DEFAULT_ZOOM,
          }}
          minZoom={14}
          maxZoom={19}
        />

        {/* 1. Verified Campus Boundary Polygon */}
        <GeoJSONSource id="campus-boundary-source" data={boundaryGeoJson}>
          <Layer
            id="campus-boundary-fill"
            type="fill"
            paint={{
              'fill-color': '#EDF2FA',
              'fill-opacity': 0.03,
            }}
          />
          <Layer
            id="campus-boundary-line"
            type="line"
            paint={{
              'line-color': '#27447E',
              'line-width': 2.2,
              'line-dasharray': [6, 5],
            }}
          />
        </GeoJSONSource>

        {/* 2. Verified Building Footprints (28 Surveyed RVCE Buildings — Interactive Tap) */}
        <GeoJSONSource
          id="buildings-footprint-source"
          data={buildingsGeoJson}
          hitbox={{ top: 14, bottom: 14, left: 14, right: 14 }}
          onPress={(e: any) => {
            e?.stopPropagation?.();
            const features = e?.nativeEvent?.features ?? e?.features;
            const feat = Array.isArray(features) ? features[0] : null;
            if (feat?.properties?.mysql_id) {
              const matched = buildings.find(
                (b) => b.building_id === Number(feat.properties.mysql_id)
              );
              if (matched) {
                triggerOnce(() => handleBuildingSelect(matched));
              }
            }
          }}
        >
          <Layer
            id="buildings-fill"
            type="fill"
            paint={{
              'fill-color': [
                'case',
                ['==', ['get', 'isSelected'], true],
                '#1D4ED8',
                '#3B5998',
              ] as any,
              'fill-opacity': [
                'case',
                ['==', ['get', 'isSelected'], true],
                0.32,
                0.11,
              ] as any,
            }}
          />
          <Layer
            id="buildings-line"
            type="line"
            paint={{
              'line-color': [
                'case',
                ['==', ['get', 'isSelected'], true],
                '#1E3A8A',
                '#27447E',
              ] as any,
              'line-width': [
                'case',
                ['==', ['get', 'isSelected'], true],
                2.8,
                1.4,
              ] as any,
            }}
          />
        </GeoJSONSource>

        {/* 3. Navigation Route Polyline Overlay (Double-Line Vehicle Road + Red Walking Path) */}
        {routeGeoJson && (
          <GeoJSONSource id="campus-route-source" data={routeGeoJson}>
            <Layer
              id="route-casing"
              type="line"
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': '#FFFFFF',
                'line-width': 9.5,
                'line-opacity': 0.96,
              }}
            />
            <Layer
              id="route-drive"
              type="line"
              filter={['==', ['get', 'isDrive'], true]}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': '#1D4ED8',
                'line-width': 6.2,
              }}
            />
            <Layer
              id="route-drive-inner"
              type="line"
              filter={['==', ['get', 'isDrive'], true]}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': '#DBEAFE',
                'line-width': 1.8,
              }}
            />
            <Layer
              id="route-walk"
              type="line"
              filter={['==', ['get', 'isWalk'], true]}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': '#DC2626',
                'line-width': 4.8,
                'line-dasharray': [2, 1.4],
              }}
            />
            <Layer
              id="route-connector"
              type="line"
              filter={['==', ['get', 'isConnector'], true]}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
              paint={{
                'line-color': '#475569',
                'line-width': 3.2,
                'line-dasharray': [1.4, 1.8],
              }}
            />
          </GeoJSONSource>
        )}

        {/* 4. Native GPU Endpoint Circles for Origin (A) & Destination (B) — Zero Touch Blocking */}
        {endpointsGeoJson && (
          <GeoJSONSource id="route-endpoints-source" data={endpointsGeoJson}>
            <Layer
              id="route-endpoints-halo"
              type="circle"
              paint={{
                'circle-radius': 12,
                'circle-color': '#FFFFFF',
                'circle-opacity': 0.95,
              }}
            />
            <Layer
              id="route-endpoints-core"
              type="circle"
              paint={{
                'circle-radius': 8.5,
                'circle-color': [
                  'case',
                  ['==', ['get', 'role'], 'ORIGIN'],
                  '#15803D',
                  '#DC2626',
                ] as any,
              }}
            />
          </GeoJSONSource>
        )}

        {/* 5. Interactive Verified Building Markers */}
        {buildings.map((b) => {
          const isOrigin =
            directionsOpen &&
            originPoint?.source === 'BUILDING' &&
            originPoint.entityId === b.building_id;
          const isDest =
            directionsOpen &&
            destinationPoint?.source === 'BUILDING' &&
            destinationPoint.entityId === b.building_id;
          const isSelected = b.building_id === selectedBuildingId || isOrigin || isDest;

          return (
            <Marker
              key={`building-marker-${b.building_id}`}
              id={`marker-${b.building_id}`}
              lngLat={[b.longitude, b.latitude]}
              anchor="center"
              onPress={() => triggerOnce(() => handleBuildingSelect(b))}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => triggerOnce(() => handleBuildingSelect(b))}
                style={[styles.markerContainer, isSelected && styles.markerContainerSelected]}
              >
                <View
                  style={[
                    styles.markerPin,
                    isOrigin
                      ? styles.markerPinOrigin
                      : isDest || b.building_id === selectedBuildingId
                      ? styles.markerPinSelected
                      : styles.markerPinDefault,
                  ]}
                >
                  {isOrigin ? (
                    <Text style={styles.endpointPinLetter}>A</Text>
                  ) : isDest ? (
                    <Text style={styles.endpointPinLetter}>B</Text>
                  ) : (
                    <Ionicons
                      name={isSelected ? 'business' : 'location'}
                      size={isSelected ? 14 : 12}
                      color="#FFFFFF"
                    />
                  )}
                </View>
                <View
                  style={[
                    styles.labelTag,
                    isOrigin
                      ? styles.labelTagOrigin
                      : isDest || b.building_id === selectedBuildingId
                      ? styles.labelTagSelected
                      : null,
                  ]}
                >
                  <Text
                    style={[styles.labelText, isSelected && styles.labelTextSelected]}
                    numberOfLines={1}
                  >
                    {b.building_code}
                  </Text>
                </View>
              </TouchableOpacity>
            </Marker>
          );
        })}

        {/* 6. Interactive Facility POI Markers */}
        {facilities.slice(0, 35).map((f) => {
          if (!f.latitude || !f.longitude) return null;
          const isOrigin =
            directionsOpen &&
            originPoint?.source === 'FACILITY' &&
            originPoint.entityId === f.facility_id;
          const isDest =
            directionsOpen &&
            destinationPoint?.source === 'FACILITY' &&
            destinationPoint.entityId === f.facility_id;
          const isSelected = f.facility_id === selectedFacilityId || isOrigin || isDest;

          return (
            <Marker
              key={`facility-marker-${f.facility_id}`}
              id={`fac-${f.facility_id}`}
              lngLat={[f.longitude, f.latitude]}
              anchor="center"
              onPress={() => triggerOnce(() => handleFacilitySelect(f))}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => triggerOnce(() => handleFacilitySelect(f))}
                style={styles.facilityHitbox}
              >
                <View
                  style={[
                    styles.facilityDot,
                    isSelected && styles.facilityDotSelected,
                    {
                      backgroundColor: isOrigin
                        ? '#15803D'
                        : isDest
                        ? '#DC2626'
                        : getFacilityColor(f.category),
                    },
                  ]}
                >
                  {isOrigin ? (
                    <Text style={styles.endpointPinLetter}>A</Text>
                  ) : isDest ? (
                    <Text style={styles.endpointPinLetter}>B</Text>
                  ) : (
                    <Ionicons name={getFacilityIcon(f.category)} size={12} color="#FFFFFF" />
                  )}
                </View>
              </TouchableOpacity>
            </Marker>
          );
        })}

        {/* 7. Custom Map-Pin Origin/Destination Badges (when user tapped an arbitrary spot on map) */}
        {directionsOpen && originPoint?.source === 'MAP_PIN' && (
          <Marker
            id="custom-origin-pin"
            lngLat={[originPoint.lng, originPoint.lat]}
            anchor="center"
          >
            <View pointerEvents="none" style={[styles.endpointBadge, { backgroundColor: '#15803D' }]}>
              <Text style={styles.endpointBadgeText}>A</Text>
            </View>
          </Marker>
        )}
        {directionsOpen && destinationPoint?.source === 'MAP_PIN' && (
          <Marker
            id="custom-dest-pin"
            lngLat={[destinationPoint.lng, destinationPoint.lat]}
            anchor="center"
          >
            <View pointerEvents="none" style={[styles.endpointBadge, { backgroundColor: '#DC2626' }]}>
              <Text style={styles.endpointBadgeText}>B</Text>
            </View>
          </Marker>
        )}

        {/* 8. Live User GPS Position Dot */}
        {userCoords && (
          <Marker id="user-gps-pin" lngLat={[userCoords.lng, userCoords.lat]} anchor="center">
            <View pointerEvents="none" style={styles.gpsHalo}>
              <View style={styles.gpsDot} />
            </View>
          </Marker>
        )}
      </Map>

      {/* Floating Map Controls (Right Side — Clear of Top Header & Bottom Sheet) */}
      <View
        style={[
          styles.floatingControls,
          directionsOpen && { top: 215 },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => handleZoomBy(0.75)}
          activeOpacity={0.8}
          accessibilityLabel="Zoom in on campus map"
        >
          <Ionicons name="add" size={22} color={Colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => handleZoomBy(-0.75)}
          activeOpacity={0.8}
          accessibilityLabel="Zoom out on campus map"
        >
          <Ionicons name="remove" size={22} color={Colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.fabBtn}
          onPress={handleReset}
          activeOpacity={0.8}
          accessibilityLabel="Reset campus map view"
        >
          <Ionicons name="compass-outline" size={21} color={Colors.primary} />
        </TouchableOpacity>

        {onLocateUser && (
          <TouchableOpacity
            style={styles.fabBtn}
            onPress={onLocateUser}
            activeOpacity={0.8}
            accessibilityLabel="Use my live GPS location"
          >
            <Ionicons name="locate" size={20} color={Colors.primary} />
          </TouchableOpacity>
        )}

        {!directionsOpen && onToggleTravelMode && (
          <TouchableOpacity
            style={[
              styles.fabBtn,
              travelMode === 'VEHICLE' ? styles.fabBtnActiveDrive : styles.fabBtnActiveWalk,
            ]}
            onPress={onToggleTravelMode}
            activeOpacity={0.8}
            accessibilityLabel={`Switch travel mode, currently ${travelMode}`}
          >
            <Ionicons
              name={travelMode === 'VEHICLE' ? 'car' : 'walk'}
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* OpenStreetMap Attribution & Verified Baseline Pill */}
      {!hasBottomOverlay && (
        <View style={styles.attributionPill} pointerEvents="none">
          <View style={styles.greenPulse} />
          <Text style={styles.attributionText}>RVCE Verified GIS • © OpenStreetMap</Text>
        </View>
      )}
    </View>
  );
};

export function getFacilityColor(category: string): string {
  switch (category) {
    case 'CAFETERIA_FOOD':
      return '#EA580C';
    case 'MEDICAL_FIRST_AID':
      return '#DC2626';
    case 'GATE_RECEPTION':
      return '#27447E';
    case 'LIBRARY':
      return '#0284C7';
    case 'BANK_ATM':
      return '#059669';
    case 'PARKING':
      return '#475569';
    case 'AUDITORIUM_HALL':
      return '#1E3A8A';
    case 'ADMIN_SERVICE':
      return '#1D3563';
    default:
      return '#64748B';
  }
}

export function getFacilityIcon(category: string): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case 'CAFETERIA_FOOD':
      return 'restaurant';
    case 'MEDICAL_FIRST_AID':
      return 'medkit';
    case 'GATE_RECEPTION':
      return 'shield-checkmark';
    case 'LIBRARY':
      return 'book';
    case 'BANK_ATM':
      return 'cash';
    case 'PARKING':
      return 'car';
    case 'AUDITORIUM_HALL':
      return 'megaphone';
    case 'ADMIN_SERVICE':
      return 'briefcase';
    default:
      return 'pin';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  markerContainerSelected: {
    transform: [{ scale: 1.12 }],
    zIndex: 999,
  },
  markerPin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 3,
    elevation: 4,
  },
  markerPinDefault: {
    backgroundColor: Colors.primary,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  markerPinOrigin: {
    backgroundColor: '#15803D',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  markerPinSelected: {
    backgroundColor: '#DC2626',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  endpointPinLetter: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  labelTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: 5.5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginTop: 2,
    borderWidth: 0.8,
    borderColor: '#CBD5E1',
    maxWidth: 100,
    elevation: 2,
  },
  labelTagOrigin: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  labelTagSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  labelText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  labelTextSelected: {
    color: '#FFFFFF',
  },
  facilityHitbox: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facilityDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    elevation: 3,
  },
  facilityDotSelected: {
    transform: [{ scale: 1.22 }],
    borderWidth: 2,
    borderColor: '#FDE047',
    zIndex: 998,
  },
  endpointBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  endpointBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  gpsHalo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(37, 99, 235, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsDot: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#2563EB',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  floatingControls: {
    position: 'absolute',
    right: Spacing.md,
    top: 144,
    gap: 8,
    zIndex: 8,
  },
  fabBtn: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  fabBtnActiveWalk: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  fabBtnActiveDrive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  attributionPill: {
    position: 'absolute',
    bottom: 12,
    left: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    gap: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  greenPulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  attributionText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
});
