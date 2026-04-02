import React from 'react';
import { ImageProps } from 'react-native';
import Reanimated from 'react-native-reanimated';

type SharedTransitionImageProps = ImageProps & {
  sharedTransitionTag?: string;
};

const AnimatedImage = Reanimated.Image as unknown as React.ComponentType<SharedTransitionImageProps>;

export function SharedTransitionImage(props: SharedTransitionImageProps) {
  return <AnimatedImage {...props} />;
}
