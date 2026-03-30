
export interface Address {
  id: string;
  name: string;
  street: string;
  city: string;
  postcode: string;
  isDefault: boolean;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account';
  last4: string;
  brand?: 'visa' | 'mastercard' | 'amex';
  bankName?: string;
  expiry?: string;
  isDefault: boolean;
}

export interface Order {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled';
  totalPrice: number;
  trackingNumber?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: 'sale' | 'purchase' | 'withdrawal' | 'refund';
  amount: number;
  status: 'completed' | 'pending';
  date: string;
  description: string;
}

export interface Listing {
  id: string;
  title: string;
  brand: string;
  size: string;
  condition: 'New with tags' | 'Very good' | 'Good' | 'Satisfactory';
  price: number;
  priceWithProtection: number;
  images: string[];
  likes: number;
  isBumped?: boolean;
  isSold?: boolean;
  sellerId: string;
  category: string;
  subcategory: string;
  description: string;
  createdAt?: string;
}

export interface User {
  id: string;
  username: string;
  avatar: string;
  coverPhoto?: string;
  rating: number;
  reviewCount: number;
  location: string;
  followers: number;
  following: number;
  isVerified: boolean;
  badges: string[];
  lastSeen: string;
  listingCount: number;
}

export interface Message {
  id: string;
  senderId: string;
  text?: string;
  offerPrice?: number;
  originalPrice?: number;
  offerStatus?: 'pending' | 'accepted' | 'declined';
  isSystem?: boolean;
  systemTitle?: string;
  timestamp: string;
  itemImage?: string;
  type?: 'text' | 'offer' | 'system';
  sender?: 'me' | 'other' | 'system';
  offer?: { originalPrice: number; offerPrice: number; status: 'pending' | 'accepted' | 'declined' };
}

export interface Conversation {
  id: string;
  sellerId: string;
  itemId: string;
  lastMessage: string;
  lastMessageTime: string;
  unread: boolean;
  messages: Message[];
}

export interface Notification {
  id: string;
  itemImage: string;
  text: string;
  time: string;
  type: 'new_item' | 'favourite' | 'system';
}

export interface Review {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerAvatar: string;
  rating: number;
  text: string;
  date: string;
  isAutomatic: boolean;
}

// ─── MOCK USERS ───────────────────────────────────────────────────────────────
export const MOCK_USERS: User[] = [
  {
    id: 'u1',
    username: 'mariefullery',
    avatar: 'https://picsum.photos/seed/marie/200/200',
    coverPhoto: 'https://picsum.photos/seed/covertop/800/400',
    rating: 4.8,
    reviewCount: 54,
    location: 'South Elmsall, United Kingdom',
    followers: 10,
    following: 0,
    isVerified: true,
    badges: ['Frequent Uploads'],
    lastSeen: '2 hours ago',
    listingCount: 26,
  },
  {
    id: 'u2',
    username: 'scott_art',
    avatar: 'https://picsum.photos/seed/scott/200/200',
    rating: 4.5,
    reviewCount: 32,
    location: 'London, United Kingdom',
    followers: 45,
    following: 12,
    isVerified: true,
    badges: [],
    lastSeen: 'Just now',
    listingCount: 15,
  },
  {
    id: 'u3',
    username: 'dankdunksuk',
    avatar: 'https://picsum.photos/seed/dank/200/200',
    rating: 4.9,
    reviewCount: 128,
    location: 'Manchester, United Kingdom',
    followers: 230,
    following: 18,
    isVerified: true,
    badges: ['Top Seller', 'Frequent Uploads'],
    lastSeen: 'an hour ago',
    listingCount: 42,
  },
  {
    id: 'u4',
    username: 'lucygibson94',
    avatar: 'https://picsum.photos/seed/lucy/200/200',
    rating: 4.7,
    reviewCount: 19,
    location: 'Bristol, United Kingdom',
    followers: 8,
    following: 3,
    isVerified: false,
    badges: [],
    lastSeen: '3 hours ago',
    listingCount: 8,
  },
];

