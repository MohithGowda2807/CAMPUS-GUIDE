import React, { useState, useMemo } from 'react';
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
import * as Haptics from 'expo-haptics';
import { useCampusData } from '../../src/context/CampusDataContext';
import { useTheme } from '../../src/context/ThemeContext';
import { SearchBar } from '../../src/components/SearchBar';
import { AdaptiveSurface } from '../../src/components/AdaptiveSurface';
import { SmartLabShowcaseModal } from '../../src/components/SmartLabShowcaseModal';
import { Radius, Spacing } from '../../src/theme/spacing';

export default function HomeScreen() {
  const router = useRouter();
  const { buildings, connectionState, selectBuilding } = useCampusData();
  const { isGlass, theme, toggleAppearanceMode } = useTheme();
  const [searchVal, setSearchVal] = useState('');
  const [assistantVisible, setAssistantVisible] = useState(false);

  const greetingText = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good morning';
    if (hr < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const jumpToCabin = (params: {
    buildingId: number;
    floorId?: number | null;
    roomId?: number | null;
  }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setAssistantVisible(false);
    const b = buildings.find((x) => x.building_id === params.buildingId);
    if (b) selectBuilding(b);
    router.push({
      pathname: '/(tabs)/map',
      params: {
        buildingId: String(params.buildingId),
        ...(params.floorId ? { floorId: String(params.floorId) } : {}),
        ...(params.roomId ? { roomId: String(params.roomId) } : {}),
      },
    });
  };

  // Curated key campus destinations (recently / commonly explored)
  const keyDestinations = useMemo(() => {
    const eee = buildings.find((b) => b.building_id === 7);
    const others = buildings.filter((b) => b.building_id !== 7).slice(0, 3);
    return eee ? [eee, ...others] : buildings.slice(0, 4);
  }, [buildings]);

  const isLive = connectionState === 'ONLINE';

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.colors.canvas }]}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Calm Institutional Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View>
              <Text style={[styles.greetingContext, { color: theme.colors.textMuted }]}>
                {greetingText} • RVCE Campus
              </Text>
              <Text style={[styles.brandName, { color: theme.colors.textPrimary }]}>
                Campus Navigator
              </Text>
            </View>
          </View>

          <View style={styles.headerRightActions}>
            {/* Subtle Appearance Mode Toggle Pill */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                toggleAppearanceMode();
              }}
              style={[
                styles.modePill,
                {
                  backgroundColor: isGlass
                    ? 'rgba(255, 255, 255, 0.78)'
                    : theme.colors.surface,
                  borderColor: theme.colors.borderSubtle,
                },
              ]}
            >
              <Ionicons
                name={isGlass ? 'sparkles' : 'sunny-outline'}
                size={13}
                color={theme.colors.primary}
              />
              <Text style={[styles.modePillText, { color: theme.colors.primary }]}>
                {isGlass ? 'Glass' : 'Clean'}
              </Text>
            </TouchableOpacity>

            {/* Unobtrusive Connection Status Indicator */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => router.push('/modal/server-settings')}
              style={[
                styles.connectionBadge,
                {
                  backgroundColor: isLive ? theme.colors.successBg : theme.colors.surfaceMuted,
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isLive ? '#16A34A' : '#64748B' },
                ]}
              />
              <Text
                style={[
                  styles.connectionText,
                  { color: isLive ? theme.colors.success : theme.colors.textSecondary },
                ]}
              >
                {isLive ? 'Live' : 'Offline'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. Primary Search Bar */}
        <View style={styles.searchSection}>
          <SearchBar
            value={searchVal}
            onChangeText={setSearchVal}
            placeholder="Search buildings, faculty, cabins, labs..."
            onPress={() => router.push('/(tabs)/map')}
            editable={false}
          />
        </View>

        {/* 3. Campus Exploration Hero with Custom Isometric PNG */}
        <AdaptiveSurface
          variant={isGlass ? 'floating' : 'card'}
          style={styles.heroCard}
        >
          <TouchableOpacity
            activeOpacity={0.94}
            onPress={() => router.push('/(tabs)/map')}
          >
            <View style={styles.heroImageContainer}>
              <Image
                source={require('../../assets/campus-hero.png')}
                style={styles.heroIllustration}
                resizeMode="cover"
              />
              <View style={styles.heroOverlayTag}>
                <Ionicons name="compass" size={13} color={theme.colors.primary} />
                <Text style={[styles.heroOverlayTagText, { color: theme.colors.primary }]}>
                  Interactive Campus Map
                </Text>
              </View>
            </View>

            <View style={styles.heroContentBody}>
              <View style={styles.heroTextCol}>
                <Text style={[styles.heroTitle, { color: theme.colors.textPrimary }]}>
                  Explore RVCE Campus
                </Text>
                <Text style={[styles.heroSubtitle, { color: theme.colors.textSecondary }]}>
                  Navigate academic blocks, paths, food courts, and multi-floor indoor maps.
                </Text>
              </View>

              <View style={styles.heroActionsRow}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  style={[styles.primaryCtaBtn, { backgroundColor: theme.colors.primary }]}
                  onPress={() => router.push('/(tabs)/map')}
                >
                  <Text style={styles.primaryCtaText}>Explore Campus</Text>
                  <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[
                    styles.secondaryActionBtn,
                    {
                      backgroundColor: theme.colors.primarySoft,
                    },
                  ]}
                  onPress={() => router.push('/(tabs)/map?directions=1')}
                >
                  <Ionicons name="navigate-outline" size={15} color={theme.colors.primary} />
                  <Text style={[styles.secondaryActionText, { color: theme.colors.primary }]}>
                    Directions
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </AdaptiveSurface>

        {/* 4. Compact Quick Services */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
            Quick Services
          </Text>
        </View>

        <View style={styles.quickGrid}>
          {[
            {
              key: 'faculty',
              title: 'Faculty',
              icon: 'people-outline' as const,
              tint: '#27447E',
              bg: '#EDF2FC',
              onPress: () => router.push('/(tabs)/directory'),
            },
            {
              key: 'cafeterias',
              title: 'Cafeterias',
              icon: 'restaurant-outline' as const,
              tint: '#15803D',
              bg: '#DCFCE7',
              onPress: () => router.push('/(tabs)/services'),
            },
            {
              key: 'visitor',
              title: 'Visitor Pass',
              icon: 'id-card-outline' as const,
              tint: '#B45309',
              bg: '#FEF3C7',
              onPress: () => router.push('/(tabs)/services?tab=VISITOR_PASS'),
            },
            {
              key: 'clinic',
              title: '24x7 Clinic',
              icon: 'medkit-outline' as const,
              tint: '#B91C1C',
              bg: '#FEE2E2',
              onPress: () => router.push('/(tabs)/services'),
            },
          ].map((item) => (
            <TouchableOpacity
              key={item.key}
              activeOpacity={0.82}
              onPress={item.onPress}
              style={[
                styles.quickTile,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.borderSubtle,
                },
                theme.shadows.card,
              ]}
            >
              <View style={[styles.quickIconCircle, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={20} color={item.tint} />
              </View>
              <Text
                style={[styles.quickTileLabel, { color: theme.colors.textPrimary }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 5. Progressive Disclosure: Indoor Navigation & Campus Assistant */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
            Indoor & Smart Assistance
          </Text>
        </View>

        <View style={styles.featureCardsStack}>
          {/* Clean Indoor Navigation Entry Point (replaces crowded raw cabin chip dump) */}
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => jumpToCabin({ buildingId: 7, floorId: 18 })}
          >
            <AdaptiveSurface variant="card" style={styles.cleanEntryCard}>
              <View style={[styles.entryIconBox, { backgroundColor: theme.colors.primarySoft }]}>
                <Ionicons name="layers-outline" size={22} color={theme.colors.primary} />
              </View>
              <View style={styles.entryBody}>
                <View style={styles.entryTitleRow}>
                  <Text style={[styles.entryTitle, { color: theme.colors.textPrimary }]}>
                    Indoor Navigation
                  </Text>
                  <View style={[styles.pillTag, { backgroundColor: theme.colors.successBg }]}>
                    <Text style={[styles.pillTagText, { color: theme.colors.success }]}>
                      GF • 1F • 2F
                    </Text>
                  </View>
                </View>
                <Text style={[styles.entrySubtitle, { color: theme.colors.textSecondary }]}>
                  Find rooms, faculty cabins, and laboratories inside campus buildings
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </AdaptiveSurface>
          </TouchableOpacity>

          {/* Clean Conversational Campus Assistant Entry Point */}
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setAssistantVisible(true);
            }}
          >
            <AdaptiveSurface variant="card" style={styles.cleanEntryCard}>
              <View style={[styles.entryIconBox, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={22} color="#2563EB" />
              </View>
              <View style={styles.entryBody}>
                <View style={styles.entryTitleRow}>
                  <Text style={[styles.entryTitle, { color: theme.colors.textPrimary }]}>
                    Campus Assistant
                  </Text>
                  <View style={[styles.pillTag, { backgroundColor: '#DBEAFE' }]}>
                    <Text style={[styles.pillTagText, { color: '#1D4ED8' }]}>Ask</Text>
                  </View>
                </View>
                <Text style={[styles.entrySubtitle, { color: theme.colors.textSecondary }]}>
                  Ask where any professor sits, check cabin rosters, or get walking routes
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
            </AdaptiveSurface>
          </TouchableOpacity>
        </View>

        {/* 6. Key Campus Landmarks / Recently Explored */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textPrimary }]}>
            Popular Destinations
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/map')}>
            <Text style={[styles.viewAllText, { color: theme.colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>

        <AdaptiveSurface variant="card" style={styles.destinationsGroupCard}>
          {keyDestinations.map((b, idx) => {
            const isEEE = b.building_id === 7;
            const isLast = idx === keyDestinations.length - 1;
            return (
              <TouchableOpacity
                key={`dest-${b.building_id}`}
                activeOpacity={0.78}
                style={[
                  styles.destinationRow,
                  !isLast && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.divider,
                  },
                ]}
                onPress={() => {
                  selectBuilding(b);
                  router.push({
                    pathname: '/(tabs)/map',
                    params: { buildingId: String(b.building_id) },
                  });
                }}
              >
                <View
                  style={[
                    styles.destinationIconWrap,
                    { backgroundColor: theme.colors.surfaceMuted },
                  ]}
                >
                  <Ionicons
                    name={isEEE ? 'layers-outline' : 'business-outline'}
                    size={18}
                    color={theme.colors.primary}
                  />
                </View>
                <View style={styles.destinationInfo}>
                  <Text
                    style={[styles.destinationName, { color: theme.colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {b.building_name}
                  </Text>
                  <Text
                    style={[styles.destinationMeta, { color: theme.colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {b.building_code} • {b.total_floors}{' '}
                    {b.total_floors === 1 ? 'Floor' : 'Floors'}
                    {isEEE ? ' • Indoor Floor Maps Available' : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </AdaptiveSurface>
      </ScrollView>

      <SmartLabShowcaseModal
        visible={assistantVisible}
        onClose={() => setAssistantVisible(false)}
        onJumpToCabin={jumpToCabin}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 32,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 11,
  },
  greetingContext: {
    fontSize: 11.5,
    fontWeight: '500',
    marginBottom: 1,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  modePillText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  statusDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 4,
  },
  connectionText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  searchSection: {
    marginBottom: 18,
  },
  heroCard: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 6,
  },
  heroImageContainer: {
    width: '100%',
    height: 158,
    backgroundColor: '#EDF3FC',
    position: 'relative',
  },
  heroIllustration: {
    width: '100%',
    height: '100%',
  },
  heroOverlayTag: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  heroOverlayTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  heroContentBody: {
    padding: 16,
  },
  heroTextCol: {
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 13.5,
    lineHeight: 19,
  },
  heroActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primaryCtaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 13,
  },
  primaryCtaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 44,
    paddingHorizontal: 15,
    borderRadius: 13,
  },
  secondaryActionText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 11,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickTile: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1,
  },
  quickIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickTileLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  featureCardsStack: {
    gap: 10,
  },
  cleanEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
  },
  entryIconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  entryBody: {
    flex: 1,
    marginRight: 8,
  },
  entryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  pillTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pillTagText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  entrySubtitle: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  destinationsGroupCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  destinationIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  destinationInfo: {
    flex: 1,
    marginRight: 8,
  },
  destinationName: {
    fontSize: 14.5,
    fontWeight: '600',
  },
  destinationMeta: {
    fontSize: 12,
    marginTop: 2,
  },
});
