import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCampusData } from '../../src/context/CampusDataContext';
import {
  NativeCampusMap,
  getFacilityColor,
  getFacilityIcon,
} from '../../src/components/NativeCampusMap';
import { IndoorFloorModal } from '../../src/components/IndoorFloorModal';
import { SearchBar } from '../../src/components/SearchBar';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';
import type {
  Building,
  FacilityItem,
  NavigationPoint,
  RouteStep,
  SearchResultItem,
  TravelMode,
} from '../../src/types/campus';

type MapCategoryFilter =
  | 'ALL'
  | 'ACADEMIC'
  | 'LABS'
  | 'FOOD'
  | 'HOSTEL'
  | 'LIBRARY'
  | 'HEALTH';

const CATEGORY_CHIPS: Array<{
  key: MapCategoryFilter;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'ALL', label: 'All Campus', icon: 'layers-outline' },
  { key: 'ACADEMIC', label: 'Departments', icon: 'school-outline' },
  { key: 'LABS', label: 'Labs & R&D', icon: 'hardware-chip-outline' },
  { key: 'FOOD', label: 'Cafeterias', icon: 'restaurant-outline' },
  { key: 'LIBRARY', label: 'Libraries', icon: 'book-outline' },
  { key: 'HOSTEL', label: 'Hostels', icon: 'bed-outline' },
  { key: 'HEALTH', label: 'Medical & Gate', icon: 'medkit-outline' },
];