// ─── MOCK LISTINGS ───────────────────────────────────────────────────────────
export const MOCK_LISTINGS: Listing[] = [
  {
    id: 'l1',
    title: 'Yves Saint Laurent Sweater',
    brand: 'Yves Saint Laurent',
    size: 'M',
    condition: 'Very good',
    price: 200,
    priceWithProtection: 210.70,
    images: [
      'https://picsum.photos/seed/ysl1/400/500',
      'https://picsum.photos/seed/ysl2/400/500',
      'https://picsum.photos/seed/ysl3/400/500',
    ],
    likes: 40,
    isBumped: true,
    sellerId: 'u1',
    category: 'women',
    subcategory: 'Clothing',
    description: 'Beautiful YSL sweater in great condition. Barely worn, no signs of wear.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l2',
    title: 'AMI Striped Shirt',
    brand: 'AMI',
    size: 'M',
    condition: 'Very good',
    price: 48,
    priceWithProtection: 51.10,
    images: [
      'https://picsum.photos/seed/ami1/400/500',
      'https://picsum.photos/seed/ami2/400/500',
    ],
    likes: 14,
    sellerId: 'u2',
    category: 'men',
    subcategory: 'Clothing',
    description: 'Pit to pit 20 in. Simple striped shirt from AMI Paris. Very good condition.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l3',
    title: 'Polo Ralph Lauren Harrington',
    brand: 'Ralph Lauren',
    size: 'L',
    condition: 'Good',
    price: 65,
    priceWithProtection: 68.90,
    images: [
      'https://picsum.photos/seed/polo1/400/500',
    ],
    likes: 5,
    sellerId: 'u3',
    category: 'men',
    subcategory: 'Clothing',
    description: 'Classic Ralph Lauren Harrington jacket in excellent condition.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l4',
    title: 'Stüssy Logo Tee',
    brand: 'Stüssy',
    size: 'XL',
    condition: 'Very good',
    price: 53,
    priceWithProtection: 56.35,
    images: [
      'https://picsum.photos/seed/stussy1/400/500',
      'https://picsum.photos/seed/stussy2/400/500',
    ],
    likes: 25,
    sellerId: 'u1',
    category: 'men',
    subcategory: 'Clothing',
    description: 'Rare Stüssy graphic tee from the New York collection.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l5',
    title: 'Off-White Mohair Zip Hoodie',
    brand: 'Off-White',
    size: 'XL',
    condition: 'Very good',
    price: 180,
    priceWithProtection: 190.80,
    images: [
      'https://picsum.photos/seed/offwhite1/400/500',
    ],
    likes: 23,
    sellerId: 'u2',
    category: 'men',
    subcategory: 'Clothing',
    description: 'Iconic Off-White arrow hoodie. Authentic, with tags.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l6',
    title: 'Nike Air Max 90 White',
    brand: 'Nike',
    size: '10',
    condition: 'Good',
    price: 75,
    priceWithProtection: 79.50,
    images: [
      'https://picsum.photos/seed/nike1/400/500',
    ],
    likes: 18,
    sellerId: 'u3',
    category: 'men',
    subcategory: 'Shoes',
    description: 'Classic Air Max 90 in white. Light signs of wear on soles.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l7',
    title: 'Zara Cargo Trousers',
    brand: 'Zara',
    size: 'S',
    condition: 'New with tags',
    price: 35,
    priceWithProtection: 37.10,
    images: [
      'https://picsum.photos/seed/zara1/400/500',
    ],
    likes: 67,
    sellerId: 'u4',
    category: 'women',
    subcategory: 'Clothing',
    description: 'Brand new with tags cargo trousers from Zara. Never worn.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l8',
    title: 'Jacquemus Mini Bag',
    brand: 'Jacquemus',
    size: 'One size',
    condition: 'Very good',
    price: 320,
    priceWithProtection: 339.20,
    images: [
      'https://picsum.photos/seed/jacq1/400/500',
    ],
    likes: 91,
    sellerId: 'u1',
    category: 'women',
    subcategory: 'Bags',
    description: 'Authentic Jacquemus Le Chiquito mini bag in excellent condition.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l9',
    title: 'Represent Oversized Hoodie',
    brand: 'Represent',
    size: 'L',
    condition: 'Very good',
    price: 120,
    priceWithProtection: 127.20,
    images: [
      'https://picsum.photos/seed/represent1/400/500',
    ],
    likes: 33,
    isBumped: true,
    sellerId: 'u2',
    category: 'men',
    subcategory: 'Clothing',
    description: 'Premium Represent Clo. hoodie in large. Great condition.',
    createdAt: '2026-03-28T10:00:00Z',
  },
  {
    id: 'l10',
    title: 'Converse Chuck Taylor High',
    brand: 'Converse',
    size: '9',
    condition: 'Good',
    price: 42,
    priceWithProtection: 44.52,
    images: [
      'https://picsum.photos/seed/converse1/400/500',
    ],
    likes: 11,
    sellerId: 'u3',
    category: 'men',
    subcategory: 'Shoes',
    description: 'Classic black and white Chuck Taylors.',
    createdAt: '2026-03-28T10:00:00Z',
  },
];

