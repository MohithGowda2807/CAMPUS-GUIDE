import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors } from '../../src/theme/colors';
import {
  getApiBaseUrl,
  setApiBaseUrl,
  campusApi,
  DEFAULT_MOBILE_API_URL,
} from '../../src/services/api';
import { useCampusData } from '../../src/context/CampusDataContext';

const PRESET_ENDPOINTS = [
  {
    title: 'Android Emulator Loopback',
    url: 'http://10.0.2.2:8000/api/v1',
    description: 'Special 10.0.2.2 loopback alias pointing to your PC host machine.',
  },
  {
    title: 'Local Wi-Fi (Physical Phone)',
    url: 'http://192.168.1.7:8000/api/v1',
    description: 'Current local Wi-Fi IP address for testing on physical Android devices.',
  },
  {
    title: 'Localhost (Direct)',
    url: 'http://127.0.0.1:8000/api/v1',
    description: 'Standard localhost interface (used if running reverse ADB proxies).',
  },
];

export default function ServerSettingsModal() {
  const router = useRouter();
  const { refreshData } = useCampusData();

  const [url, setUrl] = useState(getApiBaseUrl());
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    mysql: boolean;
    mongodb: boolean;
    detail?: string;
  } | null>(null);

  const handleTestConnection = async (testUrl = url) => {
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      // Temporarily set to test URL
      await setApiBaseUrl(testUrl);
      const res = await campusApi.getHealth();
      const elapsed = Math.round(performance.now() - start);
      setTestResult({
        success: res.healthy || res.mysql.connected || res.mongodb.connected,
        latencyMs: elapsed,
        mysql: res.mysql.connected,
        mongodb: res.mongodb.connected,
        detail: res.mysql.detail || res.mongodb.detail,
      });
    } catch (err: unknown) {
      const elapsed = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : 'Server unreachable';
      setTestResult({
        success: false,
        latencyMs: elapsed,
        mysql: false,
        mongodb: false,
        detail: msg,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setApiBaseUrl(url);
      await refreshData();
      Alert.alert('Configuration Saved', 'API endpoint updated successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save settings.';
      Alert.alert('Save Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = async () => {
    setUrl(DEFAULT_MOBILE_API_URL);
    await setApiBaseUrl(DEFAULT_MOBILE_API_URL);
    setTestResult(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header bar */}
      <View style={styles.navBar}>
        <Text style={styles.navTitle}>Server Settings</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionHeader}>API Server Endpoint</Text>
        <Text style={styles.sectionSub}>
          Configure the FastAPI backend server URL for data synchronization, live faculty statuses,
          and visitor passes.
        </Text>

        {/* URL Input */}
        <View style={styles.inputWrapper}>
          <Ionicons name="link-outline" size={20} color={Colors.primary} />
          <TextInput
            style={styles.textInput}
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.7:8000/api/v1"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {url ? (
            <TouchableOpacity onPress={() => setUrl('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Action Buttons: Test Connection & Reset */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.testBtn, testing && { opacity: 0.7 }]}
            onPress={() => handleTestConnection()}
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <>
                <Ionicons name="pulse-outline" size={16} color={Colors.primary} />
                <Text style={styles.testBtnText}>Test Latency & Health</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.resetBtn} onPress={handleResetDefault}>
            <Text style={styles.resetBtnText}>Reset</Text>
          </TouchableOpacity>
        </View>

        {/* Diagnostics Card if tested */}
        {testResult && (
          <View
            style={[
              styles.diagCard,
              {
                borderColor: testResult.success ? Colors.success : Colors.danger,
                backgroundColor: testResult.success ? '#F0FDF4' : '#FEF2F2',
              },
            ]}
          >
            <View style={styles.diagHeader}>
              <Ionicons
                name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                size={20}
                color={testResult.success ? Colors.success : Colors.danger}
              />
              <Text
                style={[
                  styles.diagTitle,
                  { color: testResult.success ? Colors.success : Colors.danger },
                ]}
              >
                {testResult.success ? 'Server Responding' : 'Connection Failed'}
              </Text>
              <Text style={styles.diagLatency}>{testResult.latencyMs} ms</Text>
            </View>

            <View style={styles.diagDetails}>
              <View style={styles.diagItem}>
                <Ionicons
                  name={testResult.mysql ? 'checkmark' : 'close'}
                  size={14}
                  color={testResult.mysql ? Colors.success : Colors.danger}
                />
                <Text style={styles.diagItemText}>
                  MySQL Relational DB: {testResult.mysql ? 'Connected' : 'Offline'}
                </Text>
              </View>

              <View style={styles.diagItem}>
                <Ionicons
                  name={testResult.mongodb ? 'checkmark' : 'close'}
                  size={14}
                  color={testResult.mongodb ? Colors.success : Colors.danger}
                />
                <Text style={styles.diagItemText}>
                  MongoDB GeoJSON DB: {testResult.mongodb ? 'Connected' : 'Offline'}
                </Text>
              </View>

              {testResult.detail && (
                <Text style={styles.diagDetailText}>{testResult.detail}</Text>
              )}
            </View>
          </View>
        )}

        {/* Quick Presets */}
        <Text style={[styles.sectionHeader, { marginTop: 24 }]}>Quick Presets</Text>
        <Text style={styles.sectionSub}>
          Select a predefined target based on how you are running the test device:
        </Text>

        <View style={styles.presetList}>
          {PRESET_ENDPOINTS.map((preset) => {
            const isSelected = url.trim() === preset.url;
            return (
              <TouchableOpacity
                key={preset.url}
                style={[styles.presetCard, isSelected && styles.presetCardSelected]}
                onPress={() => {
                  setUrl(preset.url);
                  handleTestConnection(preset.url);
                }}
              >
                <View style={styles.presetTop}>
                  <Text style={[styles.presetTitle, isSelected && { color: Colors.primary }]}>
                    {preset.title}
                  </Text>
                  {isSelected && (
                    <View style={styles.activeTag}>
                      <Text style={styles.activeTagText}>ACTIVE</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.presetUrl}>{preset.url}</Text>
                <Text style={styles.presetDesc}>{preset.description}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Offline Fallback Explanation */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.infoBoxText}>
            When the backend server cannot be reached, RVCE Campus Navigator automatically falls back
            to bundled offline GIS geometries, 28 building footprints, and offline Dijkstra routing.
          </Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={20} color="#FFFFFF" />
              <Text style={styles.saveBtnText}>Save & Apply Endpoint</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  navBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 17,
    marginBottom: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    gap: 8,
  },
  textInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 13,
    color: Colors.text,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  testBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#E8EDF5',
  },
  testBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  resetBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  resetBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  diagCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  diagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  diagTitle: {
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  diagLatency: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  diagDetails: {
    marginTop: 8,
    gap: 4,
  },
  diagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  diagItemText: {
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500',
  },
  diagDetailText: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  presetList: {
    gap: 10,
  },
  presetCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  presetCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
  },
  presetTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  presetTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  activeTag: {
    backgroundColor: '#E8EDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.primary,
  },
  presetUrl: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: Colors.primary,
    marginBottom: 4,
  },
  presetDesc: {
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 15,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    marginTop: 20,
  },
  infoBoxText: {
    flex: 1,
    fontSize: 11,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
