/**
 * HostGameMenu.js
 * Launch button pinned to bottom — always visible regardless of scroll position.
 * Settings rows compact and responsive via useWindowDimensions.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, ScrollView, Switch, TextInput, Modal, useWindowDimensions, SafeAreaView, Pressable, Platform,
} from "react-native";
import { db, auth } from '../firebaseConfig';
import { doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

export default function HostGameMenu({ navigation, route }) {
  const { gameId } = route.params;
  const { width: winW, height: winH } = useWindowDimensions();
  // Scale factor: 1.0 on comfortable screen, down to 0.7 on small
  const rs = Math.min(1, Math.max(0.7, winW / 500, winH / 700));

  const [game, setGame] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [gameDuration,       setGameDuration]       = useState('10');
  const [maxPlayers,         setMaxPlayers]         = useState('30');
  const [timePerQuestion,    setTimePerQuestion]    = useState('20');
  const [boardSize,          setBoardSize]          = useState('');
  const [showAnswersAfter,   setShowAnswersAfter]   = useState(true);
  const [nicknameGenerator,  setNicknameGenerator]  = useState(false);
  const [hostPlays,          setHostPlays]          = useState(false);
  const [randomizeQuestions, setRandomizeQuestions] = useState(true);
  const [randomizeAnswers,   setRandomizeAnswers]   = useState(true);

  useEffect(() => {
    const fetchGame = async () => {
      try {
        const gameDoc = await getDoc(doc(db, 'games', gameId));
        if (gameDoc.exists()) {
          const d = gameDoc.data();
          setGame(d);
          setCoverImage(d.coverImage || null);
          if (d.timePerQuestion > 0) setTimePerQuestion(d.timePerQuestion.toString());
        } else {
          setError('Game not found');
          setErrorMessage('The selected game could not be found.');
          setShowErrorModal(true);
        }
      } catch (err) {
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
    if (isNaN(duration) || duration < 1 || duration > 180) { setErrorMessage('Game duration must be between 1 and 180 minutes.'); return false; }
    if (isNaN(players)  || players  < 1 || players  > 500) { setErrorMessage('Maximum players must be between 1 and 500.'); return false; }
    if (isNaN(time)     || time     < 5 || time     > 300) { setErrorMessage('Time per question must be between 5 and 300 seconds.'); return false; }
    if (boardSize.trim() !== '') {
      const size = parseInt(boardSize, 10);
      if (isNaN(size) || size < 1 || size > 300) { setErrorMessage('Board tiles must be between 1 and 300, or leave blank for auto.'); return false; }
    }
    return true;
  };

  const launchLobby = async () => {
    if (!game || !validateSettings()) { setShowErrorModal(true); return; }
    try {
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      const parsedBoardSize = boardSize.trim() ? Math.max(1, parseInt(boardSize, 10)) : null;
      const sessionRef = await addDoc(collection(db, 'gameSessions'), {
        gameId, hostId: auth.currentUser.uid, pin,
        status: 'lobby', players: [], kickedPlayers: [],
        currentQuestionIndex: 0,
        settings: {
          gameDuration:     parseInt(gameDuration, 10),
          gameDurationSecs: parseInt(gameDuration, 10) * 60,
          maxPlayers:       parseInt(maxPlayers, 10),
          timePerQuestion:  parseInt(timePerQuestion, 10),
          boardSize:        parsedBoardSize,
          showAnswersAfter, nicknameGenerator, hostPlays,
          randomizeQuestions, randomizeAnswers,
        },
        createdAt: serverTimestamp(),
      });
      navigation.navigate('Lobby', { sessionId: sessionRef.id, pin, gameId, isHost: true });
    } catch (err) {
      setErrorMessage('Failed to create the game session. Please try again.');
      setShowErrorModal(true);
    }
  };

  if (isLoading) {
    return (
      <View style={S.loading}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={S.loadingTxt}>Loading game...</Text>
      </View>
    );
  }

  const rowSz = { fontSize: Math.max(12, 14 * rs), marginBottom: Math.max(10, 14 * rs) };
  const inputSz = { width: Math.max(70, 80 * rs), height: Math.max(36, 40 * rs), fontSize: Math.max(13, 15 * rs) };

  // Settings rows data
  const textRows = [
    { label: 'Game duration (min)', value: gameDuration, set: setGameDuration, placeholder: '10' },
    { label: 'Players allowed',     value: maxPlayers,   set: setMaxPlayers,   placeholder: '30' },
    { label: 'Time per question (s)',value: timePerQuestion, set: setTimePerQuestion, placeholder: '20' },
    { label: 'Board tiles (blank = auto)', value: boardSize, set: setBoardSize, placeholder: 'Auto', hint: true },
  ];
  const toggleRows = [
    { label: 'Nickname generator', hint: 'Auto-assign random names', value: nicknameGenerator, set: setNicknameGenerator },
    { label: 'Show correct answers after each Q', value: showAnswersAfter, set: setShowAnswersAfter },
    { label: 'Host can play', value: hostPlays, set: setHostPlays },
    { label: 'Randomize question order', value: randomizeQuestions, set: setRandomizeQuestions },
    { label: 'Randomize answer order', value: randomizeAnswers, set: setRandomizeAnswers },
  ];

  return (
    <SafeAreaView style={S.container}>
      {/* ── Header ── */}
      <View style={[S.header, { padding: Math.max(12, 16 * rs) }]}>
        <TouchableOpacity style={{ width: 80 }} onPress={() => navigation.goBack()}>
          <Text style={[S.backText, { fontSize: Math.max(13, 15 * rs) }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[S.headerTitle, { fontSize: Math.max(16, 20 * rs) }]}>Host Game</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ── Scrollable settings ── */}
      <ScrollView
        style={S.scroll}
        contentContainerStyle={[S.content, { padding: Math.max(10, 14 * rs), paddingBottom: 16 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Game card */}
        <View style={[S.gameCard, { padding: Math.max(12, 16 * rs), marginBottom: Math.max(8, 12 * rs) }]}>
          <View style={[S.gameCover, { width: Math.max(64, 80 * rs), height: Math.max(64, 80 * rs) }]}>
            {coverImage
              ? <Image source={{ uri: coverImage }} style={{ width: '100%', height: '100%', borderRadius: 12 }} resizeMode="cover" />
              : <View style={{ width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#555', fontSize: Math.max(18, 22 * rs), fontWeight: 'bold' }}>
                    {game?.title?.substring(0,2).toUpperCase() || '?'}
                  </Text>
                </View>
            }
          </View>
          <Text style={[S.gameTitle, { fontSize: Math.max(15, 18 * rs) }]} numberOfLines={2}>
            {game?.title || 'Game Title'}
          </Text>
          <Text style={[S.gameInfo, { fontSize: Math.max(11, 13 * rs) }]}>
            {game?.numQuestions || 0} questions
          </Text>
        </View>

        {/* Settings card */}
        <View style={[S.settingsCard, { padding: Math.max(12, 18 * rs), marginBottom: Math.max(8, 12 * rs) }]}>
          <Text style={[S.sectionTitle, { fontSize: Math.max(13, 15 * rs), marginBottom: Math.max(8, 12 * rs) }]}>
            Game Settings
          </Text>

          {/* Text input rows */}
          {textRows.map(r => (
            <View key={r.label} style={[S.settingRow, { marginBottom: rowSz.marginBottom }]}>
              <Text style={[S.settingLabel, { fontSize: rowSz.fontSize }]} numberOfLines={2}>{r.label}</Text>
              <TextInput
                style={[S.numberInput, inputSz]}
                value={r.value} onChangeText={r.set}
                keyboardType="numeric" placeholder={r.placeholder}
                placeholderTextColor="#666" maxLength={4}
              />
            </View>
          ))}

          {/* Divider */}
          <View style={S.divider} />

          {/* Toggle rows */}
          {toggleRows.map(r => (
            <View key={r.label} style={[S.settingRow, { marginBottom: rowSz.marginBottom }]}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[S.settingLabel, { fontSize: rowSz.fontSize }]}>{r.label}</Text>
                {r.hint && <Text style={S.settingHint}>{r.hint}</Text>}
              </View>
              <Switch
                value={r.value} onValueChange={r.set}
                trackColor={{ false: '#333', true: '#00c781' }}
                thumbColor={r.value ? '#fff' : '#ccc'}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Bottom buttons — always visible ── */}
      <View style={[S.launchBar, { padding: Math.max(10, 14 * rs), gap: 10 }]}>
        <Pressable
          style={({hovered,pressed})=>[S.launchButton, { paddingVertical: Math.max(12, 16 * rs) }, Platform.OS==='web'&&hovered&&{backgroundColor:'#00e090',transform:[{scale:1.02}]}, pressed&&{opacity:0.85}]}
          onPress={launchLobby}
        >
          <Text style={[S.launchText, { fontSize: Math.max(15, 18 * rs) }]}>Launch Lobby</Text>
          <Text style={[S.launchSubtext, { fontSize: Math.max(11, 13 * rs) }]}>Students will join with a PIN</Text>
        </Pressable>
        <TouchableOpacity
          style={[S.soloButton, { paddingVertical: Math.max(11, 14 * rs) }]}
          activeOpacity={0.75}
          onPress={() => {
            if (!game) { alert('Game not loaded yet, please wait.'); return; }
            if (!game.questions || game.questions.length === 0) { alert('This game has no questions.'); return; }
            navigation.navigate('SoloQuiz', {
              gameId,
              questions: game.questions,
              title: game.title || '',
              coverImage: coverImage || null,
              timePerQuestion: parseInt(timePerQuestion, 10) || 20,
              gameDuration: parseInt(gameDuration, 10) || 10,
              showAnswersAfter,
              randomizeQuestions,
              randomizeAnswers,
            });
          }}
        >
          <Text style={[S.soloButtonText, { fontSize: Math.max(14, 16 * rs) }]}>Play Solo</Text>
          <Text style={[S.launchSubtext, { fontSize: Math.max(10, 12 * rs) }]}>Answer questions by yourself</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showErrorModal} transparent animationType="fade" onRequestClose={() => setShowErrorModal(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalContent}>
            <Text style={S.modalTitle}>Oops!</Text>
            <Text style={S.modalMessage}>{errorMessage}</Text>
            <TouchableOpacity style={S.modalBtn} onPress={() => { setShowErrorModal(false); if (error) navigation.goBack(); }}>
              <Text style={S.modalBtnTxt}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#111' },
  loading:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  loadingTxt:  { color: '#fff', marginTop: 16, fontSize: 16 },

  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  backText:    { color: '#00c781', fontWeight: 'bold' },
  headerTitle: { fontWeight: 'bold', color: '#fff' },

  scroll:   { flex: 1 },
  content:  { alignItems: 'center' },

  gameCard:    { backgroundColor: '#1e1e1e', borderRadius: 16, width: '100%', maxWidth: 600,
                  alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  gameCover:   { backgroundColor: '#2a2a2a', borderRadius: 12, justifyContent: 'center',
                  alignItems: 'center', marginBottom: 10 },
  gameTitle:   { fontWeight: 'bold', color: '#fff', marginBottom: 4, textAlign: 'center' },
  gameInfo:    { color: '#aaa' },

  settingsCard: { backgroundColor: '#1e1e1e', borderRadius: 16, width: '100%', maxWidth: 600,
                   borderWidth: 1, borderColor: '#333' },
  sectionTitle: { fontWeight: 'bold', color: '#fff' },
  settingRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { color: '#ddd', flex: 1 },
  settingHint:  { fontSize: 11, color: '#555', marginTop: 2 },
  numberInput:  { backgroundColor: '#2a2a2a', borderRadius: 10, paddingHorizontal: 10,
                   color: '#fff', textAlign: 'center', borderWidth: 1, borderColor: '#444' },
  divider:      { height: 1, backgroundColor: '#2a2a2a', marginVertical: 10 },

  // Launch bar — pinned to bottom, always visible
  launchBar:    { backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: '#222' },
  launchButton: { backgroundColor: '#00c781', borderRadius: 14, alignItems: 'center',
                   width: '100%', maxWidth: 600, alignSelf: 'center' },
  launchText:   { color: '#fff', fontWeight: 'bold' },
  soloButton:     { backgroundColor: '#0d3550', borderRadius: 14, alignItems: 'center', width: '100%', maxWidth: 600, alignSelf: 'center', borderWidth: 1.5, borderColor: '#3498db' },
  soloButtonText: { color: '#3498db', fontWeight: 'bold' },
  launchSubtext:{ color: 'rgba(255,255,255,0.75)', marginTop: 3 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#1e1e1e', borderRadius: 16, padding: 24, width: '85%',
                   maxWidth: 400, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  modalTitle:   { fontSize: 20, fontWeight: 'bold', color: '#ff6b6b', marginBottom: 12 },
  modalMessage: { fontSize: 14, color: '#ddd', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  modalBtn:     { backgroundColor: '#00c781', paddingVertical: 12, paddingHorizontal: 32,
                   borderRadius: 12, width: '100%', alignItems: 'center' },
  modalBtnTxt:  { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});