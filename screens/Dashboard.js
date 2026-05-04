/**
 * Dashboard.js — mobile-responsive
 * Portrait iPhone: bottom tab bar replaces sidebar, 2-column card grid
 * Landscape / desktop: original sidebar layout
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Modal, Image, ScrollView, Switch, Pressable, Platform, useWindowDimensions, SafeAreaView,
} from "react-native";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth } from '../firebaseConfig';
import {
  collection, query, where, getDocs,
  doc, getDoc, deleteDoc, updateDoc,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';


const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel' }) => {
  if (!isOpen) return null;
  return (
    <Modal visible={isOpen} transparent animationType="fade">
      <View style={S.modalOverlay}>
        <View style={S.confirmModal}>
          <Text style={S.confirmTitle}>{title}</Text>
          <Text style={S.confirmText}>{message}</Text>
          <View style={S.confirmBtns}>
            <TouchableOpacity style={S.confirmCancel} onPress={onCancel}>
              <Text style={S.confirmCancelTxt}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.confirmConfirm} onPress={onConfirm}>
              <Text style={S.confirmConfirmTxt}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default function Dashboard({ navigation, route }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const isMobile = winW < 700;
  // Responsive scale
  const rs = Math.min(1, winW / 700);

  const [myGames,       setMyGames]      = useState([]);
  const [publicGames,   setPublicGames]  = useState([]);
  const [searchQuery,   setSearchQuery]  = useState('');
  const [userData,      setUserData]     = useState(null);
  const [deletingIds,   setDeletingIds]  = useState(new Set());
  const [currentTab,    setCurrentTab]   = useState('home');
  const [filter,        setFilter]       = useState('all');
  const [openedMenuId,  setOpenedMenuId] = useState(null);
  const [menuPosition,  setMenuPosition] = useState(null);

  const [titleModal,   setTitleModal]   = useState({ isOpen: false, currentTitle: '', onSave: () => {} });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {}, confirmText: 'Confirm', cancelText: 'Cancel' });
  const [previewModal, setPreviewModal] = useState({ isOpen: false, game: null });
  const [showAnswersInPreview, setShowAnswersInPreview] = useState(false);

  const cardRefs = React.useRef({});

  // Dynamic card size
  const sidebarW = isMobile ? 0 : 260;
  const cols     = winW < 500 ? 2 : winW < 900 ? 3 : 4;
  const gap      = 12;
  const hPad     = isMobile ? 12 : 30;
  const cardSize = Math.min(
    220,
    Math.max(120, Math.floor((winW - sidebarW - hPad * 2 - gap * (cols + 1)) / cols))
  );

  const fetchData = useCallback(async () => {
    const userToken = await AsyncStorage.getItem('userToken');
    if (!userToken) { navigation.replace('Home'); return; }

    const userDoc = await getDoc(doc(db, 'users', userToken));
    const myUserData = userDoc.exists() ? userDoc.data() : {};
    if (userDoc.exists()) setUserData(myUserData);
    const myUsername = myUserData.username || myUserData.displayName || myUserData.email || 'Me';

    const myQ = query(collection(db, 'games'), where('creatorId', '==', userToken));
    const mySnap = await getDocs(myQ);
    const myGamesData = mySnap.docs.map(d => ({ id: d.id, ...d.data(), isPublished: d.data().isPublished || false, creatorName: myUsername || d.data().creatorName || 'Me' }));
    setMyGames(myGamesData);
    // Backfill creatorName on games that don't have it stored
    myGamesData.forEach(g => {
      if (!g.creatorName || g.creatorName === 'Unknown') {
        updateDoc(doc(db, 'games', g.id), { creatorName: myUsername }).catch(()=>{});
      }
    });

    // Fetch ALL games (not just published) to backfill creatorName everywhere
    const allGamesSnap = await getDocs(collection(db, 'games'));
    const allGames = allGamesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Get ALL unique creatorIds
    const allCreatorIds = Array.from(new Set(allGames.map(g => g.creatorId).filter(Boolean)));
    const usersMap = {};
    if (allCreatorIds.length) {
      try {
        const snaps = await Promise.all(allCreatorIds.map(id => getDoc(doc(db, 'users', id))));
        snaps.forEach(snap => {
          if (snap.exists()) {
            const u = snap.data();
            const name = u.username || u.displayName || u.name || (u.email ? u.email.split('@')[0] : null);
            if (name) usersMap[snap.id] = name;
          }
        });
      } catch(e) { console.warn('user lookup err', e); }
    }

    // Write creatorName to every game that is missing it
    const writes = [];
    allGames.forEach(g => {
      const name = usersMap[g.creatorId];
      if (name && g.creatorName !== name) {
        writes.push(updateDoc(doc(db, 'games', g.id), { creatorName: name }).catch(e => console.warn('write fail', g.id, e)));
      }
    });
    if (writes.length) await Promise.all(writes);

    // Display only published games
    const pubGamesData = allGames
      .filter(g => g.isPublished)
      .map(g => ({ ...g, creatorName: usersMap[g.creatorId] || g.creatorName || 'Anonymous' }));
    setPublicGames(pubGamesData);
  }, [navigation]);

  // Re-fetch every time the screen comes into focus (e.g. returning from CreateGameMenu)
  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  useEffect(() => {
    if (route.params?.newGame) {
      setMyGames(prev => [...prev, route.params.newGame]);
      navigation.setParams({ newGame: undefined });
    }
  }, [route.params, navigation]);

  const totalQuestions = myGames.reduce((a, g) => a + (g.numQuestions || 0), 0);
  const recentGames    = myGames.slice(0, 8);

  const handleCreateGame = () => {
    setTitleModal({
      isOpen: true, currentTitle: '',
      onSave: (title) => {
        navigation.navigate('CreateGameMenu', { initialTitle: title });
        setTitleModal(p => ({ ...p, isOpen: false }));
      },
    });
  };

  const handleLogout = () => {
    setConfirmModal({
      isOpen: true, title: 'Log out?', message: 'Are you sure you want to log out?',
      onConfirm: async () => { await signOut(auth); await AsyncStorage.removeItem('userToken'); navigation.reset({ index: 0, routes: [{ name: 'Home' }] }); },
      onCancel: () => setConfirmModal(p => ({ ...p, isOpen: false })),
      confirmText: 'Log out',
    });
  };

  const confirmDelete = (gameId, gameTitle) => {
    setConfirmModal({
      isOpen: true, title: 'Delete Game?', message: `Delete "${gameTitle}"? This cannot be undone.`,
      onConfirm: async () => {
        setDeletingIds(p => new Set([...p, gameId]));
        try { await deleteDoc(doc(db, 'games', gameId)); setMyGames(p => p.filter(g => g.id !== gameId)); }
        catch (e) { console.error(e); }
        finally { setDeletingIds(p => { const s = new Set(p); s.delete(gameId); return s; }); setConfirmModal(p => ({ ...p, isOpen: false })); }
      },
      onCancel: () => setConfirmModal(p => ({ ...p, isOpen: false })),
      confirmText: 'Delete',
    });
  };

  const confirmPublishToggle = (gameId, gameTitle, current) => {
    setConfirmModal({
      isOpen: true, title: current ? 'Unpublish?' : 'Publish?',
      message: current ? `"${gameTitle}" will no longer be public.` : `"${gameTitle}" will be visible in Discover.`,
      onConfirm: async () => {
        try { await updateDoc(doc(db, 'games', gameId), { isPublished: !current }); setMyGames(p => p.map(g => g.id === gameId ? { ...g, isPublished: !current } : g)); }
        catch (e) { console.error(e); }
        finally { setConfirmModal(p => ({ ...p, isOpen: false })); }
      },
      onCancel: () => setConfirmModal(p => ({ ...p, isOpen: false })),
      confirmText: current ? 'Unpublish' : 'Publish',
    });
  };

  const openPreview = (game) => { setPreviewModal({ isOpen: true, game }); setShowAnswersInPreview(false); };

  const getDisplayedGames = () => {
    let list = currentTab === 'library' ? myGames : publicGames;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(g => g.title?.toLowerCase().includes(q) || (g.tags || []).some(t => t.toLowerCase().includes(q)) || g.creatorName?.toLowerCase().includes(q));
    }
    if (currentTab === 'library' && filter !== 'all') list = list.filter(g => filter === 'published' ? g.isPublished : !g.isPublished);
    return list;
  };

  const handleThreeDotsPress = (gameId) => {
    const ref = cardRefs.current[gameId];
    if (!ref) return;
    if (openedMenuId === gameId) { setOpenedMenuId(null); setMenuPosition(null); return; }
    ref.measureInWindow((x, y, width, height) => {
      setMenuPosition({ pageX: Math.min(x + width - 150, winW - 160), pageY: y + cardSize * 0.6 + 20 });
      setOpenedMenuId(gameId);
    });
  };

  const renderGameCard = ({ item }) => {
    const isMine = currentTab === 'library';
    const isMenuOpen = openedMenuId === item.id;
    const cs = cardSize;
    return (
      <Pressable
        style={({ hovered, pressed }) => [
          S.gameCard,
          { width: cs, marginHorizontal: gap / 2, marginBottom: gap },
          Platform.OS === 'web' && hovered && { transform: [{ scale: 1.03 }], borderColor: '#555', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => { if (!isMine) openPreview(item); if (isMenuOpen) { setOpenedMenuId(null); setMenuPosition(null); } }}
        disabled={isMine}
        ref={ref => { cardRefs.current[item.id] = ref; }}
      >
        <View style={[S.gameCover, { height: cs * 0.55 }]}>
          {item.coverImage
            ? <Image source={{ uri: item.coverImage }} style={{ width: '100%', height: '100%', borderRadius: 10 }} resizeMode="cover" />
            : <View style={{ width: '100%', height: '100%', borderRadius: 10, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#555', fontSize: Math.max(11, 13 * rs) }}>{item.title?.substring(0,2).toUpperCase() || '??'}</Text>
              </View>
          }
        </View>
        {item.isPublished && currentTab === 'library' && (
          <View style={S.publishedBadge}><Text style={S.badgeTxt}>Published</Text></View>
        )}
        <Text style={[S.gameTitle, { fontSize: Math.max(12, 14 * rs) }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[S.creatorTxt, { fontSize: Math.max(10, 12 * rs) }]} numberOfLines={1}>{item.creatorName || 'Anonymous'}</Text>
        <Text style={[S.gameDetails, { fontSize: Math.max(10, 12 * rs) }]}>{item.numQuestions || 0} questions</Text>
        {isMine && (
          <TouchableOpacity
            style={S.threeDotsBtn}
            onPress={() => handleThreeDotsPress(item.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Image source={require('../assets/threeDots.png')} style={S.threeDotsIcon} resizeMode="contain" />
          </TouchableOpacity>
        )}
      </Pressable>
    );
  };

  const renderDropdownMenu = () => {
    if (!openedMenuId || !menuPosition) return null;
    const game = myGames.find(g => g.id === openedMenuId);
    if (!game) return null;
    return (
      <TouchableOpacity style={S.menuBackdrop} activeOpacity={1} onPress={() => { setOpenedMenuId(null); setMenuPosition(null); }}>
        <View style={[S.menuDropdown, { left: menuPosition.pageX, top: menuPosition.pageY }]}>
          {[
            { label: 'Host',    onPress: () => { setOpenedMenuId(null); setMenuPosition(null); navigation.navigate('HostGameMenu', { gameId: game.id }); } },
            { label: 'Edit',    onPress: () => { setOpenedMenuId(null); setMenuPosition(null); navigation.navigate('CreateGameMenu', { gameId: game.id, gameData: game }); } },
            { label: game.isPublished ? 'Unpublish' : 'Publish', onPress: () => { setOpenedMenuId(null); setMenuPosition(null); confirmPublishToggle(game.id, game.title, game.isPublished); } },
            { label: 'Delete',  onPress: () => { setOpenedMenuId(null); setMenuPosition(null); confirmDelete(game.id, game.title); }, danger: true },
          ].map(item => (
            <TouchableOpacity key={item.label} style={[S.menuItem, item.danger && S.menuItemDanger]} onPress={item.onPress}>
              <Text style={item.danger ? S.menuItemTxtDanger : S.menuItemTxt}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  // ── SIDEBAR TABS (desktop) ──────────────────────────────────────────────────
  const TAB_ITEMS = [
    { id: 'home',     label: 'Home',        icon: require('../assets/home.png') },
    { id: 'library',  label: 'Library',     icon: require('../assets/library.png') },
    { id: 'discover', label: 'Discover',    icon: require('../assets/discover.png') },
  ];

  const SidebarTab = ({ tab }) => (
    <Pressable
      style={({ hovered, pressed }) => [
        S.tabRow,
        currentTab === tab.id && S.tabRowActive,
        Platform.OS === 'web' && hovered && !S.tabRowActive && { backgroundColor: '#1a2a1a' },
        pressed && { opacity: 0.8 },
      ]}
      onPress={() => setCurrentTab(tab.id)}
    >
      <Image source={tab.icon} style={[S.tabIconImg, currentTab === tab.id && S.tabIconImgActive]} resizeMode="contain" />
      <Text style={[S.tabLabel, currentTab === tab.id && S.tabLabelActive]}>{tab.label}</Text>
    </Pressable>
  );

  // ── MAIN CONTENT ─────────────────────────────────────────────────────────────
  const MainContent = () => {
    const pad = isMobile ? 14 : 40;
    if (currentTab === 'home') {
      return (
        <ScrollView contentContainerStyle={{ padding: pad }}>
          <Text style={[S.welcome, { fontSize: Math.max(20, 28 * rs) }]}>
            Welcome, {userData?.username || 'Teacher'}!
          </Text>
          <Text style={[S.subtitle, { fontSize: Math.max(13, 16 * rs), marginBottom: Math.max(20, 32 * rs) }]}>
            {myGames.length} games · {totalQuestions} questions
          </Text>

          <View style={[S.actionRow, { flexDirection: isMobile ? 'column' : 'row', gap: 12, marginBottom: Math.max(24, 40 * rs) }]}>
            <Pressable style={({ hovered, pressed }) => [S.bigCreateBtn, isMobile && { minWidth: 0 }, Platform.OS==='web' && hovered && { backgroundColor:'#00e090', transform:[{scale:1.02}] }, pressed && { opacity:0.85 }]} onPress={handleCreateGame}>
              <Text style={[S.bigCreateTxt, { fontSize: Math.max(15, 18 * rs) }]}>+ Create New Game</Text>
            </Pressable>
            <Pressable style={({ hovered, pressed }) => [S.joinBtn, isMobile && { minWidth: 0 }, Platform.OS==='web' && hovered && { backgroundColor:'#5dade2', transform:[{scale:1.02}] }, pressed && { opacity:0.85 }]} onPress={() => navigation.navigate('JoinGameScreen')}>
              <Text style={[S.joinBtnTxt, { fontSize: Math.max(15, 18 * rs) }]}>Join Game</Text>
            </Pressable>
          </View>

          {recentGames.length > 0 && (
            <>
              <Text style={[S.section, { fontSize: Math.max(16, 20 * rs) }]}>Your Recent Games</Text>
              <FlatList
                data={recentGames}
                renderItem={renderGameCard}
                keyExtractor={item => item.id}
                numColumns={cols}
                key={`cols-${cols}`}
                scrollEnabled={false}
                contentContainerStyle={{ paddingHorizontal: gap / 2 }}
              />
            </>
          )}
        </ScrollView>
      );
    }

    return (
      <View style={{ flex: 1 }}>
        <View style={[S.header, { padding: Math.max(10, 16 * rs), gap: 10 }]}>
          <View style={[S.searchBox, { height: Math.max(40, 48 * rs) }]}>
            <Image source={require('../assets/search.png')} style={{ width: 18, height: 18, marginRight: 8, tintColor: '#aaa' }} resizeMode="contain" />
            <TextInput
              style={[S.searchInput, { fontSize: Math.max(13, 15 * rs) }]}
              placeholder={`Search ${currentTab === 'library' ? 'library' : 'discover'}...`}
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          {!isMobile && (
            <TouchableOpacity style={S.createBtn} onPress={handleCreateGame}>
              <Text style={S.createBtnTxt}>+ Create</Text>
            </TouchableOpacity>
          )}
        </View>

        {currentTab === 'library' && (
          <View style={[S.filters, { paddingHorizontal: Math.max(10, 16 * rs) }]}>
            {['all', 'drafts', 'published'].map(f => (
              <TouchableOpacity key={f} onPress={() => setFilter(f)} style={[S.filterBtn, filter === f && S.filterActive]}>
                <Text style={[S.filterTxt, { fontSize: Math.max(12, 14 * rs) }]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
              </TouchableOpacity>
            ))}
            {isMobile && (
              <TouchableOpacity style={S.createBtn} onPress={handleCreateGame}>
                <Text style={S.createBtnTxt}>+ New</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <FlatList
          data={getDisplayedGames()}
          renderItem={renderGameCard}
          keyExtractor={item => item.id}
          numColumns={cols}
          key={`cols-${cols}`}
          contentContainerStyle={{ paddingHorizontal: gap / 2, paddingTop: 8, paddingBottom: 80 }}
          ListEmptyComponent={<Text style={S.emptyTxt}>{currentTab === 'library' ? 'No games yet. Create your first one!' : 'No public games found.'}</Text>}
        />
      </View>
    );
  };

  // ── BOTTOM TAB BAR (mobile) ────────────────────────────────────────────────
  const BottomTabBar = () => (
    <View style={S.bottomBar}>
      {TAB_ITEMS.map(tab => (
        <TouchableOpacity key={tab.id} style={S.bottomTab} onPress={() => setCurrentTab(tab.id)}>
          <Image source={tab.icon} style={[S.bottomTabIconImg, currentTab === tab.id && S.bottomTabIconImgActive]} resizeMode="contain" />
          <Text style={[S.bottomTabLabel, currentTab === tab.id && S.bottomTabLabelActive]}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={S.bottomTab} onPress={handleLogout}>
        <Image source={require('../assets/logout.png')} style={S.bottomTabIconImg} resizeMode="contain" />
        <Text style={S.bottomTabLabel}>Logout</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={S.container}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Sidebar — desktop only */}
        {!isMobile && (
          <View style={S.sidebar}>
            <Text style={S.logo}>Brain Board</Text>
            {TAB_ITEMS.map(tab => <SidebarTab key={tab.id} tab={tab} />)}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={S.tabRow} onPress={handleLogout}>
              <Image source={require('../assets/logout.png')} style={S.tabIconImg} resizeMode="contain" />
              <Text style={S.tabLabel}>Logout</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main */}
        <View style={{ flex: 1 }}>
          {/* Mobile header */}
          {isMobile && (
            <View style={S.mobileHeader}>
              <Text style={S.mobileHeaderTitle}>Brain Board</Text>
              <TouchableOpacity onPress={handleCreateGame} style={S.mobileCreateBtn}>
                <Text style={S.mobileCreateBtnTxt}>+ Create</Text>
              </TouchableOpacity>
            </View>
          )}
          <MainContent />
        </View>
      </View>

      {/* Bottom nav — mobile only */}
      {isMobile && <BottomTabBar />}

      {/* Dropdown menu */}
      {renderDropdownMenu()}

      {/* Title modal */}
      <Modal visible={titleModal.isOpen} transparent animationType="fade">
        <View style={S.modalOverlay}>
          <View style={S.titleModal}>
            <Text style={S.titleModalHdr}>New Game Title</Text>
            <TextInput
              style={S.titleInput}
              placeholder="Enter a title..."
              placeholderTextColor="#888"
              value={titleModal.currentTitle}
              onChangeText={t => setTitleModal(p => ({ ...p, currentTitle: t }))}
              autoFocus
            />
            <View style={S.titleModalBtns}>
              <TouchableOpacity style={S.titleCancel} onPress={() => setTitleModal(p => ({ ...p, isOpen: false }))}>
                <Text style={S.titleCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.titleSave, !titleModal.currentTitle.trim() && { opacity: 0.5 }]}
                onPress={() => titleModal.currentTitle.trim() && titleModal.onSave(titleModal.currentTitle.trim())}
                disabled={!titleModal.currentTitle.trim()}
              >
                <Text style={S.titleSaveTxt}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmationModal
        isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message}
        onConfirm={confirmModal.onConfirm} onCancel={confirmModal.onCancel}
        confirmText={confirmModal.confirmText} cancelText={confirmModal.cancelText}
      />

      {/* Preview modal */}
      <Modal visible={previewModal.isOpen} transparent animationType="slide">
        <View style={S.previewOverlay}>
          <View style={[S.previewModal, { width: isMobile ? '96%' : '75%', padding: isMobile ? 18 : 30 }]}>
            {previewModal.game && (
              <>
                <View style={S.previewHdr}>
                  <Text style={[S.previewTitle, { fontSize: isMobile ? 20 : 26 }]} numberOfLines={2}>{previewModal.game.title}</Text>
                  <TouchableOpacity onPress={() => setPreviewModal({ isOpen: false, game: null })}>
                    <Text style={S.closePreview}>×</Text>
                  </TouchableOpacity>
                </View>
                <Text style={S.previewCreator}>{previewModal.game.creatorName || 'Anonymous'}</Text>
                <Text style={S.previewQCount}>{previewModal.game.numQuestions || 0} questions</Text>
                <View style={S.previewToggleRow}>
                  <Switch value={showAnswersInPreview} onValueChange={setShowAnswersInPreview} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={showAnswersInPreview ? '#fff' : '#ccc'} />
                  <Text style={S.previewToggleLbl}>Reveal Answers</Text>
                </View>
                <ScrollView style={{ flex: 1, marginBottom: 16 }}>
                  {(previewModal.game.questions || []).map((q, idx) => (
                    <View key={idx} style={S.previewQBlock}>
                      <Text style={[S.previewQTxt, { fontSize: isMobile ? 15 : 18 }]}>{q.question}</Text>
                      {q.imageUrl && <Image source={{ uri: q.imageUrl }} style={S.previewQImg} />}
                      <View style={{ gap: 6 }}>
                        {(q.type === 'multipleChoice' ? q.answers : ['True', 'False']).map((ans, i) => (
                          <View key={i} style={[S.previewAns, showAnswersInPreview && q.correctAnswers?.[i] && S.previewCorrect]}>
                            <Text style={S.previewAnsTxt}>{ans || `Answer ${i + 1}`}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={S.playBtn}
                  onPress={() => { setPreviewModal({ isOpen: false, game: null }); navigation.navigate('HostGameMenu', { gameId: previewModal.game.id }); }}
                  activeOpacity={0.85}
                >
                  <Text style={S.playBtnTxt}>Play</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#111' },
  sidebar:    { width: 260, backgroundColor: '#0d0d0d', paddingVertical: 36, paddingHorizontal: 16, borderRightWidth: 1, borderRightColor: '#222' },
  logo:       { fontSize: 24, fontWeight: 'bold', color: '#00c781', marginBottom: 40, marginLeft: 8 },
  tabRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, marginBottom: 6 },
  tabRowActive: { backgroundColor: '#003322' },
  tabIconImg:       { width: 22, height: 22, marginRight: 14, tintColor: '#ccc' },
  tabIconImgActive: { tintColor: '#00c781' },
  tabLabel:   { fontSize: 15, color: '#ccc', fontWeight: '500' },
  tabLabelActive: { color: '#00c781', fontWeight: 'bold' },

  mobileHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  mobileHeaderTitle: { fontSize: 20, fontWeight: 'bold', color: '#00c781' },
  mobileCreateBtn:   { backgroundColor: '#00c781', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  mobileCreateBtnTxt:{ color: '#fff', fontWeight: 'bold', fontSize: 14 },

  bottomBar:       { flexDirection: 'row', backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: '#222', paddingBottom: 4 },
  bottomTab:       { flex: 1, alignItems: 'center', paddingVertical: 8 },
  bottomTabIconImg:       { width: 22, height: 22, marginBottom: 2, tintColor: '#666' },
  bottomTabIconImgActive: { tintColor: '#00c781' },
  bottomTabLabel:  { fontSize: 10, color: '#666', fontWeight: '600' },
  bottomTabLabelActive: { color: '#00c781' },

  welcome:  { fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { color: '#aaa' },
  actionRow:{ flexWrap: 'wrap' },
  bigCreateBtn: { backgroundColor: '#00c781', padding: 18, borderRadius: 14, alignItems: 'center', flex: 1, minWidth: 200 },
  bigCreateTxt: { color: '#fff', fontWeight: 'bold' },
  joinBtn:      { backgroundColor: '#3498db', padding: 18, borderRadius: 14, alignItems: 'center', flex: 1, minWidth: 200 },
  joinBtnTxt:   { color: '#fff', fontWeight: 'bold' },
  section:      { fontWeight: 'bold', color: '#fff', marginBottom: 14, marginTop: 4 },

  header:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111' },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 12, flex: 1, borderWidth: 1, borderColor: '#333' },
  searchInput: { flex: 1, color: '#fff' },
  createBtn:   { backgroundColor: '#00c781', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  createBtnTxt:{ color: '#fff', fontWeight: 'bold', fontSize: 13 },
  filters:     { flexDirection: 'row', gap: 8, paddingVertical: 8, flexWrap: 'wrap' },
  filterBtn:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#222' },
  filterActive:{ backgroundColor: '#003322', borderWidth: 1, borderColor: '#00c781' },
  filterTxt:   { color: '#fff', fontWeight: 'bold' },

  gameCard:    { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#333', flexDirection: 'column' },
  gameCover:   { backgroundColor: '#2a2a2a', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  publishedBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#00c781', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, zIndex: 5 },
  badgeTxt:    { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  gameTitle:   { fontWeight: 'bold', color: '#fff', marginBottom: 3 },
  creatorTxt:  { color: '#aaa', marginBottom: 2 },
  gameDetails: { color: '#aaa' },
  threeDotsBtn:{ alignSelf: 'flex-end', padding: 4, marginTop: 4 },
  threeDotsIcon:{ width: 18, height: 18, tintColor: '#aaa' },

  menuBackdrop:{ ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 50 },
  menuDropdown:{ position: 'absolute', backgroundColor: '#1e1e1e', borderRadius: 12, borderWidth: 1, borderColor: '#444', paddingVertical: 6, width: 140, zIndex: 60, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
  menuItem:    { paddingVertical: 10, paddingHorizontal: 16 },
  menuItemDanger: { borderTopWidth: 1, borderTopColor: '#444' },
  menuItemTxt: { color: '#fff', fontSize: 14 },
  menuItemTxtDanger: { color: '#ff4d4d', fontSize: 14, fontWeight: 'bold' },

  emptyTxt:    { color: '#666', fontSize: 16, textAlign: 'center', marginTop: 80, padding: 20 },
  modalOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },

  confirmModal: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: '88%', maxWidth: 360, borderWidth: 1, borderColor: '#333' },
  confirmTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 10, textAlign: 'center' },
  confirmText:  { fontSize: 14, color: '#ccc', marginBottom: 20, textAlign: 'center', lineHeight: 20 },
  confirmBtns:  { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, backgroundColor: '#444', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  confirmCancelTxt: { color: '#fff', fontWeight: 'bold' },
  confirmConfirm: { flex: 1, backgroundColor: '#c0392b', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  confirmConfirmTxt: { color: '#fff', fontWeight: 'bold' },

  titleModal:    { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: '90%', maxWidth: 380, borderWidth: 1, borderColor: '#333' },
  titleModalHdr: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 14, textAlign: 'center' },
  titleInput:    { backgroundColor: '#2a2a2a', color: '#fff', padding: 13, borderRadius: 12, fontSize: 15, marginBottom: 18, borderWidth: 1, borderColor: '#444' },
  titleModalBtns:{ flexDirection: 'row', gap: 10 },
  titleCancel:   { flex: 1, backgroundColor: '#444', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  titleCancelTxt:{ color: '#fff', fontWeight: 'bold' },
  titleSave:     { flex: 1, backgroundColor: '#00c781', paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  titleSaveTxt:  { color: '#fff', fontWeight: 'bold' },

  previewOverlay:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', justifyContent: 'center', alignItems: 'center' },
  previewModal:  { backgroundColor: '#1e1e1e', borderRadius: 18, maxHeight: '90%', borderWidth: 1, borderColor: '#333' },
  previewHdr:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  previewTitle:  { fontWeight: 'bold', color: '#fff', flex: 1, marginRight: 12 },
  closePreview:  { fontSize: 36, color: '#fff', fontWeight: 'bold', lineHeight: 38 },
  previewCreator:{ fontSize: 15, color: '#aaa', marginBottom: 6 },
  previewQCount: { fontSize: 13, color: '#ccc', marginBottom: 16 },
  previewToggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  previewToggleLbl: { fontSize: 14, color: '#ddd' },
  previewQBlock: { backgroundColor: '#222', borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  previewQTxt:   { fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  previewQImg:   { width: '100%', height: 140, borderRadius: 10, marginBottom: 10 },
  previewAns:    { backgroundColor: '#333', padding: 10, borderRadius: 8 },
  previewCorrect:{ backgroundColor: '#004d26' },
  previewAnsTxt: { color: '#fff', fontSize: 14 },
  playBtn:       { backgroundColor: '#00c781', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  playBtnTxt:    { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});