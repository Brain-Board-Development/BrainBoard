/**
 * GameScreen.js - Fixed nickname persistence
 * - Uses username passed from JoinGameScreen
 * - No more overwriting with Firebase displayName
 * - Real-time session updates + dummy question/timer
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
import { db, auth } from '../firebaseConfig';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

export default function GameScreen({ route, navigation }) {
  const { sessionId, gameId, isHost, username: passedUsername } = route.params; // ← Now receives username from JoinGameScreen

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [username, setUsername] = useState(passedUsername || ''); // ← Use passed name first!
  const [hasSetUsername, setHasSetUsername] = useState(!!passedUsername); // Already set if passed
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);

  // Listen to real-time session updates
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = onSnapshot(doc(db, 'gameSessions', sessionId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSession(data);

        // Only generate username if nothing was passed AND setting is on
        if (data.settings?.nicknameGenerator && !hasSetUsername && !username) {
          const generated = generateNickname();
          setUsername(generated);
          joinWithUsername(generated);
        }

        // Dummy question (replace with real data later)
        if (data.currentQuestionIndex !== undefined) {
          setCurrentQuestion({
            question: "What is the capital of France?",
            answers: ["Paris", "London", "Berlin", "Madrid"],
            correctIndex: 0,
          });
          setTimeLeft(data.settings?.timePerQuestion || 60);
        }

        setLoading(false);
      } else {
        setError("Game session not found");
        setLoading(false);
      }
    }, (err) => {
      console.error("Session listen error:", err);
      setError("Failed to connect to game");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [sessionId]);

  // Timer countdown
  useEffect(() => {
    if (!timeLeft || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Generate fun nickname (only as fallback)
  const generateNickname = () => {
    const adjectives = ["Happy", "Cosmic", "Speedy", "Sneaky", "Epic", "Mystic", "Wild", "Cool"];
    const nouns = ["Panda", "Fox", "Tiger", "Dragon", "Ninja", "Robot", "Wizard", "Pirate"];
    const number = Math.floor(Math.random() * 100);
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${
      nouns[Math.floor(Math.random() * nouns.length)]
    }${number}`;
  };

  // Join with chosen/generated username
  const joinWithUsername = async (chosenName) => {
    if (!auth.currentUser) {
      Alert.alert("Error", "You must be logged in to play.");
      return;
    }

    try {
      const playerEntry = {
        uid: auth.currentUser.uid,
        name: chosenName,
        joinedAt: new Date().toISOString(),
        score: 0,
      };

      // Check if already joined
      const existing = session?.players?.find(p => p.uid === auth.currentUser.uid);
      if (existing) {
        setHasSetUsername(true);
        return;
      }

      await updateDoc(doc(db, 'gameSessions', sessionId), {
        players: [...(session?.players || []), playerEntry],
      });

      setUsername(chosenName);
      setHasSetUsername(true);
    } catch (err) {
      console.error("Failed to join:", err);
      Alert.alert("Error", "Could not join the game.");
    }
  };

  // Submit answer (placeholder)
  const submitAnswer = (index) => {
    console.log("Submitted answer:", index);
    Alert.alert("Answer Submitted", `You chose option ${index + 1}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Connecting to game...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Username setup screen (only shown if no name was passed)
  if (!hasSetUsername) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Choose Your Name</Text>

        {session?.settings?.nicknameGenerator ? (
          <Text style={styles.infoText}>Auto-generated: {username}</Text>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Enter your username"
              placeholderTextColor="#666"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="words"
              maxLength={20}
            />
            <Text style={styles.hint}>3–20 characters</Text>
          </>
        )}

        <TouchableOpacity
          style={styles.joinButton}
          onPress={() => joinWithUsername(username || generateNickname())}
          disabled={!username.trim()}
        >
          <Text style={styles.buttonText}>Join Game</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Main Game UI
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Brain Board</Text>
        <View style={styles.playerInfo}>
          <Text style={styles.username}>{username}</Text> {/* ← Now uses correct name */}
          <Text style={styles.score}>Score: 0</Text>
        </View>
      </View>

      {/* Timer & Question */}
      <View style={styles.questionContainer}>
        <Text style={styles.timer}>{timeLeft}s</Text>
        <Text style={styles.questionText}>
          {currentQuestion?.question || "Waiting for next question..."}
        </Text>
      </View>

      {/* Answers */}
      {currentQuestion?.answers && (
        <View style={styles.answersGrid}>
          {currentQuestion.answers.map((answer, index) => (
            <TouchableOpacity
              key={index}
              style={styles.answerButton}
              onPress={() => submitAnswer(index)}
            >
              <Text style={styles.answerText}>{answer}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Players List (small sidebar) */}
      <View style={styles.playersContainer}>
        <Text style={styles.playersTitle}>Players</Text>
        <FlatList
          data={session.players || []}
          keyExtractor={(item, idx) => idx.toString()}
          renderItem={({ item }) => (
            <Text style={styles.playerName}>{item.name}</Text>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  playerInfo: {
    alignItems: 'flex-end',
  },
  username: {
    color: '#00c781',
    fontSize: 16,
    fontWeight: '600',
  },
  score: {
    color: '#aaa',
    fontSize: 14,
  },
  questionContainer: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    alignItems: 'center',
  },
  timer: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ff6b6b',
    marginBottom: 16,
  },
  questionText: {
    fontSize: 24,
    color: '#fff',
    textAlign: 'center',
  },
  answersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  answerButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#222',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    alignItems: 'center',
  },
  answerText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
  playersContainer: {
    position: 'absolute',
    right: 16,
    top: 80,
    width: 180,
    backgroundColor: 'rgba(30,30,30,0.7)',
    borderRadius: 12,
    padding: 12,
  },
  playersTitle: {
    color: '#00c781',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  playerName: {
    color: '#ddd',
    fontSize: 14,
    marginVertical: 4,
  },
  input: {
    width: '80%',
    height: 50,
    backgroundColor: '#222',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 18,
    marginBottom: 16,
    textAlign: 'center',
  },
  joinButton: {
    width: '80%',
    height: 50,
    backgroundColor: '#00c781',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 20,
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
    borderRadius: 8,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
  },
  infoText: {
    color: '#aaa',
    fontSize: 16,
    marginBottom: 20,
  },
  hint: {
    color: '#666',
    fontSize: 14,
    marginBottom: 20,
  },
});