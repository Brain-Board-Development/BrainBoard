/**
 * Lobby.js - HOST-ONLY Lobby Screen
 * Updated: Snake board preview, colored player tokens, start navigates to BoardGameScreen
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  Alert,
  ScrollView,
  Animated,
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

const BOARD_COLS = 10;
const BOARD_TOTAL = 20;  // spaces 0–20

// Build snake-layout board rows
// Row 0 (bottom): 0–9 left→right
// Row 1 (top): 10–19 right→left
// Cap: 20 (snake head)
function buildSnakeRows(total = BOARD_TOTAL) {
  const rows = [];
  for (let rowIdx = 0; rowIdx * BOARD_COLS <= total; rowIdx++) {
    const startSpace = rowIdx * BOARD_COLS;
    const endSpace = Math.min(startSpace + BOARD_COLS - 1, total);
    const spaces = [];
    for (let s = startSpace; s <= endSpace; s++) spaces.push(s);
    // Odd rows go right-to-left (snake direction)
    if (rowIdx % 2 === 1) spaces.reverse();
    rows.push({ rowIdx, spaces });
  }
  return rows.reverse(); // top row first visually
}

function SnakeBoardPreview({ players }) {
  const rows = buildSnakeRows(BOARD_TOTAL);

  const getPlayersOnSpace = (spaceIdx) =>
    players.filter(p => (p.position || 0) === spaceIdx);

  return (
    <View style={boardStyles.boardWrapper}>
      <Text style={boardStyles.boardTitle}>🐍 Game Board</Text>
      {rows.map(({ rowIdx, spaces }) => (
        <View key={rowIdx} style={boardStyles.row}>
          {spaces.map((spaceIdx) => {
            const here = getPlayersOnSpace(spaceIdx);
            const isHead = spaceIdx === BOARD_TOTAL;
            const isStart = spaceIdx === 0;
            return (
              <View
                key={spaceIdx}
                style={[
                  boardStyles.space,
                  isHead && boardStyles.spaceHead,
                  isStart && boardStyles.spaceStart,
                ]}
              >
                {isHead ? (
                  <Text style={boardStyles.headEmoji}>🐍</Text>
                ) : (
                  <Text style={boardStyles.spaceNum}>{spaceIdx}</Text>
                )}
                <View style={boardStyles.tokens}>
                  {here.map((p, i) => (
                    <View
                      key={i}
                      style={[boardStyles.token, { backgroundColor: p.color || '#888' }]}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ))}
      {/* Snake path decoration */}
      <View style={boardStyles.legendRow}>
        <View style={boardStyles.legendItem}>
          <View style={boardStyles.legendDot} />
          <Text style={boardStyles.legendText}>Normal</Text>
        </View>
        <View style={boardStyles.legendItem}>
          <Text style={boardStyles.legendIcon}>🐍</Text>
          <Text style={boardStyles.legendText}>Finish</Text>
        </View>
        <View style={boardStyles.legendItem}>
          <Text style={boardStyles.legendIcon}>🟩</Text>
          <Text style={boardStyles.legendText}>Start</Text>
        </View>
      </View>
    </View>
  );
}

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [session, setSession] = useState(null);
  const [players, setPlayers] = useState([]);
  const [isLobbyLocked, setIsLobbyLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);

  const pinPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pinPulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'gameSessions', sessionId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSession(data);
        setPlayers(data.players || []);
        setIsLobbyLocked(data.isLobbyLocked || false);
        setLoading(false);

        // Non-host auto-navigate when game starts
        if (!isHost && data.status === 'playing') {
          const myName = route.params.playerName;
          const myColor = route.params.playerColor || '#00c781';
          navigation.replace('BoardGameScreen', {
            sessionId,
            gameId: data.gameId || gameId,
            playerName: myName,
            playerColor: myColor,
            isHost: false,
          });
        }
      } else {
        setError('Session not found');
        setLoading(false);
      }
    }, (err) => {
      setError('Failed to load lobby');
      setLoading(false);
    });
    return () => unsub();
  }, [sessionId]);

  const toggleLobbyLock = async () => {
    if (!isHost) return;
    try {
      await updateDoc(doc(db, 'gameSessions', sessionId), {
        isLobbyLocked: !isLobbyLocked,
      });
    } catch (err) {
      Alert.alert('Error', 'Failed to update lobby status');
    }
  };

  const handleStartGame = async () => {
    if (!isHost) return;
    if (players.length === 0) {
      Alert.alert('No Players', 'You need at least 1 player to start.');
      return;
    }
    try {
      await updateDoc(doc(db, 'gameSessions', sessionId), {
        status: 'playing',
        currentQuestionIndex: 0,
        currentTurn: players[0]?.name || '',
        board: buildBoardData(),
      });
      navigation.replace('BoardGameScreen', {
        sessionId,
        gameId,
        playerName: route.params.hostName || 'Host',
        playerColor: '#00c781',
        isHost: true,
      });
    } catch (err) {
      console.error('Start game error:', err);
      Alert.alert('Error', 'Failed to start the game');
    }
  };

  const buildBoardData = () => {
    const SPACE_TYPES = ['normal', 'normal', 'normal', 'lava', 'cannon', 'trap', 'mystery', 'normal'];
    return Array.from({ length: BOARD_TOTAL + 1 }, (_, i) => ({
      index: i,
      type: i === 0 ? 'normal' : SPACE_TYPES[Math.floor(Math.random() * SPACE_TYPES.length)],
    }));
  };

  const renderPlayer = ({ item, index }) => (
    <View style={[styles.playerCard, hoveredButton === `p-${index}` && styles.playerCardHover]}>
      <View style={[styles.playerColorBadge, { backgroundColor: item.color || '#888' }]} />
      <Text style={styles.playerName}>{item.name || 'Anonymous'}</Text>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Loading lobby...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>

        {/* PIN Display */}
        <Animated.View style={[styles.pinCard, { transform: [{ scale: pinPulse }] }]}>
          <Text style={styles.pinLabel}>Game PIN</Text>
          <Text style={styles.pin}>{pin || '------'}</Text>
          <Text style={styles.pinHint}>Share this code with players</Text>
        </Animated.View>

        <Text style={styles.playerCountLabel}>{players.length} / {session?.settings?.maxPlayers || '∞'} Players</Text>

        {/* Player grid */}
        {players.length > 0 ? (
          <FlatList
            data={players}
            renderItem={renderPlayer}
            keyExtractor={(_, i) => i.toString()}
            numColumns={3}
            columnWrapperStyle={styles.playerRow}
            scrollEnabled={false}
            style={styles.playerList}
          />
        ) : (
          <View style={styles.emptyPlayerArea}>
            <Text style={styles.emptyText}>👋 Waiting for players to join...</Text>
            <Text style={styles.emptySubtext}>Players go to Brain Board and enter the PIN above</Text>
          </View>
        )}

        {/* Snake board preview (host only) */}
        {isHost && (
          <SnakeBoardPreview players={players} />
        )}

      </ScrollView>

      {/* Host controls */}
      {isHost && (
        <View style={styles.hostControls}>
          <TouchableOpacity
            style={[styles.lockBtn, isLobbyLocked && styles.lockBtnActive]}
            onPress={toggleLobbyLock}
          >
            <Text style={styles.lockBtnIcon}>{isLobbyLocked ? '🔒' : '🔓'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.startBtn, players.length === 0 && styles.startBtnDisabled]}
            onPress={handleStartGame}
            disabled={players.length === 0}
            onMouseEnter={() => setHoveredButton('start')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={styles.startBtnText}>▶  Start Game</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Cancel button */}
      <TouchableOpacity
        style={styles.cancelBtn}
        onPress={() => setShowCancelModal(true)}
      >
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>

      {/* Cancel modal */}
      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Leave Lobby?</Text>
            <Text style={styles.modalText}>Are you sure you want to leave?</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setShowCancelModal(false)}>
                <Text style={styles.modalBtnCancelText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnConfirm}
                onPress={() => { setShowCancelModal(false); navigation.navigate('Dashboard'); }}
              >
                <Text style={styles.modalBtnConfirmText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Board preview styles ─────────────────────────────────────────────────────
const boardStyles = StyleSheet.create({
  boardWrapper: {
    backgroundColor: '#0d0d0d',
    borderRadius: 16,
    padding: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  boardTitle: { color: '#00c781', fontSize: 16, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', marginBottom: 4 },
  space: {
    width: 44,
    height: 44,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    margin: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  spaceHead: {
    backgroundColor: '#003322',
    borderColor: '#00c781',
    borderWidth: 2,
  },
  spaceStart: {
    backgroundColor: '#1a2a1a',
    borderColor: '#2ecc71',
  },
  headEmoji: { fontSize: 22 },
  spaceNum: { color: '#555', fontSize: 11 },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 1 },
  token: { width: 8, height: 8, borderRadius: 4, margin: 1 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1e1e1e', borderWidth: 1, borderColor: '#333' },
  legendIcon: { fontSize: 12 },
  legendText: { color: '#666', fontSize: 11 },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  scrollContent: { padding: 24, paddingBottom: 160 },
  loadingText: { color: '#fff', marginTop: 16, fontSize: 18, textAlign: 'center' },
  errorText: { color: '#ff6b6b', fontSize: 18, textAlign: 'center', padding: 30 },

  pinCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#00c781',
  },
  pinLabel: { fontSize: 14, color: '#aaa', letterSpacing: 3, marginBottom: 8 },
  pin: { fontSize: 56, fontWeight: 'bold', color: '#00c781', letterSpacing: 12 },
  pinHint: { fontSize: 13, color: '#555', marginTop: 6 },

  playerCountLabel: { color: '#aaa', fontSize: 15, textAlign: 'center', marginBottom: 16 },

  playerList: { marginBottom: 8 },
  playerRow: { justifyContent: 'flex-start', gap: 8, marginBottom: 8 },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 12,
    flex: 1,
    minWidth: 100,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  playerCardHover: { borderColor: '#00c781' },
  playerColorBadge: { width: 14, height: 14, borderRadius: 7, marginRight: 8 },
  playerName: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },

  emptyPlayerArea: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: '#555', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  emptySubtext: { color: '#444', fontSize: 14, textAlign: 'center' },

  // Host controls
  hostControls: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  lockBtn: {
    width: 60,
    height: 60,
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  lockBtnActive: { backgroundColor: '#003322', borderColor: '#00c781' },
  lockBtnIcon: { fontSize: 26 },
  startBtn: {
    flex: 1,
    maxWidth: 260,
    backgroundColor: '#00c781',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  startBtnDisabled: { backgroundColor: '#2a2a2a', opacity: 0.5 },
  startBtnText: { color: '#000', fontSize: 20, fontWeight: 'bold' },

  cancelBtn: {
    position: 'absolute',
    bottom: 20,
    left: 24,
    backgroundColor: '#c0392b',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  cancelBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 28, width: 340, borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12, textAlign: 'center' },
  modalText: { fontSize: 15, color: '#ccc', textAlign: 'center', marginBottom: 24 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalBtnCancel: { flex: 1, backgroundColor: '#333', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalBtnCancelText: { color: '#fff', fontWeight: 'bold' },
  modalBtnConfirm: { flex: 1, backgroundColor: '#c0392b', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalBtnConfirmText: { color: '#fff', fontWeight: 'bold' },
});