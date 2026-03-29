export interface SubCategory {
  id: string;
  name: string;
  icon: string; // Ionicons name
  hasChildren?: boolean;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  subcategories: SubCategory[];
}

export const CATEGORIES: Category[] = [
  {
    id: 'women',
    name: 'Women',
    emoji: '👗',
    color: '#1c1c1c',
    subcategories: [
      { id: 'women-clothing', name: 'Clothing', icon: 'shirt-outline', hasChildren: true },
      { id: 'women-shoes', name: 'Shoes', icon: 'footsteps-outline', hasChildren: true },
      { id: 'women-bags', name: 'Bags', icon: 'bag-handle-outline', hasChildren: true },
      { id: 'women-accessories', name: 'Accessories', icon: 'watch-outline', hasChildren: true },
      { id: 'women-beauty', name: 'Beauty', icon: 'flower-outline', hasChildren: true },
    ],
  },
  {
    id: 'men',
    name: 'Men',
    emoji: '🧥',
    color: '#1c1c1c',
    subcategories: [
      { id: 'men-clothing', name: 'Clothing', icon: 'shirt-outline', hasChildren: true },
      { id: 'men-shoes', name: 'Shoes', icon: 'footsteps-outline', hasChildren: true },
      { id: 'men-accessories', name: 'Accessories', icon: 'watch-outline', hasChildren: true },
      { id: 'men-grooming', name: 'Grooming', icon: 'cut-outline' },
    ],
  },
  {
    id: 'designer',
    name: 'Designer',
    emoji: '👜',
    color: '#1c1c1c',
    subcategories: [
      { id: 'designer-bags', name: 'Bags & Accessories', icon: 'bag-outline', hasChildren: true },
      { id: 'designer-clothing', name: 'Clothing', icon: 'shirt-outline', hasChildren: true },
      { id: 'designer-shoes', name: 'Shoes', icon: 'footsteps-outline', hasChildren: true },
      { id: 'designer-jewellery', name: 'Jewellery & Watches', icon: 'diamond-outline', hasChildren: true },
    ],
  },
  {
    id: 'kids',
    name: 'Kids',
    emoji: '🐰',
    color: '#1c1c1c',
    subcategories: [
      { id: 'kids-clothing', name: 'Clothing', icon: 'shirt-outline', hasChildren: true },
      { id: 'kids-shoes', name: 'Shoes', icon: 'footsteps-outline', hasChildren: true },
      { id: 'kids-toys', name: 'Toys & Games', icon: 'game-controller-outline', hasChildren: true },
      { id: 'kids-accessories', name: 'Accessories', icon: 'happy-outline' },
    ],
  },
  {
    id: 'home',
    name: 'Home',
    emoji: '🏮',
    color: '#1c1c1c',
    subcategories: [
      { id: 'home-kitchen-small', name: 'Small kitchen appliances', icon: 'cafe-outline', hasChildren: true },
      { id: 'home-kitchen-large', name: 'Large appliances', icon: 'terminal-outline', hasChildren: true },
      { id: 'home-cookware', name: 'Cookware & bakeware', icon: 'restaurant-outline', hasChildren: true },
      { id: 'home-tools', name: 'Kitchen tools', icon: 'construct-outline' },
      { id: 'home-tableware', name: 'Tableware', icon: 'wine-outline', hasChildren: true },
      { id: 'home-care', name: 'Household care', icon: 'sparkles-outline', hasChildren: true },
      { id: 'home-textiles', name: 'Textiles', icon: 'color-palette-outline', hasChildren: true },
      { id: 'home-accessories', name: 'Home accessories', icon: 'home-outline', hasChildren: true },
      { id: 'home-office', name: 'Office supplies', icon: 'briefcase-outline', hasChildren: true },
      { id: 'home-celebrations', name: 'Celebrations & holidays', icon: 'gift-outline', hasChildren: true },
      { id: 'home-diy', name: 'Tools & DIY', icon: 'hammer-outline', hasChildren: true },
    ],
  },
  {
    id: 'electronics',
    name: 'Electronics',
    emoji: '📱',
    color: '#1c1c1c',
    subcategories: [
      { id: 'elec-gaming', name: 'Video games & consoles', icon: 'game-controller-outline', hasChildren: true },
      { id: 'elec-computers', name: 'Computers & accessories', icon: 'laptop-outline', hasChildren: true },
      { id: 'elec-phones', name: 'Mobile phones & communication', icon: 'phone-portrait-outline', hasChildren: true },
      { id: 'elec-audio', name: 'Audio, headphones & hi-fi', icon: 'headset-outline', hasChildren: true },
      { id: 'elec-cameras', name: 'Cameras & accessories', icon: 'camera-outline', hasChildren: true },
      { id: 'elec-tablets', name: 'Tablets, e-readers & accessories', icon: 'tablet-portrait-outline', hasChildren: true },
      { id: 'elec-tv', name: 'TV & home cinema', icon: 'tv-outline', hasChildren: true },
      { id: 'elec-beauty', name: 'Beauty & personal care electronics', icon: 'color-wand-outline', hasChildren: true },
      { id: 'elec-wearables', name: 'Wearables', icon: 'watch-outline', hasChildren: true },
      { id: 'elec-other', name: 'Other devices & accessories', icon: 'hardware-chip-outline', hasChildren: true },
    ],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    emoji: '📚',
    color: '#1c1c1c',
    subcategories: [
      { id: 'ent-books', name: 'Books', icon: 'book-outline', hasChildren: true },
      { id: 'ent-magazines', name: 'Magazines', icon: 'newspaper-outline' },
      { id: 'ent-music', name: 'Music', icon: 'musical-notes-outline', hasChildren: true },
      { id: 'ent-video', name: 'Video', icon: 'videocam-outline', hasChildren: true },
    ],
  },
  {
    id: 'hobbies',
    name: 'Hobbies & collectables',
    emoji: '🎭',
    color: '#1c1c1c',
    subcategories: [
      { id: 'hob-trading', name: 'Trading cards', icon: 'card-outline', hasChildren: true },
      { id: 'hob-board', name: 'Board games', icon: 'grid-outline' },
      { id: 'hob-puzzles', name: 'Puzzles', icon: 'extension-puzzle-outline' },
      { id: 'hob-tabletop', name: 'Tabletop & miniature gaming', icon: 'dice-outline' },
      { id: 'hob-memorabilia', name: 'Memorabilia', icon: 'ribbon-outline', hasChildren: true },
      { id: 'hob-coins', name: 'Coins & banknotes', icon: 'cash-outline', hasChildren: true },
      { id: 'hob-stamps', name: 'Stamps', icon: 'mail-outline', hasChildren: true },
      { id: 'hob-postcards', name: 'Postcards', icon: 'image-outline' },
      { id: 'hob-music', name: 'Musical instruments & gear', icon: 'musical-note-outline', hasChildren: true },
      { id: 'hob-arts', name: 'Arts & crafts', icon: 'color-palette-outline', hasChildren: true },
      { id: 'hob-storage', name: 'Collectables storage', icon: 'archive-outline', hasChildren: true },
    ],
  },
  {
    id: 'sports',
    name: 'Sports',
    emoji: '🏓',
    color: '#1c1c1c',
    subcategories: [
      { id: 'spt-cycling', name: 'Cycling', icon: 'bicycle-outline', hasChildren: true },
      { id: 'spt-fitness', name: 'Fitness, running & yoga', icon: 'fitness-outline', hasChildren: true },
      { id: 'spt-outdoor', name: 'Outdoor sports', icon: 'leaf-outline', hasChildren: true },
      { id: 'spt-water', name: 'Water sports', icon: 'water-outline', hasChildren: true },
      { id: 'spt-team', name: 'Team sports', icon: 'football-outline', hasChildren: true },
      { id: 'spt-racquet', name: 'Racquet sports', icon: 'tennisball-outline', hasChildren: true },
      { id: 'spt-golf', name: 'Golf', icon: 'golf-outline', hasChildren: true },
      { id: 'spt-equestrian', name: 'Equestrian', icon: 'ribbon-outline', hasChildren: true },
      { id: 'spt-skate', name: 'Skateboards & scooters', icon: 'rocket-outline', hasChildren: true },
      { id: 'spt-boxing', name: 'Boxing & martial arts', icon: 'shield-outline', hasChildren: true },
      { id: 'spt-casual', name: 'Casual sports & games', icon: 'game-controller-outline', hasChildren: true },
    ],
  },
];

export const FILTER_CHIPS = ['All', 'Women', 'Men', 'Designer', 'Kids', 'Home', 'Electronics', 'Sports'];
