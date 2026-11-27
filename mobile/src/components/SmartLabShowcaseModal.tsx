import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { campusApi } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import type { AssistantCard } from '../services/campusRagEngine';
import { Colors } from '../theme/colors';
import { Radius, Spacing } from '../theme/spacing';

interface SmartLabShowcaseModalProps {
  visible: boolean;
  initialQuery?: string;
  onClose: () => void;
  onJumpToCabin: (params: {
    buildingId: number;
    floorId?: number | null;
    roomId?: number | null;
  }) => void;
}

interface ChatMessage {
  id: string;
  sender: 'USER' | 'ASSISTANT';
  text: string;
  cards?: AssistantCard[];
  suggestions?: string[];
  contextTopic?: string;
}

const STARTER_QUESTIONS = [
  'Where does Dr. Sushmita Sarkar sit?',
  'Who are the Kannada faculty in EEE?',
  'Where is Dr. C. Suresha & Counselling Room?',
  'How do I walk from Main Gate to ABB Micro Grid Lab?',
  'Who sits in EEE-115?',
  'Where can I eat lunch or get coffee?',
  'Where is the Medical & First-Aid Clinic?',
];

/**
 * Renders markdown bold (**text**) cleanly as native Text spans
 */
function FormattedAnswerText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <Text style={styles.assistantText}>
      {parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={idx} style={styles.assistantTextBold}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={idx}>{part}</Text>;
      })}
    </Text>
  );
}

