import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions, TextInput } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

const { height, width } = Dimensions.get('window');

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
  const translateY = useSharedValue(height);
  const contextY = useSharedValue(0);

  // Derived filtered options
  const filteredOptions = options.filter(o => o.toLowerCase().includes(searchQuery.toLowerCase()));

  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      translateY.value = withSpring(height * 0.4, { damping: 22, stiffness: 220 });
    } else {
      translateY.value = withTiming(height, { duration: 300 });
    }
  }, [visible]);

  const handleClose = () => {
    translateY.value = withTiming(height, { duration: 300 }, () => {
      runOnJS(onClose)();
    });
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
        translateY.value = withSpring(height * 0.4, { damping: 20, stiffness: 200 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => {
    const opacity = interpolate(translateY.value, [height * 0.4, height], [0.6, 0], Extrapolation.CLAMP);
    return {
      opacity,
      display: opacity === 0 && !visible ? 'none' : 'flex'
    };
  });

  if (!visible && translateY.value === height) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="box-none">
      <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, overlayStyle]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
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
                <TouchableOpacity
                  key={opt}
                  style={styles.optionRow}
                  activeOpacity={0.7}
                  onPress={() => handleSelect(opt)}
                >
                  <Text style={[styles.optionText, selectedValue === opt && styles.optionTextActive]}>{opt}</Text>
                  {selectedValue === opt && <Ionicons name="checkmark-circle" size={24} color={Colors.accent} />}
                </TouchableOpacity>
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
    backgroundColor: '#111',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  handleContainer: { alignItems: 'center', paddingVertical: 14 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#333' },
  header: { alignItems: 'center', marginBottom: 12 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    marginHorizontal: 20,
    paddingHorizontal: 16,
    height: 50,
    borderRadius: 25,
    marginBottom: 16,
  },
  searchInput: { flex: 1, marginLeft: 10, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },
  
  scrollList: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  optionText: { fontSize: 16, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  optionTextActive: { fontFamily: 'Inter_700Bold', color: Colors.accent },
  
  noResultsText: { textAlign: 'center', color: Colors.textMuted, marginTop: 40, fontFamily: 'Inter_500Medium' },
});
