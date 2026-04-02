import React from 'react';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import BalanceScreen from './BalanceScreen';

type Props = StackScreenProps<RootStackParamList, 'Wallet'>;

export default function WalletScreen(props: Props) {
  return <BalanceScreen {...props} />;
}