// ─── MOCK CONVERSATIONS ───────────────────────────────────────────────────────
export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'c1',
    sellerId: 'u1',
    itemId: 'l2',
    lastMessage: "Sorry, I'm tied up at the moment – I'll p...",
    lastMessageTime: '13 hours ago',
    unread: false,
    messages: [
      {
        id: 'm1',
        senderId: 'u1',
        text: "Hi, I'm mariefullery",
        timestamp: '19/03/2026',
      },
      {
        id: 'm2',
        senderId: 'me',
        offerPrice: 30,
        originalPrice: 48,
        offerStatus: 'declined',
        timestamp: '19/03/2026',
      },
      {
        id: 'm3',
        senderId: 'u1',
        offerPrice: 35,
        originalPrice: 48,
        timestamp: '19/03/2026',
      },
      {
        id: 'm4',
        senderId: 'system',
        isSystem: true,
        systemTitle: 'Purchase successful',
        text: 'mariefullery has to send it before 26 Mar. We\'ll keep you updated on the progress.',
        timestamp: '19/03/2026',
      },
      {
        id: 'm5',
        senderId: 'system',
        isSystem: true,
        systemTitle: 'mariefullery is preparing your order',
        text: 'mariefullery has to send it before 26 Mar. You\'ll be able to track the parcel as soon as it\'s sent.',
        timestamp: '20/03/2026',
      },
    ],
  },
  {
    id: 'c2',
    sellerId: 'u3',
    itemId: 'l6',
    lastMessage: 'Shout if you want more pics or questio...',
    lastMessageTime: 'a day ago',
    unread: false,
    messages: [],
  },
];

// ─── MOCK NOTIFICATIONS ──────────────────────────────────────────────────────
export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    itemImage: 'https://picsum.photos/seed/noti1/80/80',
    text: 'scott_art has just uploaded new items: Giorgio Armani avant garde black wool wide leg trousers size 32 inch and more.',
    time: 'Just now',
    type: 'new_item',
  },
  {
    id: 'n2',
    itemImage: 'https://picsum.photos/seed/noti2/80/80',
    text: 'dankdunksuk has just uploaded new items: Umbro West Ham home jersey, Burberry nova check slim chinos and more.',
    time: 'an hour ago',
    type: 'new_item',
  },
  {
    id: 'n3',
    itemImage: 'https://picsum.photos/seed/noti3/80/80',
    text: 'lucygibson94 has just uploaded new items: Ralph Lauren Pink & Blue Striped Shirt, Ralph Lauren Burgundy Plain Shirt and more.',
    time: '2 hours ago',
    type: 'new_item',
  },
];

