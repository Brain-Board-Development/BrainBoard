/**
 * Lobby.js - Game Lobby Screen for students to join via PIN
 * Shows PIN, player list, host controls
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
  StatusBar,
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons'; // You'll need to install @expo/vector-icons

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params; // isHost = true if teacher

  const [session, setSession] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(doc(db, 'gameSessions', sessionId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSession(data);
        setPlayers(data.players || []);
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

  const handleStartGame = async () => {
    if (!isHost || players.length === 0) return;

    try {
      await updateDoc(doc(db, 'gameSessions', sessionId), {
        status: 'playing',
        currentQuestionIndex: 0,
      });
      // Navigate to game play screen (host view)
      navigation.navigate('HostGamePlay', { sessionId, gameId });
    } catch (err) {
      console.error('Failed to start game:', err);
      alert('Failed to start the game');
    }
  };

  const renderPlayer = ({ item }) => (
    <View style={styles.playerCard}>
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

  const canStart = isHost && players.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color="#00c781" />
        </TouchableOpacity>

        <Text style={styles.title}>Game Lobby</Text>

        {isHost && (
          <TouchableOpacity>
            <Ionicons name="settings-outline" size={28} color="#00c781" />
          </TouchableOpacity>
        )}
      </View>

      {/* PIN Display */}
      <View style={styles.pinContainer}>
        <Text style={styles.pinLabel}>Game PIN</Text>
        <Text style={styles.pin}>{pin || '------'}</Text>
      </View>

      {/* Player Count */}
      <View style={styles.playerCountContainer}>
        <Ionicons name="people-outline" size={24} color="#00c781" />
        <Text style={styles.playerCount}>
          {players.length} / {session?.settings?.maxPlayers || '?'} Players
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

      {/* Start Button (only for host) */}
      {isHost && (
        <TouchableOpacity
          style={[
            styles.startButton,
            !canStart && styles.startButtonDisabled,
          ]}
          onPress={handleStartGame}
          disabled={!canStart}
        >
          <Ionicons name="lock-closed" size={28} color="#fff" style={styles.lockIcon} />
          <Text style={styles.startButtonText}>Start Game</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  pinContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  pinLabel: {
    color: '#aaa',
    fontSize: 16,
    marginBottom: 8,
  },
  pin: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#00c781',
    letterSpacing: 8,
    backgroundColor: '#111',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#222',
  },
  playerCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  playerCount: {
    color: '#00c781',
    fontSize: 18,
    fontWeight: '600',
  },
  playersList: {
    paddingBottom: 100,
  },
  playerRow: {
    justifyContent: 'space-between',
  },
  playerCard: {
    flex: 1,
    margin: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  playerName: {
    color: '#00c781',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    color: '#666',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 40,
  },
  startButton: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: '#00c781',
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  startButtonDisabled: {
    backgroundColor: '#444',
    opacity: 0.6,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  lockIcon: {
    marginRight: 8,
  },
});