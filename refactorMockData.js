const fs = require('fs');

let data = fs.readFileSync('src/data/mockData.ts', 'utf8');

// 1. Update Listing interface
data = data.replace(
  'description: string;\n}',
  'description: string;\n  createdAt?: string;\n}'
);

// 2. Add createdAt to MOCK_LISTINGS
data = data.replace(
  /description: '(.+)',/g,
  "description: '$1',\n    createdAt: '2026-03-28T10:00:00Z',"
);

// 3. New Interfaces block to prepend
const newInterfaces = `
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
`;

data = data.replace('export interface Listing', newInterfaces + '\nexport interface Listing');

// 4. Update the Message Interface
const newMsgInterface = `export interface Message {
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
}`;

data = data.replace(/export interface Message \{[\s\S]*?itemImage\?: string;\s*\}/, newMsgInterface);

// 5. Append new MOCK arrays
const newMocks = `
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
`;

data = data + newMocks;

fs.writeFileSync('src/data/mockData.ts', data);
console.log('mockData updated!');
