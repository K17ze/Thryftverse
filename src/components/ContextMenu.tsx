import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import Reanimated, { FadeOut, ZoomIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useHaptic } from '../hooks/useHaptic';
import { useReducedMotion } from '../hooks/useReducedMotion';

const IS_LIGHT = ActiveTheme === 'light';
const MENU_BG = IS_LIGHT ? '#ffffff' : '#1c1c1e';
const MENU_BORDER = IS_LIGHT ? '#e0dbd4' : '#333';
const MENU_SEPARATOR = IS_LIGHT ? '#eae5de' : '#2a2a2a';
const BACKDROP = IS_LIGHT ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.55)';

export interface ContextMenuAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
}

interface ContextMenuProps {
  visible: boolean;
  onDismiss: () => void;
  actions: ContextMenuAction[];
  title?: string;
}

export function ContextMenu({ visible, onDismiss, actions, title }: ContextMenuProps) {
  const haptic = useHaptic();
  const reducedMotionEnabled = useReducedMotion();

  const menuEnterAnimation = reducedMotionEnabled
    ? undefined
    : ZoomIn.springify().damping(18).stiffness(280);
  const menuExitAnimation = reducedMotionEnabled
    ? undefined
    : FadeOut.duration(150);

  const handleAction = (action: ContextMenuAction) => {
    haptic.light();
    onDismiss();
    // Delay action slightly so menu closes first
    setTimeout(action.onPress, reducedMotionEnabled ? 0 : 180);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Reanimated.View
          entering={menuEnterAnimation}
          exiting={menuExitAnimation}
          style={styles.menuCard}
        >
          {title && <Text style={styles.menuTitle}>{title}</Text>}
          {actions.map((action, index) => (
            <React.Fragment key={action.label}>
              {index > 0 && <View style={styles.separator} />}
              <Pressable
                style={({ pressed }) => [
                  styles.menuItem,
                  pressed && styles.menuItemPressed,
                ]}
                onPress={() => handleAction(action)}
              >
                <Ionicons
                  name={action.icon}
                  size={18}
                  color={action.destructive ? Colors.danger : Colors.textPrimary}
                />
                <Text
                  style={[
                    styles.menuItemText,
                    action.destructive && styles.menuItemDestructive,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </Reanimated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 50,
  },
  menuCard: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: MENU_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MENU_BORDER,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 16,
  },
  menuTitle: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  separator: {
    height: 1,
    backgroundColor: MENU_SEPARATOR,
    marginHorizontal: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuItemPressed: {
    backgroundColor: IS_LIGHT ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
  },
  menuItemText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: Typography.family.medium,
  },
  menuItemDestructive: {
    color: Colors.danger,
  },
});
