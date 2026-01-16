/**
 * TeacherDashboard.js - FINAL CORRECTED VERSION WITH SETTINGS TAB
 * No syntax errors, no jiggle, reusable modal
 *
 * Updated: show publisher username on each game card in the Discover page.
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
  ActivityIndicator,
  Image,
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
  addDoc,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { storage } from '../firebaseConfig';

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

export default function TeacherDashboard({ navigation, route }) {
  const [hoveredButton, setHoveredButton] = useState(null);
  const [myGames, setMyGames] = useState([]);
  const [publicGames, setPublicGames] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [userData, setUserData] = useState(null);
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [currentTab, setCurrentTab] = useState('home');
  const [filter, setFilter] = useState('all');

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

  useEffect(() => {
    const fetchData = async () => {
      const userToken = await AsyncStorage.getItem('userToken');
      if (!userToken) {
        navigation.replace('Home');
        return;
      }

      // Load current user doc
      const userDoc = await getDoc(doc(db, 'users', userToken));
      if (userDoc.exists()) setUserData(userDoc.data());

      // Load my games
      const myQ = query(collection(db, 'games'), where('creatorId', '==', userToken));
      const mySnapshot = await getDocs(myQ);
      const fetchedMy = mySnapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
        isPublished: d.data().isPublished || false,
      }));
      setMyGames(fetchedMy);

      // Load public games and annotate with creator username
      const publicQ = query(collection(db, 'games'), where('isPublished', '==', true));
      const publicSnapshot = await getDocs(publicQ);
      const publicRaw = publicSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // collect unique creatorIds to fetch usernames
      const creatorIds = Array.from(new Set(publicRaw.map(g => g.creatorId).filter(Boolean)));
      const usersMap = {};

      if (creatorIds.length > 0) {
        try {
          const userSnaps = await Promise.all(creatorIds.map(id => getDoc(doc(db, 'users', id))));
          userSnaps.forEach(s => {
            if (s.exists()) {
              const u = s.data();
              // prefer username field, fallback to displayName or email
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
        setDeletingIds(prev => new Set(prev).add(gameId));

        try {
          const gameDocRef = doc(db, 'games', gameId);
          const gameSnap = await getDoc(gameDocRef);
          if (gameSnap.exists()) {
            const data = gameSnap.data();
            if (data.images && Array.isArray(data.images)) {
              await Promise.all(data.images.map(async url => {
                try {
                  const path = decodeURIComponent(url.split('/o/')[1].split('?')[0]);
                  await deleteObject(storageRef(storage, path));
                } catch (err) { console.warn('Image delete failed:', err); }
              }));
            }
          }
          await deleteDoc(gameDocRef);
          setMyGames(prev => prev.filter(g => g.id !== gameId));
        } catch (error) {
          console.error('Delete failed:', error);
        } finally {
          setDeletingIds(prev => { const s = new Set(prev); s.delete(gameId); return s; });
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

  const copyGame = async (game) => {
    try {
      const userToken = await AsyncStorage.getItem('userToken');
      const newGameData = {
        ...game,
        creatorId: userToken,
        isPublished: false,
        title: `${game.title} (Copy)`,
      };
      delete newGameData.id;
      const docRef = await addDoc(collection(db, 'games'), newGameData);
      setMyGames(prev => [...prev, { id: docRef.id, ...newGameData }]);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const getDisplayedGames = () => {
    let list = currentTab === 'library' ? myGames : publicGames;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g => 
        g.title.toLowerCase().includes(q) || 
        (g.tags && g.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    if (currentTab === 'library' && filter !== 'all') {
      list = list.filter(g => filter === 'published' ? g.isPublished : !g.isPublished);
    }
    return list;
  };

  const renderGameCard = ({ item }) => {
    const isMine = currentTab === 'library';
    return (
      <View style={[styles.gameCard, hoveredButton === item.id && styles.gameCardHover]}
            onMouseEnter={() => setHoveredButton(item.id)}
            onMouseLeave={() => setHoveredButton(null)}>
        <View style={styles.gameCoverPlaceholder}>
          <Text style={{ fontSize: 40 }}>🎯</Text>
        </View>
        {item.isPublished && <View style={styles.publishedBadge}><Text style={styles.badgeText}>Published</Text></View>}
        <Text style={styles.gameTitle}>{item.title}</Text>
        {/* Display creator username on Discover (or whenever available) */}
        {(!isMine && item.creatorName) && <Text style={styles.creatorText}>{item.creatorName}</Text>}
        <Text style={styles.gameDetails}>{item.numQuestions || 0} questions</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.hostBtn} onPress={() => navigation.navigate('HostGameMenu', { gameId: item.id })}>
            <Text style={styles.btnText}>Host</Text>
          </TouchableOpacity>
          {isMine ? (
            <>
              <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('CreateGameMenu', { gameId: item.id, gameData: item })}>
                <Text style={styles.btnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.publishBtn, item.isPublished && styles.unpublishBtn]}
                onPress={() => confirmPublishToggle(item.id, item.title, item.isPublished)}>
                <Text style={styles.btnText}>{item.isPublished ? 'Unpublish' : 'Publish'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDelete(item.id, item.title)}>
                {deletingIds.has(item.id) ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>Delete</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.copyBtn} onPress={() => copyGame(item)}>
              <Text style={styles.btnText}>Copy to Library</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
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
          <Image source={require('../assets/home.png')} style={[
            styles.tabIcon,
            currentTab === 'home' && styles.tabIconActive
          ]} resizeMode="contain" />
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
          <Image source={require('../assets/library.png')} style={[
            styles.tabIcon,
            currentTab === 'library' && styles.tabIconActive
          ]} resizeMode="contain" />
          <Text style={[
            styles.tabLabel,
            currentTab === 'library' && styles.tabLabelActive
          ]}>Your library</Text>
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
          <Image source={require('../assets/discover.png')} style={[
            styles.tabIcon,
            currentTab === 'discover' && styles.tabIconActive
          ]} resizeMode="contain" />
          <Text style={[
            styles.tabLabel,
            currentTab === 'discover' && styles.tabLabelActive
          ]}>Discover</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Profile */}
        <TouchableOpacity 
          style={[
            styles.tabRow,
            hoveredButton === 'profile' && styles.tabRowActive,
          ]}
          onPress={() => navigation.navigate('Profile')}
          onMouseEnter={() => setHoveredButton('profile')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image source={require('../assets/profile.png')} style={styles.tabIcon} resizeMode="contain" />
          <Text style={styles.tabLabel}>Profile</Text>
        </TouchableOpacity>

        {/* Settings */}
        <TouchableOpacity 
          style={[
            styles.tabRow,
            hoveredButton === 'settings' && styles.tabRowActive,
          ]}
          onPress={() => navigation.navigate('Settings')} // Change to your Settings screen name
          onMouseEnter={() => setHoveredButton('settings')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Image source={require('../assets/settings.png')} style={styles.tabIcon} resizeMode="contain" />
          <Text style={styles.tabLabel}>Settings</Text>
        </TouchableOpacity>

        {/* Logout */}
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
            
            <TouchableOpacity style={styles.bigCreateBtn} onPress={handleCreateGame}>
              <Text style={styles.bigCreateText}>+ Create New Game</Text>
            </TouchableOpacity>

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
                <Text style={{ fontSize: 20 }}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder={`Search ${currentTab === 'library' ? 'your library' : 'discover'}...`}
                  placeholderTextColor="#666"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
              {currentTab === 'library' && (
                <TouchableOpacity style={styles.createBtn} onPress={handleCreateGame}>
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

      {/* Title Creation Modal */}
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

      {/* Reusable Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={confirmModal.onCancel}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
      />
    </View>
  );
}

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
  bigCreateBtn: { backgroundColor: '#00c781', padding: 24, borderRadius: 16, alignItems: 'center', marginBottom: 50 },
  bigCreateText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  section: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 16, flex: 1, height: 52, borderWidth: 1, borderColor: '#333' },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 10 },
  createBtn: { backgroundColor: '#00c781', paddingVertical: 16, paddingHorizontal: 30, borderRadius: 12, marginLeft: 20 },
  createBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  filters: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  filterBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#222' },
  filterActive: { backgroundColor: '#003322', borderWidth: 1, borderColor: '#00c781' },
  filterText: { color: '#fff', fontWeight: 'bold' },
  gameCard: { 
    backgroundColor: '#1e1e1e', 
    borderRadius: 16, 
    padding: 18, 
    margin: 12, 
    flex: 1, 
    maxWidth: '23%', 
    borderWidth: 1, 
    borderColor: '#333' 
  },
  gameCardHover: { 
    borderColor: '#00c781', 
    shadowOpacity: 0.5,
  },
  gameCoverPlaceholder: { height: 120, backgroundColor: '#2a2a2a', borderRadius: 12, marginBottom: 12, justifyContent: 'center', alignItems: 'center' },
  publishedBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: '#00c781', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  gameTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  creatorText: { fontSize: 14, color: '#aaa', marginBottom: 6 },
  gameDetails: { fontSize: 14, color: '#aaa', marginBottom: 16 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  hostBtn: { backgroundColor: '#00c781', padding: 10, borderRadius: 10, flex: 1, alignItems: 'center' },
  editBtn: { backgroundColor: '#00a670', padding: 10, borderRadius: 10, flex: 1, alignItems: 'center' },
  publishBtn: { backgroundColor: '#00c781', padding: 10, borderRadius: 10, flex: 1, alignItems: 'center' },
  unpublishBtn: { backgroundColor: '#e67e22' },
  deleteBtn: { backgroundColor: '#c0392b', padding: 10, borderRadius: 10, flex: 1, alignItems: 'center' },
  copyBtn: { backgroundColor: '#3498db', padding: 10, borderRadius: 10, flex: 1, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
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
});