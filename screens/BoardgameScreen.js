/**
 * BoardGameScreen.js - Proof of Concept Board Game
 * 
 * Simplified version for testing:
 * - Answer 3 questions correctly in a row → roll dice
 * - Dice roll determines spaces moved
 * - Randomly generated board spaces
 * - Board extends as players approach the end
 * - Real-time multiplayer via Firestore
 * - Space types: Normal, Lava, Cannon, Trap
 * - Host controls start/end
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Animated,
  Dimensions,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { db } from '../firebaseConfig';
import {
  doc,
  onSnapshot,
  updateDoc,
  getDoc,
  arrayUnion,
} from 'firebase/firestore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────────────────────

const SPACE_TYPES = {
  NORMAL:  { id: 'normal',  label: '🟩', color: '#2ecc71', description: 'Safe space',           weight: 50 },
  LAVA:    { id: 'lava',    label: '🌋', color: '#e74c3c', description: 'Roll to go back!',       weight: 15 },
  CANNON:  { id: 'cannon',  label: '💨', color: '#3498db', description: 'Roll again for free!',   weight: 15 },
  TRAP:    { id: 'trap',    label: '⚠️',  color: '#f39c12', description: 'Answer fast or stun!',  weight: 10 },
  MYSTERY: { id: 'mystery', label: '❓', color: '#9b59b6', description: 'Mystery event!',         weight: 10 },
};

const BOARD_CHUNK_SIZE = 20; // spaces added per extension
const BOARD_EXTEND_THRESHOLD = 5; // extend when any player is within 5 spaces of end
const QUESTIONS_PER_ROLL = 3;
const TRAP_TIME_LIMIT = 10; // seconds to answer trap question

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];
const PLAYER_EMOJIS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🩵'];

// ─── Space Generation ─────────────────────────────────────────────────────────

function generateSpaces(count, startIndex = 0) {
  const typeKeys = Object.keys(SPACE_TYPES);
  const totalWeight = typeKeys.reduce((s, k) => s + SPACE_TYPES[k].weight, 0);

  return Array.from({ length: count }, (_, i) => {
    const roll = Math.random() * totalWeight;
    let cumulative = 0;
    let chosenType = 'normal';
    for (const key of typeKeys) {
      cumulative += SPACE_TYPES[key].weight;
      if (roll < cumulative) { chosenType = key; break; }
    }
    // First space is always normal (start)
    if (startIndex + i === 0) chosenType = 'normal';
    return { index: startIndex + i, type: chosenType };
  });
}

// ─── Dice Roll Helper ─────────────────────────────────────────────────────────

function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, isHost, gameId } = route.params;

  // ── State ──
  const [session, setSession]     = useState(null);
  const [game, setGame]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Player state
  const [myState, setMyState]     = useState(null); // local copy for quick reads

  // Question phase
  const [currentQuestion, setCurrentQuestion]     = useState(null);
  const [questionIndex, setQuestionIndex]         = useState(0); // index into game.questions
  const [selectedAnswer, setSelectedAnswer]       = useState(null);
  const [answerResult, setAnswerResult]           = useState(null); // 'correct' | 'wrong'
  const [correctStreak, setCorrectStreak]         = useState(0);
  const [questionPhase, setQuestionPhase]         = useState('answering'); // 'answering' | 'result'

  // Dice phase
  const [phase, setPhase]         = useState('questions'); // 'questions' | 'rolling' | 'moving' | 'space_event' | 'waiting'
  const [diceValue, setDiceValue] = useState(null);
  const [diceRolling, setDiceRolling] = useState(false);

  // Space event
  const [spaceEvent, setSpaceEvent] = useState(null); // { type, question? }
  const [trapAnswered, setTrapAnswered] = useState(false);
  const [trapTimer, setTrapTimer] = useState(TRAP_TIME_LIMIT);
  const trapIntervalRef = useRef(null);

  // Board scroll
  const scrollRef = useRef(null);

  // Dice animation
  const diceAnim = useRef(new Animated.Value(0)).current;

  // ── Firestore listener ──
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'gameSessions', sessionId), snap => {
      if (!snap.exists()) { setError('Session not found'); setLoading(false); return; }
      const data = snap.data();
      setSession(data);
      const me = (data.players || []).find(p => p.name === playerName);
      if (me) setMyState(me);
      setLoading(false);
    });
    return () => unsub();
  }, [sessionId, playerName]);

  // ── Load game questions ──
  useEffect(() => {
    if (!gameId) return;
    getDoc(doc(db, 'games', gameId)).then(snap => {
      if (snap.exists()) setGame(snap.data());
    });
  }, [gameId]);

  // ── Pick next question ──
  useEffect(() => {
    if (!game || !game.questions?.length) return;
    const q = game.questions[questionIndex % game.questions.length];
    setCurrentQuestion(q);
    setSelectedAnswer(null);
    setAnswerResult(null);
    setQuestionPhase('answering');
  }, [questionIndex, game]);

  // ── Board auto-extend ──
  useEffect(() => {
    if (!session || !isHost) return;
    const board = session.board || [];
    const boardLen = board.length;
    const players = session.players || [];
    const maxPos = Math.max(...players.map(p => p.position || 0), 0);
    if (boardLen - maxPos <= BOARD_EXTEND_THRESHOLD) {
      const newSpaces = generateSpaces(BOARD_CHUNK_SIZE, boardLen);
      updateDoc(doc(db, 'gameSessions', sessionId), {
        board: [...board, ...newSpaces],
      });
    }
  }, [session?.players]);

  // ── Initialize board if host ──
  useEffect(() => {
    if (!session || !isHost) return;
    if (!session.board || session.board.length === 0) {
      const initialBoard = generateSpaces(BOARD_CHUNK_SIZE + 10, 0);
      updateDoc(doc(db, 'gameSessions', sessionId), { board: initialBoard });
    }
  }, [session, isHost]);

  // ─── Answer Handler ───────────────────────────────────────────────────────

  const handleAnswer = useCallback(async (answerIndex) => {
    if (questionPhase !== 'answering' || selectedAnswer !== null) return;
    setSelectedAnswer(answerIndex);

    const q = currentQuestion;
    const isCorrect = q?.correctAnswers?.[answerIndex] === true;

    setAnswerResult(isCorrect ? 'correct' : 'wrong');
    setQuestionPhase('result');

    if (isCorrect) {
      const newStreak = correctStreak + 1;
      setCorrectStreak(newStreak);
      if (newStreak >= QUESTIONS_PER_ROLL) {
        // Ready to roll!
        setTimeout(() => {
          setCorrectStreak(0);
          setPhase('rolling');
        }, 1200);
      } else {
        // Next question
        setTimeout(() => {
          setQuestionIndex(i => i + 1);
        }, 1200);
      }
    } else {
      // Wrong – pick a fresh question, streak stays at 0 (reset progress toward roll)
      setCorrectStreak(0);
      setTimeout(() => {
        setQuestionIndex(i => i + 1);
      }, 1200);
    }
  }, [questionPhase, selectedAnswer, currentQuestion, correctStreak]);

  // ─── Dice Roll Handler ────────────────────────────────────────────────────

  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);

    // Animate dice
    Animated.sequence([
      Animated.timing(diceAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();

    await new Promise(r => setTimeout(r, 700));

    const roll = rollDice();
    setDiceValue(roll);
    setDiceRolling(false);

    // Move player
    setTimeout(() => movePlayer(roll), 400);
  }, [diceRolling, diceAnim, myState, session]);

  // ─── Move Player ──────────────────────────────────────────────────────────

  const movePlayer = useCallback(async (spaces) => {
    if (!myState || !session) return;
    setPhase('moving');

    const newPos = (myState.position || 0) + spaces;
    const board = session.board || [];
    const landedSpace = board[Math.min(newPos, board.length - 1)];

    // Update Firestore
    const updatedPlayers = (session.players || []).map(p =>
      p.name === playerName ? { ...p, position: newPos } : p
    );
    await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });

    // Handle space event
    setTimeout(() => handleSpaceLanding(landedSpace, spaces), 600);
  }, [myState, session, playerName, sessionId]);

  // ─── Space Landing Logic ──────────────────────────────────────────────────

  const handleSpaceLanding = useCallback((space, rollValue) => {
    if (!space) { setPhase('questions'); return; }

    switch (space.type) {
      case 'lava': {
        setSpaceEvent({ type: 'lava', rollValue });
        setPhase('space_event');
        break;
      }
      case 'cannon': {
        setSpaceEvent({ type: 'cannon' });
        setPhase('space_event');
        break;
      }
      case 'trap': {
        if (!game?.questions?.length) { setPhase('questions'); return; }
        const trapQ = game.questions[Math.floor(Math.random() * game.questions.length)];
        setSpaceEvent({ type: 'trap', question: trapQ });
        setTrapTimer(TRAP_TIME_LIMIT);
        setTrapAnswered(false);
        setPhase('space_event');
        // Start countdown
        trapIntervalRef.current = setInterval(() => {
          setTrapTimer(t => {
            if (t <= 1) {
              clearInterval(trapIntervalRef.current);
              handleTrapTimeout();
              return 0;
            }
            return t - 1;
          });
        }, 1000);
        break;
      }
      case 'mystery': {
        setSpaceEvent({ type: 'mystery' });
        setPhase('space_event');
        break;
      }
      default:
        setPhase('questions');
    }
  }, [game, myState, session, playerName, sessionId]);

  const handleTrapTimeout = useCallback(async () => {
    clearInterval(trapIntervalRef.current);
    // Stunned: skip next turn (mark in Firestore)
    if (session && myState) {
      const updatedPlayers = (session.players || []).map(p =>
        p.name === playerName ? { ...p, stunned: true } : p
      );
      await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
    }
    setSpaceEvent(null);
    setPhase('questions');
  }, [session, myState, playerName, sessionId]);

  const resolveSpaceEvent = useCallback(async (choice) => {
    clearInterval(trapIntervalRef.current);
    if (!spaceEvent || !myState || !session) return;

    const currentPos = myState.position || 0;
    let newPos = currentPos;

    switch (spaceEvent.type) {
      case 'lava': {
        // Roll dice to go back
        const backRoll = rollDice();
        newPos = Math.max(0, currentPos - backRoll);
        const updatedPlayers = (session.players || []).map(p =>
          p.name === playerName ? { ...p, position: newPos } : p
        );
        await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
        break;
      }
      case 'cannon': {
        // Roll again and move forward
        const bonusRoll = rollDice();
        newPos = currentPos + bonusRoll;
        const updatedPlayers = (session.players || []).map(p =>
          p.name === playerName ? { ...p, position: newPos } : p
        );
        await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
        break;
      }
      case 'trap': {
        if (!choice?.correct) {
          // Stunned
          const updatedPlayers = (session.players || []).map(p =>
            p.name === playerName ? { ...p, stunned: true } : p
          );
          await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
        }
        break;
      }
      case 'mystery': {
        // POC: just give a small bonus move
        newPos = currentPos + 2;
        const updatedPlayers = (session.players || []).map(p =>
          p.name === playerName ? { ...p, position: newPos } : p
        );
        await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
        break;
      }
    }

    setSpaceEvent(null);
    setPhase('questions');
  }, [spaceEvent, myState, session, playerName, sessionId]);

  // ─── Handle stun ──────────────────────────────────────────────────────────

  const handleUnstunSelf = useCallback(async () => {
    const updatedPlayers = (session.players || []).map(p =>
      p.name === playerName ? { ...p, stunned: false } : p
    );
    await updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers });
  }, [session, playerName, sessionId]);

  // ─── Render Helpers ───────────────────────────────────────────────────────

  const getAnswerStyle = (i) => {
    const base = [styles.answerBtn];
    if (selectedAnswer === null) return base;
    if (i === selectedAnswer) {
      base.push(answerResult === 'correct' ? styles.answerCorrect : styles.answerWrong);
    } else if (currentQuestion?.correctAnswers?.[i] && answerResult === 'wrong') {
      base.push(styles.answerCorrectHighlight);
    }
    return base;
  };

  const isMyTurn = session?.currentTurn === playerName;
  const isStunned = myState?.stunned === true;

  // ─── Loading / Error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Entering game...</Text>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ─── Main UI ──────────────────────────────────────────────────────────────

  const board = session?.board || [];
  const players = session?.players || [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>Brain Board</Text>
        <View style={styles.streakBadge}>
          <Text style={styles.streakText}>🔥 {correctStreak}/{QUESTIONS_PER_ROLL}</Text>
        </View>
        <Text style={styles.playerTag}>{playerName}</Text>
      </View>

      {/* Main area: board + right panel */}
      <View style={styles.mainArea}>

        {/* ── Board ── */}
        <View style={styles.boardWrapper}>
          <Text style={styles.boardTitle}>🗺️ Game Board</Text>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.boardScroll}
          >
            {board.map((space, i) => {
              const playersHere = players.filter(p => (p.position || 0) === i);
              const spaceInfo = SPACE_TYPES[space.type] || SPACE_TYPES.NORMAL;
              return (
                <View key={i} style={[styles.space, { backgroundColor: spaceInfo.color + '33', borderColor: spaceInfo.color }]}>
                  <Text style={styles.spaceEmoji}>{spaceInfo.label}</Text>
                  <Text style={styles.spaceNum}>{i}</Text>
                  {/* Player tokens */}
                  <View style={styles.tokens}>
                    {playersHere.map((p, pi) => {
                      const pIdx = players.findIndex(x => x.name === p.name);
                      return (
                        <Text key={pi} style={styles.token}>
                          {PLAYER_EMOJIS[pIdx % PLAYER_EMOJIS.length]}
                        </Text>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Space legend */}
          <View style={styles.legend}>
            {Object.values(SPACE_TYPES).map(s => (
              <View key={s.id} style={styles.legendItem}>
                <Text style={styles.legendEmoji}>{s.label}</Text>
                <Text style={styles.legendLabel}>{s.description}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Right Panel ── */}
        <View style={styles.rightPanel}>

          {/* Leaderboard */}
          <View style={styles.leaderboard}>
            <Text style={styles.sectionTitle}>📊 Standings</Text>
            {[...players]
              .sort((a, b) => (b.position || 0) - (a.position || 0))
              .map((p, i) => {
                const pIdx = players.findIndex(x => x.name === p.name);
                const isMe = p.name === playerName;
                return (
                  <View key={p.name} style={[styles.lbRow, isMe && styles.lbRowMe]}>
                    <Text style={styles.lbRank}>#{i + 1}</Text>
                    <Text style={styles.lbEmoji}>{PLAYER_EMOJIS[pIdx % PLAYER_EMOJIS.length]}</Text>
                    <Text style={[styles.lbName, isMe && styles.lbNameMe]} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.lbPos}>Space {p.position || 0}</Text>
                    {p.stunned && <Text style={styles.stunBadge}>😵</Text>}
                  </View>
                );
              })}
          </View>

          {/* ── Action Zone ── */}
          <View style={styles.actionZone}>

            {/* STUNNED */}
            {isStunned && (
              <View style={styles.stunnedCard}>
                <Text style={styles.stunnedTitle}>😵 Stunned!</Text>
                <Text style={styles.stunnedSub}>Answer 3 in a row to recover</Text>
                {correctStreak >= QUESTIONS_PER_ROLL && (
                  <TouchableOpacity style={styles.greenBtn} onPress={handleUnstunSelf}>
                    <Text style={styles.btnText}>✅ Unstun Yourself</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* QUESTION PHASE */}
            {!isStunned && phase === 'questions' && currentQuestion && (
              <View style={styles.questionCard}>
                <Text style={styles.questionNum}>Question — Get {QUESTIONS_PER_ROLL - correctStreak} more right to roll</Text>
                <Text style={styles.questionText}>{currentQuestion.question}</Text>
                <View style={styles.answersGrid}>
                  {currentQuestion.type === 'multipleChoice'
                    ? currentQuestion.answers.map((ans, i) => (
                        <TouchableOpacity
                          key={i}
                          style={getAnswerStyle(i)}
                          onPress={() => handleAnswer(i)}
                          disabled={questionPhase !== 'answering'}
                        >
                          <Text style={styles.answerText}>{ans || `Option ${i + 1}`}</Text>
                        </TouchableOpacity>
                      ))
                    : ['True', 'False'].map((label, i) => (
                        <TouchableOpacity
                          key={i}
                          style={getAnswerStyle(i)}
                          onPress={() => handleAnswer(i)}
                          disabled={questionPhase !== 'answering'}
                        >
                          <Text style={styles.answerText}>{label}</Text>
                        </TouchableOpacity>
                      ))
                  }
                </View>
                {answerResult && (
                  <Text style={[styles.resultText, answerResult === 'correct' ? styles.resultCorrect : styles.resultWrong]}>
                    {answerResult === 'correct' ? '✅ Correct!' : '❌ Wrong — try again!'}
                  </Text>
                )}
              </View>
            )}

            {/* ROLLING PHASE */}
            {!isStunned && phase === 'rolling' && (
              <View style={styles.diceCard}>
                <Text style={styles.diceTitle}>🎲 Time to Roll!</Text>
                <Text style={styles.diceSub}>You answered {QUESTIONS_PER_ROLL} correctly</Text>
                <Animated.Text style={[
                  styles.diceEmoji,
                  { transform: [{ rotate: diceAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }
                ]}>
                  {diceValue ? getDiceFace(diceValue) : '🎲'}
                </Animated.Text>
                {diceValue && <Text style={styles.diceResult}>You rolled a {diceValue}!</Text>}
                {!diceValue && (
                  <TouchableOpacity style={styles.rollBtn} onPress={handleRoll} disabled={diceRolling}>
                    <Text style={styles.btnText}>{diceRolling ? 'Rolling...' : 'Roll Dice!'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* MOVING PHASE */}
            {phase === 'moving' && (
              <View style={styles.movingCard}>
                <ActivityIndicator color="#00c781" size="large" />
                <Text style={styles.movingText}>Moving your piece...</Text>
              </View>
            )}

            {/* WAITING PHASE (host-only end) */}
            {phase === 'waiting' && (
              <View style={styles.waitCard}>
                <Text style={styles.waitText}>⏳ Waiting...</Text>
              </View>
            )}
          </View>

          {/* Host controls */}
          {isHost && (
            <View style={styles.hostControls}>
              <Text style={styles.hostLabel}>🎮 Host Controls</Text>
              <TouchableOpacity
                style={styles.endBtn}
                onPress={async () => {
                  await updateDoc(doc(db, 'gameSessions', sessionId), { status: 'ended' });
                  navigation.navigate('Dashboard');
                }}
              >
                <Text style={styles.btnText}>End Game</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Space Event Modal ── */}
      <Modal visible={phase === 'space_event' && !!spaceEvent} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          {spaceEvent?.type === 'lava' && (
            <View style={styles.eventCard}>
              <Text style={styles.eventEmoji}>🌋</Text>
              <Text style={styles.eventTitle}>Lava Space!</Text>
              <Text style={styles.eventDesc}>Oh no! You'll roll to see how many spaces you go back.</Text>
              <TouchableOpacity style={styles.redBtn} onPress={() => resolveSpaceEvent({})}>
                <Text style={styles.btnText}>Roll & Go Back</Text>
              </TouchableOpacity>
            </View>
          )}

          {spaceEvent?.type === 'cannon' && (
            <View style={styles.eventCard}>
              <Text style={styles.eventEmoji}>💨</Text>
              <Text style={styles.eventTitle}>Cannon Space!</Text>
              <Text style={styles.eventDesc}>Free bonus roll! Move forward extra spaces!</Text>
              <TouchableOpacity style={styles.blueBtn} onPress={() => resolveSpaceEvent({})}>
                <Text style={styles.btnText}>Launch! 🚀</Text>
              </TouchableOpacity>
            </View>
          )}

          {spaceEvent?.type === 'trap' && spaceEvent.question && (
            <View style={styles.eventCard}>
              <Text style={styles.eventEmoji}>⚠️</Text>
              <Text style={styles.eventTitle}>Trap! Answer Fast!</Text>
              <View style={styles.trapTimer}>
                <Text style={[styles.trapTimerText, trapTimer <= 3 && styles.trapTimerDanger]}>
                  ⏱ {trapTimer}s
                </Text>
              </View>
              <Text style={styles.questionText}>{spaceEvent.question.question}</Text>
              <View style={styles.answersGrid}>
                {(spaceEvent.question.type === 'multipleChoice'
                  ? spaceEvent.question.answers
                  : ['True', 'False']
                ).map((ans, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.answerBtn, styles.answerBtnSmall]}
                    disabled={trapAnswered}
                    onPress={() => {
                      clearInterval(trapIntervalRef.current);
                      setTrapAnswered(true);
                      const correct = spaceEvent.question.correctAnswers?.[i] === true;
                      resolveSpaceEvent({ correct });
                    }}
                  >
                    <Text style={styles.answerTextSmall}>{ans}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {spaceEvent?.type === 'mystery' && (
            <View style={styles.eventCard}>
              <Text style={styles.eventEmoji}>❓</Text>
              <Text style={styles.eventTitle}>Mystery Space!</Text>
              <Text style={styles.eventDesc}>Something random happens... you move forward 2 bonus spaces!</Text>
              <TouchableOpacity style={styles.purpleBtn} onPress={() => resolveSpaceEvent({})}>
                <Text style={styles.btnText}>Reveal!</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* ── Game Over Modal ── */}
      {session?.status === 'ended' && (
        <Modal visible transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.eventCard}>
              <Text style={styles.eventEmoji}>🏆</Text>
              <Text style={styles.eventTitle}>Game Over!</Text>
              {(() => {
                const winner = [...(session.players || [])].sort((a, b) => (b.position || 0) - (a.position || 0))[0];
                return <Text style={styles.eventDesc}>Winner: {winner?.name || '?'} at Space {winner?.position || 0}!</Text>;
              })()}
              <Text style={styles.myScore}>You reached Space {myState?.position || 0}</Text>
              <TouchableOpacity style={styles.greenBtn} onPress={() => navigation.navigate('Dashboard')}>
                <Text style={styles.btnText}>Back to Dashboard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

// ─── Dice Face Helper ─────────────────────────────────────────────────────────

function getDiceFace(n) {
  const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  return faces[n - 1] || '🎲';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#111' },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  loadingText: { color: '#fff', marginTop: 16, fontSize: 18 },
  errorText:   { color: '#ff6b6b', fontSize: 18, textAlign: 'center' },
  backBtn:     { marginTop: 20, backgroundColor: '#333', padding: 14, borderRadius: 12 },
  backBtnText: { color: '#fff', fontWeight: 'bold' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222',
  },
  logo:       { fontSize: 22, fontWeight: 'bold', color: '#00c781' },
  streakBadge: { backgroundColor: '#1e1e1e', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
  streakText:  { color: '#fff', fontWeight: 'bold' },
  playerTag:   { color: '#aaa', fontSize: 14 },

  // Layout
  mainArea: { flex: 1, flexDirection: 'row' },

  // Board
  boardWrapper: { flex: 1, backgroundColor: '#161616', padding: 16 },
  boardTitle:   { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  boardScroll:  { alignItems: 'flex-end', paddingBottom: 8 },
  space: {
    width: 72, height: 90, borderRadius: 10, marginRight: 6, padding: 6,
    justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5,
  },
  spaceEmoji: { fontSize: 26 },
  spaceNum:   { fontSize: 10, color: '#888' },
  tokens:     { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  token:      { fontSize: 14 },
  legend: {
    flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8,
  },
  legendItem:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  legendEmoji: { fontSize: 14, marginRight: 4 },
  legendLabel: { color: '#ccc', fontSize: 11 },

  // Right panel
  rightPanel: {
    width: 360, backgroundColor: '#0d0d0d',
    borderLeftWidth: 1, borderLeftColor: '#222',
    padding: 16, gap: 16,
  },
  sectionTitle: { color: '#00c781', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },

  // Leaderboard
  leaderboard: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 14 },
  lbRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  lbRowMe:  { backgroundColor: '#003322', borderRadius: 8, paddingHorizontal: 6 },
  lbRank:   { color: '#888', width: 28, fontSize: 13 },
  lbEmoji:  { fontSize: 18, marginRight: 8 },
  lbName:   { color: '#fff', flex: 1, fontSize: 14 },
  lbNameMe: { color: '#00c781', fontWeight: 'bold' },
  lbPos:    { color: '#aaa', fontSize: 12 },
  stunBadge: { fontSize: 16, marginLeft: 4 },

  // Action zone
  actionZone: { flex: 1 },

  // Stunned
  stunnedCard: { backgroundColor: '#2a0000', borderRadius: 14, padding: 20, alignItems: 'center', gap: 8 },
  stunnedTitle: { color: '#ff6b6b', fontSize: 20, fontWeight: 'bold' },
  stunnedSub:   { color: '#ccc', textAlign: 'center' },

  // Question card
  questionCard: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 16, gap: 12 },
  questionNum:  { color: '#888', fontSize: 12 },
  questionText: { color: '#fff', fontSize: 17, fontWeight: '600', lineHeight: 24 },
  answersGrid:  { gap: 8 },
  answerBtn: {
    backgroundColor: '#2a2a2a', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#333',
  },
  answerBtnSmall: { padding: 10 },
  answerText:      { color: '#fff', fontSize: 15, fontWeight: '500' },
  answerTextSmall: { color: '#fff', fontSize: 13 },
  answerCorrect:   { backgroundColor: '#003d1a', borderColor: '#00c781' },
  answerWrong:     { backgroundColor: '#3d0000', borderColor: '#e74c3c' },
  answerCorrectHighlight: { backgroundColor: '#003d1a', borderColor: '#00c781', opacity: 0.6 },
  resultText:    { textAlign: 'center', fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  resultCorrect: { color: '#00c781' },
  resultWrong:   { color: '#e74c3c' },

  // Dice card
  diceCard: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 20, alignItems: 'center', gap: 12 },
  diceTitle:  { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  diceSub:    { color: '#888', fontSize: 13 },
  diceEmoji:  { fontSize: 72 },
  diceResult: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  rollBtn: { backgroundColor: '#00c781', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12 },

  // Moving
  movingCard: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 30, alignItems: 'center', gap: 12 },
  movingText: { color: '#aaa', fontSize: 16 },

  // Waiting
  waitCard: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 30, alignItems: 'center' },
  waitText: { color: '#aaa', fontSize: 16 },

  // Host controls
  hostControls: { backgroundColor: '#1e1e1e', borderRadius: 14, padding: 14 },
  hostLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  endBtn: { backgroundColor: '#c0392b', padding: 14, borderRadius: 10, alignItems: 'center' },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center',
  },
  eventCard: {
    backgroundColor: '#1e1e1e', borderRadius: 20,
    padding: 28, width: '90%', maxWidth: 420,
    alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: '#333',
  },
  eventEmoji: { fontSize: 56 },
  eventTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  eventDesc:  { color: '#ccc', fontSize: 16, textAlign: 'center', lineHeight: 22 },
  myScore:    { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  trapTimer:     { backgroundColor: '#222', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  trapTimerText:   { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  trapTimerDanger: { color: '#e74c3c' },

  // Buttons
  greenBtn:  { backgroundColor: '#00c781', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, width: '100%', alignItems: 'center' },
  redBtn:    { backgroundColor: '#e74c3c', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, width: '100%', alignItems: 'center' },
  blueBtn:   { backgroundColor: '#3498db', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, width: '100%', alignItems: 'center' },
  purpleBtn: { backgroundColor: '#9b59b6', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12, width: '100%', alignItems: 'center' },
  btnText:   { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});