import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../theme/colors';

interface StatusPillProps {
  status: string;
  type?: 'AVAILABILITY' | 'CONNECTION';
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, type = 'AVAILABILITY' }) => {
  let bg = Colors.cardSecondary;
  let text = Colors.textSecondary;
  let dot = Colors.textMuted;
  let label = status;

  if (type === 'CONNECTION') {
    if (status === 'ONLINE') {
      bg = Colors.successBg;
      text = Colors.success;
      dot = Colors.success;
      label = 'Server Online';
    } else {
      bg = Colors.warningBg;
      text = Colors.warning;
      dot = Colors.warning;
      label = 'Offline Cache';
    }
  } else {
    switch (status) {
      case 'AVAILABLE':
        bg = Colors.successBg;
        text = Colors.success;
        dot = Colors.success;
        label = 'Available';
        break;
      case 'IN_CLASS':
        bg = Colors.primaryLight;
        text = Colors.primary;
        dot = Colors.primary;
        label = 'In Class';
        break;
      case 'IN_MEETING':
        bg = Colors.warningBg;
        text = Colors.warning;
        dot = Colors.warning;
        label = 'In a Meeting';
        break;
      case 'BUSY':
      case 'BUSY_SCHEDULED':
        bg = Colors.warningBg;
        text = Colors.warning;
        dot = Colors.warning;
        label = status === 'BUSY' ? 'Busy' : 'Busy / Scheduled';
        break;
      case 'UNAVAILABLE':
        bg = Colors.dangerBg;
        text = Colors.danger;
        dot = Colors.danger;
        label = 'Unavailable';
        break;
      case 'NOT_SPECIFIED':
      default:
        bg = Colors.cardSecondary;
        text = Colors.textSecondary;
        dot = Colors.textMuted;
        label = 'Not specified';
        break;
    }
  }

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 9999,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'System',
  },
});