// ─── MOCK REVIEWS ─────────────────────────────────────────────────────────────
export const MOCK_REVIEWS: Review[] = [
  {
    id: 'r1',
    reviewerId: 'thryftverse',
    reviewerName: 'Thryftverse',
    reviewerAvatar: 'https://picsum.photos/seed/app/80/80',
    rating: 5,
    text: 'Auto-feedback: Sale completed successfully',
    date: '6 days ago',
    isAutomatic: true,
  },
  {
    id: 'r2',
    reviewerId: 'thryftverse',
    reviewerName: 'Thryftverse',
    reviewerAvatar: 'https://picsum.photos/seed/app/80/80',
    rating: 5,
    text: 'Auto-feedback: Sale completed successfully',
    date: 'a week ago',
    isAutomatic: true,
  },
  {
    id: 'r3',
    reviewerId: 'u3',
    reviewerName: 'dankdunksuk',
    reviewerAvatar: 'https://picsum.photos/seed/dank/80/80',
    rating: 5,
    text: 'Great seller! Item exactly as described, fast shipping.',
    date: '2 weeks ago',
    isAutomatic: false,
  },
  {
    id: 'r4',
    reviewerId: 'u4',
    reviewerName: 'lucygibson94',
    reviewerAvatar: 'https://picsum.photos/seed/lucy/80/80',
    rating: 5,
    text: 'Lovely product. Would definitely buy again.',
    date: '3 weeks ago',
    isAutomatic: false,
  },
];

export const MY_USER: User = {
  id: 'me',
  username: 'thryftuser',
  avatar: 'https://picsum.photos/seed/me/200/200',
  coverPhoto: 'https://picsum.photos/seed/mycover/800/400',
  rating: 4.6,
  reviewCount: 12,
  location: 'London, United Kingdom',
  followers: 24,
  following: 31,
  isVerified: true,
  badges: [],
  lastSeen: 'Now',
  listingCount: 14,
};

// ─── MOCK CATEGORIES ───────────────────────────────────────────────────────────
export const MOCK_CATEGORIES = [
  { id: 'cat1', name: 'Vintage', subItems: [{ id: 'sub1', name: 'Hoodies' }, { id: 'sub2', name: 'Tees' }] },
  { id: 'cat2', name: 'Y2K', subItems: [{ id: 'sub3', name: 'Tops' }, { id: 'sub4', name: 'Accessories' }] },
  { id: 'cat3', name: 'Designer', subItems: [{ id: 'sub5', name: 'Bags' }, { id: 'sub6', name: 'Shoes' }] },
  { id: 'cat4', name: 'Streetwear', subItems: [{ id: 'sub7', name: 'Sneakers' }, { id: 'sub8', name: 'Jackets' }] },
];

export const MOCK_ADDRESSES: Address[] = [
  { id: 'addr1', name: 'Thryft User', street: '123 Fake Street', city: 'London', postcode: 'W1D 1AN', isDefault: true },
];

export const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm1', type: 'card', brand: 'visa', last4: '4242', expiry: '12/28', isDefault: true },
];

export const MOCK_ORDERS: Order[] = [
  { id: 'ord1', listingId: 'l2', buyerId: 'me', sellerId: 'u2', status: 'shipped', totalPrice: 51.10, trackingNumber: 'TRK123456', createdAt: '2026-03-25T14:30:00Z' },
];

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 'tx1', type: 'sale', amount: 48.00, status: 'completed', date: '2026-03-20T10:20:00Z', description: 'Sold: AMI Striped Shirt' },
  { id: 'tx2', type: 'withdrawal', amount: -20.00, status: 'completed', date: '2026-03-22T09:15:00Z', description: 'Bank transfer' },
];
