import React from 'react';
import { View, Dimensions } from 'react-native';
import { SkeletonLoader } from '../SkeletonLoader';
import { Colors } from '../../constants/colors';

const { width: W } = Dimensions.get('window');
const ITEM_W = (W - 48) / 2;
const STATS_BG = Colors.card;

export function ProfileSkeleton() {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      {/* Hero section */}
      <View style={{ alignItems: 'center', paddingVertical: 28, gap: 14 }}>
        <SkeletonLoader width={96} height={96} borderRadius={48} />
        <SkeletonLoader width={140} height={18} borderRadius={9} />
        <SkeletonLoader width={100} height={13} borderRadius={6} />
      </View>
      {/* Stats bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', backgroundColor: STATS_BG, borderRadius: 20, padding: 20, marginBottom: 24 }}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={{ alignItems: 'center', gap: 6 }}>
            <SkeletonLoader width={40} height={22} borderRadius={11} />
            <SkeletonLoader width={52} height={11} borderRadius={6} />
          </View>
        ))}
      </View>
      {/* Grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonLoader key={i} width={ITEM_W} height={ITEM_W * 1.35} borderRadius={16} />
        ))}
      </View>
    </View>
  );
}
