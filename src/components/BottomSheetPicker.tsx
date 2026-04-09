import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, TextInput } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from './AnimatedPressable';

const { height, width } = Dimensions.get('window');
const IS_LIGHT = ActiveTheme === 'light';
const OVERLAY_BG = IS_LIGHT ? 'rgba(14, 12, 10, 0.34)' : 'rgba(0,0,0,0.6)';
const SHEET_BG = Colors.surface;
const HANDLE_BG = Colors.borderLight;
const SEARCH_BG = Colors.cardAlt;
const SEARCH_BORDER = Colors.border;
const OPTION_BORDER = Colors.border;

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: string[];
  selectedValue?: string;
  onSelect: (value: string) => void;
  searchable?: boolean;
}

export function BottomSheetPicker({ visible, onClose, title, options, selectedValue, onSelect, searchable }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [shouldRender, setShouldRender] = useState(visible);
  const translateY = useSharedValue(height);
  const contextY = useSharedValue(0);

  // Derived filtered options
  const filteredOptions = options.filter(o => o.toLowerCase().includes(searchQuery.toLowerCase()));

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setSearchQuery('');
      translateY.value = height * 0.4;
    } else if (shouldRender) {
      translateY.value = height;
      setShouldRender(false);
    }
  }, [shouldRender, visible]);

  const handleClose = () => {
    translateY.value = height;
    onClose();
  };

  const handleSelect = (val: string) => {
    onSelect(val);
    handleClose();
  };

  const gesture = Gesture.Pan()
    .onStart(() => {
      contextY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(height * 0.1, contextY.value + e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 80 && e.velocityY > 500) {
        runOnJS(handleClose)();
      } else if (translateY.value > height * 0.7) {
        runOnJS(handleClose)();
      } else {
        translateY.value = height * 0.4;
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => {
    return {
      opacity: visible ? 0.6 : 0,
      display: visible ? 'flex' : 'none',
    };
  });

  if (!shouldRender) {
    return null;
  }

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="box-none">
      <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: OVERLAY_BG }, overlayStyle]}>
        <AnimatedPressable
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          disableAnimation
          onPress={handleClose}
        />
      </Reanimated.View>

      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>

          {searchable && (
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={20} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search..."
                placeholderTextColor={Colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          )}

          <ScrollView style={styles.scrollList} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {filteredOptions.length === 0 ? (
              <Text style={styles.noResultsText}>No results found</Text>
            ) : (
              filteredOptions.map((opt) => (
                <AnimatedPressable
                  key={opt}
                  style={styles.optionRow}
                  activeOpacity={0.7}
                  onPress={() => handleSelect(opt)}
                >
                  <Text style={[styles.optionText, selectedValue === opt && styles.optionTextActive]}>{opt}</Text>
                  {selectedValue === opt && <Ionicons name="checkmark-circle" size={24} color={Colors.accent} />}
                </AnimatedPressable>
              ))
            )}
          </ScrollView>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    width: width,
    height: height,
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  handleContainer: { alignItems: 'center', paddingVertical: 14 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: HANDLE_BG },
  header: { alignItems: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 20, fontFamily: Typography.family.semibold, color: Colors.textPrimary, letterSpacing: 0.08 },
  
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SEARCH_BG,
    borderWidth: 1,
    borderColor: SEARCH_BORDER,
    marginHorizontal: 20,
    paddingHorizontal: 16,
    height: 50,
    borderRadius: 25,
    marginBottom: 16,
  },
  searchInput: { flex: 1, marginLeft: 10, color: Colors.textPrimary, fontFamily: Typography.family.medium, fontSize: 16, letterSpacing: 0.08 },
  
  scrollList: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: OPTION_BORDER,
  },
  optionText: { fontSize: 16, fontFamily: Typography.family.medium, color: Colors.textPrimary, letterSpacing: 0.08 },
  optionTextActive: { fontFamily: Typography.family.semibold, color: Colors.accent },
  
  noResultsText: { textAlign: 'center', color: Colors.textMuted, marginTop: 40, fontFamily: Typography.family.medium },
});
