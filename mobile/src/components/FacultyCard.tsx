import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FacultyMember } from '../types/campus';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing } from '../theme/spacing';
import { StatusPill } from './StatusPill';

interface FacultyCardProps {
  faculty: FacultyMember;
  onPress?: () => void;
  onLocateOffice?: () => void;
}

export const FacultyCard: React.FC<FacultyCardProps> = ({
  faculty,
  onPress,
  onLocateOffice,
}) => {
  const { theme } = useTheme();
  const hasMappedCabin = Boolean(faculty.office_room_id && faculty.floor_id);
  const initials = faculty.display_name
    .replace(/^(Dr\.|Mr\.|Ms\.|Prof\.)\s*/i, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.borderSubtle,
        },
        theme.shadows.card,
      ]}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.topRow}>
        <View style={[styles.avatarCircle, { backgroundColor: theme.colors.primarySoft }]}>
          <Text style={[styles.avatarText, { color: theme.colors.primary }]}>
            {initials || 'RV'}
          </Text>
        </View>

        <View style={styles.infoCol}>
          <View style={styles.nameHeaderRow}>
            <Text style={[styles.name, { color: theme.colors.textPrimary }]} numberOfLines={1}>
              {faculty.display_name}
            </Text>
            <View style={[styles.deptBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
              <Text style={[styles.deptBadgeText, { color: theme.colors.primary }]}>
                {faculty.dept_code}
              </Text>
            </View>
          </View>

          <Text
            style={[styles.designation, { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {faculty.designation}
            {faculty.program_name && faculty.program_name.includes('Kannada')
              ? ' • Kannada Faculty'
              : ''}
          </Text>

          <Text style={[styles.dept, { color: theme.colors.textMuted }]} numberOfLines={1}>
            {faculty.building_name || faculty.dept_name}
            {faculty.floor_name ? ` • ${faculty.floor_name}` : ''}
          </Text>
        </View>

        <StatusPill status={faculty.effective_availability} type="AVAILABILITY" />
      </View>

      {(faculty.office_room_number || faculty.leadership_role || onLocateOffice) && (
        <View style={[styles.bottomRow, { borderTopColor: theme.colors.divider }]}>
          <View style={styles.metaRow}>
            {faculty.leadership_role && (
              <View style={[styles.roleBadge, { backgroundColor: theme.colors.primarySoft }]}>
                <Text style={[styles.roleText, { color: theme.colors.primary }]}>
                  {faculty.leadership_role}
                </Text>
              </View>
            )}
            {faculty.office_room_number ? (
              <View style={styles.cabinTag}>
                <Ionicons name="layers-outline" size={12} color="#B45309" />
                <Text style={styles.cabinTagText}>Cabin {faculty.office_room_number}</Text>
              </View>
            ) : (
              <Text style={[styles.locationHint, { color: theme.colors.textMuted }]}>
                {faculty.dept_code} Department
              </Text>
            )}
          </View>

          {onLocateOffice && (
            <TouchableOpacity
              activeOpacity={0.82}
              style={[
                styles.locateBtn,
                {
                  backgroundColor: hasMappedCabin
                    ? theme.colors.primary
                    : theme.colors.primarySoft,
                },
              ]}
              onPress={onLocateOffice}
            >
              <Ionicons
                name={hasMappedCabin ? 'layers-outline' : 'location-outline'}
                size={13}
                color={hasMappedCabin ? '#FFFFFF' : theme.colors.primary}
              />
              <Text
                style={[
                  styles.locateText,
                  { color: hasMappedCabin ? '#FFFFFF' : theme.colors.primary },
                ]}
              >
                {hasMappedCabin && faculty.office_room_number
                  ? `Open ${faculty.office_room_number}`
                  : 'View on Map'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  infoCol: {
    flex: 1,
    marginRight: 10,
  },
  nameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  deptBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  deptBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  designation: {
    fontSize: 12.5,
    fontWeight: '500',
    marginBottom: 2,
  },
  dept: {
    fontSize: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 11,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cabinTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  cabinTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400E',
  },
  locationHint: {
    fontSize: 11.5,
  },
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
  },
  locateText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
});
