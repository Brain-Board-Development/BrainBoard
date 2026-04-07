/**
 * GameScreen.js - Player Lobby with name + color selection
 * Fixes: color change no longer resets name/code
 * Players pick their color here before joining
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  FlatList,
  Modal,
  Animated,
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

// Player color options
const PLAYER_COLORS = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e91e63', // pink
  '#ff5722', // deep orange
];

// Pawn SVG-style using View/Text
function PawnIcon({ color, size = 40 }) {
  return (
    <View style={[styles.pawnContainer, { width: size, height: size * 1.2 }]}>
      <View style={[styles.pawnHead, { width: size * 0.45, height: size * 0.45, borderRadius: size * 0.225, backgroundColor: color }]} />
      <View style={[styles.pawnNeck, { width: size * 0.18, height: size * 0.15, backgroundColor: color }]} />
      <View style={[styles.pawnBody, { width: size * 0.55, height: size * 0.3, borderRadius: size * 0.08, backgroundColor: color }]} />
      <View style={[styles.pawnBase, { width: size * 0.65, height: size * 0.14, borderRadius: size * 0.07, backgroundColor: color }]} />
    </View>
  );
}

export default function GameScreen({ route, navigation }) {
  const { sessionId, isHost, gameId } = route.params;

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Use separate refs to avoid closure issues with name/color
  const [username, setUsername] = useState('');
  const [selectedColor, setSelectedColor] = useState(PLAYER_COLORS[0]);
  const [hasJoined, setHasJoined] = useState(false);
  const [playerUid] = useState(`guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  const [showNameTakenModal, setShowNameTakenModal] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);

  // Keep refs to avoid stale closures
  const usernameRef = useRef(username);
  const colorRef = useRef(selectedColor);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { colorRef.current = selectedColor; }, [selectedColor]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Firestore listener
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'gameSessions', sessionId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSession(data);
        setLoading(false);

        // Game started — navigate to board
        if (data.status === 'playing' && hasJoined) {
          navigation.replace('BoardGameScreen', {
            sessionId,
            gameId: data.gameId || gameId,
            playerName: usernameRef.current,
            playerColor: colorRef.current,
            playerUid,
            isHost: false,
          });
        }
      } else {
        setError('Session not found');
        setLoading(false);
      }
    }, (err) => {
      console.error('Session error:', err);
      setError('Failed to connect');
      setLoading(false);
    });
    return () => unsub();
  }, [sessionId, hasJoined]);

  const handleJoin = useCallback(async () => {
    const name = username.trim();
    if (!name || name.length < 1) return;

    const existingNames = (session?.players || []).map(p => p.name);
    if (existingNames.includes(name)) {
      setShowNameTakenModal(true);
      return;
    }

    try {
      const newPlayer = {
        uid: playerUid,
        name,
        color: selectedColor,
        joinedAt: new Date().toISOString(),
        score: 0,
        position: 0,
        correctStreak: 0,
        totalCorrect: 0,
        luck: 0,
        stunned: false,
      };

      const updatedPlayers = [...(session?.players || []), newPlayer];
      await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
      setHasJoined(true);
    } catch (err) {
      console.error('Join error:', err);
    }
  }, [username, selectedColor, session, sessionId, playerUid]);

  // ─── Color selection — does NOT touch username state ───────────────────────
  const handleColorSelect = useCallback((color) => {
    setSelectedColor(color);
    colorRef.current = color;
    // Also update if already joined
    if (hasJoined && session) {
      const updatedPlayers = (session.players || []).map(p =>
        p.uid === playerUid ? { ...p, color } : p
      );
      updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers }).catch(console.error);
    }
  }, [hasJoined, session, sessionId, playerUid]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Connecting...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const players = session?.players || [];

  // ─── Pre-join screen ──────────────────────────────────────────────────────
  if (!hasJoined) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.gameTitle}>🎲 Brain Board</Text>
        <Text style={styles.subtitle}>Customize your player</Text>

        {/* Pawn preview */}
        <Animated.View style={[styles.pawnPreview, { transform: [{ scale: pulseAnim }] }]}>
          <PawnIcon color={selectedColor} size={72} />
        </Animated.View>

        {/* Color picker */}
        <View style={styles.colorGrid}>
          {PLAYER_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              style={[
                styles.colorSwatch,
                { backgroundColor: color },
                selectedColor === color && styles.colorSwatchSelected,
              ]}
              onPress={() => handleColorSelect(color)}
              activeOpacity={0.8}
            >
              {selectedColor === color && (
                <Text style={styles.colorCheckmark}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Name input — completely independent of color state */}
        <View style={styles.nameSection}>
          <Text style={styles.inputLabel}>Your Name</Text>
          <TextInput
            style={styles.nameInput}
            placeholder="Enter your name..."
            placeholderTextColor="#555"
            value={username}
            onChangeText={setUsername}
            maxLength={20}
            autoCapitalize="words"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.joinBtn,
            !username.trim() && styles.joinBtnDisabled,
          ]}
          onPress={handleJoin}
          disabled={!username.trim()}
          onMouseEnter={() => setHoveredButton('join')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={styles.joinBtnText}>Join Game →</Text>
        </TouchableOpacity>

        {/* Modal for name taken */}
        <Modal visible={showNameTakenModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Name Taken</Text>
              <Text style={styles.modalText}>That name is already in use. Choose another!</Text>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setShowNameTakenModal(false)}
              >
                <Text style={styles.modalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  // ─── Post-join waiting lobby ──────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.waitingHeader}>
        <Text style={styles.gameTitle}>🎲 Brain Board</Text>
        <Text style={styles.waitingSubtitle}>Waiting for host to start...</Text>
      </View>

      {/* My player card */}
      <View style={styles.myCard}>
        <PawnIcon color={selectedColor} size={52} />
        <View style={{ marginLeft: 16 }}>
          <Text style={styles.myNameLabel}>You</Text>
          <Text style={styles.myName}>{username}</Text>
        </View>
        <View style={[styles.colorDot, { backgroundColor: selectedColor }]} />
      </View>

      {/* Player list */}
      <View style={styles.playerListCard}>
        <Text style={styles.playerListTitle}>Players ({players.length})</Text>
        <FlatList
          data={players}
          keyExtractor={(_, i) => i.toString()}
          renderItem={({ item }) => (
            <View style={[styles.playerRow, item.name === username && styles.playerRowMe]}>
              <View style={[styles.playerDot, { backgroundColor: item.color || '#888' }]} />
              <Text style={[styles.playerRowName, item.name === username && { color: '#00c781' }]}>
                {item.name}
              </Text>
              {item.name === username && <Text style={styles.youBadge}>You</Text>}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Waiting for players...</Text>
          }
        />
      </View>

      <Text style={styles.waitingHint}>
        The host will start the game when everyone is ready.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: '#fff', marginTop: 16, fontSize: 18 },
  errorText: { color: '#ff6b6b', fontSize: 18, textAlign: 'center' },
  backBtn: { marginTop: 20, backgroundColor: '#333', padding: 14, borderRadius: 12 },
  backBtnText: { color: '#fff', fontWeight: 'bold' },

  gameTitle: { fontSize: 32, fontWeight: 'bold', color: '#00c781', marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#aaa', marginBottom: 24 },

  // Pawn preview
  pawnPreview: { marginBottom: 24, alignItems: 'center' },
  pawnContainer: { alignItems: 'center', justifyContent: 'flex-end' },
  pawnHead: {},
  pawnNeck: { marginTop: 1 },
  pawnBody: { marginTop: 1 },
  pawnBase: { marginTop: 1 },

  // Color grid
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 28,
    width: '100%',
    maxWidth: 320,
  },
  colorSwatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  colorSwatchSelected: {
    borderColor: '#fff',
    transform: [{ scale: 1.15 }],
  },
  colorCheckmark: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  // Name section
  nameSection: { width: '100%', maxWidth: 360, marginBottom: 20 },
  inputLabel: { color: '#aaa', fontSize: 13, marginBottom: 8, marginLeft: 4 },
  nameInput: {
    backgroundColor: '#1e1e1e',
    color: '#fff',
    fontSize: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#333',
    width: '100%',
  },

  // Join button
  joinBtn: {
    backgroundColor: '#00c781',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 16,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  joinBtnDisabled: { backgroundColor: '#333', opacity: 0.5 },
  joinBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  modal: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 28, width: 320, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  modalText: { color: '#ccc', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  modalBtn: { backgroundColor: '#00c781', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },
  modalBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // Waiting lobby
  waitingHeader: { alignItems: 'center', marginBottom: 24 },
  waitingSubtitle: { color: '#aaa', fontSize: 15 },
  myCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  myNameLabel: { color: '#aaa', fontSize: 12, marginBottom: 2 },
  myName: { color: '#00c781', fontSize: 22, fontWeight: 'bold' },
  colorDot: { width: 20, height: 20, borderRadius: 10, marginLeft: 'auto' },
  playerListCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    flex: 1,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 20,
  },
  playerListTitle: { color: '#00c781', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  playerRowMe: { backgroundColor: '#003322', borderRadius: 8, paddingHorizontal: 8 },
  playerDot: { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  playerRowName: { color: '#fff', fontSize: 15, flex: 1 },
  youBadge: { backgroundColor: '#00c781', color: '#000', fontSize: 11, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  emptyText: { color: '#555', textAlign: 'center', paddingVertical: 20 },
  waitingHint: { color: '#555', fontSize: 13, textAlign: 'center' },
});