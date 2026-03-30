import React from 'react';
import { View, Dimensions } from 'react-native';
import { SkeletonLoader } from '../SkeletonLoader';

const { width: W } = Dimensions.get('window');

export function ItemDetailSkeleton() {
  return (
    <View>
      {/* Hero image */}
      <SkeletonLoader width={W} height={W} borderRadius={0} />
      <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 12 }}>
        {/* Price */}
        <SkeletonLoader width={120} height={32} borderRadius={8} />
        {/* Title */}
        <SkeletonLoader width="90%" height={18} borderRadius={9} />
        <SkeletonLoader width="70%" height={18} borderRadius={9} />
        {/* Meta pills */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <SkeletonLoader width={72} height={28} borderRadius={14} />
          <SkeletonLoader width={72} height={28} borderRadius={14} />
          <SkeletonLoader width={72} height={28} borderRadius={14} />
        </View>
        {/* Description block */}
        <View style={{ gap: 8, marginTop: 8 }}>
          <SkeletonLoader width="100%" height={13} borderRadius={6} />
          <SkeletonLoader width="95%" height={13} borderRadius={6} />
          <SkeletonLoader width="80%" height={13} borderRadius={6} />
        </View>
        {/* Seller card */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12, backgroundColor: '#111', borderRadius: 20, padding: 16 }}>
          <SkeletonLoader width={48} height={48} borderRadius={24} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonLoader width="50%" height={14} borderRadius={7} />
            <SkeletonLoader width="35%" height={11} borderRadius={6} />
          </View>
        </View>
      </View>
    </View>
  );
}