interface PlaceOption {
  key: string;
  group: 'Gate & Amenities' | 'Campus Buildings';
  subtitle: string;
  code?: string;
  category?: string;
  point: NavigationPoint;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function getManeuverIcon(step: RouteStep): keyof typeof Ionicons.glyphMap {
  if (step.maneuver === 'ARRIVE') return 'location';
  if (step.maneuver === 'TURN_LEFT' || step.maneuver === 'SLIGHT_LEFT') return 'return-up-back';
  if (step.maneuver === 'TURN_RIGHT' || step.maneuver === 'SLIGHT_RIGHT')
    return 'return-up-forward';
  if (step.path_type === 'WALKWAY' || step.path_type === 'STEPS') return 'walk';
  return 'navigate';
}

export default function MapScreen() {
  const params = useLocalSearchParams<{
    directions?: string;
    buildingId?: string;
    floorId?: string;
    roomId?: string;
  }>();

  const {
    buildings,
    facilities,
    geometries,
    selectedBuilding,
    selectedFacility,
    activeRoute,
    travelMode,
    selectBuilding,
    selectFacility,
    setTravelMode,
    fetchRoute,
    clearRoute,
    searchCampus,
  } = useCampusData();

  // Search & Explore State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<MapCategoryFilter>('ALL');
  const [indoorBuilding, setIndoorBuilding] = useState<Building | null>(null);
  const [targetFloorId, setTargetFloorId] = useState<number | null>(null);
  const [targetRoomId, setTargetRoomId] = useState<number | null>(null);

  // Handle incoming deep links (e.g. from Directory or Search with building/floor/room)
  useEffect(() => {
    if (params.buildingId && buildings.length > 0) {
      const targetBldg = buildings.find((b) => b.building_id === Number(params.buildingId));
      if (targetBldg) {
        selectBuilding(targetBldg);
        if (params.floorId) {
          setTargetFloorId(Number(params.floorId));
          setTargetRoomId(params.roomId ? Number(params.roomId) : null);
          setIndoorBuilding(targetBldg);
        }
      }
    }
  }, [params.buildingId, params.floorId, params.roomId, buildings]);

  // Google-Maps-Style Campus Navigation State (Matches Website 1:1)
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [originPoint, setOriginPoint] = useState<NavigationPoint | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<NavigationPoint | null>(null);
  const [pickingTarget, setPickingTarget] = useState<'ORIGIN' | 'DESTINATION' | null>(null);
  const [pickerModalTarget, setPickerModalTarget] = useState<'ORIGIN' | 'DESTINATION' | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [routeSheetCollapsed, setRouteSheetCollapsed] = useState(false);

  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [focusedCoord, setFocusedCoord] = useState<{ lat: number; lng: number } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Default Main Gate Origin
  const defaultGateOrigin = useMemo<NavigationPoint>(() => {
    const gate = buildings.find((x) => x.building_code === 'GATE-MAIN');
    return {
      label: gate ? `${gate.building_name}` : 'Main Mysuru Road Entrance Gate',
      lat: gate ? gate.latitude : 12.924631,
      lng: gate ? gate.longitude : 77.49904,
      source: 'BUILDING',
      entityId: gate?.building_id,
    };
  }, [buildings]);

  // Open Directions Planner automatically if navigated with ?directions=1 from Home
  useEffect(() => {
    if (params.directions === '1') {
      setDirectionsOpen(true);
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
    }
  }, [params.directions, defaultGateOrigin]);

  // If user selects a building or facility from Home, Directory, or Services tab, exit old route & focus it
  useEffect(() => {
    if (selectedBuilding && directionsOpen) {
      setDirectionsOpen(false);
      setPickingTarget(null);
      clearRoute();
    }
  }, [selectedBuilding]);

  useEffect(() => {
    if (selectedFacility && directionsOpen) {
      setDirectionsOpen(false);
      setPickingTarget(null);
      clearRoute();
    }
  }, [selectedFacility]);

  // Combined searchable list of all 28 RVCE buildings + 12 verified campus amenities for From/To selection
  const allPlaceOptions = useMemo<PlaceOption[]>(() => {
    const list: PlaceOption[] = [];

    // Put Main Gate first so it is always easy to pick
    const mainGate = buildings.find((b) => b.building_code === 'GATE-MAIN');
    if (mainGate) {
      list.push({
        key: `B-${mainGate.building_id}`,
        group: 'Gate & Amenities',
        subtitle: `${mainGate.building_code} • Main Campus Entrance`,
        code: mainGate.building_code,
        point: {
          label: `${mainGate.building_name} (${mainGate.building_code})`,
          lat: mainGate.latitude,
          lng: mainGate.longitude,
          source: 'BUILDING',
          entityId: mainGate.building_id,
        },
      });
    }

    for (const fc of facilities) {
      if (fc.latitude && fc.longitude) {
        list.push({
          key: `F-${fc.facility_id}`,
          group: 'Gate & Amenities',
          subtitle: `${fc.category.replace(/_/g, ' ')}${
            fc.building_name ? ` • ${fc.building_name}` : ''
          }`,
          category: fc.category,
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

    for (const b of buildings) {
      if (b.building_code === 'GATE-MAIN') continue;
      list.push({
        key: `B-${b.building_id}`,
        group: 'Campus Buildings',
        subtitle: `${b.building_code} • ${b.building_type.replace(/_/g, ' ')}`,
        code: b.building_code,
        point: {
          label: `${b.building_name} (${b.building_code})`,
          lat: b.latitude,
          lng: b.longitude,
          source: 'BUILDING',
          entityId: b.building_id,
        },
      });
    }

    return list;
  }, [buildings, facilities]);

  const filteredPickerOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return allPlaceOptions;
    return allPlaceOptions.filter(
      (opt) =>
        opt.point.label.toLowerCase().includes(q) ||
        opt.subtitle.toLowerCase().includes(q) ||
        (opt.code && opt.code.toLowerCase().includes(q))
    );
  }, [allPlaceOptions, pickerQuery]);

  // Automatically calculate Dijkstra campus route whenever Directions is open & Origin + Destination are set
  useEffect(() => {
    if (!directionsOpen || !originPoint || !destinationPoint) {
      return;
    }

    // Prevent zero-distance self-route error if user picked same spot for A & B
    if (
      Math.abs(originPoint.lat - destinationPoint.lat) < 0.00003 &&
      Math.abs(originPoint.lng - destinationPoint.lng) < 0.00003
    ) {
      clearRoute();
      setRouteError('Start (A) and Destination (B) are the same location. Please pick a different destination.');
      return;
    }

    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);

    fetchRoute(
      originPoint.lat,
      originPoint.lng,
      destinationPoint.lat,
      destinationPoint.lng,
      travelMode,
      originPoint.label,
      destinationPoint.label
    )
      .then((res) => {
        if (!cancelled) {
          if (!res) {
            setRouteError('Could not compute route between these points.');
          } else {
            setRouteError(null);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRouteError(err instanceof Error ? err.message : 'Route calculation failed.');
        }
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [directionsOpen, originPoint, destinationPoint, travelMode]);

  // Filter visible markers when category chip is active (always show all during Directions mode)
  const visibleBuildings = useMemo(() => {
    if (categoryFilter === 'ALL' || directionsOpen) return buildings;
    return buildings.filter((b) => {
      if (selectedBuilding?.building_id === b.building_id) return true;
      switch (categoryFilter) {
        case 'ACADEMIC':
          return b.building_type === 'ACADEMIC_BLOCK' || b.building_type === 'ADMINISTRATION';
        case 'LABS':
          return b.building_type === 'LABORATORY_COMPLEX';
        case 'LIBRARY':
          return b.building_type === 'LIBRARY';
        case 'HOSTEL':
          return b.building_type === 'HOSTEL';
        case 'HEALTH':
          return b.building_code === 'HEALTH' || b.building_type === 'SECURITY_GATE';
        case 'FOOD':
          return false;
        default:
          return true;
      }
    });
  }, [buildings, categoryFilter, selectedBuilding, directionsOpen]);

  const visibleFacilities = useMemo(() => {
    if (categoryFilter === 'ALL' || directionsOpen) return facilities;
    return facilities.filter((f) => {
      if (selectedFacility?.facility_id === f.facility_id) return true;
      switch (categoryFilter) {
        case 'FOOD':
          return f.category === 'CAFETERIA_FOOD';
        case 'LIBRARY':
          return f.category === 'LIBRARY';
        case 'HEALTH':
          return f.category === 'MEDICAL_FIRST_AID' || f.category === 'GATE_RECEPTION';
        case 'ACADEMIC':
          return f.category === 'ADMIN_SERVICE' || f.category === 'AUDITORIUM_HALL';
        default:
          return false;
      }
    });
  }, [facilities, categoryFilter, selectedFacility, directionsOpen]);

  // Debounced Campus Search (Explore Mode)
  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (text.trim().length > 1) {
      setIsSearching(true);
      debounceTimerRef.current = setTimeout(async () => {
        const results = await searchCampus(text.trim());
        setSearchResults(results);
      }, 160);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item: SearchResultItem) => {
    Keyboard.dismiss();
    setIsSearching(false);
    setSearchQuery('');
    setCategoryFilter('ALL');

    if (item.entity_type === 'FACILITY') {
      const f = facilities.find((x) => x.facility_id === item.id);
      if (f) {
        selectFacility(f);
        return;
      }
    }

    if (item.building_id) {
      const b = buildings.find((x) => x.building_id === item.building_id);
      if (b) {
        selectBuilding(b);
        // If searching a faculty with allocated room, or a direct room, open floor plan directly!
        if (item.floor_id) {
          setTargetFloorId(item.floor_id);
          setTargetRoomId(item.room_id || null);
          setIndoorBuilding(b);
        }
      }
    }
  };

  // GPS Location Handler — works both on Explore Map and inside From (A) Picker
  const handleLocateUser = async (setAsOrigin = false) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'Allow location access to display your position on the RVCE campus map.'
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = {
        lat: Number(loc.coords.latitude.toFixed(6)),
        lng: Number(loc.coords.longitude.toFixed(6)),
      };
      setUserCoords(coords);

      const distLat = Math.abs(coords.lat - 12.92355);
      const distLng = Math.abs(coords.lng - 77.49985);
      const isInsideCampus = distLat < 0.02 && distLng < 0.02;

      if (isInsideCampus) {
        const gpsPt: NavigationPoint = {
          label: 'My Live GPS Location',
          lat: coords.lat,
          lng: coords.lng,
          source: 'GPS',
        };
        setOriginPoint(gpsPt);
        setFocusedCoord(coords);
        if (setAsOrigin) {
          setDirectionsOpen(true);
          setPickingTarget(null);
          setPickerModalTarget(null);
        }
      } else {
        Alert.alert(
          'Outside RVCE Campus',
          'Your phone GPS is currently outside the RVCE Mysuru Road campus. Select any campus gate or building as your starting point (A), or use "Tap on Map".'
        );
      }
    } catch {
      Alert.alert('Location Unavailable', 'Unable to read current GPS coordinates.');
    }
  };

  // Open Directions Planner with a target Destination (defaults From to existing origin or Main Gate)
  const openDirectionsToDestination = useCallback(
    (dest: NavigationPoint) => {
      Keyboard.dismiss();
      setIsSearching(false);
      setPickingTarget(null);
      setShowSteps(false);
      setRouteSheetCollapsed(false);
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
      setDestinationPoint(dest);
      setDirectionsOpen(true);
    },
    [defaultGateOrigin]
  );

  // Open Directions Planner cleanly (even when no building was tapped yet!)
  const handleOpenDirectionsPlanner = () => {
    Keyboard.dismiss();
    setIsSearching(false);
    setPickingTarget(null);
    setRouteSheetCollapsed(false);

    // If user currently has a building/facility open in bottom sheet, pre-fill it as Destination B!
    if (selectedBuilding) {
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
      setDestinationPoint({
        label: `${selectedBuilding.building_name} (${selectedBuilding.building_code})`,
        lat: selectedBuilding.latitude,
        lng: selectedBuilding.longitude,
        source: 'BUILDING',
        entityId: selectedBuilding.building_id,
      });
    } else if (selectedFacility && selectedFacility.latitude && selectedFacility.longitude) {
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
      setDestinationPoint({
        label: selectedFacility.facility_name,
        lat: selectedFacility.latitude,
        lng: selectedFacility.longitude,
        source: 'FACILITY',
        entityId: selectedFacility.facility_id,
      });
    } else {
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
    }

    setDirectionsOpen(true);
  };

  const handleCloseDirections = () => {
    setDirectionsOpen(false);
    setPickingTarget(null);
    setPickerModalTarget(null);
    setDestinationPoint(null);
    setRouteError(null);
    setShowSteps(false);
    setRouteSheetCollapsed(false);
    clearRoute();
  };

  const handleSwapEndpoints = () => {
    if (!originPoint && !destinationPoint) return;
    const prevOrigin = originPoint;
    const prevDest = destinationPoint;
    setOriginPoint(prevDest);
    setDestinationPoint(prevOrigin);
  };

  // Map Building Tap Handler (Aware of Pick-on-Map & Directions Mode!)
  const handleMapSelectBuilding = (b: Building) => {
    Keyboard.dismiss();
    setIsSearching(false);

    const pt: NavigationPoint = {
      label: `${b.building_name} (${b.building_code})`,
      lat: b.latitude,
      lng: b.longitude,
      source: 'BUILDING',
      entityId: b.building_id,
    };

    if (pickingTarget === 'ORIGIN') {
      setOriginPoint(pt);
      setPickingTarget(null);
      setDirectionsOpen(true);
      return;
    }
    if (pickingTarget === 'DESTINATION') {
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
      setDestinationPoint(pt);
      setPickingTarget(null);
      setDirectionsOpen(true);
      return;
    }

    // If Directions planner is open and To (B) isn't set yet, tapping any building sets To (B)!
    if (directionsOpen && !destinationPoint) {
      setOriginPoint((prev) => prev ?? defaultGateOrigin);
      setDestinationPoint(pt);
      return;
    }

    // If Directions planner is open and user taps a building on map, ask or update Destination B!
    if (directionsOpen) {
      setDestinationPoint(pt);
      setRouteSheetCollapsed(false);
      return;
    }

    selectBuilding(b);
  };

  // Map Facility Tap Handler
  const handleMapSelectFacility = (f: FacilityItem) => {
    Keyboard.dismiss();
    setIsSearching(false);

    if (f.latitude && f.longitude) {
      const pt: NavigationPoint = {
        label: f.facility_name,
        lat: f.latitude,
        lng: f.longitude,
        source: 'FACILITY',
        entityId: f.facility_id,
      };

      if (pickingTarget === 'ORIGIN') {
        setOriginPoint(pt);
        setPickingTarget(null);
        setDirectionsOpen(true);
        return;
      }
      if (pickingTarget === 'DESTINATION') {
        setOriginPoint((prev) => prev ?? defaultGateOrigin);
        setDestinationPoint(pt);
        setPickingTarget(null);
        setDirectionsOpen(true);
        return;
      }
      if (directionsOpen) {
        setOriginPoint((prev) => prev ?? defaultGateOrigin);
        setDestinationPoint(pt);
        setRouteSheetCollapsed(false);
        return;
      }
    }

    selectFacility(f);
  };

  // Arbitrary Map Coordinate Tap Handler (Supports "Pick on Map" just like the Website!)
  const handleMapCoordinatePress = (lat: number, lng: number) => {
    Keyboard.dismiss();
    if (isSearching) {
      setIsSearching(false);
      return;
    }

    if (pickingTarget) {
      const customPoint: NavigationPoint = {
        label:
          pickingTarget === 'ORIGIN'
            ? `Pinned Start (${lat.toFixed(5)}, ${lng.toFixed(5)})`
            : `Pinned Destination (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        lat,
        lng,
        source: 'MAP_PIN',
      };

      if (pickingTarget === 'ORIGIN') {
        setOriginPoint(customPoint);
      } else {
        setOriginPoint((prev) => prev ?? defaultGateOrigin);
        setDestinationPoint(customPoint);
      }
      setPickingTarget(null);
      setDirectionsOpen(true);
      setRouteSheetCollapsed(false);
    }
  };

  const activeDestination: Building | FacilityItem | null = selectedBuilding || selectedFacility;

  // Check if current route destination corresponds to a campus building (for Indoor Floor Plan button)
  const destinationBuildingForIndoor = useMemo<Building | null>(() => {
    if (destinationPoint?.source === 'BUILDING' && destinationPoint.entityId) {
      return buildings.find((b) => b.building_id === destinationPoint.entityId) || null;
    }
    return null;
  }, [destinationPoint, buildings]);

  return (
    <View style={styles.container}>
      {/* 1. Hardware-Accelerated Native MapLibre Campus Map */}
      <NativeCampusMap
        buildings={visibleBuildings}
        facilities={visibleFacilities}
        geometries={geometries}
        selectedBuildingId={!directionsOpen ? selectedBuilding?.building_id : null}
        selectedFacilityId={!directionsOpen ? selectedFacility?.facility_id : null}
        originPoint={originPoint}
        destinationPoint={destinationPoint}
        activeRoute={directionsOpen ? activeRoute : null}
        pickingTarget={pickingTarget}
        directionsOpen={directionsOpen}
        travelMode={travelMode}
        userCoords={userCoords}
        focusedCoord={focusedCoord}
        hasBottomOverlay={Boolean((!directionsOpen && activeDestination) || (directionsOpen && (activeRoute || routeError || !destinationPoint)))}
        onSelectBuilding={handleMapSelectBuilding}
        onSelectFacility={handleMapSelectFacility}
        onMapCoordinatePress={handleMapCoordinatePress}
        onLocateUser={() => handleLocateUser(directionsOpen)}
        onToggleTravelMode={() =>
          setTravelMode(travelMode === 'WALKING' ? 'VEHICLE' : 'WALKING')
        }
        onResetCampus={() => {
          selectBuilding(null);
          selectFacility(null);
          if (!directionsOpen) {
            clearRoute();
            setCategoryFilter('ALL');
          }
          setPickingTarget(null);
          setShowSteps(false);
        }}
      />

      {/* 2. TOP INTERFACE: Either Explore Search+Directions OR Full From (A) / To (B) Navigation Planner */}
      <SafeAreaView style={styles.floatingTopBar} edges={['top']} pointerEvents="box-none">
        {!directionsOpen ? (
          <>
            {/* Explore Top Row: Search Capsule + Prominent "Directions" Button */}
            <View style={styles.exploreHeaderRow} pointerEvents="box-none">
              <View style={{ flex: 1 }}>
                <SearchBar
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  placeholder="Search buildings, Mingos, CSE, faculty..."
                  onClear={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setIsSearching(false);
                  }}
                />
              </View>

              <TouchableOpacity
                style={styles.topDirectionsBtn}
                activeOpacity={0.88}
                onPress={handleOpenDirectionsPlanner}
                accessibilityLabel="Open From and To campus navigation planner"
              >
                <Ionicons name="navigate" size={16} color="#FFFFFF" />
                <Text style={styles.topDirectionsBtnText}>Directions</Text>
              </TouchableOpacity>
            </View>

            {/* Category Filter Chips + Browse List Trigger */}
            {!isSearching && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryScroll}
              >
                <TouchableOpacity
                  style={styles.browseAllChip}
                  activeOpacity={0.85}
                  onPress={() => {
                    setPickerQuery('');
                    setDirectionsOpen(true);
                    setOriginPoint((prev) => prev ?? defaultGateOrigin);
                    setPickerModalTarget('DESTINATION');
                  }}
                >
                  <Ionicons name="trail-sign-outline" size={13} color="#FFFFFF" />
                  <Text style={styles.browseAllChipText}>Route A → B</Text>
                </TouchableOpacity>

                {CATEGORY_CHIPS.map((chip) => {
                  const active = categoryFilter === chip.key;
                  return (
                    <TouchableOpacity
                      key={chip.key}
                      style={[styles.catChip, active && styles.catChipActive]}
                      activeOpacity={0.85}
                      onPress={() => setCategoryFilter(chip.key)}
                    >
                      <Ionicons
                        name={chip.icon}
                        size={13}
                        color={active ? '#FFFFFF' : Colors.primary}
                      />
                      <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                        {chip.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Search Suggestions Dropdown */}
            {isSearching && (
              <View style={styles.suggestionsDropdown}>
                {searchResults.length === 0 ? (
                  <View style={styles.emptySearchBox}>
                    <Ionicons name="search-outline" size={20} color={Colors.textMuted} />
                    <Text style={styles.emptySearchText}>
                      No campus buildings, facilities or faculty match "{searchQuery}"
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.suggestionsScroll}
                    keyboardShouldPersistTaps="handled"
                  >
                    {searchResults.map((item, idx) => (
                      <TouchableOpacity
                        key={`res-${item.entity_type}-${item.id}-${idx}`}
                        style={styles.suggestionRow}
                        onPress={() => handleSelectSearchResult(item)}
                      >
                        <View style={styles.suggestionIconCircle}>
                          <Ionicons
                            name={
                              item.entity_type === 'BUILDING'
                                ? 'business-outline'
                                : item.entity_type === 'FACULTY'
                                ? 'person-outline'
                                : item.entity_type === 'ROOM'
                                ? 'cube-outline'
                                : 'location-outline'
                            }
                            size={17}
                            color={Colors.primary}
                          />
                        </View>
                        <View style={styles.suggestionTextCol}>
                          <Text style={styles.suggestionTitle} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.suggestionSubtitle} numberOfLines={1}>
                            {item.subtitle}
                          </Text>
                        </View>
                        <View style={styles.entityTag}>
                          <Text style={styles.entityTagText}>{item.entity_type}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </>
        ) : (
          /* GOOGLE-MAPS-STYLE FROM (A) & TO (B) CAMPUS DIRECTIONS PLANNER */
          <View style={styles.plannerCard}>
            {/* Planner Top Bar: Back + Walking/Vehicle Switcher + Swap + Close */}
            <View style={styles.plannerTopRow}>
              <TouchableOpacity
                style={styles.plannerIconBtn}
                onPress={handleCloseDirections}
                accessibilityLabel="Back to explore map"
              >
                <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>

              <View style={styles.modeSegmented}>
                <TouchableOpacity
                  style={[
                    styles.modeSegBtn,
                    travelMode === 'WALKING' && styles.modeSegBtnWalk,
                  ]}
                  onPress={() => setTravelMode('WALKING')}
                >
                  <Ionicons
                    name="walk"
                    size={15}
                    color={travelMode === 'WALKING' ? '#FFFFFF' : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.modeSegText,
                      travelMode === 'WALKING' && styles.modeSegTextActive,
                    ]}
                  >
                    Walking
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeSegBtn,
                    travelMode === 'VEHICLE' && styles.modeSegBtnDrive,
                  ]}
                  onPress={() => setTravelMode('VEHICLE')}
                >
                  <Ionicons
                    name="car"
                    size={15}
                    color={travelMode === 'VEHICLE' ? '#FFFFFF' : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.modeSegText,
                      travelMode === 'VEHICLE' && styles.modeSegTextActive,
                    ]}
                  >
                    Vehicle
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.plannerSwapBtn}
                onPress={handleSwapEndpoints}
                accessibilityLabel="Swap From and To locations"
              >
                <Ionicons name="swap-vertical" size={18} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            {/* FROM (Origin A) Selector Row */}
            <View style={styles.inputEndpointRow}>
              <View style={[styles.dotBadge, { backgroundColor: '#15803D' }]}>
                <Text style={styles.dotBadgeText}>A</Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.endpointSelectorBtn,
                  pickingTarget === 'ORIGIN' && styles.endpointSelectorPicking,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  setPickingTarget(null);
                  setPickerQuery('');
                  setPickerModalTarget('ORIGIN');
                }}
              >
                <Text
                  style={
                    originPoint ? styles.endpointValueText : styles.endpointPlaceholderText
                  }
                  numberOfLines={1}
                >
                  {originPoint ? originPoint.label : 'Tap to choose starting point (From)...'}
                </Text>
                <Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniActionBtn}
                onPress={() => handleLocateUser(true)}
                accessibilityLabel="Set From to My GPS"
              >
                <Ionicons name="locate" size={17} color={Colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.miniActionBtn,
                  pickingTarget === 'ORIGIN' && styles.miniActionBtnActive,
                ]}
                onPress={() =>
                  setPickingTarget((prev) => (prev === 'ORIGIN' ? null : 'ORIGIN'))
                }
                accessibilityLabel="Tap on map to pick From location"
              >
                <Ionicons
                  name="pin"
                  size={16}
                  color={pickingTarget === 'ORIGIN' ? '#FFFFFF' : Colors.primary}
                />
              </TouchableOpacity>
            </View>

            {/* TO (Destination B) Selector Row */}
            <View style={[styles.inputEndpointRow, { marginTop: 7 }]}>
              <View style={[styles.dotBadge, { backgroundColor: '#DC2626' }]}>
                <Text style={styles.dotBadgeText}>B</Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.endpointSelectorBtn,
                  !destinationPoint && styles.endpointSelectorHighlight,
                  pickingTarget === 'DESTINATION' && styles.endpointSelectorPicking,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  setPickingTarget(null);
                  setPickerQuery('');
                  setPickerModalTarget('DESTINATION');
                }}
              >
                <Text
                  style={
                    destinationPoint
                      ? styles.endpointValueTextBold
                      : styles.endpointPlaceholderPrompt
                  }
                  numberOfLines={1}
                >
                  {destinationPoint
                    ? destinationPoint.label
                    : 'Tap here to select Destination (To)...'}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={15}
                  color={destinationPoint ? Colors.textMuted : Colors.primary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.miniActionBtn,
                  pickingTarget === 'DESTINATION' && styles.miniActionBtnActiveRed,
                ]}
                onPress={() =>
                  setPickingTarget((prev) =>
                    prev === 'DESTINATION' ? null : 'DESTINATION'
                  )
                }
                accessibilityLabel="Tap on map to pick Destination"
              >
                <Ionicons
                  name="pin"
                  size={16}
                  color={pickingTarget === 'DESTINATION' ? '#FFFFFF' : '#DC2626'}
                />
              </TouchableOpacity>
            </View>

            {/* Pick-on-Map Instruction Banner */}
            {pickingTarget && (
              <View style={styles.pickOnMapBanner}>
                <Ionicons name="hand-left-outline" size={15} color="#FFFFFF" />
                <Text style={styles.pickOnMapText}>
                  Tap any building, pin, or exact spot on the map to set{' '}
                  {pickingTarget === 'ORIGIN' ? 'Start (A)' : 'Destination (B)'}
                </Text>
                <TouchableOpacity onPress={() => setPickingTarget(null)}>
                  <Text style={styles.pickOnMapCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* 3. DIRECTIONS BOTTOM CARD: Route Summary, Steps & Prompt */}
      {directionsOpen && (
        <View style={styles.routeSheet}>
          <TouchableOpacity
            style={styles.sheetGrabArea}
            activeOpacity={0.8}
            onPress={() => setRouteSheetCollapsed((c) => !c)}
          >
            <View style={styles.dragPill} />
          </TouchableOpacity>

          {routeLoading ? (
            <View style={styles.routeStateRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.routeStateText}>
                Computing shortest campus {travelMode === 'VEHICLE' ? 'road' : 'walkway'} route...
              </Text>
            </View>
          ) : routeError ? (
            <View style={styles.routeErrorBox}>
              <Ionicons name="alert-circle" size={18} color={Colors.danger} />
              <Text style={styles.routeErrorText}>{routeError}</Text>
            </View>
          ) : !destinationPoint ? (
            <View style={styles.routePromptRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.routePromptTitle}>Choose a Campus Destination (B)</Text>
                <Text style={styles.routePromptSub}>
                  Tap the red "B" field above to search 28 buildings & 12 facilities, or tap any building directly on the map.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.chooseDestCta}
                onPress={() => {
                  setPickerQuery('');
                  setPickerModalTarget('DESTINATION');
                }}
              >
                <Ionicons name="search" size={15} color="#FFFFFF" />
                <Text style={styles.chooseDestCtaText}>Pick To (B)</Text>
              </TouchableOpacity>
            </View>
          ) : activeRoute ? (
            <>
              {/* Summary Header Row */}
              <View style={styles.routeMetricsRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.timeDistRow}>
                    <Text style={styles.routeTime}>
                      {formatDuration(activeRoute.total_duration_seconds)}
                    </Text>
                    <Text style={styles.routeDistBadge}>
                      {formatDistance(activeRoute.total_distance_m)}
                    </Text>
                    {activeRoute.uses_steps && (
                      <View style={styles.stairsBadge}>
                        <Text style={styles.stairsBadgeText}>Includes Steps</Text>
                      </View>
                    )}
                  </View>

                  {!routeSheetCollapsed && (
                    <Text style={styles.routeBreakdown}>
                      {activeRoute.breakdown.road_distance_m > 0
                        ? `${Math.round(activeRoute.breakdown.road_distance_m)}m campus road`
                        : ''}
                      {activeRoute.breakdown.road_distance_m > 0 &&
                      activeRoute.breakdown.walkway_distance_m > 0
                        ? ' • '
                        : ''}
                      {activeRoute.breakdown.walkway_distance_m > 0
                        ? `${Math.round(activeRoute.breakdown.walkway_distance_m)}m footpath`
                        : ''}
                    </Text>
                  )}
                </View>

                <View style={styles.routeHeaderActions}>
                  {destinationBuildingForIndoor && (
                    <TouchableOpacity
                      style={styles.routeIndoorChip}
                      onPress={() => setIndoorBuilding(destinationBuildingForIndoor)}
                    >
                      <Ionicons name="layers-outline" size={14} color={Colors.primary} />
                      <Text style={styles.routeIndoorChipText}>Rooms</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={styles.collapseIconBtn}
                    onPress={() => setRouteSheetCollapsed((c) => !c)}
                  >
                    <Ionicons
                      name={routeSheetCollapsed ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={Colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Expandable Turn-by-Turn Steps */}
              {!routeSheetCollapsed && activeRoute.steps && activeRoute.steps.length > 0 && (
                <>
                  <TouchableOpacity
                    style={styles.stepsToggleRow}
                    onPress={() => setShowSteps((s) => !s)}
                  >
                    <Ionicons
                      name={getManeuverIcon(activeRoute.steps[0])}
                      size={17}
                      color={Colors.primary}
                    />
                    <Text style={styles.nextStepText} numberOfLines={1}>
                      {activeRoute.steps[0].instruction}
                    </Text>
                    <Text style={styles.stepsCountBtn}>
                      {showSteps ? 'Hide Steps' : `Turn-by-Turn (${activeRoute.steps.length})`}
                    </Text>
                  </TouchableOpacity>

                  {showSteps && (
                    <ScrollView style={styles.stepsList} nestedScrollEnabled>
                      {activeRoute.steps.map((st, idx) => (
                        <TouchableOpacity
                          key={`step-${idx}`}
                          style={styles.stepItem}
                          onPress={() => setFocusedCoord({ lat: st.lat, lng: st.lng })}
                        >
                          <View
                            style={[
                              styles.stepNumCircle,
                              st.maneuver === 'ARRIVE' && { backgroundColor: '#FEF2F2' },
                            ]}
                          >
                            <Ionicons
                              name={getManeuverIcon(st)}
                              size={13}
                              color={st.maneuver === 'ARRIVE' ? '#DC2626' : Colors.primary}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.stepInstruction}>{st.instruction}</Text>
                            <Text style={styles.stepSub}>
                              {st.path_type}
                              {st.distance_m > 0 ? ` • ${Math.round(st.distance_m)} m` : ''}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </>
              )}
            </>
          ) : null}
        </View>
      )}

      {/* 4. EXPLORE MODE DESTINATION DETAILS SHEET (When user taps a building/facility on map) */}
      {!directionsOpen && activeDestination && (
        <View style={styles.bottomSheet}>
          <View style={styles.dragPill} />

          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleCol}>
              <View style={styles.sheetBadgesRow}>
                {'building_code' in activeDestination && activeDestination.building_code && (
                  <View style={styles.sheetBadge}>
                    <Text style={styles.sheetBadgeText}>
                      {activeDestination.building_code}
                    </Text>
                  </View>
                )}
                {'total_floors' in activeDestination && (
                  <View style={styles.sheetMetaPill}>
                    <Text style={styles.sheetMetaPillText}>
                      {activeDestination.total_floors} Floors
                    </Text>
                  </View>
                )}
                {activeDestination.is_accessible && (
                  <View style={styles.sheetAccessPill}>
                    <Text style={styles.sheetAccessText}>Accessible</Text>
                  </View>
                )}
              </View>

              <Text style={styles.sheetTitle} numberOfLines={2}>
                {'building_name' in activeDestination
                  ? activeDestination.building_name || ''
                  : activeDestination.facility_name}
              </Text>

              <Text style={styles.sheetType}>
                {'building_type' in activeDestination
                  ? activeDestination.building_type.replace(/_/g, ' ')
                  : `${activeDestination.category.replace(/_/g, ' ')}${
                      activeDestination.opening_hours
                        ? ` • ${activeDestination.opening_hours}`
                        : ''
                    }`}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.sheetCloseBtn}
              onPress={() => {
                selectBuilding(null);
                selectFacility(null);
              }}
              accessibilityLabel="Close destination sheet"
            >
              <Ionicons name="close" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          {activeDestination.description && (
            <Text style={styles.sheetDesc} numberOfLines={2}>
              {activeDestination.description}
            </Text>
          )}

          <View style={styles.sheetActionsRow}>
            {/* Action 1: Directions TO here */}
            <TouchableOpacity
              style={styles.navigateBtn}
              activeOpacity={0.88}
              onPress={() => {
                const lat = activeDestination.latitude;
                const lng = activeDestination.longitude;
                if (!lat || !lng) return;
                const isBldg = 'total_floors' in activeDestination;
                openDirectionsToDestination({
                  label: isBldg
                    ? `${activeDestination.building_name} (${activeDestination.building_code})`
                    : activeDestination.facility_name,
                  lat,
                  lng,
                  source: isBldg ? 'BUILDING' : 'FACILITY',
                  entityId: isBldg
                    ? activeDestination.building_id
                    : activeDestination.facility_id,
                });
              }}
            >
              <Ionicons name="navigate" size={15} color={Colors.textInverse} />
              <Text style={styles.navigateBtnText}>Directions</Text>
            </TouchableOpacity>

            {/* Action 2: Set as FROM (Start A) */}
            <TouchableOpacity
              style={styles.setOriginBtn}
              activeOpacity={0.85}
              onPress={() => {
                const lat = activeDestination.latitude;
                const lng = activeDestination.longitude;
                if (!lat || !lng) return;
                const isBldg = 'total_floors' in activeDestination;
                setOriginPoint({
                  label: isBldg
                    ? `${activeDestination.building_name} (${activeDestination.building_code})`
                    : activeDestination.facility_name,
                  lat,
                  lng,
                  source: isBldg ? 'BUILDING' : 'FACILITY',
                  entityId: isBldg
                    ? activeDestination.building_id
                    : activeDestination.facility_id,
                });
                setDirectionsOpen(true);
                if (!destinationPoint) {
                  setPickerQuery('');
                  setPickerModalTarget('DESTINATION');
                }
              }}
            >
              <Ionicons name="flag-outline" size={14} color={Colors.primary} />
              <Text style={styles.setOriginText}>From Here</Text>
            </TouchableOpacity>

            {/* Action 3: Indoor Floors & Rooms */}
            {'total_floors' in activeDestination && (
              <TouchableOpacity
                style={styles.indoorBtn}
                activeOpacity={0.88}
                onPress={() => setIndoorBuilding(activeDestination)}
              >
                <Ionicons name="layers-outline" size={15} color={Colors.primary} />
                <Text style={styles.indoorBtnText}>Rooms</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 5. SEARCHABLE FROM (A) / TO (B) CAMPUS LOCATION PICKER MODAL */}
      <Modal
        visible={pickerModalTarget !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setPickerModalTarget(null)}
      >
        <SafeAreaView style={styles.pickerModalContainer} edges={['top', 'bottom']}>
          {/* Modal Header */}
          <View style={styles.pickerHeader}>
            <TouchableOpacity
              style={styles.pickerBackBtn}
              onPress={() => setPickerModalTarget(null)}
            >
              <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickerHeaderTitle}>
                {pickerModalTarget === 'ORIGIN'
                  ? 'Select Starting Point (From A)'
                  : 'Select Destination (To B)'}
              </Text>
              <Text style={styles.pickerHeaderSub}>
                28 verified RVCE buildings, gates & 12 campus amenities
              </Text>
            </View>
          </View>

          {/* Instant Filter Input */}
          <View style={styles.pickerSearchBox}>
            <Ionicons name="search" size={18} color={Colors.primary} />
            <TextInput
              style={styles.pickerSearchInput}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="Search CSE, Admin, Mingos, Gate, Hostel, Library..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
              returnKeyType="search"
            />
            {pickerQuery.length > 0 && (
              <TouchableOpacity onPress={() => setPickerQuery('')}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Quick Special Actions: Live GPS & Pick Directly on Map */}
          <View style={styles.pickerQuickRow}>
            {pickerModalTarget === 'ORIGIN' && (
              <TouchableOpacity
                style={styles.pickerQuickChip}
                onPress={() => handleLocateUser(true)}
              >
                <Ionicons name="locate" size={16} color="#15803D" />
                <Text style={styles.pickerQuickText}>My Live GPS</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.pickerQuickChip}
              onPress={() => {
                const target = pickerModalTarget;
                setPickerModalTarget(null);
                setPickingTarget(target);
              }}
            >
              <Ionicons name="map-outline" size={16} color={Colors.primary} />
              <Text style={styles.pickerQuickText}>Tap Spot on Map</Text>
            </TouchableOpacity>
          </View>

          {/* All Campus Places FlatList */}
          <FlatList
            data={filteredPickerOptions}
            keyExtractor={(item) => item.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.pickerListContent}
            renderItem={({ item, index }) => {
              const prevGroup = index > 0 ? filteredPickerOptions[index - 1].group : null;
              const showGroupHeader = item.group !== prevGroup;

              return (
                <>
                  {showGroupHeader && (
                    <Text style={styles.pickerSectionLabel}>{item.group}</Text>
                  )}
                  <TouchableOpacity
                    style={styles.pickerItemRow}
                    activeOpacity={0.78}
                    onPress={() => {
                      if (pickerModalTarget === 'ORIGIN') {
                        setOriginPoint(item.point);
                      } else {
                        setOriginPoint((prev) => prev ?? defaultGateOrigin);
                        setDestinationPoint(item.point);
                      }
                      setPickerModalTarget(null);
                      setPickingTarget(null);
                      setDirectionsOpen(true);
                      setRouteSheetCollapsed(false);
                    }}
                  >
                    <View
                      style={[
                        styles.pickerItemIcon,
                        item.category
                          ? { backgroundColor: getFacilityColor(item.category) }
                          : { backgroundColor: Colors.primary },
                      ]}
                    >
                      <Ionicons
                        name={
                          item.category
                            ? getFacilityIcon(item.category)
                            : 'business'
                        }
                        size={15}
                        color="#FFFFFF"
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerItemTitle} numberOfLines={1}>
                        {item.point.label}
                      </Text>
                      <Text style={styles.pickerItemSub} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    </View>

                    <Ionicons
                      name="arrow-forward-circle-outline"
                      size={20}
                      color={Colors.primary}
                    />
                  </TouchableOpacity>
                </>
              );
            }}
            ListEmptyComponent={
              <View style={styles.pickerEmptyBox}>
                <Text style={styles.pickerEmptyText}>
                  No campus locations match "{pickerQuery}".
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* 6. Building Details & Interactive Indoor Floor-Plan Modal */}
      <IndoorFloorModal
        visible={Boolean(indoorBuilding)}
        building={indoorBuilding}
        initialFloorId={targetFloorId}
        initialRoomId={targetRoomId}
        onClose={() => {
          setIndoorBuilding(null);
          setTargetFloorId(null);
          setTargetRoomId(null);
        }}
        onNavigateToBuilding={(b) => {
          setIndoorBuilding(null);
          setTargetFloorId(null);
          setTargetRoomId(null);
          openDirectionsToDestination({
            label: `${b.building_name} (${b.building_code})`,
            lat: b.latitude,
            lng: b.longitude,
            source: 'BUILDING',
            entityId: b.building_id,
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  floatingTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  exploreHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    gap: 8,
  },
  topDirectionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 5,
  },
  topDirectionsBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  categoryScroll: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    gap: 7,
  },
  browseAllChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#15803D',
    paddingHorizontal: 12,
    paddingVertical: 6.5,
    borderRadius: Radius.full,
    elevation: 3,
  },
  browseAllChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    paddingHorizontal: 11,
    paddingVertical: 6.5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  catChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  catChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  catChipTextActive: {
    color: '#FFFFFF',
  },
  suggestionsDropdown: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    maxHeight: 280,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  },
  emptySearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: Spacing.md,
  },
  emptySearchText: {
    flex: 1,
    fontSize: 12.5,
    color: Colors.textSecondary,
  },
  suggestionsScroll: {
    paddingVertical: 4,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  suggestionIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionTextCol: {
    flex: 1,
  },
  suggestionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  suggestionSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  entityTag: {
    backgroundColor: Colors.cardSecondary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  entityTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.textSecondary,
  },

  /* Google-Maps-Style Top Directions Planner Card */
  plannerCard: {
    marginHorizontal: 12,
    marginTop: 4,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 8,
  },
  plannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  plannerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plannerSwapBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegmented: {
    flexDirection: 'row',
    backgroundColor: Colors.cardSecondary,
    borderRadius: Radius.full,
    padding: 3,
    gap: 3,
  },
  modeSegBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  modeSegBtnWalk: {
    backgroundColor: '#DC2626',
  },
  modeSegBtnDrive: {
    backgroundColor: '#1D4ED8',
  },
  modeSegText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  modeSegTextActive: {
    color: '#FFFFFF',
  },
  inputEndpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dotBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  endpointSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    height: 38,
    gap: 6,
  },
  endpointSelectorHighlight: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  endpointSelectorPicking: {
    borderColor: '#DC2626',
    borderWidth: 1.5,
    backgroundColor: '#FEF2F2',
  },
  endpointValueText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  endpointValueTextBold: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  endpointPlaceholderText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textMuted,
  },
  endpointPlaceholderPrompt: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.primary,
  },
  miniActionBtn: {
    width: 36,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniActionBtnActive: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  miniActionBtnActiveRed: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  pickOnMapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 9,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pickOnMapText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '600',
  },
  pickOnMapCancel: {
    color: '#FDE047',
    fontSize: 11.5,
    fontWeight: '800',
  },

  /* Bottom Route Summary Sheet */
  routeSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: 6,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderColor: Colors.border,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    zIndex: 11,
  },
  sheetGrabArea: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  dragPill: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 8,
  },
  routeStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  routeStateText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  routeErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  routeErrorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.danger,
    fontWeight: '600',
  },
  routePromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  routePromptTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  routePromptSub: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  chooseDestCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DC2626',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  chooseDestCtaText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
  },
  routeMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timeDistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  routeTime: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.primary,
  },
  routeDistBadge: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  stairsBadge: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  stairsBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  routeBreakdown: {
    fontSize: 11.5,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  routeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeIndoorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  routeIndoorChipText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: Colors.primary,
  },
  collapseIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  nextStepText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  stepsCountBtn: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.primary,
  },
  stepsList: {
    maxHeight: 190,
    marginTop: 8,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  stepNumCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepInstruction: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  stepSub: {
    fontSize: 10.5,
    color: Colors.textMuted,
    marginTop: 1,
  },

  /* Explore Mode Destination Bottom Sheet */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: 10,
    paddingBottom: Spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
    borderTopWidth: 1,
    borderColor: Colors.border,
    zIndex: 11,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sheetTitleCol: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  sheetBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  sheetBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  sheetBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
  },
  sheetMetaPill: {
    backgroundColor: Colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  sheetMetaPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  sheetAccessPill: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  sheetAccessText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  sheetType: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDesc: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: Spacing.sm,
  },
  sheetActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: Spacing.md,
  },
  navigateBtn: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: Radius.md,
    gap: 5,
  },
  navigateBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textInverse,
  },
  setOriginBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    gap: 4,
  },
  setOriginText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: Colors.primary,
  },
  indoorBtn: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    borderWidth: 1.2,
    borderColor: Colors.primary,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    gap: 4,
  },
  indoorBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: Colors.primary,
  },

  /* Searchable From (A) / To (B) Campus Location Picker Modal */
  pickerModalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  pickerHeaderSub: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  pickerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.md,
    marginTop: 12,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1.2,
    borderColor: Colors.primary,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  pickerQuickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  pickerQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pickerQuickText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  pickerListContent: {
    paddingHorizontal: Spacing.md,
    paddingBottom: 32,
  },
  pickerSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 6,
  },
  pickerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: Radius.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickerItemIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerItemTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  pickerItemSub: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  pickerEmptyBox: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  pickerEmptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
});
