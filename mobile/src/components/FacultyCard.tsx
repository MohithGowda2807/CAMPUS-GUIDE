import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FacultyMember } from '../types/campus';
import { Colors } from '../theme/colors';
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
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.topRow}>
        <View style={styles.infoCol}>
          <Text style={styles.name}>{faculty.display_name}</Text>
          <Text style={styles.designation}>{faculty.designation}</Text>
          <Text style={styles.dept}>{faculty.dept_name}</Text>
        </View>
        <StatusPill status={faculty.effective_availability} type="AVAILABILITY" />
      </View>

      <View style={styles.bottomRow}>
        <View style={styles.metaRow}>
          {faculty.leadership_role && (
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{faculty.leadership_role}</Text>
            </View>
          )}
          <Text style={styles.codeText}>ID: {faculty.employee_code}</Text>
        </View>

        {onLocateOffice && (
          <TouchableOpacity style={styles.locateBtn} onPress={onLocateOffice}>
            <Ionicons name="location-sharp" size={13} color={Colors.primary} />
            <Text style={styles.locateText}>Locate Office</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.xs,
  },
  infoCol: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  designation: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 2,
  },
  dept: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  codeText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  locateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.md,
  },
  locateText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
});
