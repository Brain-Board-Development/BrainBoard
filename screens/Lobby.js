/**
 * Lobby.js - HOST-ONLY Lobby Screen (TeacherDashboard style)
 * - No top navigation bar
 * - Cancel button bottom-left with confirmation modal
 * - Square green lock button + rectangular Start Game button at bottom
 * - Start Game button is green & clickable ONLY when ≥1 player; otherwise gray/disabled
 * - Consistent dark/green UI with rounded cards & hover effects
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  Modal,
  Image,
  Alert,
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [session, setSession] = useState(null);
  const [players, setPlayers] = useState([]);
  const [isLobbyLocked, setIsLobbyLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredButton, setHoveredButton] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(doc(db, 'gameSessions', sessionId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSession(data);
        setPlayers(data.players || []);
        setIsLobbyLocked(data.isLobbyLocked || false);
        setLoading(false);
      } else {
        setError('Session not found');
        setLoading(false);
      }
    }, (err) => {
      console.error('Lobby snapshot error:', err);
      setError('Failed to load lobby');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [sessionId]);

  const toggleLobbyLock = async () => {
    if (!isHost) return;
    try {
      const newLockedState = !isLobbyLocked;
      await updateDoc(doc(db, 'gameSessions', sessionId), {
        isLobbyLocked: newLockedState,
      });
    } catch (err) {
      console.error('Failed to toggle lobby lock:', err);
      Alert.alert('Error', 'Failed to update lobby status');
    }
  };

  const handleStartGame = async () => {
    if (!isHost) return;
    if (players.length === 0) {
      Alert.alert("No Players", "You need at least 1 player to start the game.");
      return;
    }

    try {
      await updateDoc(doc(db, 'gameSessions', sessionId), {
        status: 'playing',
        currentQuestionIndex: 0,
      });
      navigation.navigate('PlayGameScreen', { sessionId, gameId, isHost: true });
    } catch (err) {
      console.error('Failed to start game:', err);
      Alert.alert('Error', 'Failed to start the game');
    }
  };

  const handleCancel = () => {
    setShowCancelModal(true);
  };

  const confirmCancel = () => {
    setShowCancelModal(false);
    navigation.navigate('TeacherDashboard');
  };

  const cancelModalCancel = () => {
    setShowCancelModal(false);
  };

  const renderPlayer = ({ item }) => (
    <View style={[
      styles.playerCard,
      hoveredButton === `player-${item.name}` && styles.playerCardHover
    ]}>
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

  const canStart = players.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Main Content */}
      <View style={styles.content}>
        {/* PIN Display */}
        <View style={styles.pinCard}>
          <Text style={styles.pinLabel}>Game PIN</Text>
          <Text style={styles.pin}>{pin || '------'}</Text>
        </View>

        {/* Player Count */}
        <View style={styles.playerCountContainer}>
          <Text style={styles.playerCount}>
            {players.length} Players
          </Text>
        </View>

        {/* Players Grid */}
        <FlatList
          data={players}
          renderItem={renderPlayer}
          keyExtractor={(item, index) => index.toString()}
          numColumns={3}
          columnWrapperStyle={styles.playerRow}
          contentContainerStyle={styles.playersList}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Waiting for players to join...</Text>
          }
        />
      </View>

      {/* Host Controls - bottom center */}
      {isHost && (
        <View style={styles.hostControls}>
          {/* Square Lock Button */}
          <TouchableOpacity
            style={[
              styles.lockButton,
              isLobbyLocked && styles.lockButtonActive,
              hoveredButton === 'lock' && styles.lockButtonHover
            ]}
            onPress={toggleLobbyLock}
            onMouseEnter={() => setHoveredButton('lock')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Image
              source={isLobbyLocked ? require('../assets/unlock.png') : require('../assets/lock.png')}
              style={styles.lockIconImage}
              resizeMode="contain"
            />
          </TouchableOpacity>

          {/* Rectangular Start Game Button */}
          <TouchableOpacity
            style={[
              styles.startButton,
              !canStart && styles.startButtonDisabled,
              hoveredButton === 'start' && styles.startButtonHover
            ]}
            onPress={handleStartGame}
            disabled={!canStart}
            onMouseEnter={() => setHoveredButton('start')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={styles.startButtonText}>Start Game</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Cancel Button - Bottom Left */}
      <TouchableOpacity
        style={[
          styles.cancelButton,
          hoveredButton === 'cancel' && styles.cancelButtonHover
        ]}
        onPress={handleCancel}
        onMouseEnter={() => setHoveredButton('cancel')}
        onMouseLeave={() => setHoveredButton(null)}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>

      {/* Cancel Confirmation Modal */}
      <Modal
        visible={showCancelModal}
        transparent
        animationType="fade"
        onRequestClose={cancelModalCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.confirmModalTitle}>Cancel Lobby?</Text>
            <Text style={styles.confirmModalText}>
              Are you sure you want to cancel and leave this lobby? All progress will be lost.
            </Text>
            <View style={styles.confirmModalButtons}>
              <TouchableOpacity
                style={styles.confirmModalCancel}
                onPress={cancelModalCancel}
              >
                <Text style={styles.confirmModalCancelText}>No, Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmModalConfirm}
                onPress={confirmCancel}
              >
                <Text style={styles.confirmModalConfirmText}>Yes, Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  content: {
    flex: 1,
    padding: 30,
  },
  pinCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#333',
  },
  pinLabel: {
    fontSize: 18,
    color: '#aaa',
    marginBottom: 12,
  },
  pin: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#00c781',
    letterSpacing: 10,
  },
  playerCountContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  playerCount: {
    color: '#00c781',
    fontSize: 20,
    fontWeight: '600',
  },
  playersList: {
    paddingBottom: 140,
  },
  playerRow: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  playerCard: {
    flex: 1,
    marginHorizontal: 8,
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  playerCardHover: {
    borderColor: '#00c781',
    transform: [{ scale: 1.02 }],
  },
  playerName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  emptyText: {
    color: '#666',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 60,
  },

  // Host Controls - bottom center
  hostControls: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 30,
  },
  lockButton: {
    width: 70,
    height: 70,
    backgroundColor: '#00c781',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#00c781',
  },
  lockButtonActive: {
    backgroundColor: '#00c781',
    borderColor: '#00c781',
  },
  lockButtonHover: {
    backgroundColor: '#00e092',
    transform: [{ scale: 1.05 }],
  },
  lockIconImage: {
    width: 40,
    height: 40,
  },
  startButton: {
    backgroundColor: '#00c781',
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 40,
    alignItems: 'center',
    minWidth: 200,
  },
  startButtonHover: {
    backgroundColor: '#00e092',
    transform: [{ scale: 1.02 }],
  },
  startButtonDisabled: {
    backgroundColor: '#444',
    opacity: 0.6,
  },
  startButtonText: {
    color: '#000',
    fontSize: 20,
    fontWeight: 'bold',
  },

  // Cancel Button - bottom left
  cancelButton: {
    position: 'absolute',
    bottom: 40,
    left: 30,
    backgroundColor: '#c0392b',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  cancelButtonHover: {
    backgroundColor: '#d32f2f',
  },
  cancelText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Cancel Confirmation Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmModal: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    width: 360,
    borderWidth: 1,
    borderColor: '#333',
  },
  confirmModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmModalText: {
    fontSize: 15,
    color: '#ccc',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  confirmModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  confirmModalCancel: {
    flex: 1,
    backgroundColor: '#444',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmModalCancelText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  confirmModalConfirm: {
    flex: 1,
    backgroundColor: '#c0392b',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmModalConfirmText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});