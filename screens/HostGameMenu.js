/**
 * HostGameMenu.js
 * All settings including boardSize are now stored in the session.
 * boardSize left blank = auto-computed from player count formula when game starts.
 * nicknameGenerator, timePerQuestion, and gameDuration are all stored and used.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Switch, TextInput, Modal,
} from 'react-native';
import { db, auth } from '../firebaseConfig';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

export default function HostGameMenu({ navigation, route }) {
  const { gameId } = route.params;

  const [game, setGame] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Settings
  const [gameDuration, setGameDuration]       = useState('10');  // minutes
  const [maxPlayers, setMaxPlayers]           = useState('30');
  const [timePerQuestion, setTimePerQuestion] = useState('20');  // seconds
  const [boardSize, setBoardSize]             = useState('');    // blank = auto (formula)
  const [showAnswersAfter, setShowAnswersAfter]     = useState(true);
  const [nicknameGenerator, setNicknameGenerator]   = useState(false);
  const [hostPlays, setHostPlays]                   = useState(false);
  const [randomizeQuestions, setRandomizeQuestions] = useState(false);
  const [randomizeAnswers, setRandomizeAnswers]     = useState(false);

  useEffect(() => {
    const fetchGame = async () => {
      try {
        const gameDoc = await getDoc(doc(db, 'games', gameId));
        if (gameDoc.exists()) {
          const gameData = gameDoc.data();
          setGame(gameData);
          if (gameData.timePerQuestion && gameData.timePerQuestion > 0) {
            setTimePerQuestion(gameData.timePerQuestion.toString());
          }
        } else {
          setError('Game not found');
          setErrorMessage('The selected game could not be found.');
          setShowErrorModal(true);
        }
      } catch (err) {
        console.error('Error fetching game:', err);
        setError('Failed to load game');
        setErrorMessage('There was a problem loading the game. Please try again.');
        setShowErrorModal(true);
      } finally {
        setIsLoading(false);
      }
    };
    fetchGame();
  }, [gameId]);

  const validateSettings = () => {
    const duration = parseInt(gameDuration, 10);
    const players  = parseInt(maxPlayers, 10);
    const time     = parseInt(timePerQuestion, 10);

    if (isNaN(duration) || duration < 1 || duration > 180) {
      setErrorMessage('Game duration must be between 1 and 180 minutes.');
      return false;
    }
    if (isNaN(players) || players < 1 || players > 500) {
      setErrorMessage('Maximum players must be between 1 and 500.');
      return false;
    }
    if (isNaN(time) || time < 5 || time > 300) {
      setErrorMessage('Time per question must be between 5 and 300 seconds.');
      return false;
    }
    if (boardSize.trim() !== '') {
      const size = parseInt(boardSize, 10);
      if (isNaN(size) || size < 1 || size > 300) {
        setErrorMessage('Board tiles must be between 1 and 300, or leave blank for auto.');
        return false;
      }
    }
    return true;
  };

  const launchLobby = async () => {
    if (!game || !validateSettings()) {
      setShowErrorModal(true);
      return;
    }

    try {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();

      // boardSize: null means "compute from player count formula when game starts"
      const parsedBoardSize = boardSize.trim() ? Math.max(1, parseInt(boardSize, 10)) : null;

      const sessionRef = await addDoc(collection(db, 'gameSessions'), {
        gameId,
        hostId: auth.currentUser.uid,
        pin,
        status: 'lobby',
        players: [],
        kickedPlayers: [],
        currentQuestionIndex: 0,
        settings: {
          gameDuration:       parseInt(gameDuration, 10),      // minutes
          gameDurationSecs:   parseInt(gameDuration, 10) * 60, // seconds (for timer)
          maxPlayers:         parseInt(maxPlayers, 10),
          timePerQuestion:    parseInt(timePerQuestion, 10),   // seconds per question
          boardSize:          parsedBoardSize,                  // null = auto
          showAnswersAfter,
          nicknameGenerator,
          hostPlays,
          randomizeQuestions,
          randomizeAnswers,
        },
        createdAt: serverTimestamp(),
      });

      navigation.navigate('Lobby', {
        sessionId: sessionRef.id,
        pin,
        gameId,
        isHost: true,
      });
    } catch (err) {
      console.error('Failed to launch lobby:', err);
      setErrorMessage('Failed to create the game session. Please try again.');
      setShowErrorModal(true);
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

  return (
    <View style={styles.container}>
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
          <Text style={styles.gameTitle}>{game?.title || 'Game Title'}</Text>
          <Text style={styles.gameInfo}>
            {game?.numQuestions || 0} questions • by {game?.creatorName || 'You'}
          </Text>
        </View>

        {/* Settings */}
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Game Settings</Text>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Game duration (minutes)</Text>
            <TextInput style={styles.numberInput} value={gameDuration} onChangeText={setGameDuration} keyboardType="numeric" placeholder="10" maxLength={3} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Players allowed</Text>
            <TextInput style={styles.numberInput} value={maxPlayers} onChangeText={setMaxPlayers} keyboardType="numeric" placeholder="30" maxLength={4} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Time per question (seconds)</Text>
            <TextInput style={styles.numberInput} value={timePerQuestion} onChangeText={setTimePerQuestion} keyboardType="numeric" placeholder="20" maxLength={3} />
          </View>

          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Board tiles</Text>
              <Text style={styles.settingHint}>Leave blank to auto-calculate from player count</Text>
            </View>
            <TextInput
              style={styles.numberInput}
              value={boardSize}
              onChangeText={setBoardSize}
              keyboardType="numeric"
              placeholder="Auto"
              placeholderTextColor="#666"
              maxLength={3}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Nickname generator</Text>
              <Text style={styles.settingHint}>Auto-assign random names to all players</Text>
            </View>
            <Switch value={nicknameGenerator} onValueChange={setNicknameGenerator} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={nicknameGenerator ? '#fff' : '#ccc'} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Show correct answers after each question</Text>
            <Switch value={showAnswersAfter} onValueChange={setShowAnswersAfter} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={showAnswersAfter ? '#fff' : '#ccc'} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Host can play</Text>
            <Switch value={hostPlays} onValueChange={setHostPlays} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={hostPlays ? '#fff' : '#ccc'} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Randomize order of questions</Text>
            <Switch value={randomizeQuestions} onValueChange={setRandomizeQuestions} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={randomizeQuestions ? '#fff' : '#ccc'} />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Randomize order of answers</Text>
            <Switch value={randomizeAnswers} onValueChange={setRandomizeAnswers} trackColor={{ false: '#333', true: '#00c781' }} thumbColor={randomizeAnswers ? '#fff' : '#ccc'} />
          </View>
        </View>

        <TouchableOpacity style={styles.launchButton} onPress={launchLobby}>
          <Text style={styles.launchText}>Launch Lobby</Text>
          <Text style={styles.launchSubtext}>Students will join with a PIN</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showErrorModal} transparent animationType="fade" onRequestClose={() => setShowErrorModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Oops!</Text>
            <Text style={styles.modalMessage}>{errorMessage}</Text>
            <TouchableOpacity style={styles.modalButton} onPress={() => { setShowErrorModal(false); if (error) navigation.goBack(); }}>
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  loadingText: { color: '#fff', marginTop: 20, fontSize: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  backText: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  content: { padding: 30, alignItems: 'center' },
  gameCard: { backgroundColor: '#1e1e1e', borderRadius: 20, padding: 24, width: '100%', maxWidth: 500, alignItems: 'center', marginBottom: 30, borderWidth: 1, borderColor: '#333' },
  gameCover: { width: 140, height: 140, backgroundColor: '#2a2a2a', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  gameTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  gameInfo: { fontSize: 16, color: '#aaa' },
  settingsCard: { backgroundColor: '#1e1e1e', borderRadius: 20, padding: 24, width: '100%', maxWidth: 500, marginBottom: 30, borderWidth: 1, borderColor: '#333' },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  settingLabel: { fontSize: 16, color: '#ddd', flex: 1 },
  settingHint: { fontSize: 12, color: '#666', marginTop: 2 },
  numberInput: { width: 90, height: 44, backgroundColor: '#333', borderRadius: 12, paddingHorizontal: 12, color: '#fff', fontSize: 16, textAlign: 'center', borderWidth: 1, borderColor: '#444' },
  launchButton: { backgroundColor: '#00c781', paddingVertical: 20, paddingHorizontal: 40, borderRadius: 16, alignItems: 'center', width: '100%', maxWidth: 500 },
  launchText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  launchSubtext: { color: '#fff', fontSize: 14, opacity: 0.8, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: '80%', maxWidth: 400, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#ff6b6b', marginBottom: 16 },
  modalMessage: { fontSize: 16, color: '#ddd', textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  modalButton: { backgroundColor: '#00c781', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12, width: '100%', alignItems: 'center' },
  modalButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});