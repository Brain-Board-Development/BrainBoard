/**
 * StudentDashboard.js
 * 
 * This is the **main dashboard for Student account type** in Brain Board.
 * It serves as the central hub after login, showing:
 *   • User's coin balance
 *   • Quick Join Game button
 *   • Searchable list of Recent & Favorited games
 *   • Navigation to Shop, Settings, Profile, and Logout
 * 
 * What it does:
 * 1. **Header Bar**:
 *    • App logo + global search
 *    • Nav links: Shop, Settings, Profile dropdown
 *    • Hover effects on web
 * 
 * 2. **Welcome Section**:
 *    • Personalized greeting with username
 *    • Current coin balance (gold coins)
 *    • Prominent "Quick Join Game" CTA
 * 
 * 3. **Tabbed Game Lists**:
 *    • **Recent**: Last 10 played games (via `gameHistory`)
 *    • **Favorites**: Games marked as favorite (via `favorites` collection)
 *    • Real-time search by title or tags
 * 
 * 4. **Game Cards**:
 *    • Title, tags, # of questions, description, creator
 *    • "Join Game" button → navigates to JoinGameScreen with `gameId`
 *    • Web: hover scale + color animation
 * 
 * 5. **Profile Dropdown**:
 *    • Click username → opens modal menu
 *    • Options: View Profile, Log Out
 *    • Positioned dynamically below button
 * 
 * 6. **Data Flow**:
 *    • On mount: fetches user data, recent games, favorites
 *    • Uses `userToken` from AsyncStorage
 *    • Queries:
 *      - `users/{uid}` → username, coins
 *      - `gameHistory` → playerId + playedAt
 *      - `favorites` → userId + gameId
 *      - `games` → full game metadata
 * 
 * 7. **Logout**:
 *    • Firebase `signOut()`
 *    • Clears `userToken`
 *    • Navigates to Home (replace to prevent back)
 * 
 * Important:
 *    • **Assigned Games** section is planned but not implemented
 *    • All navigation uses `navigation.navigate()` or `replace()`
 *    • Web-specific hover + transform animations
 *    • Mobile: tap-to-open profile menu
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Platform,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth } from '../firebaseConfig';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  orderBy,
  limit,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';

/**
 * StudentDashboard – main student hub with game history, favorites, and navigation
 * @param {object} navigation – React Navigation prop
 */
