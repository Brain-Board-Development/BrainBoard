/**
 * TeacherDashboard.js
 * 
 * This is the **main dashboard for Teacher account type** in Brain Board.
 * It allows teachers to:
 *   • View, search, and manage their created games
 *   • Host, edit, or delete games
 *   • Create new games with a title prompt
 *   • Access Library, Settings, Profile, and Logout
 * 
 * What it does:
 * 1. **Header Bar**:
 *    • App logo + search (filters by title/tags)
 *    • Nav: Library, Settings, Profile dropdown
 *    • Hover effects on web
 * 
 * 2. **Welcome Section**:
 *    • Personalized greeting
 *    • "Create New Game" button → opens title modal
 * 
 * 3. **Game List**:
 *    • Displays all games where `creatorId === user.uid`
 *    • Each card shows: title, tags, # questions, description
 *    • Action buttons: **Host**, **Edit**, **Delete**
 * 
 * 4. **Create Game Flow**:
 *    • Click "Create New Game" → modal asks for title
 *    • On save → navigates to `CreateGameMenu` with `initialTitle`
 * 
 * 5. **Edit Game**:
 *    • Click "Edit" → navigates to `CreateGameMenu` with `gameId` + `gameData`
 * 
 * 6. **Delete Game**:
 *    • Click "Delete" → confirmation modal
 *    • Deletes:
 *      - All associated images from Firebase Storage
 *      - Game document from Firestore
 *    • Shows loading spinner during deletion
 *    • Removes from UI on success
 * 
 * 7. **Profile Dropdown**:
 *    • Click username → opens menu
 *    • Options: View Profile, Log Out
 *    • Positioned dynamically
 * 
 * 8. **Data Flow**:
 *    • On mount: fetches user + games via `userToken`
 *    • Listens for `route.params.newGame` → adds to list
 *    • Real-time search filtering
 * 
 * 9. **Logout**:
 *    • Firebase `signOut()`
 *    • Clears `userToken`
 *    • Resets navigation stack to Home
 * 
 * Important:
 *    • Uses **custom modals** (not Alert) for better UX
 *    • Handles image cleanup in Storage on delete
 *    • Prevents double-delete with `deletingIds` Set
 *    • Web: hover animations on all buttons
 *    • Mobile: tap-to-open menus
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
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth, storage } from '../firebaseConfig';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ref, deleteObject } from 'firebase/storage';

/**
 * TeacherDashboard – central hub for teachers to manage their games
 * @param {object} navigation – React Navigation prop
 * @param {object} route – Route params (e.g., newGame from CreateGameMenu)
 */
