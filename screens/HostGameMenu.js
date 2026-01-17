/**
 * HostGameMenu.js - Intermediary screen before launching the lobby
 * Review game → optional settings → Launch Lobby
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { db, auth } from '../firebaseConfig';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

export default function HostGameMenu({ navigation, route }) {
  const { gameId } = route.params;

  const [game, setGame] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeMultiplier, setTimeMultiplier] = useState(1); // 0.5x, 1x, 1.5x, 2x
  const [showAnswersAfter, setShowAnswersAfter] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchGame = async () => {
      try {
        const gameDoc = await getDoc(doc(db, 'games', gameId));
        if (gameDoc.exists()) {
          setGame(gameDoc.data());
        } else {
          setError('Game not found');
        }
      } catch (err) {
        console.error('Error fetching game:', err);
        setError('Failed to load game');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGame();
  }, [gameId]);

  const launchLobby = async () => {
    if (!game) return;

    try {
      // Generate a simple 6-digit PIN (you can make it more unique later)
      const pin = Math.floor(100000 + Math.random() * 900000).toString();

      // Create a new game session
      const sessionRef = await addDoc(collection(db, 'gameSessions'), {
        gameId,
        hostId: auth.currentUser.uid,
        pin,
        status: 'lobby',
        players: [],
        currentQuestionIndex: 0,
        settings: {
          timeMultiplier,
          showAnswersAfter,
        },
        createdAt: serverTimestamp(),
      });

      // Navigate to the actual lobby screen
      navigation.navigate('HostGameLobby', {
        sessionId: sessionRef.id,
        gameId,
        pin,
      });
    } catch (err) {
      console.error('Failed to launch lobby:', err);
      alert('Failed to start hosting. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Loading game...</Text>
      </View>
    );
  }

  if (error || !game) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Game not found'}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Host Game</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Game Overview */}
        <View style={styles.gameCard}>
          <View style={styles.gameCover}>
            <Text style={{ fontSize: 60 }}>🎯</Text>
          </View>
          <Text style={styles.gameTitle}>{game.title}</Text>
          <Text style={styles.gameInfo}>
            {game.numQuestions || 0} questions • by {game.creatorName || 'You'}
          </Text>
        </View>

        {/* Quick Settings */}
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Quick Settings</Text>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Time per question</Text>
            <View style={styles.multiplierButtons}>
              {['0.5x', '1x', '1.5x', '2x'].map((val) => (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.multiplierBtn,
                    timeMultiplier === parseFloat(val) && styles.multiplierBtnActive,
                  ]}
                  onPress={() => setTimeMultiplier(parseFloat(val))}
                >
                  <Text style={styles.multiplierText}>{val}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Show correct answers after each question</Text>
            <Switch
              value={showAnswersAfter}
              onValueChange={setShowAnswersAfter}
              trackColor={{ false: '#333', true: '#00c781' }}
              thumbColor={showAnswersAfter ? '#fff' : '#ccc'}
            />
          </View>
        </View>

        {/* Launch Button */}
        <TouchableOpacity style={styles.launchButton} onPress={launchLobby}>
          <Text style={styles.launchText}>Launch Lobby</Text>
          <Text style={styles.launchSubtext}>Students will join with a PIN</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  loadingText: {
    color: '#fff',
    marginTop: 20,
    fontSize: 18,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 20,
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  backBtnText: {
    color: '#fff',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#0d0d0d',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  backText: {
    color: '#00c781',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  content: {
    padding: 30,
    alignItems: 'center',
  },
  gameCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#333',
  },
  gameCover: {
    width: 140,
    height: 140,
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  gameTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  gameInfo: {
    fontSize: 16,
    color: '#aaa',
  },
  settingsCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 500,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#333',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 16,
    color: '#ddd',
    flex: 1,
  },
  multiplierButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  multiplierBtn: {
    backgroundColor: '#333',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  multiplierBtnActive: {
    backgroundColor: '#00c781',
  },
  multiplierText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  launchButton: {
    backgroundColor: '#00c781',
    paddingVertical: 20,
    paddingHorizontal: 40,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    maxWidth: 500,
    shadowColor: '#00c781',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  launchText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  launchSubtext: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.8,
    marginTop: 4,
  },
});