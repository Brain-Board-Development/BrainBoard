/**
 * Dashboard.js - FIXED SQUARE CARDS + DYNAMIC DOWNWARD 3-DOTS MENU
 * - Square cards consistent across ALL tabs
 * - 3-dots menu positioned dynamically right below the clicked icon
 * - No background dimming when menu is open
 * - Three dots placed right below the placeholder picture
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
  Image,
  ScrollView,
  Dimensions,
  Switch,
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
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';

// Reusable Confirmation Modal
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) => {
  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.confirmModal}>
          <Text style={styles.confirmModalTitle}>{title}</Text>
          <Text style={styles.confirmModalText}>{message}</Text>
          <View style={styles.confirmModalButtons}>
            <TouchableOpacity style={styles.confirmModalCancel} onPress={onCancel}>
              <Text style={styles.confirmModalCancelText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmModalConfirm} onPress={onConfirm}>
              <Text style={styles.confirmModalConfirmText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default function Dashboard({ navigation, route }) {
  const [hoveredButton, setHoveredButton] = useState(null);
  const [myGames, setMyGames] = useState([]);
  const [publicGames, setPublicGames] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userData, setUserData] = useState(null);
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [currentTab, setCurrentTab] = useState('home');
  const [filter, setFilter] = useState('all');
  const [openedMenuId, setOpenedMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null); // {pageX, pageY}

  const [titleModal, setTitleModal] = useState({ isOpen: false, currentTitle: '', onSave: () => {} });
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
    confirmText: 'Confirm',
    cancelText: 'Cancel',
  });

  const [previewModal, setPreviewModal] = useState({ isOpen: false, game: null });
  const [showAnswersInPreview, setShowAnswersInPreview] = useState(false);

  const cardRefs = React.useRef({});

  useEffect(() => {
    const fetchData = async () => {
      const userToken = await AsyncStorage.getItem('userToken');
      if (!userToken) {
        navigation.replace('Home');
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', userToken));
      if (userDoc.exists()) setUserData(userDoc.data());

      const myQ = query(collection(db, 'games'), where('creatorId', '==', userToken));
      const mySnapshot = await getDocs(myQ);
      const fetchedMy = mySnapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
        isPublished: d.data().isPublished || false,
      }));
      setMyGames(fetchedMy);

      const publicQ = query(collection(db, 'games'), where('isPublished', '==', true));
      const publicSnapshot = await getDocs(publicQ);
      const publicRaw = publicSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      const creatorIds = Array.from(new Set(publicRaw.map(g => g.creatorId).filter(Boolean)));
      const usersMap = {};

      if (creatorIds.length > 0) {
        try {
          const userSnaps = await Promise.all(creatorIds.map(id => getDoc(doc(db, 'users', id))));
          userSnaps.forEach(s => {
            if (s.exists()) {
              const u = s.data();
              usersMap[s.id] = u.username || u.displayName || u.email || 'Unknown';
            }
          });
        } catch (err) {
          console.warn('Failed to fetch creators:', err);
        }
      }

      const annotatedPublic = publicRaw.map(g => ({
        ...g,
        creatorName: usersMap[g.creatorId] || 'Unknown',
      }));

      setPublicGames(annotatedPublic);
    };

    fetchData();
  }, [navigation]);

  useEffect(() => {
    if (route.params?.newGame) {
      setMyGames(prev => [...prev, route.params.newGame]);
      navigation.setParams({ newGame: undefined });
    }
  }, [route.params, navigation]);

  const totalQuestions = myGames.reduce((acc, g) => acc + (g.numQuestions || 0), 0);
  const recentGames = myGames.slice(0, 8);

  const handleCreateGame = () => {
    setTitleModal({
      isOpen: true,
      currentTitle: '',
      onSave: (title) => {
        navigation.navigate('CreateGameMenu', { initialTitle: title });
        setTitleModal(prev => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleLogout = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Log out?',
      message: 'Are you sure you want to log out of Brain Board?',
      onConfirm: async () => {
        await signOut(auth);
        await AsyncStorage.removeItem('userToken');
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      },
      onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      confirmText: 'Log out',
    });
  };

  const confirmDelete = (gameId, gameTitle) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Game?',
      message: `Are you sure you want to delete "${gameTitle}"? This cannot be undone.`,
      onConfirm: async () => {
        if (deletingIds.has(gameId)) return;
        setDeletingIds(prev => new Set([...prev, gameId]));

        try {
          const gameDocRef = doc(db, 'games', gameId);
          await deleteDoc(gameDocRef);
          setMyGames(prev => prev.filter(g => g.id !== gameId));
        } catch (error) {
          console.error('Delete failed:', error);
        } finally {
          setDeletingIds(prev => {
            const s = new Set(prev);
            s.delete(gameId);
            return s;
          });
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      },
      onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      confirmText: 'Delete',
    });
  };

  const confirmPublishToggle = (gameId, gameTitle, currentPublished) => {
    setConfirmModal({
      isOpen: true,
      title: currentPublished ? 'Unpublish Game?' : 'Publish Game?',
      message: currentPublished
        ? `"${gameTitle}" will no longer be public.`
        : `"${gameTitle}" will be visible in Discover.`,
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'games', gameId), { isPublished: !currentPublished });
          setMyGames(prev => prev.map(g => g.id === gameId ? { ...g, isPublished: !currentPublished } : g));
        } catch (error) {
          console.error('Publish toggle failed:', error);
        } finally {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      },
      onCancel: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
      confirmText: currentPublished ? 'Unpublish' : 'Publish',
    });
  };

  const openPreview = (game) => {
    setPreviewModal({ isOpen: true, game });
    setShowAnswersInPreview(false);
  };

  const getDisplayedGames = () => {
    let list = currentTab === 'library' ? myGames : publicGames;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g =>
        g.title.toLowerCase().includes(q) ||
        (g.tags && g.tags.some(t => t.toLowerCase().includes(q))) ||
        (g.creatorName && g.creatorName.toLowerCase().includes(q))
      );
    }
    if (currentTab === 'library' && filter !== 'all') {
      list = list.filter(g => filter === 'published' ? g.isPublished : !g.isPublished);
    }
    return list;
  };

  const handleThreeDotsPress = (gameId) => {
    const ref = cardRefs.current[gameId];
    if (!ref) return;

    if (openedMenuId === gameId) {
      setOpenedMenuId(null);
      setMenuPosition(null);
      return;
    }

    ref.measureInWindow((x, y, width, height) => {
      // Position menu directly below the three dots (right-aligned)
      setMenuPosition({
        pageX: x + width - 160,          // menu width 140 + margin
        pageY: y + (cardSize * 0.6) + 20, // cover height (~60%) + some gap
      });
      setOpenedMenuId(gameId);
    });
  };

  const renderGameCard = ({ item }) => {
    const isMine = currentTab === 'library';
    const isDiscover = currentTab === 'discover';
    const isHome = currentTab === 'home';
    const isMenuOpen = openedMenuId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.gameCard,
          hoveredButton === item.id && styles.gameCardHover,
          styles.squareCard,
        ]}
        onPress={() => {
          if (!isMine) openPreview(item);
          if (isMenuOpen) {
            setOpenedMenuId(null);
            setMenuPosition(null);
          }
        }}
        onMouseEnter={() => setHoveredButton(item.id)}
        onMouseLeave={() => setHoveredButton(null)}
        disabled={isMine}
        ref={(ref) => { cardRefs.current[item.id] = ref; }}
      >
        <View style={[styles.gameCoverPlaceholder, styles.squareCover]}>
          <Text style={{ fontSize: 40 }}>🎯</Text>
        </View>

        {item.isPublished && !isDiscover && !isHome && (
          <View style={styles.publishedBadge}>
            <Text style={styles.badgeText}>Published</Text>
          </View>
        )}

        <Text style={styles.gameTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.creatorText}>{item.creatorName || 'Unknown'}</Text>
        <Text style={styles.gameDetails}>{item.numQuestions || 0} questions</Text>

        {isMine && (
          <TouchableOpacity
            style={styles.threeDotsBtn}
            onPress={() => handleThreeDotsPress(item.id)}
            hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          >
            <Image
              source={require('../assets/threeDots.png')}
              style={styles.threeDotsIcon}
              resizeMode="contain"
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderDropdownMenu = () => {
    if (!openedMenuId || !menuPosition) return null;

    const game = myGames.find(g => g.id === openedMenuId);
    if (!game) return null;

    return (
      <TouchableOpacity
        style={styles.menuBackdrop}
        activeOpacity={1}
        onPress={() => {
          setOpenedMenuId(null);
          setMenuPosition(null);
        }}
      >
        <View
          style={[
            styles.menuDropdown,
            {
              position: 'absolute',
              left: menuPosition.pageX,
              top: menuPosition.pageY,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setOpenedMenuId(null);
              setMenuPosition(null);
              navigation.navigate('HostGameMenu', { gameId: game.id });
            }}
          >
            <Text style={styles.menuItemText}>Host</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setOpenedMenuId(null);
              setMenuPosition(null);
              navigation.navigate('CreateGameMenu', { gameId: game.id, gameData: game });
            }}
          >
            <Text style={styles.menuItemText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setOpenedMenuId(null);
              setMenuPosition(null);
              confirmPublishToggle(game.id, game.title, game.isPublished);
            }}
          >
            <Text style={styles.menuItemText}>
              {game.isPublished ? 'Unpublish' : 'Publish'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemDanger]}
            onPress={() => {
              setOpenedMenuId(null);
              setMenuPosition(null);
              confirmDelete(game.id, game.title);
            }}
          >
            <Text style={styles.menuItemTextDanger}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Sidebar */}
      <View style={styles.sidebar}>
        <Text style={styles.logo}>Brain Board</Text>

        <TouchableOpacity
          style={[
            styles.tabRow,
            (currentTab === 'home' || hoveredButton === 'home') && styles.tabRowActive,
          ]}
          onPress={() => setCurrentTab('home')}
          onMouseEnter={() => setHoveredButton('home')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image
            source={require('../assets/home.png')}
            style={[
              styles.tabIcon,
              currentTab === 'home' && styles.tabIconActive
            ]}
            resizeMode="contain"
          />
          <Text style={[
            styles.tabLabel,
            currentTab === 'home' && styles.tabLabelActive
          ]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabRow,
            (currentTab === 'library' || hoveredButton === 'library') && styles.tabRowActive,
          ]}
          onPress={() => setCurrentTab('library')}
          onMouseEnter={() => setHoveredButton('library')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image
            source={require('../assets/library.png')}
            style={[
              styles.tabIcon,
              currentTab === 'library' && styles.tabIconActive
            ]}
            resizeMode="contain"
          />
          <Text style={[
            styles.tabLabel,
            currentTab === 'library' && styles.tabLabelActive
          ]}>Your Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabRow,
            (currentTab === 'discover' || hoveredButton === 'discover') && styles.tabRowActive,
          ]}
          onPress={() => setCurrentTab('discover')}
          onMouseEnter={() => setHoveredButton('discover')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image
            source={require('../assets/discover.png')}
            style={[
              styles.tabIcon,
              currentTab === 'discover' && styles.tabIconActive
            ]}
            resizeMode="contain"
          />
          <Text style={[
            styles.tabLabel,
            currentTab === 'discover' && styles.tabLabelActive
          ]}>Discover</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabRow,
            hoveredButton === 'shop' && styles.tabRowActive,
          ]}
          onPress={() => navigation.navigate('Shop')}
          onMouseEnter={() => setHoveredButton('shop')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image
            source={require('../assets/shop.png')}
            style={styles.tabIcon}
            resizeMode="contain"
          />
          <Text style={styles.tabLabel}>Shop</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabRow,
            hoveredButton === 'inventory' && styles.tabRowActive,
          ]}
          onPress={() => navigation.navigate('Inventory')}
          onMouseEnter={() => setHoveredButton('inventory')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image
            source={require('../assets/inventory.png')}
            style={styles.tabIcon}
            resizeMode="contain"
          />
          <Text style={styles.tabLabel}>Inventory</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={[
            styles.tabRow,
            hoveredButton === 'settings' && styles.tabRowActive,
          ]}
          onPress={() => navigation.navigate('Settings')}
          onMouseEnter={() => setHoveredButton('settings')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image source={require('../assets/settings.png')} style={styles.tabIcon} resizeMode="contain" />
          <Text style={styles.tabLabel}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabRow,
            hoveredButton === 'logout' && styles.tabRowActive,
          ]}
          onPress={handleLogout}
          onMouseEnter={() => setHoveredButton('logout')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image source={require('../assets/logout.png')} style={styles.tabIcon} resizeMode="contain" />
          <Text style={styles.tabLabel}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content */}
      <View style={styles.main}>
        {currentTab === 'home' ? (
          <View style={{ flex: 1, padding: 40 }}>
            <Text style={styles.welcome}>Welcome back, {userData?.username || 'Teacher'}!</Text>
            <Text style={styles.subtitle}>You have {myGames.length} games • {totalQuestions} questions created</Text>

            <View style={styles.actionButtonsRow}>
              <TouchableOpacity
                style={[
                  styles.bigCreateBtn,
                  hoveredButton === 'create' && styles.bigCreateBtnHover
                ]}
                onPress={handleCreateGame}
                onMouseEnter={() => setHoveredButton('create')}
                onMouseLeave={() => setHoveredButton(null)}
              >
                <Text style={styles.bigCreateText}>+ Create New Game</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.joinGameBtn,
                  hoveredButton === 'join' && styles.joinGameBtnHover
                ]}
                onPress={() => navigation.navigate('JoinGameScreen')}
                onMouseEnter={() => setHoveredButton('join')}
                onMouseLeave={() => setHoveredButton(null)}
              >
                <Text style={styles.joinGameText}>Join Game</Text>
              </TouchableOpacity>
            </View>

            {recentGames.length > 0 && (
              <>
                <Text style={styles.section}>Your Recent Games</Text>
                <FlatList
                  data={recentGames}
                  renderItem={renderGameCard}
                  keyExtractor={item => item.id}
                  numColumns={4}
                  columnWrapperStyle={{ justifyContent: 'flex-start' }}
                />
              </>
            )}
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <View style={styles.searchBox}>
                <Image
                  source={require('../assets/search.png')}
                  style={styles.searchIconImage}
                  resizeMode="contain"
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder={`Search ${currentTab === 'library' ? 'your library' : 'discover'}...`}
                  placeholderTextColor="#666"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {(currentTab === 'library' || currentTab === 'discover') && (
                <TouchableOpacity
                  style={[styles.createBtn, { marginLeft: 20 }]}
                  onPress={handleCreateGame}
                >
                  <Text style={styles.createBtnText}>+ Create New Game</Text>
                </TouchableOpacity>
              )}
            </View>

            {currentTab === 'library' && (
              <View style={styles.filters}>
                <TouchableOpacity onPress={() => setFilter('all')} style={[styles.filterBtn, filter === 'all' && styles.filterActive]}>
                  <Text style={styles.filterText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setFilter('drafts')} style={[styles.filterBtn, filter === 'drafts' && styles.filterActive]}>
                  <Text style={styles.filterText}>Drafts</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setFilter('published')} style={[styles.filterBtn, filter === 'published' && styles.filterActive]}>
                  <Text style={styles.filterText}>Published</Text>
                </TouchableOpacity>
              </View>
            )}

            <FlatList
              data={getDisplayedGames()}
              renderItem={renderGameCard}
              keyExtractor={item => item.id}
              numColumns={4}
              columnWrapperStyle={{ justifyContent: 'flex-start' }}
              ListEmptyComponent={<Text style={styles.emptyText}>
                {currentTab === 'library' ? 'No games yet. Create your first one!' : 'No public games found.'}
              </Text>}
            />
          </>
        )}
      </View>

      {/* Dynamic Dropdown Menu */}
      {renderDropdownMenu()}

      {/* Modals */}
      <Modal visible={titleModal.isOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.titleModal}>
            <Text style={styles.titleModalHeader}>New Game Title</Text>
            <TextInput
              style={styles.titleInput}
              placeholder="Enter a title..."
              placeholderTextColor="#888"
              value={titleModal.currentTitle}
              onChangeText={t => setTitleModal(prev => ({ ...prev, currentTitle: t }))}
              autoFocus
            />
            <View style={styles.titleModalButtons}>
              <TouchableOpacity style={styles.titleModalCancel} onPress={() => setTitleModal(prev => ({ ...prev, isOpen: false }))}>
                <Text style={styles.titleModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.titleModalSave, !titleModal.currentTitle.trim() && styles.disabledBtn]}
                onPress={() => titleModal.currentTitle.trim() && titleModal.onSave(titleModal.currentTitle.trim())}
                disabled={!titleModal.currentTitle.trim()}
              >
                <Text style={styles.titleModalSaveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={confirmModal.onCancel}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
      />

      <Modal visible={previewModal.isOpen} transparent animationType="slide">
        <View style={styles.previewModalOverlay}>
          <View style={styles.previewModal}>
            {previewModal.game && (
              <>
                <View style={styles.previewHeader}>
                  <Text style={styles.previewTitle}>{previewModal.game.title}</Text>
                  <TouchableOpacity onPress={() => setPreviewModal({ isOpen: false, game: null })}>
                    <Text style={styles.closePreview}>×</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.previewCreator}>{previewModal.game.creatorName || 'Unknown'}</Text>
                <Text style={styles.previewQuestions}>{previewModal.game.numQuestions || 0} questions</Text>

                <View style={styles.previewToggleRow}>
                  <Switch
                    value={showAnswersInPreview}
                    onValueChange={setShowAnswersInPreview}
                    trackColor={{ false: '#333', true: '#00c781' }}
                    thumbColor={showAnswersInPreview ? '#fff' : '#ccc'}
                  />
                  <Text style={styles.previewToggleLabel}>Reveal Answers</Text>
                </View>

                <ScrollView style={styles.previewQuestionsList}>
                  {previewModal.game.questions.map((q, idx) => (
                    <View key={idx} style={styles.previewQuestionBlock}>
                      <Text style={styles.previewQText}>{q.question}</Text>
                      {q.imageUrl && (
                        <Image source={{ uri: q.imageUrl }} style={styles.previewQImage} />
                      )}
                      <View style={styles.previewAnswersList}>
                        {q.type === 'multipleChoice' ? (
                          q.answers.map((ans, i) => (
                            <View
                              key={i}
                              style={[
                                styles.previewAnswerItem,
                                showAnswersInPreview && q.correctAnswers[i] && styles.previewCorrectAnswer
                              ]}
                            >
                              <Text style={styles.previewAnswerText}>
                                {ans || `Answer ${i + 1}`}
                              </Text>
                            </View>
                          ))
                        ) : (
                          ['True', 'False'].map((label, i) => (
                            <View
                              key={i}
                              style={[
                                styles.previewAnswerItem,
                                showAnswersInPreview && q.correctAnswers[i] && styles.previewCorrectAnswer
                              ]}
                            >
                              <Text style={styles.previewAnswerText}>{label}</Text>
                            </View>
                          ))
                        )}
                      </View>
                    </View>
                  ))}
                </ScrollView>

                <View style={styles.previewActionButtons}>
                  <TouchableOpacity
                    style={styles.hostGameBtn}
                    onPress={() => {
                      setPreviewModal({ isOpen: false, game: null });
                      navigation.navigate('HostGameMenu', { gameId: previewModal.game.id });
                    }}
                  >
                    <Text style={styles.hostGameBtnText}>Host This Game</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.soloBtn}
                    onPress={() => {
                      setPreviewModal({ isOpen: false, game: null });
                      navigation.navigate('SoloGameScreen', { gameId: previewModal.game.id });
                    }}
                  >
                    <Text style={styles.soloBtnText}>Play Solo</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const { width } = Dimensions.get('window');
const sidebarWidth = 260;
const paddingHorizontal = 30 * 2 + 12 * 2 * 4; // approximate
const cardSize = Math.min((width - sidebarWidth - paddingHorizontal) / 4, 280);

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#111' },
  sidebar: {
    width: 260,
    backgroundColor: '#0d0d0d',
    paddingVertical: 40,
    paddingHorizontal: 20,
    borderRightWidth: 1,
    borderRightColor: '#222'
  },
  logo: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#00c781',
    marginBottom: 60,
    marginLeft: 8
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabRowActive: {
    backgroundColor: '#003322',
  },
  tabIcon: {
    width: 24,
    height: 24,
    marginRight: 16,
    tintColor: '#ccc',
  },
  tabIconActive: {
    tintColor: '#00c781',
  },
  tabLabel: {
    fontSize: 16,
    color: '#ccc',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#00c781',
    fontWeight: 'bold',
  },
  main: { flex: 1, padding: 30, backgroundColor: '#111' },
  welcome: { fontSize: 36, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  subtitle: { fontSize: 18, color: '#aaa', marginBottom: 40 },

  actionButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 50,
    flexWrap: 'wrap',
  },
  bigCreateBtn: {
    backgroundColor: '#00c781',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    flex: 1,
    minWidth: 300,
    maxWidth: "100%",
  },
  bigCreateBtnHover: {
    backgroundColor: '#00e092',
    transform: [{ scale: 1.02 }],
  },
  bigCreateText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  joinGameBtn: {
    backgroundColor: '#3498db',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    flex: 1,
    minWidth: 300,
    maxWidth: "100%",
  },
  joinGameBtnHover: {
    backgroundColor: '#3baffc',
    transform: [{ scale: 1.02 }],
  },
  joinGameText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },

  section: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 12,
    paddingHorizontal: 16,
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderColor: '#333'
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    marginLeft: 10
  },
  createBtn: {
    backgroundColor: '#00c781',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 12,
    marginLeft: 20,
  },
  createBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16
  },
  filters: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  filterBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#222' },
  filterActive: { backgroundColor: '#003322', borderWidth: 1, borderColor: '#00c781' },
  filterText: { color: '#fff', fontWeight: 'bold' },
  gameCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 12,
    margin: 12,
    borderWidth: 1,
    borderColor: '#333',
    position: 'relative',
    overflow: 'hidden',
  },
  squareCard: {
    width: cardSize,
    aspectRatio: 1,
    justifyContent: 'space-between',
  },
  gameCardHover: {
    borderColor: '#00c781',
  },
  gameCoverPlaceholder: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    height: '60%', // consistent with squareCover
    marginBottom: 8,
  },
  squareCover: {
    height: '60%',
    marginBottom: 8,
  },
  publishedBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#00c781',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  gameTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  creatorText: { fontSize: 14, color: '#aaa', marginBottom: 6 },
  gameDetails: { fontSize: 14, color: '#aaa', marginBottom: 16 },
  threeDotsBtn: {
    position: 'absolute',
    top: cardSize * 0.6 + 1,   // right after cover image + margin
    right: 2,
    padding: 4,
    zIndex: 10,
  },
  threeDotsIcon: {
    width: 24,
    height: 24,
    tintColor: '#ccc',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 50,
  },
  menuDropdown: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#444',
    paddingVertical: 8,
    width: 140,
    zIndex: 60,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  menuItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  menuItemText: {
    color: '#fff',
    fontSize: 14,
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: '#444',
  },
  menuItemTextDanger: {
    color: '#ff4d4d',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyText: { color: '#666', fontSize: 18, textAlign: 'center', marginTop: 100 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  confirmModal: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: 360, borderWidth: 1, borderColor: '#333' },
  confirmModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12, textAlign: 'center' },
  confirmModalText: { fontSize: 15, color: '#ccc', marginBottom: 24, textAlign: 'center', lineHeight: 22 },
  confirmModalButtons: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  confirmModalCancel: { flex: 1, backgroundColor: '#444', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmModalCancelText: { color: '#fff', fontWeight: 'bold' },
  confirmModalConfirm: { flex: 1, backgroundColor: '#c0392b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmModalConfirmText: { color: '#fff', fontWeight: 'bold' },
  titleModal: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: 380, borderWidth: 1, borderColor: '#333' },
  titleModalHeader: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16, textAlign: 'center' },
  titleInput: { backgroundColor: '#2a2a2a', color: '#fff', padding: 14, borderRadius: 12, fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: '#444' },
  titleModalButtons: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  titleModalCancel: { flex: 1, backgroundColor: '#444', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  titleModalCancelText: { color: '#fff', fontWeight: 'bold' },
  titleModalSave: { flex: 1, backgroundColor: '#00c781', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  titleModalSaveText: { color: '#fff', fontWeight: 'bold' },
  disabledBtn: { opacity: 0.5 },

  // Preview Modal Styles
  previewModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  previewModal: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    width: '75%',
    maxHeight: '85%',
    padding: 30,
    borderWidth: 1,
    borderColor: '#333',
  },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  previewTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  closePreview: { fontSize: 40, color: '#fff', fontWeight: 'bold' },
  previewCreator: { fontSize: 18, color: '#aaa', marginBottom: 8 },
  previewQuestions: { fontSize: 16, color: '#ccc', marginBottom: 20 },
  previewToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 20,
    gap: 12,
  },
  previewToggleLabel: {
    fontSize: 16,
    color: '#ddd',
    fontWeight: '500',
  },
  previewQuestionsList: { flex: 1, marginBottom: 24 },
  previewQuestionBlock: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333'
  },
  previewQText: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  previewQImage: { width: '100%', height: 180, borderRadius: 12, marginBottom: 12 },
  previewAnswersList: { gap: 8 },
  previewAnswerItem: {
    backgroundColor: '#333',
    padding: 12,
    borderRadius: 10,
  },
  previewCorrectAnswer: { backgroundColor: '#004d26' },
  previewAnswerText: { color: '#fff', fontSize: 16 },
  previewActionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 16
  },
  soloBtn: {
    flex: 1,
    backgroundColor: '#3498db',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center'
  },
  soloBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold'
  },
  hostGameBtn: {
    flex: 1,
    backgroundColor: '#00c781',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center'
  },
  hostGameBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  searchIconImage: {
    width: 25,
    height: 25,
    marginRight: 10,
    tintColor: '#ffffff',
  },
});