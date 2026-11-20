import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCampusData } from '../../src/context/CampusDataContext';
import { SearchBar } from '../../src/components/SearchBar';
import { StatusPill } from '../../src/components/StatusPill';
import { Colors } from '../../src/theme/colors';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function HomeScreen() {
  const router = useRouter();
  const { buildings, connectionState, selectBuilding } = useCampusData();
  const [searchVal, setSearchVal] = useState('');

  // 4 Featured campus landmarks
  const featured = buildings.slice(0, 4);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Official Institutional Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View>
              <Text style={styles.brandName}>RVCE Campus Navigator</Text>
              <Text style={styles.brandSubtitle}>R. V. College of Engineering®</Text>
            </View>
          </View>

          {/* Connection status pill */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.push('/modal/server-settings')}
          >
            <StatusPill status={connectionState} type="CONNECTION" />
          </TouchableOpacity>
        </View>

        {/* 2. Hero Search Bar (Swiggy / Maps Style) */}
        <View style={styles.searchSection}>
          <SearchBar
            value={searchVal}
            onChangeText={setSearchVal}
            placeholder="Search 28 buildings, 339 faculty, labs..."
            onPress={() => router.push('/(tabs)/map')}
            editable={false}
          />
        </View>

        {/* 3. Hero Campus Map Exploration Card */}
        <TouchableOpacity
          activeOpacity={0.92}
          style={styles.heroMapCard}
          onPress={() => router.push('/(tabs)/map')}
        >
          <View style={styles.heroMapHeader}>
            <View>
              <View style={styles.badgeRow}>
                <Ionicons name="compass" size={13} color={Colors.accentBlue} />
                <Text style={styles.badgeText}>Verified OpenStreetMap Campus GIS</Text>
              </View>
              <Text style={styles.heroTitle}>Navigate RVCE Campus</Text>
              <Text style={styles.heroDesc}>
                Mysuru Road Entrance, Academic Blocks, Food Courts & Hostels
              </Text>
            </View>
          </View>

          <View style={styles.heroCtaRow}>
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.heroPill}
              onPress={() => router.push('/(tabs)/map?directions=1')}
            >
              <Ionicons name="navigate" size={14} color="#059669" />
              <Text style={styles.heroPillText}>Route A → B</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.heroPill}
              onPress={() => router.push('/(tabs)/map?directions=1')}
            >
              <Ionicons name="walk" size={15} color={Colors.primary} />
              <Text style={styles.heroPillText}>Walking / Road</Text>
            </TouchableOpacity>
            <View style={styles.openMapBtn}>
              <Text style={styles.openMapText}>Explore</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.textInverse} />
            </View>
          </View>
        </TouchableOpacity>

        {/* 4. Quick Category Pills */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Campus Quick Services</Text>
        </View>
        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/directory')}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#EEF2FF' }]}>
              <Ionicons name="people" size={22} color="#4F46E5" />
            </View>
            <Text style={styles.quickCardTitle}>Faculty</Text>
            <Text style={styles.quickCardSub}>339 Profiles</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/services')}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="restaurant" size={22} color="#16A34A" />
            </View>
            <Text style={styles.quickCardTitle}>Cafeterias</Text>
            <Text style={styles.quickCardSub}>Food Courts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/services?tab=VISITOR_PASS')}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="shield-checkmark" size={22} color="#D97706" />
            </View>
            <Text style={styles.quickCardTitle}>Visitor Pass</Text>
            <Text style={styles.quickCardSub}>Gate Entry</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/services')}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#FEE2E2' }]}>
              <Ionicons name="medkit" size={22} color="#DC2626" />
            </View>
            <Text style={styles.quickCardTitle}>Clinic</Text>
            <Text style={styles.quickCardSub}>24x7 First Aid</Text>
          </TouchableOpacity>
        </View>

        {/* 5. Key Verified Destinations */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Key Campus Destinations</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/map')}>
            <Text style={styles.viewAllText}>View on Map</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.landmarksList}>
          {featured.map((b) => (
            <TouchableOpacity
              key={`feat-${b.building_id}`}
              style={styles.landmarkCard}
              activeOpacity={0.85}
              onPress={() => {
                selectBuilding(b);
                router.push('/(tabs)/map');
              }}
            >
              <View style={styles.landmarkIcon}>
                <Ionicons name="business" size={20} color={Colors.primary} />
              </View>
              <View style={styles.landmarkBody}>
                <Text style={styles.landmarkName} numberOfLines={1}>
                  {b.building_name}
                </Text>
                <Text style={styles.landmarkDesc} numberOfLines={1}>
                  {b.building_code} • {b.total_floors} Floors
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  searchSection: {
    marginVertical: Spacing.sm,
  },
  heroMapCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    marginVertical: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  heroMapHeader: {
    marginBottom: Spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accentBlue,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.primary,
    marginBottom: 4,
    letterSpacing: -0.4,
  },
  heroDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  heroCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.cardSecondary,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.md,
  },
  heroPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primary,
  },
  openMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: Radius.full,
  },
  openMapText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  quickCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  quickCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  quickCardSub: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  landmarksList: {
    gap: Spacing.xs,
  },
  landmarkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  landmarkIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  landmarkBody: {
    flex: 1,
  },
  landmarkName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  landmarkDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
