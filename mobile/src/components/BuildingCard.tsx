import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Building } from '../types/campus';
import { Colors } from '../theme/colors';
import { Radius, Spacing } from '../theme/spacing';

interface BuildingCardProps {
  building: Building;
  onPress: () => void;
  onDirectionsPress?: () => void;
  selected?: boolean;
}

export const BuildingCard: React.FC<BuildingCardProps> = ({
  building,
  onPress,
  onDirectionsPress,
  selected = false,
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.card,
        selected && styles.cardSelected,
      ]}
    >
      <View style={styles.header}>
        <View style={styles.codeBadge}>
          <Text style={styles.codeText}>{building.building_code}</Text>
        </View>
        <Text style={styles.typeText}>{building.building_type.replace(/_/g, ' ')}</Text>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {building.building_name}
      </Text>

      {building.description ? (
        <Text style={styles.desc} numberOfLines={2}>
          {building.description}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.metaRow}>
          <Ionicons name="layers-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.metaText}>{building.total_floors} Floors</Text>
          {building.is_accessible && (
            <View style={styles.accessibleBadge}>
              <Ionicons name="accessibility" size={12} color={Colors.success} />
              <Text style={styles.accessibleText}>Accessible</Text>
            </View>
          )}
        </View>

        {onDirectionsPress && (
          <TouchableOpacity
            style={styles.directionsBtn}
            onPress={(e) => {
              e.stopPropagation();
              onDirectionsPress();
            }}
          >
            <Ionicons name="navigate" size={14} color={Colors.textInverse} />
            <Text style={styles.directionsText}>Directions</Text>
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  codeBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  codeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  typeText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  desc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginLeft: 4,
  },
  accessibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successBg,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
  },
  accessibleText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.success,
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
  },
  directionsText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textInverse,
  },
});
