import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { RootStackParamList } from './types';

import SplashScreen from '../screens/SplashScreen';
import AuthLandingScreen from '../screens/AuthLandingScreen';
import LoginScreen from '../screens/LoginScreen';
import SignUpScreen from '../screens/SignUpScreen';
import TabNavigator from './TabNavigator';
import CategoryDetailScreen from '../screens/CategoryDetailScreen';
import BrowseScreen from '../screens/BrowseScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import FavouritesScreen from '../screens/FavouritesScreen';
import PosterViewerScreen from '../screens/PosterViewerScreen';
import CreatePosterScreen from '../screens/CreatePosterScreen';
import CreateAuctionScreen from '../screens/CreateAuctionScreen';
import CreateSyndicateScreen from '../screens/CreateSyndicateScreen';
import MarketLedgerScreen from '../screens/MarketLedgerScreen';
import SyndicateHubScreen from '../screens/SyndicateHubScreen';
import AssetDetailScreen from '../screens/AssetDetailScreen';
import TradeScreen from '../screens/TradeScreen';
import PortfolioScreen from '../screens/PortfolioScreen';
import SyndicateOrderHistoryScreen from '../screens/SyndicateOrderHistoryScreen';
import AssetLeaderboardScreen from '../screens/AssetLeaderboardScreen';
import BuyoutScreen from '../screens/BuyoutScreen';
import SyndicateOnboardingScreen from '../screens/SyndicateOnboardingScreen';
import ChatScreen from '../screens/ChatScreen';
import UserProfileScreen from '../screens/UserProfileScreen';

// Profile Subs
import BalanceScreen from '../screens/BalanceScreen';
import WalletScreen from '../screens/WalletScreen';
import MyOrdersScreen from '../screens/MyOrdersScreen';
import PersonalisationScreen from '../screens/PersonalisationScreen';
import SettingsScreen from '../screens/SettingsScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import PaymentsScreen from '../screens/PaymentsScreen';

// Phase 16 new screens
import MakeOfferScreen from '../screens/MakeOfferScreen';
import PushNotificationsScreen from '../screens/PushNotificationsScreen';
import PostageScreen from '../screens/PostageScreen';
import InviteFriendsScreen from '../screens/InviteFriendsScreen';
import BalanceHistoryScreen from '../screens/BalanceHistoryScreen';

// Phase 17 new screens
import AddCardScreen from '../screens/AddCardScreen';
import AddBankAccountScreen from '../screens/AddBankAccountScreen';
import HelpSupportScreen from '../screens/HelpSupportScreen';

// Phase 18 new screens
import OrderDetailScreen from '../screens/OrderDetailScreen';

// Phase 19 new screens
import CheckoutScreen from '../screens/CheckoutScreen';
import SuccessScreen from '../screens/SuccessScreen';
import ManageListingScreen from '../screens/ManageListingScreen';
import WithdrawScreen from '../screens/WithdrawScreen';
import CategoryTreeScreen from '../screens/CategoryTreeScreen';

// Phase 24 new screens
import GlobalSearchScreen from '../screens/GlobalSearchScreen';
import AddAddressScreen from '../screens/AddAddressScreen';

// Phase 25 new screens
import FilterScreen from '../screens/FilterScreen';
import ListingSuccessScreen from '../screens/ListingSuccessScreen';

// Phase 27
import NotificationsScreen from '../screens/NotificationsScreen';

// Phase 28
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import TwoFactorSetupScreen from '../screens/TwoFactorSetupScreen';
import WriteReviewScreen from '../screens/WriteReviewScreen';
import ReportScreen from '../screens/ReportScreen';

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Splash" component={SplashScreen} />
      
      {/* Auth Flow */}
      <Stack.Screen name="AuthLanding" component={AuthLandingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

      <Stack.Screen name="MainTabs" component={TabNavigator} />
      <Stack.Screen name="CategoryDetail" component={CategoryDetailScreen} />
      <Stack.Screen name="Browse" component={BrowseScreen} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
      <Stack.Screen name="Favourites" component={FavouritesScreen} />
      <Stack.Screen name="PosterViewer" component={PosterViewerScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="CreatePoster" component={CreatePosterScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="CreateAuction" component={CreateAuctionScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="CreateSyndicate" component={CreateSyndicateScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="MarketLedger" component={MarketLedgerScreen} />
      <Stack.Screen name="SyndicateHub" component={SyndicateHubScreen} />
      <Stack.Screen name="AssetDetail" component={AssetDetailScreen} />
      <Stack.Screen name="Trade" component={TradeScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Portfolio" component={PortfolioScreen} />
      <Stack.Screen name="SyndicateOrderHistory" component={SyndicateOrderHistoryScreen} />
      <Stack.Screen name="AssetLeaderboard" component={AssetLeaderboardScreen} />
      <Stack.Screen name="Buyout" component={BuyoutScreen} />
      <Stack.Screen name="SyndicateOnboarding" component={SyndicateOnboardingScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="Balance" component={BalanceScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="MyOrders" component={MyOrdersScreen} />
      <Stack.Screen name="Personalisation" component={PersonalisationScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
      <Stack.Screen name="Payments" component={PaymentsScreen} />

      {/* Phase 16 new screens */}
      <Stack.Screen name="MakeOffer" component={MakeOfferScreen} />
      <Stack.Screen name="PushNotifications" component={PushNotificationsScreen} />
      <Stack.Screen name="Postage" component={PostageScreen} />
      <Stack.Screen name="InviteFriends" component={InviteFriendsScreen} />
      <Stack.Screen name="BalanceHistory" component={BalanceHistoryScreen} />

      {/* Phase 17 new screens */}
      <Stack.Screen name="AddCard" component={AddCardScreen} />
      <Stack.Screen name="AddBankAccount" component={AddBankAccountScreen} />
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />

      {/* Phase 18 new screens */}
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />

      {/* Phase 19 new screens */}
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="Success" component={SuccessScreen} />
      <Stack.Screen name="ManageListing" component={ManageListingScreen} />
      <Stack.Screen name="Withdraw" component={WithdrawScreen} />
      <Stack.Screen name="CategoryTree" component={CategoryTreeScreen} />
      
      {/* Phase 24 new screens */}
      <Stack.Screen name="GlobalSearch" component={GlobalSearchScreen} />
      <Stack.Screen name="AddAddress" component={AddAddressScreen} />

      {/* Phase 25 new screens */}
      <Stack.Screen name="Filter" component={FilterScreen} options={{ presentation: 'transparentModal', headerShown: false, cardOverlayEnabled: true, cardStyle: { backgroundColor: 'transparent' } }} />
      <Stack.Screen name="ListingSuccess" component={ListingSuccessScreen} />

      {/* Phase 27 new screens */}
      <Stack.Screen name="NotificationsList" component={NotificationsScreen} />

      {/* Phase 28 new screens */}
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="TwoFactorSetup" component={TwoFactorSetupScreen} />
      <Stack.Screen name="WriteReview" component={WriteReviewScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Report" component={ReportScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