export const SmartLabShowcaseModal: React.FC<SmartLabShowcaseModalProps> = ({
  visible,
  initialQuery,
  onClose,
  onJumpToCabin,
}) => {
  const { isGlass, theme } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-0',
      sender: 'ASSISTANT',
      text: 'Hello! I am your **RVCE Campus Assistant**. Ask me where any professor sits, who is in a cabin or lab, walking directions between any two places, or where to find cafeterias, ATMs, and clinics.',
      suggestions: STARTER_QUESTIONS.slice(0, 4),
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    });
    const s2 = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);

  useEffect(() => {
    if (visible && initialQuery && initialQuery.trim()) {
      handleSendQuery(initialQuery.trim());
    }
  }, [visible, initialQuery]);

  const handleSendQuery = async (rawText?: string) => {
    const q = (rawText ?? inputVal).trim();
    if (!q || loading) return;

    Haptics.selectionAsync().catch(() => {});
    if (!rawText) setInputVal('');
    Keyboard.dismiss();

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'USER',
      text: q,
    };

    const historyContext = messages
      .filter((m) => m.sender === 'ASSISTANT' && m.contextTopic)
      .map((m) => ({ context_topic: m.contextTopic }));

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    try {
      const res = await campusApi.askAssistant(q, historyContext);
      const botMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        sender: 'ASSISTANT',
        text: res.answer,
        cards: res.cards,
        suggestions: res.suggestions,
        contextTopic: res.context_topic,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'ASSISTANT',
          text: 'Sorry, I encountered an issue looking that up. Please try asking again.',
          suggestions: STARTER_QUESTIONS.slice(0, 3),
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 160);
    }
  };

  const handleResetChat = () => {
    Haptics.selectionAsync().catch(() => {});
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        sender: 'ASSISTANT',
        text: 'Hello! I am your **RVCE Campus Assistant**. Ask me where any professor sits, who is in a cabin or lab, walking directions between any two places, or where to find cafeterias, ATMs, and clinics.',
        suggestions: STARTER_QUESTIONS,
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.canvas }]}
        edges={['top', 'bottom']}
      >
        {/* Clean Consumer Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
              borderBottomColor: theme.colors.borderSubtle,
              overflow: 'hidden',
            },
          ]}
        >
          {isGlass && <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />}
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onClose();
            }}
          >
            <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.headerTitle}>RVCE Campus Assistant</Text>
              <View style={styles.onlineDot} />
            </View>
            <Text style={styles.headerSub} numberOfLines={1}>
              Smart Faculty, Cabin, Floor Map & Route Concierge
            </Text>
          </View>
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={handleResetChat}
            accessibilityLabel="Reset conversation"
          >
            <Ionicons name="refresh" size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 16}
        >
          {/* Conversational Message Stream */}
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={[
              styles.chatContent,
              keyboardHeight > 0 && { paddingBottom: 24 },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg) => {
              if (msg.sender === 'USER') {
                return (
                  <View key={msg.id} style={styles.userRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.userBubbleText}>{msg.text}</Text>
                    </View>
                  </View>
                );
              }

              return (
                <View key={msg.id} style={styles.assistantRow}>
                  <View style={styles.assistantAvatar}>
                    <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                  </View>
                  <View style={styles.assistantCol}>
                    <View style={styles.assistantBubble}>
                      <FormattedAnswerText text={msg.text} />
                    </View>

                    {/* Embedded Interactive Cards */}
                    {msg.cards && msg.cards.length > 0 && (
                      <View style={styles.cardsContainer}>
                        {msg.cards.map((card, cIdx) => {
                          if (card.card_type === 'FACULTY') {
                            return (
                              <View key={`fc-${cIdx}`} style={styles.entityCard}>
                                <View style={styles.entityCardTop}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.entityCardTitle}>{card.title}</Text>
                                    <Text style={styles.entityCardSub}>{card.subtitle}</Text>
                                    {card.building_name && (
                                      <Text style={styles.entityCardMeta}>
                                        {card.building_name}
                                        {card.floor_name ? ` • ${card.floor_name}` : ''}
                                        {card.room_number ? ` • Cabin ${card.room_number}` : ''}
                                      </Text>
                                    )}
                                  </View>
                                  {card.room_number && (
                                    <View style={styles.cabinBadge}>
                                      <Text style={styles.cabinBadgeText}>{card.room_number}</Text>
                                    </View>
                                  )}
                                </View>
                                {card.building_id && (
                                  <TouchableOpacity
                                    style={styles.cardActionBtn}
                                    onPress={() => {
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                      onJumpToCabin({
                                        buildingId: card.building_id!,
                                        floorId: card.floor_id,
                                        roomId: card.room_id,
                                      });
                                    }}
                                  >
                                    <Ionicons
                                      name={card.room_id ? 'layers' : 'location'}
                                      size={15}
                                      color="#FFFFFF"
                                    />
                                    <Text style={styles.cardActionBtnText}>
                                      {card.room_number
                                        ? `Open Cabin ${card.room_number} on Floor Plan`
                                        : 'Locate Building on Campus Map'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            );
                          }

                          if (card.card_type === 'ROOM') {
                            return (
                              <View key={`rm-${cIdx}`} style={styles.entityCard}>
                                <View style={styles.entityCardTop}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.entityCardTitle}>{card.title}</Text>
                                    <Text style={styles.entityCardSub}>{card.subtitle}</Text>
                                    {card.description ? (
                                      <Text style={styles.entityCardMeta} numberOfLines={2}>
                                        {card.description}
                                      </Text>
                                    ) : null}
                                  </View>
                                  {card.is_accessible && (
                                    <View style={styles.accessTag}>
                                      <Ionicons name="accessibility" size={12} color="#059669" />
                                      <Text style={styles.accessTagText}>Step-Free</Text>
                                    </View>
                                  )}
                                </View>
                                {card.building_id && (
                                  <TouchableOpacity
                                    style={styles.cardActionBtn}
                                    onPress={() => {
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                      onJumpToCabin({
                                        buildingId: card.building_id!,
                                        floorId: card.floor_id,
                                        roomId: card.room_id,
                                      });
                                    }}
                                  >
                                    <Ionicons name="map" size={15} color="#FFFFFF" />
                                    <Text style={styles.cardActionBtnText}>
                                      Highlight {card.room_number} on {card.floor_name || 'Floor'} Plan
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            );
                          }

                          if (card.card_type === 'ROUTE') {
                            return (
                              <View key={`rt-${cIdx}`} style={styles.entityCard}>
                                <View style={styles.entityCardTop}>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.entityCardTitle}>{card.title}</Text>
                                    <Text style={styles.routeHighlightSub}>{card.subtitle}</Text>
                                  </View>
                                </View>
                                {card.steps_preview && card.steps_preview.length > 0 && (
                                  <View style={styles.stepsBox}>
                                    {card.steps_preview.map((step, sIdx) => (
                                      <Text key={sIdx} style={styles.stepItemText}>
                                        {sIdx + 1}. {step}
                                      </Text>
                                    ))}
                                  </View>
                                )}
                                {card.building_id && (
                                  <TouchableOpacity
                                    style={styles.cardActionBtn}
                                    onPress={() => {
                                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                      onJumpToCabin({
                                        buildingId: card.building_id!,
                                        floorId: card.floor_id,
                                        roomId: card.room_id,
                                      });
                                    }}
                                  >
                                    <Ionicons name="navigate" size={15} color="#FFFFFF" />
                                    <Text style={styles.cardActionBtnText}>
                                      {card.room_id
                                        ? 'Open Destination Floor Map'
                                        : 'Open Destination on Campus Map'}
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            );
                          }

                          // BUILDING or FACILITY card
                          return (
                            <View key={`bf-${cIdx}`} style={styles.entityCard}>
                              <Text style={styles.entityCardTitle}>{card.title}</Text>
                              <Text style={styles.entityCardSub}>{card.subtitle}</Text>
                              {card.description ? (
                                <Text style={styles.entityCardMeta} numberOfLines={2}>
                                  {card.description}
                                </Text>
                              ) : null}
                              {card.building_id && (
                                <TouchableOpacity
                                  style={styles.cardActionBtn}
                                  onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                                    onJumpToCabin({
                                      buildingId: card.building_id!,
                                      floorId: card.floor_id,
                                      roomId: card.room_id,
                                    });
                                  }}
                                >
                                  <Ionicons name="location" size={15} color="#FFFFFF" />
                                  <Text style={styles.cardActionBtnText}>View on Campus Map</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    {/* Follow-up Suggestion Chips */}
                    {msg.suggestions && msg.suggestions.length > 0 && (
                      <View style={styles.suggestionsWrap}>
                        {msg.suggestions.map((sug, sIdx) => (
                          <TouchableOpacity
                            key={`sug-${sIdx}`}
                            style={styles.suggestionChip}
                            onPress={() => handleSendQuery(sug)}
                          >
                            <Ionicons
                              name="chatbubble-outline"
                              size={12}
                              color={Colors.primary}
                            />
                            <Text style={styles.suggestionChipText}>{sug}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}

            {loading && (
              <View style={styles.assistantRow}>
                <View style={styles.assistantAvatar}>
                  <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                </View>
                <View style={styles.typingBubble}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                  <Text style={styles.typingText}>Finding campus details…</Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Bottom Composer Bar */}
          <View
            style={[
              styles.composerBar,
              {
                backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
                borderTopColor: theme.colors.borderSubtle,
                overflow: 'hidden',
              },
              Platform.OS === 'android' && keyboardHeight > 0 && { marginBottom: keyboardHeight },
            ]}
          >
            {isGlass && <BlurView intensity={60} tint="light" style={StyleSheet.absoluteFill} />}
            <View style={styles.inputShell}>
              <TextInput
                style={styles.textInput}
                value={inputVal}
                onChangeText={setInputVal}
                placeholder="Ask about faculty, cabins, labs, or directions..."
                placeholderTextColor={Colors.textMuted}
                returnKeyType="send"
                onSubmitEditing={() => handleSendQuery()}
              />
              {inputVal.length > 0 && (
                <TouchableOpacity onPress={() => setInputVal('')}>
                  <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, !inputVal.trim() && styles.sendBtnDisabled]}
              onPress={() => handleSendQuery()}
              disabled={!inputVal.trim() || loading}
            >
              <Ionicons name="send" size={17} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
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
  headerTitleCol: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  headerSub: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginTop: 1,
  },
  resetBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.cardSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: Spacing.md,
    paddingBottom: 24,
    gap: 16,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  userBubbleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  assistantAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  assistantCol: {
    flex: 1,
    gap: 10,
  },
  assistantBubble: {
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  assistantText: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  assistantTextBold: {
    fontWeight: '800',
    color: Colors.primary,
  },
  cardsContainer: {
    gap: 8,
  },
  entityCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 1,
  },
  entityCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  entityCardTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  entityCardSub: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  entityCardMeta: {
    fontSize: 11.5,
    color: Colors.textMuted,
    marginTop: 3,
    lineHeight: 16,
  },
  routeHighlightSub: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#059669',
    marginTop: 3,
  },
  cabinBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cabinBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  accessTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  accessTagText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#059669',
  },
  stepsBox: {
    backgroundColor: '#F8FAFC',
    padding: 9,
    borderRadius: 8,
    gap: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepItemText: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 2,
  },
  cardActionBtnText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  suggestionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6.5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  suggestionChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: Colors.primary,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typingText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  inputShell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardSecondary,
    borderRadius: Radius.full,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 13.5,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
});
