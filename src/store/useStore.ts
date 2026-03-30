import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  avatar: string;
}

interface DraftListing {
  categoryId?: string;
  subcategoryId?: string;
  brand?: string;
  size?: string;
  condition?: string;
}

interface StoreState {
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;

  // Global Interactions
  favourites: string[]; // array of string item IDs
  toggleFavourite: (id: string) => void;
  isFavourite: (id: string) => boolean;

  // Notifications
  notificationCount: number;
  setNotificationCount: (count: number) => void;

  // Selling Draft
  sellDraft: DraftListing;
  updateSellDraft: (updates: Partial<DraftListing>) => void;
  clearSellDraft: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  currentUser: null, // Note: For a real app, load this from secure storage initially
  isAuthenticated: false,
  login: (user) => set({ currentUser: user, isAuthenticated: true }),
  logout: () => set({ currentUser: null, isAuthenticated: false }),

  favourites: [],
  toggleFavourite: (id) =>
    set((state) => {
      const isFav = state.favourites.includes(id);
      return {
        favourites: isFav
          ? state.favourites.filter((fid) => fid !== id)
          : [...state.favourites, id],
      };
    }),
  isFavourite: (id) => get().favourites.includes(id),

  notificationCount: 3, // Hardcoded initial mock badge
  setNotificationCount: (count) => set({ notificationCount: count }),

  sellDraft: {},
  updateSellDraft: (updates) =>
    set((state) => ({ sellDraft: { ...state.sellDraft, ...updates } })),
  clearSellDraft: () => set({ sellDraft: {} }),
}));
