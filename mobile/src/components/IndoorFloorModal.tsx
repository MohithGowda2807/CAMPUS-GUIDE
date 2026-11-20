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
import Svg, { Rect, G, Circle, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { campusApi } from '../services/api';
import { Colors } from '../theme/colors';
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
  FACULTY_OFFICE: '#FFF7ED', // Warm amber highlight for faculty cabins
  HOD_CABIN: '#FEF3C7',      // Golden amber for HoD cabin
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
  }, [visible, building]);

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
        r.room_type.toLowerCase().includes(q)
    );
  }, [floorPlan, roomFilter]);

  if (!building) return null;

  const canvasW =
    floorPlan?.overlay?.canvas.width ?? floorPlan?.floor_plan?.canvas_width ?? 1000;
  const canvasH =
    floorPlan?.overlay?.canvas.height ?? floorPlan?.floor_plan?.canvas_height ?? 650;
  const isSchematic = Boolean(
    floorPlan?.floor_plan?.is_schematic_sample || floorPlan?.overlay?.is_schematic_sample
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Top Bar with Breadcrumb Context */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}
            accessibilityLabel="Back to outdoor campus map"
          >
            <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.topTitleCol}>
            <Text style={styles.breadcrumb}>
              RVCE Campus • {building.building_code}
            </Text>
            <Text style={styles.buildingTitle} numberOfLines={1}>
              {building.building_name}
            </Text>
          </View>
          {onNavigateToBuilding && (
            <TouchableOpacity
              style={styles.routeChip}
              onPress={() => {
                onClose();
                onNavigateToBuilding(building);
              }}
            >
              <Ionicons name="navigate" size={14} color="#FFFFFF" />
              <Text style={styles.routeChipText}>Route</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Building Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.metaBadgesRow}>
              <View style={styles.codeBadge}>
                <Text style={styles.codeBadgeText}>{building.building_code}</Text>
              </View>
              <View style={styles.metaBadge}>
                <Ionicons name="layers-outline" size={12} color={Colors.textSecondary} />
                <Text style={styles.metaBadgeText}>{building.total_floors} Floors</Text>
              </View>
              {building.is_accessible && (
                <View style={styles.accessBadge}>
                  <Ionicons name="accessibility-outline" size={12} color={Colors.success} />
                  <Text style={styles.accessBadgeText}>Accessible</Text>
                </View>
              )}
            </View>
            {building.description ? (
              <Text style={styles.buildingDesc}>{building.description}</Text>
            ) : null}
          </View>

          {loadingBuilding ? (
            <View style={styles.loaderBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loaderText}>Loading building floors & spaces…</Text>
            </View>
          ) : (
            <>
              {/* Floor Selector Chips */}
              {detail && detail.floors.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Select Floor</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.floorChipsRow}
                  >
                    {detail.floors.map((fl) => {
                      const active = selectedFloor?.floor_id === fl.floor_id;
                      return (
                        <TouchableOpacity
                          key={fl.floor_id}
                          style={[styles.floorChip, active && styles.floorChipActive]}
                          onPress={() => setSelectedFloor(fl)}
                        >
                          <Text
                            style={[
                              styles.floorChipText,
                              active && styles.floorChipTextActive,
                            ]}
                          >
                            {fl.floor_name}
                          </Text>
                          {fl.has_lift_access && (
                            <Ionicons
                              name="swap-vertical"
                              size={12}
                              color={active ? '#FFFFFF' : Colors.textMuted}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Schematic Sample Governance Banner */}
              {isSchematic && (
                <View style={styles.schematicBanner}>
                  <Ionicons name="information-circle" size={17} color={Colors.warning} />
                  <Text style={styles.schematicText}>
                    <Text style={{ fontWeight: '800' }}>Schematic Floor Layout (Sample Data): </Text>
                    Local indoor room coordinates are illustrative schematics pending departmental CAD approval.
                  </Text>
                </View>
              )}

              {/* Interactive SVG Floor Plan Viewer */}
              {loadingFloor ? (
                <View style={styles.loaderBox}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.loaderText}>Loading indoor floor plan…</Text>
                </View>
              ) : floorPlan?.overlay ? (
                <View style={styles.planCard}>
                  <View style={styles.planToolbar}>
                    <Text style={styles.planTitle}>
                      {floorPlan.floor.floor_name} Interactive Plan
                    </Text>
                    <View style={styles.zoomControls}>
                      <TouchableOpacity
                        style={styles.zoomBtn}
                        onPress={() => setZoom((z) => Math.max(0.8, +(z - 0.25).toFixed(2)))}
                        accessibilityLabel="Zoom out indoor plan"
                      >
                        <Ionicons name="remove" size={16} color={Colors.textPrimary} />
                      </TouchableOpacity>
                      <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
                      <TouchableOpacity
                        style={styles.zoomBtn}
                        onPress={() => setZoom((z) => Math.min(2.0, +(z + 0.25).toFixed(2)))}
                        accessibilityLabel="Zoom in indoor plan"
                      >
                        <Ionicons name="add" size={16} color={Colors.textPrimary} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.zoomBtn} onPress={() => setZoom(1)}>
                        <Ionicons name="refresh" size={14} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator
                    contentContainerStyle={styles.svgScrollContent}
                  >
                    <Svg
                      width={Math.round(330 * zoom)}
                      height={Math.round(215 * zoom)}
                      viewBox={`0 0 ${canvasW} ${canvasH}`}
                    >
                      {/* Building Slab */}
                      <Rect
                        x={50}
                        y={55}
                        width={canvasW - 100}
                        height={canvasH - 110}
                        rx={8}
                        fill="#FFFFFF"
                        stroke="#64748B"
                        strokeWidth={3}
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
                            <Rect
                              x={poly.bounds.x}
                              y={poly.bounds.y}
                              width={poly.bounds.w}
                              height={poly.bounds.h}
                              rx={6}
                              fill={fill}
                              stroke={isSelected ? '#1E3666' : '#94A3B8'}
                              strokeWidth={isSelected ? 4 : 2}
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
                </View>
              ) : (
                <View style={styles.emptyPlanBox}>
                  <Ionicons name="map-outline" size={28} color={Colors.textMuted} />
                  <Text style={styles.emptyPlanTitle}>No Vector Plan Published Yet</Text>
                  <Text style={styles.emptyPlanSub}>
                    Browse the verified room directory below for this floor.
                  </Text>
                </View>
              )}

              {/* Selected Room Detail Highlight */}
              {selectedRoom && (
                <View style={styles.selectedRoomCard}>
                  <View style={styles.selectedRoomHeader}>
                    <View style={styles.roomNumBadge}>
                      <Text style={styles.roomNumBadgeText}>{selectedRoom.room_number}</Text>
                    </View>
                    <Text style={styles.roomTypeBadge}>
                      {selectedRoom.room_type.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <Text style={styles.selectedRoomTitle}>{selectedRoom.room_name}</Text>
                  {selectedRoom.description ? (
                    <Text style={styles.selectedRoomDesc}>{selectedRoom.description}</Text>
                  ) : null}
                  <View style={styles.roomMetaRow}>
                    {selectedRoom.capacity ? (
                      <Text style={styles.roomMetaItem}>Capacity: {selectedRoom.capacity}</Text>
                    ) : null}
                    <Text style={styles.roomMetaItem}>
                      {selectedRoom.is_accessible ? 'Step-Free Access' : 'Stair Access'}
                    </Text>
                  </View>
                  {roomOccupants.length > 0 && (
                    <View style={styles.occupantsBox}>
                      <Text style={styles.occupantsLabel}>Assigned Faculty:</Text>
                      {roomOccupants.map((occ) => (
                        <Text key={occ.staff_id} style={styles.occupantRow}>
                          • {occ.display_name} ({occ.designation})
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Searchable Room List (Accessible Fallback to Small SVG Targets) */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Floor Rooms ({filteredRooms.length})
                </Text>
                <View style={styles.roomSearchBox}>
                  <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.roomSearchInput}
                    value={roomFilter}
                    onChangeText={setRoomFilter}
                    placeholder="Filter rooms by number, lab or hall name..."
                    placeholderTextColor={Colors.textMuted}
                  />
                  {roomFilter.length > 0 && (
                    <TouchableOpacity onPress={() => setRoomFilter('')}>
                      <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {filteredRooms.length === 0 ? (
                  <Text style={styles.noRoomsText}>
                    No rooms match your filter on this floor.
                  </Text>
                ) : (
                  <View style={{ gap: 8 }}>
                    {filteredRooms.map((r) => {
                      const active = selectedRoom?.room_id === r.room_id;
                      return (
                        <TouchableOpacity
                          key={r.room_id}
                          style={[styles.roomRow, active && styles.roomRowActive]}
                          onPress={() => handleSelectRoom(r)}
                        >
                          <View style={styles.roomRowBadge}>
                            <Text style={styles.roomRowBadgeText}>{r.room_number}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.roomRowName}>{r.room_name}</Text>
                            <Text style={styles.roomRowSub}>
                              {r.room_type.replace(/_/g, ' ')}
                              {r.capacity ? ` • ${r.capacity} seats` : ''}
                            </Text>
                          </View>
                          <Ionicons
                            name={active ? 'radio-button-on' : 'chevron-forward'}
                            size={17}
                            color={active ? Colors.primary : Colors.textMuted}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleCol: {
    flex: 1,
  },
  breadcrumb: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
  },
  buildingTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  routeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  routeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: 36,
    gap: Spacing.md,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metaBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  codeBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  codeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.primary,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  metaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.successBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  accessBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.success,
  },
  buildingDesc: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  loaderBox: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  loaderText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  floorChipsRow: {
    gap: 8,
  },
  floorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  floorChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  floorChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  floorChipTextActive: {
    color: '#FFFFFF',
  },
  schematicBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  schematicText: {
    flex: 1,
    fontSize: 11,
    color: '#92400E',
    lineHeight: 16,
  },
  planCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  planToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.cardSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  planTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  zoomBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    minWidth: 36,
    textAlign: 'center',
  },
  svgScrollContent: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPlanBox: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyPlanTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 6,
  },
  emptyPlanSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  selectedRoomCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  selectedRoomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roomNumBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  roomNumBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  roomTypeBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  selectedRoomTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  selectedRoomDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  roomMetaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  roomMetaItem: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  occupantsBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderStrong,
  },
  occupantsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 2,
  },
  occupantRow: {
    fontSize: 11.5,
    color: Colors.textPrimary,
  },
  roomSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  roomSearchInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    paddingVertical: 0,
  },
  noRoomsText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  roomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    padding: 11,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  roomRowActive: {
    borderColor: Colors.primary,
    backgroundColor: '#F8FAFC',
  },
  roomRowBadge: {
    backgroundColor: Colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.sm,
  },
  roomRowBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.primary,
  },
  roomRowName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  roomRowSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
