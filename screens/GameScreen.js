/**
 * GameScreen.js - Lobby Waiting Screen (username managed here)
 * - Username input is REQUIRED (button disabled if blank)
 * - Username is stored and used locally in this screen
 * - Shows real-time player list in dashboard-style cards
 * - Big green "Customize" button (placeholder)
 * - Matches TeacherDashboard style
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  FlatList,
  Alert,
} from 'react-native';
import { db } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

export default function GameScreen({ route, navigation }) {
  const { sessionId, isHost } = route.params;

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [username, setUsername] = useState('');           // Managed here only
  const [hasSetUsername, setHasSetUsername] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);

  // Listen to real-time session updates
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(doc(db, 'gameSessions', sessionId), (docSnap) => {
      if (docSnap.exists()) {
        setSession(docSnap.data());
        setLoading(false);
      } else {
        setError("Game session not found");
        setLoading(false);
      }
    }, (err) => {
      console.error("Session listen error:", err);
      setError("Failed to connect to lobby");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [sessionId]);

  // Join/update username in lobby
  const joinWithUsername = async () => {
    const finalName = username.trim();
    if (!finalName) {
      Alert.alert("Username Required", "Please enter a display name to join the lobby.");
      return;
    }

    try {
      const playerUid = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // Always guest-style UID

      let updatedPlayers = [...(session?.players || [])];

      // Check if this device/session is already in
      const existingIndex = updatedPlayers.findIndex(p => p.uid === playerUid);
      if (existingIndex !== -1) {
        // Update existing entry with new name
        updatedPlayers[existingIndex] = {
          ...updatedPlayers[existingIndex],
          name: finalName,
        };
      } else {
        // Add new player
        updatedPlayers.push({
          uid: playerUid,
          name: finalName,
          joinedAt: new Date().toISOString(),
          score: 0,
        });
      }

      await updateDoc(doc(db, 'gameSessions', sessionId), {
        players: updatedPlayers,
      });

      setUsername(finalName);
      setHasSetUsername(true);
    } catch (err) {
      console.error("Failed to join lobby:", err);
      Alert.alert("Error", "Could not join the lobby.");
    }
  };

  // Placeholder for Customize button
  const handleCustomize = () => {
    Alert.alert("Customize", "Avatar, color, or piece selection coming soon!");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Connecting to lobby...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
          onMouseEnter={() => setHoveredButton('back')}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={[
            styles.backButtonText,
            hoveredButton === 'back' && { color: '#00e092' }
          ]}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Username input screen - centered vertically
  if (!hasSetUsername) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredContent}>
          <Text style={styles.title}>Welcome to the Lobby</Text>
          <Text style={styles.subtitle}>Choose your display name</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter your username"
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="words"
            maxLength={20}
            autoFocus
          />

          <Text style={styles.hint}>3–20 characters (required)</Text>

          <TouchableOpacity
            style={[
              styles.joinButton,
              !username.trim() && styles.disabledButton,
              hoveredButton === 'join' && styles.joinButtonHover
            ]}
            onPress={joinWithUsername}
            disabled={!username.trim()}
            onMouseEnter={() => setHoveredButton('join')}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={styles.buttonText}>Enter Lobby</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Main Lobby UI (dashboard-style)
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Brain Board Lobby</Text>
        {isHost && <Text style={styles.hostBadge}>Host</Text>}
      </View>

      {/* Your Username */}
      <View style={styles.usernameCard}>
        <Text style={styles.usernameLabel}>You are:</Text>
        <Text style={styles.username}>{username}</Text>
      </View>

      {/* Players List */}
      <View style={styles.playersCard}>
        <Text style={styles.playersTitle}>
          Players ({session?.players?.length || 0})
        </Text>

        <FlatList
          data={session?.players || []}
          keyExtractor={(item, idx) => idx.toString()}
          renderItem={({ item }) => (
            <View style={[
              styles.playerCard,
              item.name === username && styles.yourPlayerCard
            ]}>
              <Text style={styles.playerName}>{item.name}</Text>
              {item.name === username && (
                <Text style={styles.youBadge}>You</Text>
              )}
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Waiting for players to join...</Text>
          }
        />
      </View>

      {/* Customize Button */}
      <TouchableOpacity 
        style={[
          styles.customizeButton,
          hoveredButton === 'customize' && styles.customizeButtonHover
        ]}
        onPress={handleCustomize}
        onMouseEnter={() => setHoveredButton('customize')}
        onMouseLeave={() => setHoveredButton(null)}
      >
        <Text style={styles.customizeText}>Customize</Text>
      </TouchableOpacity>

      {/* Waiting Message */}
      <Text style={styles.waitingText}>
        {isHost
          ? "Waiting for more players... Click Start in the host lobby when ready!"
          : "Waiting for the host to start the game..."}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    padding: 30,
  },

  // Vertical centering for username input
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
    paddingHorizontal: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  hostBadge: {
    backgroundColor: '#00c781',
    color: '#000',
    fontSize: 14,
    fontWeight: 'bold',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  usernameCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#333',
  },
  usernameLabel: {
    fontSize: 16,
    color: '#aaa',
    marginBottom: 8,
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00c781',
  },
  playersCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#333',
    flex: 1,
  },
  playersTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00c781',
    marginBottom: 16,
    textAlign: 'center',
  },
  playerCard: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  yourPlayerCard: {
    borderColor: '#00c781',
    backgroundColor: '#003322',
  },
  playerName: {
    fontSize: 16,
    color: '#fff',
  },
  youBadge: {
    backgroundColor: '#00c781',
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
  },
  customizeButton: {
    backgroundColor: '#00c781',
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  customizeButtonHover: {
    backgroundColor: '#00e092',
    transform: [{ scale: 1.02 }],
  },
  customizeText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  waitingText: {
    color: '#aaa',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  input: {
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
    width: '80%',
    maxWidth: 400,
  },
  joinButton: {
    backgroundColor: '#00c781',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    width: '80%',
    maxWidth: 400,
  },
  disabledButton: {
    backgroundColor: '#444',
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 18,
    color: '#aaa',
    marginBottom: 24,
    textAlign: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  hint: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 20,
    textAlign: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 18,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 20,
    padding: 12,
    backgroundColor: '#333',
    borderRadius: 12,
    alignSelf: 'center',
  },
  backText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});