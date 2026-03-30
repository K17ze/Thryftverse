import React from 'react';
import { View } from 'react-native';
import { SkeletonLoader } from '../SkeletonLoader';

function ConvoRow() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 }}>
      <SkeletonLoader width={52} height={52} borderRadius={26} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonLoader width="60%" height={14} borderRadius={7} />
        <SkeletonLoader width="85%" height={11} borderRadius={6} />
      </View>
      <SkeletonLoader width={36} height={36} borderRadius={18} />
    </View>
  );
}

export function ConversationListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <ConvoRow key={i} />
      ))}
    </View>
  );
}
