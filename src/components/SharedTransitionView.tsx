import React from 'react';
import { ViewProps } from 'react-native';
import Reanimated from 'react-native-reanimated';

type SharedTransitionViewProps = ViewProps & {
  sharedTransitionTag?: string;
  children?: React.ReactNode;
};

const AnimatedView = Reanimated.View as unknown as React.ComponentType<SharedTransitionViewProps>;

export function SharedTransitionView(props: SharedTransitionViewProps) {
  return <AnimatedView {...props} />;
}
