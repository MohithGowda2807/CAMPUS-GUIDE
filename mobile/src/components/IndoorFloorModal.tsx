import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { KeyboardSafeScrollView } from './KeyboardSafeScrollView';
import Svg, { Rect, G, Circle, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { campusApi } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing } from '../theme/spacing';
import type {
  Building,
  BuildingDetailResponse,
  FacultyMember,
  FloorPlanResponse,
  FloorSummary,
  RoomItem,
} from '../types/campus';

interface IndoorFloorModalProps {
  visible: boolean;
  building: Building | null;
  initialFloorId?: number | null;
  initialRoomId?: number | null;
  onClose: () => void;
  onNavigateToBuilding?: (building: Building) => void;
}

const ROOM_CATEGORY_FILL: Record<string, string> = {
  CLASSROOM: '#F8FAFC',
  LABORATORY: '#EFF6FF',
  SEMINAR_HALL: '#F0F9FF',
  FACULTY_OFFICE: '#FFF7ED',
  HOD_CABIN: '#FEF3C7',
  ADMIN_OFFICE: '#F8FAFC',
  LIBRARY_ZONE: '#F0FDF4',
  RESTROOM: '#F1F5F9',
  RECEPTION: '#FEFCE8',
};

export const IndoorFloorModal: React.FC<IndoorFloorModalProps> = ({
  visible,
  building,
  initialFloorId,
  initialRoomId,
  onClose,
  onNavigateToBuilding,
}) => {
  const { isGlass, theme } = useTheme();
  const [detail, setDetail] = useState<BuildingDetailResponse | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<FloorSummary | null>(null);
  const [floorPlan, setFloorPlan] = useState<FloorPlanResponse | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomItem | null>(null);
  const [roomOccupants, setRoomOccupants] = useState<FacultyMember[]>([]);
  const [roomFilter, setRoomFilter] = useState('');
  const [zoom, setZoom] = useState(1);
  const [loadingBuilding, setLoadingBuilding] = useState(false);
  const [loadingFloor, setLoadingFloor] = useState(false);

  useEffect(() => {
    if (!visible || !building) return;
    let active = true;
    setLoadingBuilding(true);
    setDetail(null);
    setSelectedFloor(null);
    setFloorPlan(null);
    setSelectedRoom(null);
    setRoomOccupants([]);
    setRoomFilter('');
    setZoom(1);

    campusApi
      .getBuildingDetail(building.building_id)
      .then((res) => {
        if (!active) return;
        setDetail(res);
        const targetFloor =
          initialFloorId
            ? res.floors.find((f) => f.floor_id === initialFloorId)
            : res.floors.find((f) => f.has_floor_plan) || res.floors[0] || null;
        if (targetFloor) {
          setSelectedFloor(targetFloor);
        }
      })
      .finally(() => {
        if (active) setLoadingBuilding(false);
      });

    return () => {
      active = false;
    };
  }, [visible, building, initialFloorId]);

  useEffect(() => {
    if (!visible || !selectedFloor) return;
    let active = true;
    setLoadingFloor(true);
    setSelectedRoom(null);
    setRoomOccupants([]);

    campusApi
      .getFloorPlan(selectedFloor.floor_id)
      .then((fp) => {
        if (!active) return;
        setFloorPlan(fp);
        if (fp.rooms.length > 0) {
          const targetRoom =
            initialRoomId
              ? fp.rooms.find((r) => r.room_id === initialRoomId)
              : null;
          handleSelectRoom(targetRoom || fp.rooms[0]);
        }
      })
      .catch(() => {
        if (active) setFloorPlan(null);
      })
      .finally(() => {
        if (active) setLoadingFloor(false);
      });

    return () => {
      active = false;
    };
  }, [visible, selectedFloor]);

  const handleSelectRoom = (room: RoomItem) => {
    Haptics.selectionAsync().catch(() => {});
    setSelectedRoom(room);
    setRoomOccupants([]);
    campusApi
      .getRoomDetail(room.room_id)
      .then((res) => setRoomOccupants(res.occupants || []))
      .catch(() => setRoomOccupants([]));
  };

  const roomById = useMemo(() => {
    const map = new Map<number, RoomItem>();
    for (const r of floorPlan?.rooms || []) {
      map.set(r.room_id, r);
    }
    return map;
  }, [floorPlan]);

  const filteredRooms = useMemo(() => {
    const rooms = floorPlan?.rooms || [];
    const q = roomFilter.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.room_number.toLowerCase().includes(q) ||
        r.room_name.toLowerCase().includes(q) ||
        r.room_type.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q))
    );
  }, [floorPlan, roomFilter]);

  if (!building) return null;

  const canvasW =
    floorPlan?.overlay?.canvas.width ?? floorPlan?.floor_plan?.canvas_width ?? 1000;
  const canvasH =
    floorPlan?.overlay?.canvas.height ?? floorPlan?.floor_plan?.canvas_height ?? 650;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.canvas }]}
        edges={['top', 'bottom']}
      >
        {/* Top Bar with Building Context */}
        <View
          style={[
            styles.topBar,
            {
              backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
              borderBottomColor: theme.colors.borderSubtle,
            },
          ]}
        >
          {isGlass && <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />}
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: theme.colors.surfaceMuted }]}
            onPress={onClose}
            accessibilityLabel="Back to outdoor campus map"
          >
            <Ionicons name="arrow-back" size={20} color={theme.colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.topTitleCol}>
            <Text style={[styles.breadcrumb, { color: theme.colors.textMuted }]}>
              {building.building_code} • {building.total_floors} Floors
            </Text>
            <Text
              style={[styles.buildingTitle, { color: theme.colors.textPrimary }]}
              numberOfLines={1}
            >
              {building.building_name}
            </Text>
          </View>

          {onNavigateToBuilding && (
            <TouchableOpacity
              style={[styles.routeChip, { backgroundColor: theme.colors.primary }]}
              onPress={() => {
                onClose();
                onNavigateToBuilding(building);
              }}
            >
              <Ionicons name="navigate" size={13} color="#FFFFFF" />
              <Text style={styles.routeChipText}>Directions</Text>
            </TouchableOpacity>
          )}
        </View>

        <KeyboardSafeScrollView contentContainerStyle={styles.scrollContent}>
          {/* Compact Building Header Summary */}
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.borderSubtle,
              },
              theme.shadows.card,
            ]}
          >
            <View style={styles.metaBadgesRow}>
              <View style={[styles.codeBadge, { backgroundColor: theme.colors.primarySoft }]}>
                <Text style={[styles.codeBadgeText, { color: theme.colors.primary }]}>
                  {building.building_code}
                </Text>
              </View>
              <View style={[styles.metaBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="layers-outline" size={12} color={theme.colors.textSecondary} />
                <Text style={[styles.metaBadgeText, { color: theme.colors.textSecondary }]}>
                  {building.total_floors} Floors
                </Text>
              </View>
              {building.is_accessible && (
                <View style={[styles.accessBadge, { backgroundColor: theme.colors.successBg }]}>
                  <Ionicons name="accessibility-outline" size={12} color={theme.colors.success} />
                  <Text style={[styles.accessBadgeText, { color: theme.colors.success }]}>
                    Step-Free Access
                  </Text>
                </View>
              )}
            </View>
            {building.description ? (
              <Text style={[styles.buildingDesc, { color: theme.colors.textSecondary }]}>
                {building.description}
              </Text>
            ) : null}
          </View>

          {loadingBuilding ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={[styles.loaderText, { color: theme.colors.textMuted }]}>
                Loading building floors & rooms…
              </Text>
            </View>
          ) : (
            <>
              {/* Clean Horizontal Segmented Floor Selector (Zero Truncation, No "Mall View" text) */}
              {detail && detail.floors.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionLabel, { color: theme.colors.textPrimary }]}>
                      Floor Level
                    </Text>
                    <Text style={[styles.sectionCountText, { color: theme.colors.textMuted }]}>
                      {detail.floors.length} {detail.floors.length === 1 ? 'Floor' : 'Floors'}
                    </Text>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.floorSelectorRow}
                  >
                    {[...detail.floors]
                      .sort((a, b) => a.floor_number - b.floor_number)
                      .map((fl) => {
                        const active = selectedFloor?.floor_id === fl.floor_id;
                        const levelBadge =
                          fl.floor_number === 0
                            ? 'GF'
                            : fl.floor_number < 0
                            ? `B${Math.abs(fl.floor_number)}`
                            : `${fl.floor_number}F`;
                        return (
                          <TouchableOpacity
                            key={fl.floor_id}
                            activeOpacity={0.85}
                            style={[
                              styles.floorTabPill,
                              {
                                backgroundColor: active
                                  ? theme.colors.primary
                                  : theme.colors.surface,
                                borderColor: active
                                  ? theme.colors.primary
                                  : theme.colors.borderSubtle,
                              },
                              !active && theme.shadows.card,
                            ]}
                            onPress={() => {
                              Haptics.selectionAsync().catch(() => {});
                              setSelectedFloor(fl);
                            }}
                          >
                            <View
                              style={[
                                styles.floorCodeBox,
                                {
                                  backgroundColor: active
                                    ? 'rgba(255, 255, 255, 0.22)'
                                    : theme.colors.primarySoft,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.floorCodeText,
                                  { color: active ? '#FFFFFF' : theme.colors.primary },
                                ]}
                              >
                                {levelBadge}
                              </Text>
                            </View>
                            <View>
                              <Text
                                style={[
                                  styles.floorTabTitle,
                                  { color: active ? '#FFFFFF' : theme.colors.textPrimary },
                                ]}
                              >
                                {fl.floor_name}
                              </Text>
                              <Text
                                style={[
                                  styles.floorTabMeta,
                                  {
                                    color: active
                                      ? 'rgba(255, 255, 255, 0.82)'
                                      : theme.colors.textMuted,
                                  },
                                ]}
                              >
                                {fl.room_count} {fl.room_count === 1 ? 'Room' : 'Rooms'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                  </ScrollView>
                </View>
              )}

              {/* Interactive SVG Floor Plan Viewer */}
              {loadingFloor ? (
                <View style={styles.loaderBox}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.loaderText, { color: theme.colors.textMuted }]}>
                    Loading floor layout…
                  </Text>
                </View>
              ) : floorPlan?.overlay ? (
                <View
                  style={[
                    styles.planCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.borderSubtle,
                    },
                    theme.shadows.card,
                  ]}
                >
                  <View
                    style={[
                      styles.planToolbar,
                      {
                        backgroundColor: theme.colors.surfaceMuted,
                        borderBottomColor: theme.colors.borderSubtle,
                      },
                    ]}
                  >
                    <Text style={[styles.planTitle, { color: theme.colors.textPrimary }]}>
                      {floorPlan.floor.floor_name} Layout
                    </Text>
                    <View style={styles.zoomControls}>
                      <TouchableOpacity
                        style={[
                          styles.zoomBtn,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.borderSubtle,
                          },
                        ]}
                        onPress={() => setZoom((z) => Math.max(0.8, +(z - 0.25).toFixed(2)))}
                        accessibilityLabel="Zoom out indoor plan"
                      >
                        <Ionicons name="remove" size={15} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                      <Text style={[styles.zoomLabel, { color: theme.colors.textSecondary }]}>
                        {Math.round(zoom * 100)}%
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.zoomBtn,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.borderSubtle,
                          },
                        ]}
                        onPress={() => setZoom((z) => Math.min(2.0, +(z + 0.25).toFixed(2)))}
                        accessibilityLabel="Zoom in indoor plan"
                      >
                        <Ionicons name="add" size={15} color={theme.colors.textPrimary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.zoomBtn,
                          {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.borderSubtle,
                          },
                        ]}
                        onPress={() => setZoom(1)}
                      >
                        <Ionicons name="refresh" size={13} color={theme.colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator
                    contentContainerStyle={styles.svgScrollContent}
                  >
                    <Svg
                      width={Math.round(335 * zoom)}
                      height={Math.round(220 * zoom)}
                      viewBox={`0 0 ${canvasW} ${canvasH}`}
                    >
                      {/* Building Slab */}
                      <Rect
                        x={50}
                        y={55}
                        width={canvasW - 100}
                        height={canvasH - 110}
                        rx={10}
                        fill="#FFFFFF"
                        stroke="#94A3B8"
                        strokeWidth={2.5}
                      />

                      {/* Corridors */}
                      {floorPlan.overlay.corridors.map((c, idx) => (
                        <G key={`cor-${idx}`}>
                          <Rect
                            x={c.x}
                            y={c.y}
                            width={c.w}
                            height={c.h}
                            fill="#F1F5F9"
                            stroke="#CBD5E1"
                            strokeDasharray="6, 6"
                          />
                          {c.label && c.w > 240 ? (
                            <SvgText
                              x={c.x + c.w / 2}
                              y={c.y + c.h / 2 + 5}
                              textAnchor="middle"
                              fontSize="15"
                              fill="#64748B"
                              fontWeight="600"
                            >
                              {c.label}
                            </SvgText>
                          ) : null}
                        </G>
                      ))}

                      {/* Interactive Selectable Rooms */}
                      {floorPlan.overlay.rooms.map((poly) => {
                        const isSelected = poly.room_id === selectedRoom?.room_id;
                        const linkedRoom = roomById.get(poly.room_id);
                        const fill = isSelected
                          ? '#27447E'
                          : ROOM_CATEGORY_FILL[poly.category] || '#F8FAFC';

                        return (
                          <G
                            key={`rm-${poly.room_id}`}
                            onPress={() => {
                              if (linkedRoom) handleSelectRoom(linkedRoom);
                            }}
                          >
                            {isSelected && (
                              <Rect
                                x={poly.bounds.x - 4}
                                y={poly.bounds.y - 4}
                                width={poly.bounds.w + 8}
                                height={poly.bounds.h + 8}
                                rx={9}
                                fill="none"
                                stroke="#3B82F6"
                                strokeWidth={3.5}
                              />
                            )}
                            <Rect
                              x={poly.bounds.x}
                              y={poly.bounds.y}
                              width={poly.bounds.w}
                              height={poly.bounds.h}
                              rx={6}
                              fill={fill}
                              stroke={isSelected ? '#1E3666' : '#94A3B8'}
                              strokeWidth={isSelected ? 3.5 : 1.8}
                            />
                            <SvgText
                              x={poly.bounds.x + poly.bounds.w / 2}
                              y={poly.bounds.y + poly.bounds.h / 2 - 4}
                              textAnchor="middle"
                              fontSize="18"
                              fontWeight="bold"
                              fill={isSelected ? '#FFFFFF' : '#27447E'}
                            >
                              {poly.room_number}
                            </SvgText>
                            <SvgText
                              x={poly.bounds.x + poly.bounds.w / 2}
                              y={poly.bounds.y + poly.bounds.h / 2 + 18}
                              textAnchor="middle"
                              fontSize="13"
                              fill={isSelected ? '#EDF2FA' : '#475569'}
                            >
                              {poly.label.length > 20
                                ? `${poly.label.slice(0, 18)}…`
                                : poly.label}
                            </SvgText>
                          </G>
                        );
                      })}

                      {/* Landmarks (Lifts / Stairs / Entrances) */}
                      {floorPlan.overlay.landmarks.map((lm, idx) => (
                        <G key={`lm-${idx}`}>
                          <Circle
                            cx={lm.x}
                            cy={lm.y}
                            r={18}
                            fill="#EDF2FA"
                            stroke="#27447E"
                            strokeWidth={2}
                          />
                          <SvgText
                            x={lm.x}
                            y={lm.y + 5}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="bold"
                            fill="#27447E"
                          >
                            {lm.label.slice(0, 4)}
                          </SvgText>
                        </G>
                      ))}
                    </Svg>
                  </ScrollView>

                  {/* Subtle Color Legend */}
                  <View
                    style={[
                      styles.legendRow,
                      {
                        borderTopColor: theme.colors.borderSubtle,
                        backgroundColor: theme.colors.surfaceMuted,
                      },
                    ]}
                  >
                    {[
                      { label: 'Faculty Cabin', color: '#FFF7ED', border: '#F59E0B' },
                      { label: 'HoD Cabin', color: '#FEF3C7', border: '#D97706' },
                      { label: 'Laboratory', color: '#EFF6FF', border: '#3B82F6' },
                      { label: 'Classroom', color: '#F8FAFC', border: '#64748B' },
                      { label: 'Selected', color: '#27447E', border: '#27447E' },
                    ].map((lg) => (
                      <View key={lg.label} style={styles.legendItem}>
                        <View
                          style={[
                            styles.legendSwatch,
                            { backgroundColor: lg.color, borderColor: lg.border },
                          ]}
                        />
                        <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                          {lg.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                /* Compact Empty State per UI DESIGN.txt Section 7 */
                <View
                  style={[
                    styles.compactEmptyPlanBar,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons name="map-outline" size={18} color={theme.colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.emptyPlanTitle, { color: theme.colors.textPrimary }]}>
                      Floor plan not available yet
                    </Text>
                    <Text style={[styles.emptyPlanSub, { color: theme.colors.textMuted }]}>
                      Explore verified rooms below
                    </Text>
                  </View>
                </View>
              )}

              {/* Selected Room Detail & Seated Faculty Roster */}
              {selectedRoom && (
                <View
                  style={[
                    styles.selectedRoomCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.primary,
                    },
                    theme.shadows.card,
                  ]}
                >
                  <View style={styles.selectedRoomHeader}>
                    <View style={[styles.roomNumBadge, { backgroundColor: theme.colors.primary }]}>
                      <Text style={styles.roomNumBadgeText}>{selectedRoom.room_number}</Text>
                    </View>
                    <Text style={[styles.roomTypeBadge, { color: theme.colors.textMuted }]}>
                      {selectedRoom.room_type.replace(/_/g, ' ')}
                    </Text>
                  </View>

                  <Text style={[styles.selectedRoomTitle, { color: theme.colors.textPrimary }]}>
                    {selectedRoom.room_name}
                  </Text>
                  {selectedRoom.description ? (
                    <Text style={[styles.selectedRoomDesc, { color: theme.colors.textSecondary }]}>
                      {selectedRoom.description}
                    </Text>
                  ) : null}

                  <View style={styles.roomMetaRow}>
                    {selectedRoom.capacity ? (
                      <Text style={[styles.roomMetaItem, { color: theme.colors.textMuted }]}>
                        Capacity: {selectedRoom.capacity}
                      </Text>
                    ) : null}
                    <Text style={[styles.roomMetaItem, { color: theme.colors.textMuted }]}>
                      {selectedRoom.is_accessible ? 'Step-Free Access' : 'Stair Access'}
                    </Text>
                  </View>

                  {roomOccupants.length > 0 && (
                    <View
                      style={[
                        styles.occupantsBox,
                        { borderTopColor: theme.colors.divider },
                      ]}
                    >
                      <View style={styles.occupantsHeaderRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons
                            name="people-outline"
                            size={15}
                            color={theme.colors.primary}
                          />
                          <Text
                            style={[styles.occupantsLabel, { color: theme.colors.textPrimary }]}
                          >
                            Seated Faculty ({roomOccupants.length})
                          </Text>
                        </View>
                      </View>

                      <View style={styles.occupantsList}>
                        {roomOccupants.map((occ) => {
                          const initials = occ.display_name
                            .replace(/^(Dr\.|Mr\.|Ms\.|Prof\.)\s*/i, '')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((w) => w[0]?.toUpperCase() || '')
                            .join('');
                          const isAvailable = occ.effective_availability === 'AVAILABLE';
                          const isBusy = occ.effective_availability === 'BUSY';
                          return (
                            <View
                              key={occ.staff_id}
                              style={[
                                styles.occupantCardRow,
                                {
                                  backgroundColor: theme.colors.surfaceMuted,
                                  borderColor: theme.colors.borderSubtle,
                                },
                              ]}
                            >
                              <View
                                style={[
                                  styles.occupantAvatar,
                                  { backgroundColor: theme.colors.primarySoft },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.occupantAvatarText,
                                    { color: theme.colors.primary },
                                  ]}
                                >
                                  {initials || 'RV'}
                                </Text>
                              </View>

                              <View style={{ flex: 1 }}>
                                <Text
                                  style={[
                                    styles.occupantName,
                                    { color: theme.colors.textPrimary },
                                  ]}
                                >
                                  {occ.display_name}
                                </Text>
                                <Text
                                  style={[
                                    styles.occupantDesignation,
                                    { color: theme.colors.textSecondary },
                                  ]}
                                >
                                  {occ.designation}
                                  {occ.dept_code ? ` • ${occ.dept_code}` : ''}
                                </Text>
                              </View>

                              <View
                                style={[
                                  styles.availabilityPill,
                                  {
                                    backgroundColor: isAvailable
                                      ? theme.colors.successBg
                                      : isBusy
                                      ? theme.colors.warningBg
                                      : '#E2E8F0',
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.availabilityPillText,
                                    {
                                      color: isAvailable
                                        ? theme.colors.success
                                        : isBusy
                                        ? theme.colors.warning
                                        : theme.colors.textSecondary,
                                    },
                                  ]}
                                >
                                  {isAvailable ? 'Available' : isBusy ? 'In Class' : 'Cabin'}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {/* Clean Scannable Room List */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionLabel, { color: theme.colors.textPrimary }]}>
                    Rooms on this Floor
                  </Text>
                  <Text style={[styles.sectionCountText, { color: theme.colors.textMuted }]}>
                    {filteredRooms.length} {filteredRooms.length === 1 ? 'Room' : 'Rooms'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.roomSearchBox,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: theme.colors.borderSubtle,
                    },
                  ]}
                >
                  <Ionicons name="search-outline" size={16} color={theme.colors.textMuted} />
                  <TextInput
                    style={[styles.roomSearchInput, { color: theme.colors.textPrimary }]}
                    value={roomFilter}
                    onChangeText={setRoomFilter}
                    placeholder="Filter rooms by code, name, or type..."
                    placeholderTextColor={theme.colors.textMuted}
                  />
                  {roomFilter.length > 0 && (
                    <TouchableOpacity onPress={() => setRoomFilter('')}>
                      <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {filteredRooms.length === 0 ? (
                  <Text style={[styles.noRoomsText, { color: theme.colors.textMuted }]}>
                    No rooms match your filter on this floor.
                  </Text>
                ) : (
                  <View
                    style={[
                      styles.roomsListContainer,
                      {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.borderSubtle,
                      },
                      theme.shadows.card,
                    ]}
                  >
                    {filteredRooms.map((r, idx) => {
                      const active = selectedRoom?.room_id === r.room_id;
                      const isLast = idx === filteredRooms.length - 1;
                      return (
                        <TouchableOpacity
                          key={r.room_id}
                          activeOpacity={0.78}
                          style={[
                            styles.roomRow,
                            active && { backgroundColor: theme.colors.primarySoft },
                            !isLast && {
                              borderBottomWidth: StyleSheet.hairlineWidth,
                              borderBottomColor: theme.colors.divider,
                            },
                          ]}
                          onPress={() => handleSelectRoom(r)}
                        >
                          <View
                            style={[
                              styles.roomRowBadge,
                              {
                                backgroundColor: active
                                  ? theme.colors.primary
                                  : theme.colors.surfaceMuted,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.roomRowBadgeText,
                                { color: active ? '#FFFFFF' : theme.colors.primary },
                              ]}
                            >
                              {r.room_number}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[styles.roomRowName, { color: theme.colors.textPrimary }]}
                              numberOfLines={1}
                            >
                              {r.room_name}
                            </Text>
                            <Text style={[styles.roomRowSub, { color: theme.colors.textMuted }]}>
                              {r.room_type.replace(/_/g, ' ')}
                              {r.capacity ? ` • ${r.capacity} seats` : ''}
                            </Text>
                          </View>
                          <Ionicons
                            name={active ? 'checkmark-circle' : 'chevron-forward'}
                            size={18}
                            color={active ? theme.colors.primary : theme.colors.textMuted}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </>
          )}
        </KeyboardSafeScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    gap: 11,
    overflow: 'hidden',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleCol: {
    flex: 1,
  },
  breadcrumb: {
    fontSize: 11,
    fontWeight: '500',
  },
  buildingTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  routeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.full,
  },
  routeChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  metaBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  codeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  codeBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  metaBadgeText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  accessBadgeText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  buildingDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  loaderBox: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  loaderText: {
    fontSize: 12.5,
  },
  section: {
    gap: 9,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '500',
  },
  floorSelectorRow: {
    gap: 10,
    paddingVertical: 2,
  },
  floorTabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 148,
  },
  floorCodeBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floorCodeText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  floorTabTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  floorTabMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  planCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  planToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  planTitle: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zoomBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'center',
  },
  svgScrollContent: {
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 11,
    height: 11,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '500',
  },
  compactEmptyPlanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  emptyPlanTitle: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  emptyPlanSub: {
    fontSize: 12,
    marginTop: 1,
  },
  selectedRoomCard: {
    borderRadius: 16,
    padding: 15,
    borderWidth: 1.5,
  },
  selectedRoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  roomNumBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
  },
  roomNumBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  roomTypeBadge: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  selectedRoomTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  selectedRoomDesc: {
    fontSize: 12.5,
    marginTop: 3,
    lineHeight: 17,
  },
  roomMetaRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 6,
  },
  roomMetaItem: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  occupantsBox: {
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  occupantsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  occupantsLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  occupantsList: {
    gap: 7,
  },
  occupantCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  occupantAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  occupantAvatarText: {
    fontSize: 12,
    fontWeight: '700',
  },
  occupantName: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  occupantDesignation: {
    fontSize: 11.5,
    marginTop: 1,
  },
  availabilityPill: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 7,
  },
  availabilityPillText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  roomSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    height: 42,
    gap: 7,
  },
  roomSearchInput: {
    flex: 1,
    fontSize: 13.5,
    paddingVertical: 0,
  },
  noRoomsText: {
    fontSize: 12.5,
    paddingVertical: 8,
  },
  roomsListContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 11,
  },
  roomRowBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    minWidth: 66,
    alignItems: 'center',
  },
  roomRowBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  roomRowName: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  roomRowSub: {
    fontSize: 11.5,
    marginTop: 1,
  },
});
