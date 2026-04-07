/**
 * BoardGameScreen.js
 *
 * Changes from previous version:
 * - Snake-style board: alternating row directions, 🐍 head at finish
 * - Question auto-advances 800ms after player answers (no manual tap needed)
 * - Player movement: animated scroll to new position after dice roll
 * - Player token shows on board with their chosen color
 * - Board is displayed vertically so player can scroll and see themselves move
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  Dimensions,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import { db } from '../firebaseConfig';
import {
  doc,
  onSnapshot,
  updateDoc,
  getDoc,
} from 'firebase/firestore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOARD_COLS = 10;
const BOARD_END = 20;
const SPACE_SIZE = Math.min(Math.floor((SCREEN_WIDTH - 48) / BOARD_COLS), 52);

// ─── Space type config ────────────────────────────────────────────────────────
const SPACE_TYPES = {
  normal:  { emoji: '🟩', color: '#1a2a1a', border: '#2ecc71' },
  lava:    { emoji: '🌋', color: '#2a0a00', border: '#e74c3c' },
  cannon:  { emoji: '💨', color: '#001a2a', border: '#3498db' },
  trap:    { emoji: '⚠️',  color: '#2a1a00', border: '#f39c12' },
  mystery: { emoji: '❓', color: '#1a0a2a', border: '#9b59b6' },
};

// ─── Build snake rows ─────────────────────────────────────────────────────────
// Returns rows bottom-first then reversed so visual top = high index
function buildSnakeRows() {
  const rows = [];
  for (let rowStart = 0; rowStart <= BOARD_END; rowStart += BOARD_COLS) {
    const spaces = [];
    for (let s = rowStart; s < rowStart + BOARD_COLS && s <= BOARD_END; s++) spaces.push(s);
    const rowIdx = Math.floor(rowStart / BOARD_COLS);
    if (rowIdx % 2 === 1) spaces.reverse(); // snake alternates direction
    rows.push(spaces);
  }
  return rows.reverse(); // top of screen = high numbers
}

const SNAKE_ROWS = buildSnakeRows();

// ─── Board component ──────────────────────────────────────────────────────────
function SnakeBoard({ board = [], players = [], myPosition = 0, highlightPos = null, boardScrollRef }) {
  const rowRefs = useRef({});

  const getPlayersAt = (idx) => players.filter(p => (p.position || 0) === idx);

  const getSpaceStyle = (idx) => {
    const space = board[idx];
    const type = space?.type || 'normal';
    const cfg = SPACE_TYPES[type] || SPACE_TYPES.normal;
    const isHighlighted = idx === highlightPos;
    const isMyPos = idx === myPosition;
    return {
      backgroundColor: cfg.color,
      borderColor: isHighlighted ? '#fff' : isMyPos ? '#fff' : cfg.border,
      borderWidth: isHighlighted || isMyPos ? 2.5 : 1,
      transform: [{ scale: isHighlighted ? 1.1 : 1 }],
    };
  };

  return (
    <View style={boardStyles.board}>
      {SNAKE_ROWS.map((row, ri) => (
        <View key={ri} style={boardStyles.row}>
          {row.map((spaceIdx) => {
            const here = getPlayersAt(spaceIdx);
            const isHead = spaceIdx === BOARD_END;
            const isStart = spaceIdx === 0;
            return (
              <View
                key={spaceIdx}
                ref={ref => { rowRefs.current[spaceIdx] = ref; }}
                style={[boardStyles.space, { width: SPACE_SIZE, height: SPACE_SIZE }, getSpaceStyle(spaceIdx)]}
              >
                {isHead ? (
                  <Text style={boardStyles.headEmoji}>🐍</Text>
                ) : isStart ? (
                  <Text style={boardStyles.spaceEmoji}>🏁</Text>
                ) : (
                  <Text style={boardStyles.spaceNum}>{spaceIdx}</Text>
                )}
                {/* Player tokens */}
                <View style={boardStyles.tokenRow}>
                  {here.slice(0, 3).map((p, pi) => (
                    <View
                      key={pi}
                      style={[boardStyles.token, { backgroundColor: p.color || '#888' }]}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Dice face helper ─────────────────────────────────────────────────────────
function getDiceFace(n) {
  return ['⚀','⚁','⚂','⚃','⚄','⚅'][n - 1] || '🎲';
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor = '#00c781', playerUid, isHost, gameId } = route.params;

  const [session, setSession]   = useState(null);
  const [game, setGame]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [myState, setMyState]   = useState(null);

  // Question phase
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionIndex, setQuestionIndex]     = useState(0);
  const [selectedAnswer, setSelectedAnswer]   = useState(null);
  const [answerFeedback, setAnswerFeedback]   = useState(null); // 'correct'|'wrong'
  const [correctStreak, setCorrectStreak]     = useState(0);
  const [luck, setLuck]                       = useState(0);

  // Dice phase
  const [phase, setPhase]         = useState('questions'); // 'questions'|'rolling'|'moving'|'space_event'
  const [diceValue, setDiceValue] = useState(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);

  // Space event
  const [spaceEvent, setSpaceEvent] = useState(null);
  const [trapTimer, setTrapTimer]   = useState(10);
  const [trapAnswered, setTrapAnswered] = useState(false);
  const trapIntervalRef = useRef(null);

  // Refs
  const boardScrollRef = useRef(null);
  const diceAnim       = useRef(new Animated.Value(0)).current;
  const moveAnim       = useRef(new Animated.Value(0)).current;
  const phaseRef       = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Load game questions ──────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return;
    getDoc(doc(db, 'games', gameId)).then(snap => {
      if (snap.exists()) setGame(snap.data());
    });
  }, [gameId]);

  // ── Firestore session listener ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'gameSessions', sessionId), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      const me = (data.players || []).find(p => p.name === playerName);
      if (me) setMyState(me);
      setLoading(false);
    });
    return () => unsub();
  }, [sessionId, playerName]);

  // ── Pick question ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.questions?.length) return;
    setCurrentQuestion(game.questions[questionIndex % game.questions.length]);
    setSelectedAnswer(null);
    setAnswerFeedback(null);
  }, [questionIndex, game]);

  // ── Scroll board to player position ─────────────────────────────────────
  const scrollToPosition = useCallback((pos) => {
    if (!boardScrollRef.current) return;
    // Which row does this position live in?
    const rowIndex = Math.floor(pos / BOARD_COLS);
    // Visual row (reversed): top row = SNAKE_ROWS[0] = highest
    const totalRows = SNAKE_ROWS.length;
    const visualRowIndex = totalRows - 1 - rowIndex;
    const scrollY = visualRowIndex * (SPACE_SIZE + 6) - SPACE_SIZE;
    boardScrollRef.current.scrollTo({ y: Math.max(0, scrollY), animated: true });
  }, []);

  // ─── Answer handler ───────────────────────────────────────────────────────
  const handleAnswer = useCallback(async (answerIndex) => {
    if (selectedAnswer !== null || phase !== 'questions') return;

    const q = currentQuestion;
    const isCorrect = q?.correctAnswers?.[answerIndex] === true;

    setSelectedAnswer(answerIndex);
    setAnswerFeedback(isCorrect ? 'correct' : 'wrong');

    const newStreak = isCorrect ? correctStreak + 1 : 0;
    const newLuck   = isCorrect ? Math.min(40, correctStreak >= 1 ? luck + 5 : luck) : 0;

    setCorrectStreak(newStreak);
    setLuck(newLuck);

    // Auto-advance after 800ms (no manual tap needed)
    setTimeout(() => {
      if (isCorrect && newStreak >= 3) {
        // Earned a roll!
        setCorrectStreak(0);
        setPhase('rolling');
      } else {
        setQuestionIndex(i => i + 1);
      }
    }, 800);

  }, [selectedAnswer, phase, currentQuestion, correctStreak, luck]);

  // ─── Dice roll ────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);

    // Shake animation
    Animated.sequence([
      Animated.timing(diceAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: -1, duration: 100, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
    ]).start();

    await new Promise(r => setTimeout(r, 500));

    // Calculate roll with luck boost
    let roll;
    const rand = Math.random();
    if (luck > 0) {
      const highProb = (1 / 6) * (1 + luck / 100);
      const highTotal = highProb * 3;
      roll = rand < highTotal ? Math.floor(rand / highProb) + 4 : Math.floor(rand * 3) + 1;
      roll = Math.min(6, Math.max(1, roll));
    } else {
      roll = Math.floor(Math.random() * 6) + 1;
    }

    // Streak bonus
    if (correctStreak >= 8) roll += 1;
    if (correctStreak >= 6) roll = Math.max(roll, Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1);

    setDiceValue(roll);
    setDiceRolling(false);

    setTimeout(() => movePlayer(roll), 600);
  }, [diceRolling, luck, correctStreak, myState, session]);

  // ─── Move player ─────────────────────────────────────────────────────────
  const movePlayer = useCallback(async (spaces) => {
    if (!myState || !session) return;
    setPhase('moving');

    const oldPos = myState.position || 0;
    const newPos = Math.min(oldPos + spaces, BOARD_END);

    // Animate highlight traveling from old to new position
    let current = oldPos;
    const animate = () => {
      if (current <= newPos) {
        setHighlightPos(current);
        scrollToPosition(current);
        current++;
        setTimeout(animate, 300);
      } else {
        setHighlightPos(newPos);
        // Persist to Firestore
        const updatedPlayers = (session.players || []).map(p =>
          p.name === playerName
            ? { ...p, position: newPos, color: playerColor }
            : p
        );
        updateDoc(doc(db, 'gameSessions', sessionId), { players: updatedPlayers })
          .then(() => handleSpaceLanding(session.board?.[newPos], newPos))
          .catch(console.error);
      }
    };
    animate();
  }, [myState, session, playerName, playerColor, sessionId, scrollToPosition]);

  // ─── Space landing ────────────────────────────────────────────────────────
  const handleSpaceLanding = useCallback((space, pos) => {
    if (pos >= BOARD_END) {
      // Winner!
      updateDoc(doc(db, 'gameSessions', sessionId), { status: 'ended', winner: playerName }).catch(console.error);
      return;
    }
    const type = space?.type || 'normal';
    switch (type) {
      case 'lava':
        setSpaceEvent({ type: 'lava' });
        setPhase('space_event');
        break;
      case 'cannon':
        setSpaceEvent({ type: 'cannon' });
        setPhase('space_event');
        break;
      case 'trap':
        if (game?.questions?.length) {
          const trapQ = game.questions[Math.floor(Math.random() * game.questions.length)];
          setSpaceEvent({ type: 'trap', question: trapQ });
          setTrapTimer(10);
          setTrapAnswered(false);
          setPhase('space_event');
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
        } else {
          setPhase('questions');
        }
        break;
      case 'mystery':
        setSpaceEvent({ type: 'mystery' });
        setPhase('space_event');
        break;
      default:
        setPhase('questions');
    }
  }, [game, playerName, sessionId]);

  const handleTrapTimeout = useCallback(async () => {
    clearInterval(trapIntervalRef.current);
    if (session) {
      const upd = (session.players || []).map(p =>
        p.name === playerName ? { ...p, stunned: true } : p
      );
      await updateDoc(doc(db, 'gameSessions', sessionId), { players: upd }).catch(console.error);
    }
    setSpaceEvent(null);
    setPhase('questions');
  }, [session, playerName, sessionId]);

  const resolveSpaceEvent = useCallback(async (opts = {}) => {
    clearInterval(trapIntervalRef.current);
    if (!myState || !session) return;
    const curPos = myState.position || 0;
    let newPos = curPos;
    let stun = false;

    switch (spaceEvent?.type) {
      case 'lava':
        newPos = Math.max(0, curPos - (Math.floor(Math.random() * 6) + 1));
        break;
      case 'cannon':
        newPos = Math.min(BOARD_END, curPos + (Math.floor(Math.random() * 6) + 1));
        break;
      case 'trap':
        if (!opts.correct) stun = true;
        break;
      case 'mystery':
        newPos = Math.min(BOARD_END, curPos + 2);
        break;
    }

    const upd = (session.players || []).map(p =>
      p.name === playerName ? { ...p, position: newPos, stunned: stun } : p
    );
    await updateDoc(doc(db, 'gameSessions', sessionId), { players: upd }).catch(console.error);

    // Show movement after event
    if (newPos !== curPos) {
      setHighlightPos(newPos);
      scrollToPosition(newPos);
    }

    setSpaceEvent(null);
    setPhase('questions');
    setQuestionIndex(i => i + 1);
  }, [spaceEvent, myState, session, playerName, sessionId, scrollToPosition]);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#00c781" />
        <Text style={styles.loadingText}>Loading game...</Text>
      </SafeAreaView>
    );
  }

  const board = session?.board || Array.from({ length: BOARD_END + 1 }, (_, i) => ({ index: i, type: 'normal' }));
  const players = session?.players || [];
  const myPos = myState?.position || 0;
  const isStunned = myState?.stunned === true;
  const QUESTIONS_TO_ROLL = 3;

  // ─── Host view ────────────────────────────────────────────────────────────
  if (isHost) {
    return (
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🎲 Brain Board — Host View</Text>
          <TouchableOpacity
            style={styles.endBtn}
            onPress={async () => {
              await updateDoc(doc(db, 'gameSessions', sessionId), { status: 'ended' }).catch(console.error);
              navigation.navigate('Dashboard');
            }}
          >
            <Text style={styles.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hostLayout}>
          {/* Snake board */}
          <ScrollView ref={boardScrollRef} style={styles.hostBoard} contentContainerStyle={{ padding: 12 }}>
            <SnakeBoard board={board} players={players} myPosition={-1} highlightPos={highlightPos} boardScrollRef={boardScrollRef} />
          </ScrollView>

          {/* Leaderboard */}
          <View style={styles.hostSidebar}>
            <Text style={styles.sectionTitle}>📊 Leaderboard</Text>
            {[...players]
              .sort((a, b) => (b.position || 0) - (a.position || 0))
              .map((p, i) => (
                <View key={p.name} style={styles.lbRow}>
                  <Text style={styles.lbRank}>#{i + 1}</Text>
                  <View style={[styles.lbDot, { backgroundColor: p.color || '#888' }]} />
                  <Text style={styles.lbName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.lbPos}>{p.position || 0}</Text>
                  {p.stunned && <Text>😵</Text>}
                </View>
              ))}
          </View>
        </View>

        {session?.status === 'ended' && (
          <GameOverModal session={session} myPos={-1} onExit={() => navigation.navigate('Dashboard')} />
        )}
      </SafeAreaView>
    );
  }

  // ─── Player view ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarItem}>
          <Text style={styles.topBarLabel}>Luck</Text>
          <Text style={styles.topBarValue}>{luck}%</Text>
        </View>
        <View style={styles.topBarItem}>
          <Text style={styles.topBarLabel}>Streak</Text>
          <Text style={styles.topBarValue}>🔥{correctStreak}/{QUESTIONS_TO_ROLL}</Text>
        </View>
        <View style={styles.topBarItem}>
          <Text style={styles.topBarLabel}>Space</Text>
          <Text style={[styles.topBarValue, { color: playerColor }]}>{myPos}</Text>
        </View>
        <View style={styles.topBarItem}>
          <Text style={styles.topBarLabel}>Name</Text>
          <Text style={[styles.topBarValue, { color: playerColor, fontSize: 12 }]} numberOfLines={1}>{playerName}</Text>
        </View>
      </View>

      {/* Snake board — player can see themselves */}
      <ScrollView
        ref={boardScrollRef}
        style={styles.boardScroll}
        contentContainerStyle={styles.boardScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <SnakeBoard
          board={board}
          players={players}
          myPosition={myPos}
          highlightPos={highlightPos}
          boardScrollRef={boardScrollRef}
        />
      </ScrollView>

      {/* Action panel */}
      <View style={styles.actionPanel}>

        {/* STUNNED */}
        {isStunned && (
          <View style={styles.stunnedCard}>
            <Text style={styles.stunnedTitle}>😵 Stunned!</Text>
            <Text style={styles.stunnedSub}>Answer {QUESTIONS_TO_ROLL} in a row to recover</Text>
          </View>
        )}

        {/* QUESTION PHASE */}
        {(phase === 'questions') && currentQuestion && !isStunned && (
          <View style={styles.questionCard}>
            <Text style={styles.progressText}>
              {correctStreak}/{QUESTIONS_TO_ROLL} correct — {QUESTIONS_TO_ROLL - correctStreak} more to roll
            </Text>
            <Text style={styles.questionText}>{currentQuestion.question}</Text>
            <View style={styles.answersGrid}>
              {(currentQuestion.type === 'multipleChoice'
                ? currentQuestion.answers
                : ['True', 'False']
              ).map((ans, i) => {
                const isSelected = selectedAnswer === i;
                const isCorrectAns = currentQuestion.correctAnswers?.[i] === true;
                let bg = '#1e1e1e';
                if (isSelected) bg = answerFeedback === 'correct' ? '#003d1a' : '#3d0000';
                else if (selectedAnswer !== null && isCorrectAns) bg = '#003d1a';
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.answerBtn, { backgroundColor: bg, borderColor: isSelected ? (answerFeedback === 'correct' ? '#00c781' : '#e74c3c') : '#333' }]}
                    onPress={() => handleAnswer(i)}
                    disabled={selectedAnswer !== null}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.answerText}>{ans}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {answerFeedback && (
              <Text style={[styles.feedbackText, { color: answerFeedback === 'correct' ? '#00c781' : '#e74c3c' }]}>
                {answerFeedback === 'correct' ? '✅ Correct!' : '❌ Wrong!'}
              </Text>
            )}
          </View>
        )}

        {/* ROLLING PHASE */}
        {phase === 'rolling' && (
          <View style={styles.diceCard}>
            <Text style={styles.diceTitle}>🎉 Roll the Dice!</Text>
            <Animated.Text style={[styles.diceEmoji, {
              transform: [{
                translateX: diceAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-12, 0, 12] })
              }]
            }]}>
              {diceValue ? getDiceFace(diceValue) : '🎲'}
            </Animated.Text>
            {diceValue && <Text style={styles.diceResult}>Rolled a {diceValue}!</Text>}
            {!diceValue && (
              <TouchableOpacity
                style={styles.rollBtn}
                onPress={handleRoll}
                disabled={diceRolling}
              >
                <Text style={styles.rollBtnText}>{diceRolling ? 'Rolling...' : '🎲 Roll!'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* MOVING PHASE */}
        {phase === 'moving' && (
          <View style={styles.movingCard}>
            <ActivityIndicator color="#00c781" />
            <Text style={styles.movingText}>Moving... watch the board!</Text>
          </View>
        )}

      </View>

      {/* ── Space Event Modal ── */}
      <Modal visible={phase === 'space_event' && !!spaceEvent} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.eventCard}>
            {spaceEvent?.type === 'lava' && (
              <>
                <Text style={styles.eventEmoji}>🌋</Text>
                <Text style={styles.eventTitle}>Lava!</Text>
                <Text style={styles.eventDesc}>You'll roll back some spaces...</Text>
                <TouchableOpacity style={[styles.eventBtn, { backgroundColor: '#e74c3c' }]} onPress={() => resolveSpaceEvent()}>
                  <Text style={styles.eventBtnText}>Roll Back</Text>
                </TouchableOpacity>
              </>
            )}
            {spaceEvent?.type === 'cannon' && (
              <>
                <Text style={styles.eventEmoji}>💨</Text>
                <Text style={styles.eventTitle}>Cannon!</Text>
                <Text style={styles.eventDesc}>Free bonus roll forward!</Text>
                <TouchableOpacity style={[styles.eventBtn, { backgroundColor: '#3498db' }]} onPress={() => resolveSpaceEvent()}>
                  <Text style={styles.eventBtnText}>Launch! 🚀</Text>
                </TouchableOpacity>
              </>
            )}
            {spaceEvent?.type === 'trap' && spaceEvent.question && (
              <>
                <Text style={styles.eventEmoji}>⚠️</Text>
                <Text style={styles.eventTitle}>Trap! Answer Fast!</Text>
                <Text style={[styles.trapTimerText, trapTimer <= 3 && { color: '#e74c3c' }]}>
                  ⏱ {trapTimer}s
                </Text>
                <Text style={styles.questionText}>{spaceEvent.question.question}</Text>
                <View style={styles.answersGrid}>
                  {(spaceEvent.question.type === 'multipleChoice'
                    ? spaceEvent.question.answers
                    : ['True', 'False']
                  ).map((ans, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.answerBtn, { borderColor: '#333' }]}
                      disabled={trapAnswered}
                      onPress={() => {
                        clearInterval(trapIntervalRef.current);
                        setTrapAnswered(true);
                        resolveSpaceEvent({ correct: spaceEvent.question.correctAnswers?.[i] === true });
                      }}
                    >
                      <Text style={styles.answerText}>{ans}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {spaceEvent?.type === 'mystery' && (
              <>
                <Text style={styles.eventEmoji}>❓</Text>
                <Text style={styles.eventTitle}>Mystery!</Text>
                <Text style={styles.eventDesc}>+2 bonus spaces!</Text>
                <TouchableOpacity style={[styles.eventBtn, { backgroundColor: '#9b59b6' }]} onPress={() => resolveSpaceEvent()}>
                  <Text style={styles.eventBtnText}>Reveal!</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Game Over ── */}
      {session?.status === 'ended' && (
        <GameOverModal
          session={session}
          myPos={myPos}
          onExit={() => navigation.navigate('Dashboard')}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Game Over Modal ──────────────────────────────────────────────────────────
function GameOverModal({ session, myPos, onExit }) {
  const sorted = [...(session?.players || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const winner = sorted[0];
  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.eventCard}>
          <Text style={styles.eventEmoji}>🏆</Text>
          <Text style={styles.eventTitle}>Game Over!</Text>
          {winner && (
            <Text style={styles.eventDesc}>
              Winner: <Text style={{ color: winner.color || '#00c781', fontWeight: 'bold' }}>{winner.name}</Text> at Space {winner.position}
            </Text>
          )}
          {myPos >= 0 && <Text style={[styles.eventDesc, { color: '#aaa' }]}>You reached Space {myPos}</Text>}
          <View style={{ width: '100%', marginTop: 12 }}>
            {sorted.slice(0, 5).map((p, i) => (
              <View key={p.name} style={styles.lbRow}>
                <Text style={styles.lbRank}>#{i + 1}</Text>
                <View style={[styles.lbDot, { backgroundColor: p.color || '#888' }]} />
                <Text style={styles.lbName}>{p.name}</Text>
                <Text style={styles.lbPos}>{p.position || 0}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={[styles.eventBtn, { backgroundColor: '#00c781', marginTop: 16 }]} onPress={onExit}>
            <Text style={styles.eventBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Board styles ─────────────────────────────────────────────────────────────
const boardStyles = StyleSheet.create({
  board: { paddingBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'center', marginBottom: 4 },
  space: {
    borderRadius: 8,
    margin: 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headEmoji: { fontSize: SPACE_SIZE * 0.5, lineHeight: SPACE_SIZE * 0.6 },
  spaceEmoji: { fontSize: SPACE_SIZE * 0.38 },
  spaceNum: { color: '#555', fontSize: SPACE_SIZE * 0.26, fontWeight: 'bold' },
  tokenRow: {
    position: 'absolute',
    bottom: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  token: {
    width: 7,
    height: 7,
    borderRadius: 4,
    margin: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 16, fontSize: 18 },

  // Header (host)
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222' },
  headerTitle: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  endBtn: { backgroundColor: '#c0392b', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 10 },
  endBtnText: { color: '#fff', fontWeight: 'bold' },

  // Host layout
  hostLayout: { flex: 1, flexDirection: 'row' },
  hostBoard: { flex: 1 },
  hostSidebar: { width: 240, backgroundColor: '#0d0d0d', padding: 16, borderLeftWidth: 1, borderLeftColor: '#222' },

  // Top bar (player)
  topBar: { flexDirection: 'row', backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: '#222', paddingVertical: 10 },
  topBarItem: { flex: 1, alignItems: 'center' },
  topBarLabel: { color: '#555', fontSize: 10, letterSpacing: 1 },
  topBarValue: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 2 },

  // Board scroll
  boardScroll: { flex: 1 },
  boardScrollContent: { padding: 12 },

  // Action panel
  actionPanel: { backgroundColor: '#0d0d0d', borderTopWidth: 1, borderTopColor: '#222', padding: 16, minHeight: 180 },

  // Stunned
  stunnedCard: { backgroundColor: '#2a0000', borderRadius: 14, padding: 20, alignItems: 'center' },
  stunnedTitle: { color: '#e74c3c', fontSize: 20, fontWeight: 'bold' },
  stunnedSub: { color: '#ccc', fontSize: 14, marginTop: 6 },

  // Question
  questionCard: { gap: 10 },
  progressText: { color: '#555', fontSize: 12 },
  questionText: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  answersGrid: { gap: 8 },
  answerBtn: { backgroundColor: '#1e1e1e', borderRadius: 10, padding: 14, borderWidth: 1.5 },
  answerText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  feedbackText: { textAlign: 'center', fontSize: 16, fontWeight: 'bold' },

  // Dice
  diceCard: { alignItems: 'center', gap: 12 },
  diceTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  diceEmoji: { fontSize: 64 },
  diceResult: { color: '#00c781', fontSize: 18, fontWeight: 'bold' },
  rollBtn: { backgroundColor: '#00c781', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14 },
  rollBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },

  // Moving
  movingCard: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  movingText: { color: '#aaa', fontSize: 16 },

  // Leaderboard rows
  sectionTitle: { color: '#00c781', fontSize: 14, fontWeight: 'bold', marginBottom: 12 },
  lbRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  lbRank: { color: '#555', width: 28, fontSize: 13 },
  lbDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  lbName: { color: '#fff', flex: 1, fontSize: 13 },
  lbPos: { color: '#aaa', fontSize: 12 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  eventCard: { backgroundColor: '#1e1e1e', borderRadius: 20, padding: 28, width: '90%', maxWidth: 400, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#333' },
  eventEmoji: { fontSize: 52 },
  eventTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  eventDesc: { color: '#ccc', fontSize: 15, textAlign: 'center' },
  eventBtn: { paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12, width: '100%', alignItems: 'center' },
  eventBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  trapTimerText: { color: '#fff', fontSize: 26, fontWeight: 'bold' },
});