export default function StudentDashboard({ navigation }) {
  // ——————————————————————————————————————
  // 1. STATE MANAGEMENT
  // ——————————————————————————————————————
  const [hoveredButton, setHoveredButton] = useState(null);     // Web hover tracking
  const [recentGames, setRecentGames] = useState([]);           // Recently played games
  const [favoritedGames, setFavoritedGames] = useState([]);     // User's favorited games
  const [searchQuery, setSearchQuery] = useState('');           // Search input
  const [userData, setUserData] = useState(null);               // Firestore user doc
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false); // Profile dropdown
  const [activeTab, setActiveTab] = useState('recent');         // 'recent' or 'favorited'
  const profileButtonRef = useRef(null);                        // Ref for positioning menu
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 }); // Menu coordinates

  // ——————————————————————————————————————
  // 2. DATA FETCHING (on mount)
  // ——————————————————————————————————————
  /**
   * Fetches user profile, recent games, and favorites
   * Runs once on component mount
   */
  useEffect(() => {
    const fetchUserDataAndGames = async () => {
      try {
        // Get persisted user token
        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) {
          navigation.replace('Home');
          return;
        }

        // ——— Fetch User Data ———
        const userDoc = await getDoc(doc(db, 'users', userToken));
        if (userDoc.exists()) {
          setUserData(userDoc.data());
        }

        // ——— Fetch Recent Games (last 10) ———
        const gameHistoryRef = collection(db, 'gameHistory');
        const recentQ = query(
          gameHistoryRef,
          where('playerId', '==', userToken),
          orderBy('playedAt', 'desc'),
          limit(10)
        );
        const recentSnapshot = await getDocs(recentQ);
        const recentGameIds = recentSnapshot.docs.map(doc => doc.data().gameId);

        // ——— Fetch All Games (to get metadata) ———
        const gamesRef = collection(db, 'games');
        const gamesSnapshot = await getDocs(gamesRef);
        const allGames = gamesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // ——— Match recent game IDs → full game objects ———
        const recentGamesData = allGames.filter(game => recentGameIds.includes(game.id));
        setRecentGames(recentGamesData);

        // ——— Fetch Favorites ———
        const favoritesQ = query(
          collection(db, 'favorites'),
          where('userId', '==', userToken)
        );
        const favoritesSnapshot = await getDocs(favoritesQ);
        const favoriteGameIds = favoritesSnapshot.docs.map(doc => doc.data().gameId);
        const favoritedGamesData = allGames.filter(game => favoriteGameIds.includes(game.id));
        setFavoritedGames(favoritedGamesData);
      } catch (error) {
        console.error('Error fetching student data or games:', error);
        // Optionally show toast/error banner
      }
    };

    fetchUserDataAndGames();
  }, [navigation]);

  // ——————————————————————————————————————
  // 3. PROFILE MENU POSITIONING
  // ——————————————————————————————————————
  /**
   * Measures profile button position to place dropdown menu
   */
  const handleProfileButtonLayout = () => {
    if (profileButtonRef.current) {
      profileButtonRef.current.measureInWindow((x, y, width, height) => {
        setMenuPosition({ x: x - 100, y: y + height + 5 });
      });
    }
  };

  // ——————————————————————————————————————
  // 4. LOGOUT HANDLER
  // ——————————————————————————————————————
  /**
   * Signs out user and clears session
   */
  const handleLogout = async () => {
    try {
      await signOut(auth);                    // Firebase sign out
      await AsyncStorage.removeItem('userToken'); // Clear local token
      setIsProfileMenuOpen(false);             // Close menu
      navigation.replace('Home');              // Prevent back navigation
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback: still navigate to avoid lockout
      navigation.replace('Home');
    }
  };

  // ——————————————————————————————————————
  // 5. GAME FILTERING (search + tab)
  // ——————————————————————————————————————
  /**
   * Filters games by search query and active tab
   */
  const filteredGames = (activeTab === 'recent' ? recentGames : favoritedGames).filter(game =>
    game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (game.tags && game.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  // ——————————————————————————————————————
  // 6. GAME CARD RENDERER
  // ——————————————————————————————————————
  /**
   * Renders individual game card with join button
   * @param {object} item - Game object
   */
  const renderGameItem = ({ item }) => {
    const getJoinBtnStyle = () => [
      styles.joinBtn,
      {
        backgroundColor: hoveredButton === `join-${item.id}` ? '#00e092' : '#00c781',
        transform: [{ scale: hoveredButton === `join-${item.id}` ? 1.05 : 1 }],
      },
    ];

    return (
      <View style={styles.gameCard}>
        <Text style={styles.gameTitle}>{item.title}</Text>
        <Text style={styles.gameDetails}>
          {item.tags ? item.tags.join(', ') : 'No tags'} | {item.numQuestions} Questions
        </Text>
        <Text style={styles.gameDescription}>{item.description || 'No description'}</Text>
        <Text style={styles.gameCreator}>Created by: {item.creatorName || 'Unknown'}</Text>
        <TouchableOpacity
          style={getJoinBtnStyle()}
          onPress={() => navigation.navigate('JoinGameScreen', { gameId: item.id })}
          // Web hover effects
          {...(Platform.OS === 'web' && {
            onMouseEnter: () => setHoveredButton(`join-${item.id}`),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          <Text style={styles.joinBtnText}>Join Game</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ——————————————————————————————————————
  // 7. NAVIGATION HANDLERS
  // ——————————————————————————————————————
  /**
   * Navigates to code entry screen
   */
  const handleJoinGame = () => {
    navigation.navigate('JoinGameScreen');
  };

  // ——————————————————————————————————————
  // 8. DYNAMIC STYLES
  // ——————————————————————————————————————
  /**
   * Navigation button style (Shop, Settings, Profile)
   */
  const getNavBtnStyle = (buttonName) => [
    styles.navBtn,
    {
      backgroundColor: hoveredButton === buttonName ? '#333' : 'transparent',
    },
  ];

  /**
   * Tab button style (Recent / Favorites)
   */
  const getTabStyle = (tabName) => [
    styles.tabBtn,
    {
      backgroundColor: activeTab === tabName ? '#00c781' : 'transparent',
      borderBottomColor: activeTab === tabName ? '#00e092' : '#333',
    },
  ];

  /**
   * Quick Join button style
   */
  const getJoinBtnStyle = () => [
    styles.joinBtn,
    {
      backgroundColor: hoveredButton === 'quickJoin' ? '#00e092' : '#00c781',
      transform: [{ scale: hoveredButton === 'quickJoin' ? 1.05 : 1 }],
    },
  ];

  /**
   * Profile menu item style
   */
  const getProfileMenuItemStyle = (buttonName) => [
    styles.profileMenuItem,
    {
      backgroundColor: hoveredButton === buttonName ? '#333' : '#222',
    },
  ];

  // ——————————————————————————————————————
  // 9. MAIN RENDER
  // ——————————————————————————————————————
  return (
    <View style={styles.container}>
      {/* ——————— HEADER ——————— */}
      <View style={styles.header}>
        <View style={styles.leftSection}>
          <Text style={styles.logo}>Brain Board</Text>
          <View style={styles.searchContainer}>
            <Text style={styles.searchIcon}>Search</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search games..."
              placeholderTextColor="#ccc"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>
        <View style={styles.navLinks}>
          <TouchableOpacity
            style={getNavBtnStyle('shop')}
            onPress={() => navigation.navigate('Shop')}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('shop'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.navText}>Shop</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={getNavBtnStyle('settings')}
            onPress={() => navigation.navigate('Settings')}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('settings'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.navText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={profileButtonRef}
            style={getNavBtnStyle('profile')}
            onPress={() => {
              handleProfileButtonLayout();
              setIsProfileMenuOpen(true);
            }}
            onLayout={handleProfileButtonLayout}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('profile'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.navText}>
              {userData ? userData.username : 'Profile'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ——————— PROFILE DROPDOWN MODAL ——————— */}
      <Modal
        visible={isProfileMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsProfileMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setIsProfileMenuOpen(false)}
        >
          <View
            style={[
              styles.profileMenu,
              {
                top: menuPosition.y,
                left: menuPosition.x,
              },
            ]}
          >
            <TouchableOpacity
              style={getProfileMenuItemStyle('profile-view')}
              onPress={() => {
                setIsProfileMenuOpen(false);
                navigation.navigate('Profile');
              }}
              // Web hover
              {...(Platform.OS === 'web' && {
                onMouseEnter: () => setHoveredButton('profile-view'),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text style={styles.profileMenuItemText}>View Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={getProfileMenuItemStyle('logout')}
              onPress={handleLogout}
              // Web hover
              {...(Platform.OS === 'web' && {
                onMouseEnter: () => setHoveredButton('logout'),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text style={styles.profileMenuItemText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ——————— MAIN CONTENT ——————— */}
      <View style={styles.content}>
        {/* Welcome + Coins + Quick Join */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>
            Welcome back, {userData ? userData.username : 'Student'}!
          </Text>
          <Text style={styles.coinsText}>
            {userData?.coins || 0} Coins
          </Text>
          <TouchableOpacity
            style={getJoinBtnStyle()}
            onPress={handleJoinGame}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('quickJoin'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.joinBtnText}>Quick Join Game</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs: Recent / Favorites */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={getTabStyle('recent')}
            onPress={() => setActiveTab('recent')}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === 'recent' ? '#fff' : '#ccc' }
            ]}>Recent</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={getTabStyle('favorited')}
            onPress={() => setActiveTab('favorited')}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === 'favorited' ? '#fff' : '#ccc' }
            ]}>Favorites</Text>
          </TouchableOpacity>
        </View>

        {/* Games List or Empty State */}
        <View style={styles.gamesSection}>
          <Text style={styles.sectionTitle}>
            {activeTab === 'recent' ? 'Recently Played' : 'Favorited Games'}
          </Text>
          {filteredGames.length > 0 ? (
            <FlatList
              data={filteredGames}
              renderItem={renderGameItem}
              keyExtractor={(item) => item.id}
              style={styles.gamesList}
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.noGamesText}>
                {activeTab === 'recent'
                  ? 'No games played yet! Join a game to see them here.'
                  : 'No favorited games yet! Join games and favorite your favorites.'
                }
              </Text>
              <TouchableOpacity
                style={getJoinBtnStyle()}
                onPress={handleJoinGame}
                // Web hover
                {...(Platform.OS === 'web' && {
                  onMouseEnter: () => setHoveredButton('quickJoin'),
                  onMouseLeave: () => setHoveredButton(null),
                })}
              >
                <Text style={styles.joinBtnText}>Find a Game to Play</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ——————————————————————————————————————
// STYLES – Dark, modern, responsive dashboard
// ——————————————————————————————————————
const styles = StyleSheet.create({
  // Full screen
  container: {
    flex: 1,
    backgroundColor: '#111',
  },

  // Fixed top header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(17, 17, 17, 0.95)',
    backdropFilter: 'blur(8px)',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17, 17, 17, 0.95)',
  },

  // Left: logo + search
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginRight: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginLeft: 12,
    height: 36,
    borderWidth: 2,
    borderColor: '#222',
  },
  searchIcon: {
    color: '#ccc',
    fontSize: 18,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },

  // Right: nav links
  navLinks: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginHorizontal: 5,
  },
  navText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },

  // Main scrollable content
  content: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 20,
  },

  // Welcome section
  welcomeSection: {
    alignItems: 'center',
    marginVertical: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  coinsText: {
    fontSize: 18,
    color: '#FFD700',
    marginBottom: 20,
  },

  // Join buttons
  joinBtn: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    alignItems: 'center',
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: 3,
    marginHorizontal: 5,
  },
  tabText: {
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Games section
  gamesSection: {
    marginVertical: 20,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 15,
  },
  gamesList: {
    width: '100%',
  },

  // Game card
  gameCard: {
    backgroundColor: '#222',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
  },
  gameTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  gameDetails: {
    fontSize: 14,
    color: '#ccc',
    marginVertical: 5,
  },
  gameDescription: {
    fontSize: 14,
    color: '#ccc',
    marginBottom: 5,
  },
  gameCreator: {
    fontSize: 12,
    color: '#888',
    marginBottom: 10,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  noGamesText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    marginBottom: 20,
  },

  // Profile menu modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  profileMenu: {
    backgroundColor: '#222',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    width: 150,
    position: 'absolute',
    zIndex: 30,
  },
  profileMenuItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  profileMenuItemText: {
    color: '#fff',
    fontSize: 16,
  },
});