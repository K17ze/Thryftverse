export type RootStackParamList = {
  Splash: undefined;
  AuthLanding: undefined;
  Login: undefined;
  SignUp: undefined;
  MainTabs: undefined;
  CategoryDetail: { categoryId: string };
  Browse: {
    categoryId: string;
    subcategoryId?: string;
    title: string;
    searchQuery?: string;
  };
  ItemDetail: { itemId: string };
  Favourites: undefined;
  PosterViewer: { posterId: string };
  CreatePoster: undefined;
  CreateAuction: undefined;
  CreateSyndicate:
    | {
        listingId?: string;
        totalUnits?: number;
        unitPriceDisplay?: number;
        offeringWindowHours?: number;
        authPhotos?: string[];
      }
    | undefined;
  MarketLedger: undefined;
  SyndicateHub: undefined;
  AssetDetail: { assetId: string };
  Trade: { assetId: string; side: 'buy' | 'sell' };
  Portfolio: undefined;
  SyndicateOrderHistory: undefined;
  AssetLeaderboard: undefined;
  Buyout: { assetId: string };
  SyndicateOnboarding: undefined;
  Chat: { conversationId: string };
  UserProfile: { userId: string; isMe?: boolean };
  // Profile sub-screens
  Balance: undefined;
  Wallet: undefined;
  MyOrders: undefined;
  Personalisation: undefined;
  Settings: undefined;
  EditProfile: undefined;
  AccountSettings: undefined;
  Payments: undefined;
  // Phase 16 new screens
  MakeOffer: { itemId: string; price: number; title: string };
  PushNotifications: undefined;
  Postage: undefined;
  InviteFriends: undefined;
  BalanceHistory: undefined;
  // Phase 17 new screens
  AddCard: undefined;
  AddBankAccount: undefined;
  HelpSupport: undefined;
  // Phase 18 new screens
  OrderDetail: { orderId: string };
  // Phase 19 new screens
  Checkout: { itemId: string };
  Success: undefined;
  ManageListing: { itemId: string };
  Withdraw: undefined;
  CategoryTree: { categoryPrefix: string };
  // Phase 24 new screens
  GlobalSearch: undefined;
  AddAddress: undefined;
  // Phase 25 new screens
  Filter:
    | {
        categoryId?: string;
        title?: string;
        subcategoryId?: string;
      }
    | undefined;
  ListingSuccess: undefined;
  // Phase 27
  NotificationsList: undefined;
  // Phase 28
  ForgotPassword: undefined;
  ChangePassword: undefined;
  TwoFactorSetup: undefined;
  WriteReview: { orderId: string };
  Report: { type: 'item' | 'user' };
};

export type TabParamList = {
  Home: undefined;
  TradeHub: undefined;
  Search: undefined;
  Sell: undefined;
  Inbox: undefined;
  Profile: undefined;
};