export default function TeacherDashboard({ navigation, route }) {
  // ——————————————————————————————————————
  // 1. STATE MANAGEMENT
  // ——————————————————————————————————————
  const [hoveredButton, setHoveredButton] = useState(null);           // Web hover tracking
  const [games, setGames] = useState([]);                             // Teacher's games
  const [searchQuery, setSearchQuery] = useState('');                 // Search input
  const [userData, setUserData] = useState(null);                     // Firestore user doc
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);  // Profile dropdown
  const profileButtonRef = useRef(null);                              // For menu positioning
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });   // Dropdown coords
  const [deletingIds, setDeletingIds] = useState(new Set());          // Prevent double-delete

  // Delete confirmation modal state
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    gameId: null,
    gameTitle: '',
  });

  // Title input modal (for new game or edit)
  const [titleModal, setTitleModal] = useState({
    isOpen: false,
    currentTitle: '',
    onSave: (title) => {}, // Callback when user saves title
  });

  // ——————————————————————————————————————
  // 2. FETCH USER DATA & GAMES (on mount)
  // ——————————————————————————————————————
  /**
   * Loads user profile and all games created by this teacher
   */
  useEffect(() => {
    const fetchUserDataAndGames = async () => {
      try {
        const userToken = await AsyncStorage.getItem('userToken');
        if (!userToken) {
          console.error('No user token found');
          navigation.replace('Home');
          return;
        }

        // ——— Fetch User Data ———
        const userDoc = await getDoc(doc(db, 'users', userToken));
        if (userDoc.exists()) {
          setUserData(userDoc.data());
        }

        // ——— Fetch Teacher's Games ———
        const gamesRef = collection(db, 'games');
        const q = query(gamesRef, where('creatorId', '==', userToken));
        const querySnapshot = await getDocs(q);
        const fetchedGames = querySnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setGames(fetchedGames);
      } catch (error) {
        console.error('Error fetching user data or games:', error);
      }
    };

    fetchUserDataAndGames();
  }, [navigation]);

  // ——————————————————————————————————————
  // 3. HANDLE NEW GAME FROM CreateGameMenu
  // ——————————————————————————————————————
  /**
   * Listens for `route.params.newGame` to add newly created game to list
   */
  useEffect(() => {
    if (route.params?.newGame) {
      setGames((prevGames) => [...prevGames, route.params.newGame]);
      navigation.setParams({ newGame: undefined }); // Clear param
    }
  }, [route.params, navigation]);

  // ——————————————————————————————————————
  // 4. PROFILE MENU POSITIONING
  // ——————————————————————————————————————
  /**
   * Measures profile button to position dropdown menu correctly
   */
  const handleProfileButtonLayout = () => {
    if (profileButtonRef.current) {
      profileButtonRef.current.measureInWindow((x, y, width, height) => {
        setMenuPosition({ x: x - 100, y: y + height + 5 });
      });
    }
  };

  // ——————————————————————————————————————
  // 5. LOGOUT HANDLER
  // ——————————————————————————————————————
  /**
   * Signs out user and resets navigation to Home
   */
  const handleLogout = async () => {
    try {
      await signOut(auth);
      await AsyncStorage.removeItem('userToken');
      setIsProfileMenuOpen(false);
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback navigation
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
    }
  };

  // ——————————————————————————————————————
  // 6. DELETE MODAL CONTROLS
  // ——————————————————————————————————————
  /**
   * Opens delete confirmation modal
   * @param {string} gameId - Firestore doc ID
   * @param {string} gameTitle - Display title
   */
  const openDeleteModal = (gameId, gameTitle) => {
    setDeleteModal({
      isOpen: true,
      gameId,
      gameTitle,
    });
  };

  /** Closes delete modal */
  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, gameId: null, gameTitle: '' });
  };

  /**
   * Confirms deletion: removes images + Firestore doc
   */
  const confirmDelete = async () => {
    const { gameId } = deleteModal;
    if (!gameId || deletingIds.has(gameId)) return;

    // Prevent double-click
    const newDeleting = new Set(deletingIds);
    newDeleting.add(gameId);
    setDeletingIds(newDeleting);
    closeDeleteModal();

    try {
      const gameDocRef = doc(db, "games", gameId);
      const gameSnap = await getDoc(gameDocRef);
      if (!gameSnap.exists()) throw new Error("Game not found");

      const gameData = gameSnap.data();

      // ——— Delete associated images from Storage ———
      if (gameData.images && Array.isArray(gameData.images)) {
        await Promise.all(
          gameData.images.map(async (imageUrl) => {
            try {
              const path = decodeURIComponent(imageUrl.split("/o/")[1].split("?")[0]);
              const imageRef = ref(storage, path);
              await deleteObject(imageRef);
            } catch (err) {
              console.warn("Failed to delete image:", imageUrl, err);
            }
          })
        );
      }

      // ——— Delete Firestore document ———
      await deleteDoc(gameDocRef);

      // ——— Update UI ———
      setGames((prev) => prev.filter((g) => g.id !== gameId));
      console.log("Game deleted:", gameId);
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      const newDeleting = new Set(deletingIds);
      newDeleting.delete(gameId);
      setDeletingIds(newDeleting);
    }
  };

  // ——————————————————————————————————————
  // 7. GAME FILTERING
  // ——————————————————————————————————————
  /**
   * Filters games by title or tags
   */
  const filteredGames = games.filter(
    (game) =>
      game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (game.tags &&
        game.tags.some((tag) =>
          tag.toLowerCase().includes(searchQuery.toLowerCase())
        ))
  );

  // ——————————————————————————————————————
  // 8. GAME CARD RENDERER
  // ——————————————————————————————————————
  /**
   * Renders a single game card with Host/Edit/Delete buttons
   * @param {object} item - Game object
   */
  const renderGameItem = ({ item }) => {
    // Host button style
    const getHostBtnStyle = () => [
      styles.hostBtn,
      {
        backgroundColor:
          hoveredButton === `host-${item.id}` ? '#00e092' : '#00c781',
      },
    ];

    // Edit button style
    const getEditBtnStyle = () => [
      styles.editBtn,
      {
        backgroundColor:
          hoveredButton === `edit-${item.id}` ? '#00e092' : '#00c781',
      },
    ];

    // Delete button style (with loading state)
    const getDeleteBtnStyle = (gameId) => [
      styles.deleteBtn,
      {
        backgroundColor:
          hoveredButton === `delete-${gameId}` ? '#ff4d4d' : '#ff3333',
        opacity: deletingIds.has(gameId) ? 0.5 : 1,
      },
    ];

    /** Navigates to edit screen with full game data */
    const handleEdit = () => {
      navigation.navigate('CreateGameMenu', { gameId: item.id, gameData: item });
    };

    return (
      <View style={styles.gameCard}>
        <Text style={styles.gameTitle}>{item.title}</Text>
        <Text style={styles.gameDetails}>
          {item.tags ? item.tags.join(', ') : 'No tags'} | {item.numQuestions}{' '}
          Questions
        </Text>
        <Text style={styles.gameDescription}>
          {item.description || 'No description'}
        </Text>
        <View style={styles.buttonRow}>
          {/* Host Game */}
          <TouchableOpacity
            style={getHostBtnStyle()}
            onPress={() =>
              navigation.navigate('HostGameMenu', { gameId: item.id })
            }
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton(`host-${item.id}`),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.hostBtnText}>Host Game</Text>
          </TouchableOpacity>

          {/* Edit Game */}
          <TouchableOpacity
            style={getEditBtnStyle()}
            onPress={handleEdit}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton(`edit-${item.id}`),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>

          {/* Delete Game */}
          <TouchableOpacity
            style={getDeleteBtnStyle(item.id)}
            onPress={() => {
              if (isProfileMenuOpen) setIsProfileMenuOpen(false);
              openDeleteModal(item.id, item.title);
            }}
            disabled={deletingIds.has(item.id)}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton(`delete-${item.id}`),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            {deletingIds.has(item.id) ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.deleteBtnText}>Delete</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ——————————————————————————————————————
  // 9. CREATE GAME FLOW
  // ——————————————————————————————————————
  /**
   * Opens title input modal for new game
   */
  const handleCreateGame = () => {
    setTitleModal({
      isOpen: true,
      currentTitle: '',
      onSave: (title) => {
        navigation.navigate('CreateGameMenu', { initialTitle: title });
        setTitleModal((s) => ({ ...s, isOpen: false }));
      },
    });
  };

  // ——————————————————————————————————————
  // 10. DYNAMIC STYLES
  // ——————————————————————————————————————
  /** Navigation button hover style */
  const getNavBtnStyle = (buttonName) => [
    styles.navBtn,
    {
      backgroundColor: hoveredButton === buttonName ? '#333' : 'transparent',
    },
  ];

  /** Create button hover style */
  const getCreateBtnStyle = () => [
    styles.createBtn,
    {
      backgroundColor: hoveredButton === 'create' ? '#00e092' : '#00c781',
    },
  ];

  /** Profile menu item hover style */
  const getProfileMenuItemStyle = (buttonName) => [
    styles.profileMenuItem,
    {
      backgroundColor: hoveredButton === buttonName ? '#333' : '#222',
    },
  ];

  // ——————————————————————————————————————
  // 11. MAIN RENDER
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
              placeholder="Search your games..."
              placeholderTextColor="#ccc"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>
        <View style={styles.navLinks}>
          <TouchableOpacity
            style={getNavBtnStyle('library')}
            onPress={() => navigation.navigate('Library')}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('library'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.navText}>Library</Text>
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

      {/* ——————— PROFILE DROPDOWN ——————— */}
      <Modal
        visible={isProfileMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsProfileMenuOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
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
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>
            Welcome, {userData ? userData.username : 'Teacher'}!
          </Text>
          <TouchableOpacity
            style={getCreateBtnStyle()}
            onPress={handleCreateGame}
            // Web hover
            {...(Platform.OS === 'web' && {
              onMouseEnter: () => setHoveredButton('create'),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.createBtnText}>Create New Game</Text>
          </TouchableOpacity>
        </View>

        {/* Games List */}
        <View style={styles.gamesSection}>
          <Text style={styles.sectionTitle}>Your Games</Text>
          {filteredGames.length > 0 ? (
            <FlatList
              data={filteredGames}
              renderItem={renderGameItem}
              keyExtractor={(item) => item.id}
              style={styles.gamesList}
            />
          ) : (
            <Text style={styles.noGamesText}>
              No games found. Create one to get started!
            </Text>
          )}
        </View>
      </View>

      {/* ——————— TITLE INPUT MODAL ——————— */}
      <Modal
        visible={titleModal.isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTitleModal((s) => ({ ...s, isOpen: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.titleModal}>
            <Text style={styles.titleModalHeader}>
              {titleModal.currentTitle ? 'Edit Title' : 'Game Title'}
            </Text>

            <TextInput
              style={styles.titleInput}
              placeholder="Enter a title..."
              placeholderTextColor="#999"
              value={titleModal.currentTitle}
              onChangeText={(t) =>
                setTitleModal((s) => ({ ...s, currentTitle: t }))
              }
              autoFocus
            />

            <View style={styles.titleModalButtons}>
              <TouchableOpacity
                style={styles.titleModalCancel}
                onPress={() => setTitleModal((s) => ({ ...s, isOpen: false }))}
              >
                <Text style={styles.titleModalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.titleModalSave,
                  !titleModal.currentTitle.trim() && styles.disabledBtn,
                ]}
                onPress={() => {
                  const title = titleModal.currentTitle.trim();
                  if (title) {
                    titleModal.onSave(title);
                  }
                }}
                disabled={!titleModal.currentTitle.trim()}
              >
                <Text style={styles.titleModalSaveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ——————— DELETE CONFIRMATION MODAL ——————— */}
      <Modal
        visible={deleteModal.isOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModal}>
            <Text style={styles.deleteModalTitle}>Delete Game?</Text>
            <Text style={styles.deleteModalText}>
              Are you sure you want to delete "
              <Text style={{ fontWeight: 'bold' }}>{deleteModal.gameTitle}</Text>
              "? This action cannot be undone.
            </Text>

            <View style={styles.deleteModalButtons}>
              <TouchableOpacity
                style={styles.deleteModalCancel}
                onPress={closeDeleteModal}
              >
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteModalConfirm}
                onPress={confirmDelete}
              >
                <Text style={styles.deleteModalConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ——————————————————————————————————————
// STYLES – Dark, modern, teacher-focused UI
// ——————————————————————————————————————
const styles = StyleSheet.create({
  // Full screen
  container: {
    flex: 1,
    backgroundColor: '#111',
  },

  // Fixed header
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

  // Scrollable content
  content: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 20,
  },

  // Welcome + Create button
  welcomeSection: {
    alignItems: 'center',
    marginVertical: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  createBtn: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    alignItems: 'center',
  },
  createBtnText: {
    color: '#fff',
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
    marginBottom: 10,
  },

  // Action button row
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hostBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 5,
    backgroundColor: '#00c781',
  },
  hostBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  editBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
    backgroundColor: '#00c781',
  },
  editBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 5,
    backgroundColor: '#ff3333',
    zIndex: 1,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Empty state
  noGamesText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
  },

  // Modal overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Profile menu
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

  // ——— DELETE MODAL ———
  deleteModal: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    width: 320,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  deleteModalText: {
    fontSize: 15,
    color: '#ccc',
    marginBottom: 20,
    lineHeight: 20,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deleteModalCancel: {
    flex: 1,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: '#444',
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteModalCancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  deleteModalConfirm: {
    flex: 1,
    paddingVertical: 10,
    marginLeft: 8,
    backgroundColor: '#ff3333',
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteModalConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },

  // ——— TITLE MODAL ———
  titleModal: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 20,
    width: 340,
    alignSelf: 'center',
  },
  titleModalHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  titleInput: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
  },
  titleModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleModalCancel: {
    flex: 1,
    backgroundColor: '#444',
    paddingVertical: 10,
    marginRight: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  titleModalCancelText: { color: '#fff', fontWeight: 'bold' },
  titleModalSave: {
    flex: 1,
    backgroundColor: '#00c781',
    paddingVertical: 10,
    marginLeft: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  titleModalSaveText: { color: '#fff', fontWeight: 'bold' },
  disabledBtn: {
    opacity: 0.5,
  },
});