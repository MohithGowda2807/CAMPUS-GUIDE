import React from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';
import { Radius, Spacing } from '../theme/spacing';

interface SearchBarProps {
  value?: string;
  onChangeText?: (text: string) => void;
  onPress?: () => void;
  placeholder?: string;
  editable?: boolean;
  onClear?: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value = '',
  onChangeText,
  onPress,
  placeholder = 'Search buildings, faculty, cabins, labs...',
  editable = true,
  onClear,
}) => {
  const { isGlass, theme } = useTheme();

  const innerContent = (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isGlass ? theme.colors.surfaceFloating : theme.colors.surface,
          borderColor: isGlass
            ? theme.colors.surfaceFloatingBorder
            : theme.colors.borderSubtle,
        },
        theme.shadows.floating,
      ]}
    >
      {isGlass && <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />}
      <Ionicons name="search" size={19} color={theme.colors.primary} style={styles.icon} />
      <TextInput
        style={[styles.input, { color: theme.colors.textPrimary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        editable={editable}
        pointerEvents={editable ? 'auto' : 'none'}
        returnKeyType="search"
      />
      {value.length > 0 && onClear ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
        </TouchableOpacity>
      ) : (
        !editable && (
          <View style={[styles.trailingBadge, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="options-outline" size={15} color={theme.colors.primary} />
          </View>
        )
      )}
    </View>
  );

  if (!editable && onPress) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        {innerContent}
      </TouchableOpacity>
    );
  }

  return innerContent;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    height: 50,
    borderWidth: 1,
    overflow: 'hidden',
  },
  icon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: 'System',
    paddingVertical: 0,
  },
  trailingBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});
