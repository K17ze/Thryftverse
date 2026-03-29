import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, ImageBackground } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';

type RouteT = RouteProp<RootStackParamList, 'CategoryTree'>;

// Premium imagery for category headers
const CAT_IMAGES: Record<string, string> = {
  Clothing: 'https://images.unsplash.com/photo-1550614000-4b95d466f204?w=800&q=80',
  Shoes: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80',
  Bags: 'https://images.unsplash.com/photo-1584916201218-f4242ceb4809?w=800&q=80',
  Accessories: 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=800&q=80',
  Girls: 'https://images.unsplash.com/photo-1519689680058-324335c77eba?w=800&q=80',
  Boys: 'https://images.unsplash.com/photo-1471286174890-9c11241eb988?w=800&q=80',
  Baby: 'https://images.unsplash.com/photo-1519238323602-513470ffbd2a?w=800&q=80',
};

const TREES: Record<string, { title: string; subs: string[] }[]> = {
  Women: [
    { title: 'Clothing', subs: ['Dresses', 'Tops & T-Shirts', 'Trousers', 'Jackets & Coats', 'Knitwear'] },
    { title: 'Shoes', subs: ['Trainers', 'Boots', 'Heels', 'Flats'] },
    { title: 'Bags', subs: ['Shoulder Bags', 'Tote Bags', 'Crossbody Bags'] },
    { title: 'Accessories', subs: ['Jewellery', 'Belts', 'Sunglasses'] }
  ],
  Men: [
    { title: 'Clothing', subs: ['T-Shirts', 'Hoodies & Sweatshirts', 'Trousers', 'Jackets & Coats', 'Jeans'] },
    { title: 'Shoes', subs: ['Trainers', 'Boots', 'Formal Shoes'] },
    { title: 'Accessories', subs: ['Watches', 'Hats & Caps', 'Belts'] }
  ],
  Kids: [
    { title: 'Girls', subs: ['Clothing', 'Shoes', 'Accessories'] },
    { title: 'Boys', subs: ['Clothing', 'Shoes', 'Accessories'] },
    { title: 'Baby', subs: ['0-6 Months', '6-12 Months', '12-24 Months'] }
  ]
};

export default function CategoryTreeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteT>();
  const { categoryPrefix } = route.params;

  const sections = TREES[categoryPrefix] || TREES['Women'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{categoryPrefix}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* View All Master Button */}
        <TouchableOpacity 
          style={styles.viewAllRow}
          onPress={() => navigation.navigate('Browse', { categoryId: categoryPrefix.toLowerCase(), title: `All ${categoryPrefix}` })}
          activeOpacity={0.9}
        >
          <Text style={styles.viewAllText}>View All {categoryPrefix}</Text>
          <Ionicons name="arrow-forward" size={20} color={Colors.background} />
        </TouchableOpacity>

        {sections.map((section, index) => (
          <View key={section.title} style={styles.section}>
             {/* Edge-to-edge imagery for category headers */}
            <TouchableOpacity 
              activeOpacity={0.9} 
              onPress={() => navigation.navigate('Browse', { 
                categoryId: categoryPrefix.toLowerCase(), 
                title: `${categoryPrefix} ${section.title}`
              })}
            >
              <ImageBackground 
                source={{ uri: CAT_IMAGES[section.title] || CAT_IMAGES['Clothing'] }} 
                style={styles.categoryBanner}
                imageStyle={{ opacity: 0.6 }}
              >
                <View style={styles.bannerOverlay}>
                  <Text style={styles.bannerTitle}>{section.title}</Text>
                  <Ionicons name="arrow-forward" size={24} color="#fff" />
                </View>
              </ImageBackground>
            </TouchableOpacity>

            {/* Premium Pilled Subcategories instead of standard rows */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subsScroll}>
              {section.subs.map(sub => (
                <TouchableOpacity 
                  key={sub} 
                  style={styles.subPill}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('Browse', { 
                    categoryId: categoryPrefix.toLowerCase(), 
                    subcategoryId: sub.toLowerCase(),
                    title: sub
                  })}
                >
                  <Text style={styles.subPillText}>{sub}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ))}

        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    height: 56, 
    borderBottomWidth: 1, 
    borderBottomColor: '#1A1A1A' 
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 1 },

  viewAllRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 24, 
    backgroundColor: Colors.textPrimary,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
    borderRadius: 16,
  },
  viewAllText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.background, textTransform: 'uppercase', letterSpacing: 0.5 },

  section: { marginTop: 16 },
  
  categoryBanner: {
    height: 140,
    justifyContent: 'flex-end',
    backgroundColor: '#111',
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  bannerOverlay: {
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  bannerTitle: {
    fontSize: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: '#fff',
    letterSpacing: -0.5,
  },

  subsScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  subPill: {
    backgroundColor: '#111',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  subPillText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});
