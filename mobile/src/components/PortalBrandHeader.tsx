import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../theme/colors';
import { Radius, Spacing } from '../theme/spacing';

interface PortalBrandHeaderProps {
  title: string;
  subtitle: string;
  badgeText?: string;
  showBack?: boolean;
  showPublicMapAction?: boolean;
}

export const PortalBrandHeader: React.FC<PortalBrandHeaderProps> = ({
  title,
  subtitle,
  badgeText = 'Authorised RVCE Faculty & Staff Only',
  showBack = false,
  showPublicMapAction = true,
}) => {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.topActionRow}>
        {showBack ? (
          <TouchableOpacity
            style={styles.navPill}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={16} color={Colors.primary} />
            <Text style={styles.navPillText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}

        {showPublicMapAction ? (
          <TouchableOpacity
            style={styles.publicMapPill}
            onPress={() => router.replace('/(tabs)/map')}
            accessibilityRole="button"
            accessibilityLabel="Return to public campus map without signing in"
          >
            <Ionicons name="compass-outline" size={15} color={Colors.primary} />
            <Text style={styles.publicMapPillText}>Public Campus Map</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.brandRow}>
        <View style={styles.logoFrame}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImg}
            contentFit="contain"
          />
        </View>
        <View style={styles.brandMeta}>
          <Text style={styles.institutionLabel}>R. V. COLLEGE OF ENGINEERING</Text>
          <View style={styles.exclusiveBadge}>
            <Ionicons name="shield-checkmark" size={12} color={Colors.primary} />
            <Text style={styles.exclusiveBadgeText}>{badgeText}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  topActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  navPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  navPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  publicMapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight,
  },
  publicMapPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  logoFrame: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImg: {
    width: 40,
    height: 40,
  },
  brandMeta: {
    flex: 1,
  },
  institutionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  exclusiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
    borderRadius: Radius.full,
  },
  exclusiveBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
});
