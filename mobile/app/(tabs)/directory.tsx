import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useCampusData } from '../../src/context/CampusDataContext';
import { useTheme } from '../../src/context/ThemeContext';
import { FacultyCard } from '../../src/components/FacultyCard';
import { SearchBar } from '../../src/components/SearchBar';
import { StatusPill } from '../../src/components/StatusPill';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';
import type { FacultyMember } from '../../src/types/campus';

export default function DirectoryScreen() {
  const router = useRouter();
  const { faculty, departments, buildings, selectBuilding } = useCampusData();
  const { isGlass, theme } = useTheme();

  const [search, setSearch] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [activeProfile, setActiveProfile] = useState<FacultyMember | null>(null);

  const filteredFaculty = useMemo(() => {
    return faculty.filter((f) => {
      const matchesDept = selectedDeptId === null || f.dept_id === selectedDeptId;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        f.display_name.toLowerCase().includes(q) ||
        f.employee_code.toLowerCase().includes(q) ||
        String(f.staff_id) === q ||
        f.dept_name.toLowerCase().includes(q) ||
        f.dept_code.toLowerCase().includes(q) ||
        f.designation.toLowerCase().includes(q) ||
        (f.office_room_number && f.office_room_number.toLowerCase().includes(q)) ||
        (f.office_room_name && f.office_room_name.toLowerCase().includes(q)) ||
        (f.program_name && f.program_name.toLowerCase().includes(q));
      return matchesDept && matchesSearch;
    });
  }, [faculty, search, selectedDeptId]);

  const handleLocateOffice = (f: FacultyMember) => {
    setActiveProfile(null);
    if (f.building_id) {
      const b = buildings.find((x) => x.building_id === f.building_id);
      if (b) {
        selectBuilding(b);
        if (f.floor_id && f.office_room_id) {
          router.push({
            pathname: '/(tabs)/map',
            params: {
              buildingId: String(f.building_id),
              floorId: String(f.floor_id),
              roomId: String(f.office_room_id),
            },
          });
        } else {
          router.push({
            pathname: '/(tabs)/map',
            params: { buildingId: String(f.building_id) },
          });
        }
      }
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
            borderBottomColor: theme.colors.borderSubtle,
          },
        ]}
      >
        {isGlass && <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />}
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          Faculty Directory
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          {faculty.length} RVCE Academic & Research Profiles
        </Text>

        <View style={styles.searchRow}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, cabin, or department..."
            onClear={() => setSearch('')}
          />
        </View>

        {/* Department Horizontal Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          <TouchableOpacity
            style={[styles.chip, selectedDeptId === null && styles.chipActive]}
            onPress={() => setSelectedDeptId(null)}
          >
            <Text
              style={[
                styles.chipText,
                selectedDeptId === null && styles.chipTextActive,
              ]}
            >
              All ({faculty.length})
            </Text>
          </TouchableOpacity>

          {departments
            .filter((d) => d.faculty_count > 0)
            .map((dept) => {
              const isSelected = selectedDeptId === dept.dept_id;
              return (
                <TouchableOpacity
                  key={`dept-${dept.dept_id}`}
                  style={[styles.chip, isSelected && styles.chipActive]}
                  onPress={() => setSelectedDeptId(isSelected ? null : dept.dept_id)}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                    {dept.dept_code} ({dept.faculty_count})
                  </Text>
                </TouchableOpacity>
              );
            })}
        </ScrollView>
      </View>

      {/* Virtualised Faculty List */}
      <FlatList
        data={filteredFaculty}
        keyExtractor={(item) => `staff-${item.staff_id}`}
        renderItem={({ item }) => (
          <FacultyCard
            faculty={item}
            onPress={() => setActiveProfile(item)}
            onLocateOffice={item.building_id ? () => handleLocateOffice(item) : undefined}
          />
        )}
        contentContainerStyle={styles.listContent}
        initialNumToRender={14}
        maxToRenderPerBatch={18}
        windowSize={9}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="search-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Faculty Profiles Found</Text>
            <Text style={styles.emptySub}>
              Try adjusting your search query or selecting another department.
            </Text>
          </View>
        }
      />

      {/* Approved Public Faculty Profile Modal */}
      <Modal
        visible={Boolean(activeProfile)}
        transparent
        animationType="slide"
        onRequestClose={() => setActiveProfile(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.profileSheet,
              isGlass && {
                backgroundColor: 'rgba(255, 255, 255, 0.88)',
                overflow: 'hidden',
              },
            ]}
          >
            {isGlass && <BlurView intensity={65} tint="light" style={StyleSheet.absoluteFill} />}
            <View style={styles.sheetDragPill} />

            {activeProfile && (
              <>
                <View style={styles.sheetTopRow}>
                  <View style={styles.avatarCircle}>
                    <Text style={styles.avatarText}>
                      {activeProfile.display_name
                        .replace(/^Dr\.\s*/i, '')
                        .slice(0, 2)
                        .toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.profileName}>{activeProfile.display_name}</Text>
                    <Text style={styles.profileDesig}>
                      {activeProfile.designation}
                      {activeProfile.qualification ? ` • ${activeProfile.qualification}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.closeModalBtn}
                    onPress={() => setActiveProfile(null)}
                  >
                    <Ionicons name="close" size={20} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.statusBanner}>
                  <Text style={styles.statusBannerLabel}>Office Availability:</Text>
                  <StatusPill
                    status={activeProfile.effective_availability}
                    type="AVAILABILITY"
                  />
                </View>

                {activeProfile.availability_note ? (
                  <Text style={styles.availNoteText}>
                    "{activeProfile.availability_note}"
                  </Text>
                ) : null}

                <View style={styles.detailGrid}>
                  <View style={styles.detailRow}>
                    <Ionicons name="school-outline" size={16} color={Colors.primary} />
                    <Text style={styles.detailText}>{activeProfile.dept_name}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Ionicons name="id-card-outline" size={16} color={Colors.primary} />
                    <Text style={styles.detailText}>
                      Employee ID: {activeProfile.employee_code}
                      {activeProfile.leadership_role
                        ? ` • ${activeProfile.leadership_role}`
                        : ''}
                    </Text>
                  </View>
                  {activeProfile.building_name ? (
                    <View style={styles.detailRow}>
                      <Ionicons name="business-outline" size={16} color={Colors.primary} />
                      <Text style={styles.detailText}>
                        {activeProfile.building_name}
                        {activeProfile.office_room_number
                          ? ` • Cabin ${activeProfile.office_room_number}`
                          : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {activeProfile.building_id ? (
                  <TouchableOpacity
                    style={styles.locateFullBtn}
                    onPress={() => handleLocateOffice(activeProfile)}
                  >
                    <Ionicons
                      name={activeProfile.office_room_id ? 'layers' : 'navigate'}
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={styles.locateFullBtnText}>
                      {activeProfile.office_room_number
                        ? `Open Cabin ${activeProfile.office_room_number} (${activeProfile.floor_name || 'Floor Plan'})`
                        : 'View Department Building on Map'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: Spacing.sm,
  },
  searchRow: {
    marginBottom: Spacing.sm,
  },
  filterScroll: {
    gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.textInverse,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },
  emptySub: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  profileSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    paddingBottom: 34,
  },
  sheetDragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  profileName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  profileDesig: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeModalBtn: {
    padding: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardSecondary,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusBannerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  availNoteText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: Colors.primary,
    marginTop: 8,
  },
  detailGrid: {
    gap: 10,
    marginTop: 14,
    marginBottom: 18,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  detailText: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  locateFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 13,
    borderRadius: Radius.md,
  },
  locateFullBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
