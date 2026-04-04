import React from 'react';
import { View, StyleSheet, Image, Dimensions, Text } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  useAnimatedReaction,
  runOnJS,
  withTiming,
  SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedPressable } from './AnimatedPressable';

const { width } = Dimensions.get('window');
const ITEM_SIZE = 80;
const SPACING = 12;
const TOTAL_SIZE = ITEM_SIZE + SPACING;

interface Props {
  photos: string[];
  onReorder: (newOrder: string[]) => void;
  onAddPhoto: () => void;
}

// Helper to get object values sorted by key (not needed strictly if we map properly)
// We will just manage an array of IDs sorted.

export function SortablePhotoStrip({ photos, onReorder, onAddPhoto }: Props) {
  return (
    <View style={styles.container}>
      <Reanimated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        <View style={{ flexDirection: 'row', position: 'relative', height: ITEM_SIZE }}>
          {photos.map((photo, index) => (
            <SortableItem
              key={photo}
              id={photo}
              index={index}
              total={photos.length}
              photos={photos}
              onReorder={onReorder}
            />
          ))}
          {/* Add more button */}
          <AnimatedPressable
            style={[styles.addBtn, { left: photos.length * TOTAL_SIZE }]}
            onPress={onAddPhoto}
          >
            <Ionicons name="add" size={28} color={Colors.background} />
          </AnimatedPressable>
        </View>
      </Reanimated.ScrollView>
      <Text style={styles.hintText}>Drag to reorder. First photo is the cover.</Text>
    </View>
  );
}

interface ItemProps {
  id: string;
  index: number;
  total: number;
  photos: string[];
  onReorder: (newOrder: string[]) => void;
}

function SortableItem({ id, index, total, photos, onReorder }: ItemProps) {
  const isDragging = useSharedValue(false);
  const position = useSharedValue(index * TOTAL_SIZE);
  const zIndex = useSharedValue(0);

  // When props update (like after drop), update position gently
  useAnimatedReaction(
    () => index,
    (currIndex) => {
      if (!isDragging.value) {
        position.value = withSpring(currIndex * TOTAL_SIZE, { damping: 20, stiffness: 200 });
      }
    },
    [index]
  );

  const panGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
      zIndex.value = 100;
    })
    .onUpdate((e) => {
      position.value = index * TOTAL_SIZE + e.translationX;
    })
    .onEnd((e) => {
      const newIndex = Math.max(0, Math.min(total - 1, Math.round(position.value / TOTAL_SIZE)));
      isDragging.value = false;
      position.value = withSpring(newIndex * TOTAL_SIZE, { damping: 20, stiffness: 200 }, () => {
        zIndex.value = 0;
      });

      if (newIndex !== index) {
        // Trigger React re-order on JS thread
        const newOrder = [...photos];
        const [moved] = newOrder.splice(index, 1);
        newOrder.splice(newIndex, 0, moved);
        runOnJS(onReorder)(newOrder);
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      zIndex: zIndex.value,
      transform: [
        { translateX: position.value },
        { scale: withSpring(isDragging.value ? 1.05 : 1) }
      ],
      shadowOpacity: withTiming(isDragging.value ? 0.3 : 0),
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Reanimated.View style={[styles.itemWrap, animatedStyle]}>
        <Image source={{ uri: id }} style={styles.image} />
        {index === 0 && (
          <View style={styles.coverBadge}>
            <Text style={styles.coverText}>COVER</Text>
          </View>
        )}
      </Reanimated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    height: ITEM_SIZE + 60,
  },
  itemWrap: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 16,
    backgroundColor: '#222',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  addBtn: {
    position: 'absolute',
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(78,205,196,0.9)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  coverText: {
    color: '#000',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  hintText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginTop: 16,
  },
});
