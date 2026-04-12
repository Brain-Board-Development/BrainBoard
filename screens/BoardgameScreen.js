/**
 * BoardGameScreen.js
 *
 * FIX #3:  "Back to Dashboard" now works (navigation.reset + dismissed state)
 * FIX #6:  Player default view = QUESTIONS only; map toggled via 🗺️ icon top-right
 *          Board auto-shows during 'rolling' and 'moving' phases
 * FIX #7:  Bigger board tiles, bigger leaderboard (top 10), larger fonts
 * FIX #9:  BOARD_END from session.settings.boardSize (dynamic)
 * FIX #11: HUD is much bigger — larger padding, larger text
 * FIX #12: Kick detection — if name in kickedPlayers → modal → back to join
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, ActivityIndicator, SafeAreaView, Modal,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const BOARD_COLS = 10;

// Dynamic tile size: fills screen width, min 36 max 72
const BASE_TILE = Math.min(72, Math.max(36, Math.floor((SCREEN_W - 32) / BOARD_COLS)));

// Bigger tile for host (more screen real estate)
const HOST_TILE = Math.min(80, Math.max(44, Math.floor((SCREEN_W * 0.65 - 32) / BOARD_COLS)));

// ─── Space type config ────────────────────────────────────────────────────────
const SPACE_TYPES = {
  normal:  { emoji: "🟩", bg: "#1a2a1a", border: "#2ecc71" },
  lava:    { emoji: "🌋", bg: "#2a0a00", border: "#e74c3c" },
  cannon:  { emoji: "💨", bg: "#001a2a", border: "#3498db" },
  trap:    { emoji: "⚠️", bg: "#2a1a00", border: "#f39c12" },
  mystery: { emoji: "❓", bg: "#1a0a2a", border: "#9b59b6" },
};

// ─── Board builder ────────────────────────────────────────────────────────────
function buildSnakeRows(boardEnd) {
  const rows = [];
  for (let rowStart = 0; rowStart <= boardEnd; rowStart += BOARD_COLS) {
    const spaces = [];
    for (let s = rowStart; s < rowStart + BOARD_COLS && s <= boardEnd; s++) spaces.push(s);
    if (Math.floor(rowStart / BOARD_COLS) % 2 === 1) spaces.reverse();
    rows.push(spaces);
  }
  return rows.reverse();
}

// ─── SnakeBoard component ─────────────────────────────────────────────────────
function SnakeBoard({ board, players, myPosition, highlightPos, boardEnd, tileSize = BASE_TILE }) {
  const rows = buildSnakeRows(boardEnd);

  const getPlayersAt = (idx) => players.filter((p) => (p.position || 0) === idx);

  const getStyle = (idx) => {
    const type = board[idx]?.type || "normal";
    const cfg  = SPACE_TYPES[type] || SPACE_TYPES.normal;
    const isMe = idx === myPosition;
    const isHL = idx === highlightPos;
    return {
      backgroundColor: cfg.bg,
      borderColor: isHL ? "#fff" : isMe ? "#fff" : cfg.border,
      borderWidth: isHL || isMe ? 3 : 1.5,
      transform: [{ scale: isHL ? 1.12 : 1 }],
    };
  };

  return (
    <View style={bStyles.board}>
      {rows.map((row, ri) => (
        <View key={ri} style={bStyles.row}>
          {row.map((idx) => {
            const here = getPlayersAt(idx);
            const isEnd   = idx === boardEnd;
            const isStart = idx === 0;
            return (
              <View
                key={idx}
                style={[bStyles.tile, { width: tileSize, height: tileSize }, getStyle(idx)]}
              >
                {isEnd ? (
                  <Text style={{ fontSize: tileSize * 0.48 }}>🐍</Text>
                ) : isStart ? (
                  <Text style={{ fontSize: tileSize * 0.4 }}>🏁</Text>
                ) : (
                  <Text style={[bStyles.tileNum, { fontSize: tileSize * 0.28 }]}>{idx}</Text>
                )}
                <View style={bStyles.tokenRow}>
                  {here.slice(0, 3).map((p, pi) => (
                    <View
                      key={pi}
                      style={[bStyles.token, { backgroundColor: p.color || "#888", width: tileSize * 0.22, height: tileSize * 0.22, borderRadius: tileSize * 0.11 }]}
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

const bStyles = StyleSheet.create({
  board: { paddingBottom: 8 },
  row: { flexDirection: "row", justifyContent: "center", marginBottom: 4 },
  tile: { borderRadius: 9, margin: 2, alignItems: "center", justifyContent: "center", position: "relative" },
  tileNum: { color: "#556", fontWeight: "bold" },
  tokenRow: { position: "absolute", bottom: 3, flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  token: { margin: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
});

// ─── Dice face ────────────────────────────────────────────────────────────────
const DICE_EMOJI = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const getDiceFace = (n) => DICE_EMOJI[(n - 1)] || "🎲";

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor = "#00c781", playerUid, isHost, gameId } = route.params;

  const [session, setSession]     = useState(null);
  const [game, setGame]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [myState, setMyState]     = useState(null);

  // FIX #6: view mode — 'questions' or 'map'
  const [viewMode, setViewMode]   = useState("questions");
  const [showKicked, setShowKicked] = useState(false);

  // Questions
  const [questionIndex, setQuestionIndex]     = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer]   = useState(null);
  const [answerFeedback, setAnswerFeedback]   = useState(null);
  const [correctStreak, setCorrectStreak]     = useState(0);
  const [luck, setLuck]                       = useState(0);

  // Phases
  const [phase, setPhase]             = useState("questions");
  const [diceValue, setDiceValue]     = useState(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);

  // Space events
  const [spaceEvent, setSpaceEvent] = useState(null);
  const [trapTimer, setTrapTimer]   = useState(10);
  const [trapAnswered, setTrapAnswered] = useState(false);
  const trapRef = useRef(null);

  // Game over
  const [gameOverDismissed, setGameOverDismissed] = useState(false);

  const boardScrollRef = useRef(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  // ── Load game ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return;
    getDoc(doc(db, "games", gameId)).then((s) => { if (s.exists()) setGame(s.data()); });
  }, [gameId]);

  // ── Session listener ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      const me = (data.players || []).find((p) => p.name === playerName);
      if (me) setMyState(me);
      setLoading(false);

      // FIX #12: Kick detection in-game
      if (!isHost) {
        const kicked = data.kickedPlayers || [];
        if (kicked.includes(playerName)) setShowKicked(true);
      }
    });
    return () => unsub();
  }, [sessionId, playerName]);

  // ── Pick question ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.questions?.length) return;
    setCurrentQuestion(game.questions[questionIndex % game.questions.length]);
    setSelectedAnswer(null);
    setAnswerFeedback(null);
  }, [questionIndex, game]);

  // ── FIX #6: Auto-show map during rolling/moving phases ─────────────────────
  useEffect(() => {
    if (phase === "rolling" || phase === "moving") setViewMode("map");
    if (phase === "questions") setViewMode("questions");
  }, [phase]);

  // ── Scroll board to position ───────────────────────────────────────────────
  const scrollToPos = useCallback((pos, boardEnd) => {
    if (!boardScrollRef.current) return;
    const rowIdx = Math.floor(pos / BOARD_COLS);
    const totalRows = Math.ceil((boardEnd + 1) / BOARD_COLS);
    const visualRow = totalRows - 1 - rowIdx;
    const scrollY = visualRow * (BASE_TILE + 6) - 50;
    boardScrollRef.current.scrollTo({ y: Math.max(0, scrollY), animated: true });
  }, []);

  // ── Answer handler ─────────────────────────────────────────────────────────
  const handleAnswer = useCallback((ansIdx) => {
    if (selectedAnswer !== null || phase !== "questions") return;
    const q = currentQuestion;
    const correct = q?.correctAnswers?.[ansIdx] === true;

    setSelectedAnswer(ansIdx);
    setAnswerFeedback(correct ? "correct" : "wrong");

    const newStreak = correct ? correctStreak + 1 : 0;
    const newLuck   = correct ? Math.min(40, newStreak >= 2 ? luck + 5 : luck) : 0;
    setCorrectStreak(newStreak);
    setLuck(newLuck);

    setTimeout(() => {
      if (correct && newStreak >= 3) {
        setCorrectStreak(0);
        setPhase("rolling");
        setDiceValue(null);
      } else {
        setQuestionIndex((i) => i + 1);
      }
    }, 900);
  }, [selectedAnswer, phase, currentQuestion, correctStreak, luck]);

  // ── Dice roll ──────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);

    Animated.sequence([
      Animated.timing(diceAnim, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 8, duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();

    await new Promise((r) => setTimeout(r, 500));

    let roll = Math.floor(Math.random() * 6) + 1;
    if (luck > 0) {
      const r2 = Math.floor(Math.random() * 6) + 1;
      if (luck >= 20) roll = Math.max(roll, r2);
    }
    if (correctStreak >= 8) roll = Math.min(6, roll + 1);

    setDiceValue(roll);
    setDiceRolling(false);
    setTimeout(() => movePlayer(roll), 700);
  }, [diceRolling, luck, correctStreak, myState, session]);

  // ── Move player ────────────────────────────────────────────────────────────
  const movePlayer = useCallback(async (spaces) => {
    if (!myState || !session) return;
    const boardEnd = session?.settings?.boardSize || 25;
    setPhase("moving");

    const oldPos = myState.position || 0;
    const newPos = Math.min(oldPos + spaces, boardEnd);

    let cur = oldPos;
    const step = () => {
      if (cur <= newPos) {
        setHighlightPos(cur);
        scrollToPos(cur, boardEnd);
        cur++;
        setTimeout(step, 280);
      } else {
        setHighlightPos(newPos);
        const updated = (session.players || []).map((p) =>
          p.name === playerName ? { ...p, position: newPos, color: playerColor } : p
        );
        updateDoc(doc(db, "gameSessions", sessionId), { players: updated })
          .then(() => handleSpaceLanding(session.board?.[newPos], newPos, boardEnd))
          .catch(console.error);
      }
    };
    step();
  }, [myState, session, playerName, playerColor, sessionId, scrollToPos]);

  // ── Space landing ──────────────────────────────────────────────────────────
  const handleSpaceLanding = useCallback((space, pos, boardEnd) => {
    if (pos >= boardEnd) {
      updateDoc(doc(db, "gameSessions", sessionId), { status: "ended", winner: playerName }).catch(console.error);
      return;
    }
    const type = space?.type || "normal";
    if (type === "normal") { setPhase("questions"); setDiceValue(null); setQuestionIndex((i) => i + 1); return; }

    if (type === "trap" && game?.questions?.length) {
      const trapQ = game.questions[Math.floor(Math.random() * game.questions.length)];
      setSpaceEvent({ type: "trap", question: trapQ });
      setTrapTimer(10);
      setTrapAnswered(false);
      setPhase("space_event");
      trapRef.current = setInterval(() => {
        setTrapTimer((t) => {
          if (t <= 1) { clearInterval(trapRef.current); handleTrapFail(); return 0; }
          return t - 1;
        });
      }, 1000);
    } else {
      setSpaceEvent({ type });
      setPhase("space_event");
    }
  }, [game, playerName, sessionId]);

  const handleTrapFail = useCallback(async () => {
    clearInterval(trapRef.current);
    if (session) {
      const upd = (session.players || []).map((p) => p.name === playerName ? { ...p, stunned: true } : p);
      await updateDoc(doc(db, "gameSessions", sessionId), { players: upd }).catch(console.error);
    }
    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
  }, [session, playerName, sessionId]);

  const resolveEvent = useCallback(async (opts = {}) => {
    clearInterval(trapRef.current);
    if (!myState || !session) return;
    const boardEnd = session?.settings?.boardSize || 25;
    const cur = myState.position || 0;
    let newPos = cur;
    let stun = false;

    switch (spaceEvent?.type) {
      case "lava":    newPos = Math.max(0, cur - (Math.floor(Math.random() * 4) + 1)); break;
      case "cannon":  newPos = Math.min(boardEnd, cur + (Math.floor(Math.random() * 4) + 1)); break;
      case "mystery": newPos = Math.min(boardEnd, cur + 2); break;
      case "trap":    if (!opts.correct) stun = true; break;
    }

    const upd = (session.players || []).map((p) =>
      p.name === playerName ? { ...p, position: newPos, stunned: stun } : p
    );
    await updateDoc(doc(db, "gameSessions", sessionId), { players: upd }).catch(console.error);
    if (newPos !== cur) { setHighlightPos(newPos); scrollToPos(newPos, boardEnd); }
    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
    setQuestionIndex((i) => i + 1);
  }, [spaceEvent, myState, session, playerName, sessionId, scrollToPos]);

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadingText}>Loading game…</Text>
    </SafeAreaView>
  );

  const board    = session?.board || [];
  const players  = session?.players || [];
  const boardEnd = session?.settings?.boardSize || 25;
  const myPos    = myState?.position || 0;
  const isStunned = myState?.stunned === true;
  const ROLL_AT  = 3;

  // ── HOST VIEW ──────────────────────────────────────────────────────────────
  if (isHost) {
    const sorted = [...players].sort((a, b) => (b.position || 0) - (a.position || 0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>🎲 Brain Board — Host</Text>
          <TouchableOpacity style={S.endBtn} onPress={async () => {
            await updateDoc(doc(db, "gameSessions", sessionId), { status: "ended" }).catch(console.error);
            navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
          }}>
            <Text style={S.endBtnText}>End Game</Text>
          </TouchableOpacity>
        </View>

        <View style={S.hostBody}>
          {/* FIX #7: Bigger board */}
          <ScrollView ref={boardScrollRef} style={S.hostBoardArea} contentContainerStyle={{ padding: 12 }}>
            <SnakeBoard
              board={board} players={players}
              myPosition={-1} highlightPos={highlightPos}
              boardEnd={boardEnd} tileSize={HOST_TILE}
            />
          </ScrollView>

          {/* FIX #7: Bigger leaderboard, top 10 */}
          <View style={S.hostSidebar}>
            <Text style={S.lbHeader}>🏆 Leaderboard</Text>
            {sorted.slice(0, 10).map((p, i) => (
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>{["🥇","🥈","🥉"][i] || `#${i+1}`}</Text>
                <View style={[S.lbDot, { backgroundColor: p.color || "#888" }]} />
                <Text style={S.lbName} numberOfLines={1}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position || 0}/{boardEnd}</Text>
                {p.stunned && <Text style={{ fontSize: 14 }}>😵</Text>}
              </View>
            ))}
          </View>
        </View>

        {/* FIX #3: Game over with working back button */}
        {session?.status === "ended" && !gameOverDismissed && (
          <GameOverModal
            session={session} myPos={-1} boardEnd={boardEnd}
            onExit={() => {
              setGameOverDismissed(true);
              navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── PLAYER VIEW ────────────────────────────────────────────────────────────
  const showMap = viewMode === "map" || phase === "rolling" || phase === "moving";

  return (
    <SafeAreaView style={S.container}>

      {/* FIX #11: Much bigger HUD */}
      <View style={S.hud}>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>LUCK</Text>
          <Text style={S.hudValue}>🍀 {luck}%</Text>
        </View>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>STREAK</Text>
          <Text style={S.hudValue}>🔥 {correctStreak}/{ROLL_AT}</Text>
        </View>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>SPACE</Text>
          <Text style={[S.hudValue, { color: playerColor }]}>{myPos}/{boardEnd}</Text>
        </View>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>NAME</Text>
          <Text style={[S.hudValueSm, { color: playerColor }]} numberOfLines={1}>{playerName}</Text>
        </View>

        {/* FIX #6: Map toggle */}
        <TouchableOpacity
          style={[S.mapToggle, showMap && S.mapToggleActive]}
          onPress={() => setViewMode((v) => v === "map" ? "questions" : "map")}
        >
          <Text style={S.mapToggleIcon}>🗺️</Text>
        </TouchableOpacity>
      </View>

      {/* Content area: map OR questions */}
      <View style={S.mainArea}>
        {showMap ? (
          // MAP VIEW
          <ScrollView ref={boardScrollRef} contentContainerStyle={{ padding: 10 }}>
            <SnakeBoard
              board={board} players={players}
              myPosition={myPos} highlightPos={highlightPos}
              boardEnd={boardEnd} tileSize={BASE_TILE}
            />
          </ScrollView>
        ) : (
          // QUESTIONS VIEW — FIX #6: default for players
          <ScrollView contentContainerStyle={S.questionsArea}>
            {isStunned ? (
              <View style={S.stunnedCard}>
                <Text style={S.stunnedTitle}>😵 Stunned!</Text>
                <Text style={S.stunnedSub}>Answer {ROLL_AT} correct in a row to recover</Text>
              </View>
            ) : currentQuestion ? (
              <View style={S.questionCard}>
                <Text style={S.progressBar}>{correctStreak}/{ROLL_AT} correct • {ROLL_AT - correctStreak} more to earn a roll</Text>
                <Text style={S.questionText}>{currentQuestion.question}</Text>
                <View style={S.answersGrid}>
                  {(currentQuestion.type === "multipleChoice"
                    ? currentQuestion.answers
                    : ["True", "False"]
                  ).map((ans, i) => {
                    const isSelected = selectedAnswer === i;
                    const isCorrect  = currentQuestion.correctAnswers?.[i] === true;
                    let bg = "#1e1e1e";
                    let bc = "#333";
                    if (isSelected) { bg = answerFeedback === "correct" ? "#003d1a" : "#3d0000"; bc = answerFeedback === "correct" ? "#00c781" : "#e74c3c"; }
                    else if (selectedAnswer !== null && isCorrect) { bg = "#003d1a"; bc = "#00c781"; }
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[S.ansBtn, { backgroundColor: bg, borderColor: bc }]}
                        onPress={() => handleAnswer(i)}
                        disabled={selectedAnswer !== null}
                        activeOpacity={0.75}
                      >
                        <Text style={S.ansBtnText}>{ans}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {answerFeedback && (
                  <Text style={[S.feedback, { color: answerFeedback === "correct" ? "#00c781" : "#e74c3c" }]}>
                    {answerFeedback === "correct" ? "✅ Correct!" : "❌ Wrong!"}
                  </Text>
                )}
              </View>
            ) : (
              <View style={S.waitingCard}>
                <ActivityIndicator color="#00c781" />
                <Text style={S.waitingText}>Loading questions…</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* Rolling phase panel */}
      {phase === "rolling" && (
        <View style={S.dicePanel}>
          <Text style={S.dicePanelTitle}>🎉 Roll the Dice!</Text>
          <Animated.Text style={[S.diceFace, { transform: [{ translateX: diceAnim }] }]}>
            {diceValue ? getDiceFace(diceValue) : "🎲"}
          </Animated.Text>
          {diceValue
            ? <Text style={S.diceResult}>Rolled a {diceValue}! Moving…</Text>
            : <TouchableOpacity style={S.rollBtn} onPress={handleRoll} disabled={diceRolling}>
                <Text style={S.rollBtnText}>{diceRolling ? "Rolling…" : "🎲 Roll!"}</Text>
              </TouchableOpacity>
          }
        </View>
      )}

      {/* Moving phase panel */}
      {phase === "moving" && (
        <View style={S.movingPanel}>
          <ActivityIndicator color="#00c781" size="large" />
          <Text style={S.movingText}>Moving… watch the board!</Text>
        </View>
      )}

      {/* Space event modal */}
      <Modal visible={phase === "space_event" && !!spaceEvent} transparent animationType="slide">
        <View style={S.overlay}>
          <View style={S.eventCard}>
            {spaceEvent?.type === "lava" && (<>
              <Text style={S.eventEmoji}>🌋</Text>
              <Text style={S.eventTitle}>Lava!</Text>
              <Text style={S.eventDesc}>You'll be pushed back…</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#e74c3c" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>OK</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "cannon" && (<>
              <Text style={S.eventEmoji}>💨</Text>
              <Text style={S.eventTitle}>Cannon!</Text>
              <Text style={S.eventDesc}>Launching you forward!</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#3498db" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>Launch! 🚀</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "mystery" && (<>
              <Text style={S.eventEmoji}>❓</Text>
              <Text style={S.eventTitle}>Mystery Box!</Text>
              <Text style={S.eventDesc}>+2 bonus spaces!</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#9b59b6" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>Reveal!</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "trap" && spaceEvent.question && (<>
              <Text style={S.eventEmoji}>⚠️</Text>
              <Text style={S.eventTitle}>Trap! Answer Fast!</Text>
              <Text style={[S.trapTimer, trapTimer <= 3 && { color: "#e74c3c" }]}>⏱ {trapTimer}s</Text>
              <Text style={S.eventDesc}>{spaceEvent.question.question}</Text>
              <View style={S.answersGrid}>
                {(spaceEvent.question.type === "multipleChoice"
                  ? spaceEvent.question.answers
                  : ["True", "False"]
                ).map((ans, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[S.ansBtn, { borderColor: "#444" }]}
                    disabled={trapAnswered}
                    onPress={() => {
                      clearInterval(trapRef.current);
                      setTrapAnswered(true);
                      resolveEvent({ correct: spaceEvent.question.correctAnswers?.[i] === true });
                    }}
                  >
                    <Text style={S.ansBtnText}>{ans}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>)}
          </View>
        </View>
      </Modal>

      {/* FIX #3: Game over */}
      {session?.status === "ended" && !gameOverDismissed && (
        <GameOverModal
          session={session} myPos={myPos} boardEnd={boardEnd}
          onExit={() => {
            setGameOverDismissed(true);
            navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
          }}
        />
      )}

      {/* FIX #12: Kicked in-game */}
      <Modal visible={showKicked} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.eventCard}>
            <Text style={{ fontSize: 56, marginBottom: 10 }}>🚫</Text>
            <Text style={S.eventTitle}>You've Been Kicked</Text>
            <Text style={S.eventDesc}>The host has removed you from this game.</Text>
            <TouchableOpacity
              style={[S.eventBtn, { backgroundColor: "#00c781", marginTop: 12 }]}
              onPress={() => {
                setShowKicked(false);
                navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] });
              }}
            >
              <Text style={S.eventBtnText}>Back to Menu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Game Over Modal ──────────────────────────────────────────────────────────
function GameOverModal({ session, myPos, boardEnd, onExit }) {
  const sorted = [...(session?.players || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const winner = sorted[0];
  return (
    <Modal visible transparent animationType="fade">
      <View style={S.overlay}>
        <View style={S.eventCard}>
          <Text style={{ fontSize: 64 }}>🏆</Text>
          <Text style={S.eventTitle}>Game Over!</Text>
          {winner && (
            <Text style={[S.eventDesc, { fontSize: 18 }]}>
              🥇 <Text style={{ color: winner.color, fontWeight: "bold" }}>{winner.name}</Text> wins at space {winner.position}!
            </Text>
          )}
          {myPos >= 0 && (
            <Text style={[S.eventDesc, { color: "#aaa" }]}>You reached space {myPos}/{boardEnd}</Text>
          )}
          <View style={{ width: "100%", marginTop: 12, marginBottom: 4 }}>
            {sorted.slice(0, 10).map((p, i) => (
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>{["🥇","🥈","🥉"][i] || `#${i+1}`}</Text>
                <View style={[S.lbDot, { backgroundColor: p.color || "#888" }]} />
                <Text style={S.lbName}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position || 0}/{boardEnd}</Text>
              </View>
            ))}
          </View>
          {/* FIX #3: This now actually works */}
          <TouchableOpacity
            style={[S.eventBtn, { backgroundColor: "#00c781", marginTop: 16 }]}
            onPress={onExit}
          >
            <Text style={S.eventBtnText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  center: { flex: 1, backgroundColor: "#111", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#fff", marginTop: 16, fontSize: 18 },

  // FIX #11: BIG HUD
  hud: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#0a0a0a", borderBottomWidth: 2, borderBottomColor: "#222",
    paddingVertical: 14, paddingHorizontal: 10,
  },
  hudItem: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  hudLabel: { color: "#555", fontSize: 10, letterSpacing: 1.5, fontWeight: "bold" },
  hudValue: { color: "#fff", fontSize: 20, fontWeight: "bold", marginTop: 3 },
  hudValueSm: { color: "#fff", fontSize: 15, fontWeight: "bold", marginTop: 3 },
  mapToggle: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: "#1a1a1a",
    justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: "#333", marginLeft: 4,
  },
  mapToggleActive: { backgroundColor: "#003322", borderColor: "#00c781" },
  mapToggleIcon: { fontSize: 22 },

  mainArea: { flex: 1 },

  // Questions
  questionsArea: { padding: 16, paddingBottom: 32 },
  questionCard: { gap: 14 },
  progressBar: { color: "#555", fontSize: 13, textAlign: "center" },
  questionText: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 28, textAlign: "center" },
  answersGrid: { gap: 10, marginTop: 8 },
  ansBtn: {
    backgroundColor: "#1e1e1e", borderRadius: 12, padding: 18,
    borderWidth: 2, alignItems: "center",
  },
  ansBtnText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  feedback: { textAlign: "center", fontSize: 20, fontWeight: "bold", marginTop: 8 },

  stunnedCard: { backgroundColor: "#2a0000", borderRadius: 16, padding: 28, alignItems: "center", margin: 8 },
  stunnedTitle: { color: "#e74c3c", fontSize: 24, fontWeight: "bold" },
  stunnedSub: { color: "#ccc", fontSize: 16, marginTop: 8, textAlign: "center" },

  waitingCard: { alignItems: "center", gap: 12, paddingVertical: 60 },
  waitingText: { color: "#555", fontSize: 16 },

  // Dice panel
  dicePanel: {
    backgroundColor: "#0a0a0a", borderTopWidth: 2, borderTopColor: "#222",
    padding: 24, alignItems: "center", gap: 14,
  },
  dicePanelTitle: { color: "#fff", fontSize: 22, fontWeight: "bold" },
  diceFace: { fontSize: 80 },
  diceResult: { color: "#00c781", fontSize: 22, fontWeight: "bold" },
  rollBtn: { backgroundColor: "#00c781", paddingVertical: 18, paddingHorizontal: 56, borderRadius: 16 },
  rollBtnText: { color: "#fff", fontSize: 22, fontWeight: "bold" },

  movingPanel: {
    backgroundColor: "#0a0a0a", borderTopWidth: 2, borderTopColor: "#222",
    padding: 28, alignItems: "center", gap: 14,
  },
  movingText: { color: "#888", fontSize: 18 },

  // Host
  hostHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 18, backgroundColor: "#0a0a0a", borderBottomWidth: 1, borderBottomColor: "#222",
  },
  hostTitle: { color: "#00c781", fontSize: 20, fontWeight: "bold" },
  endBtn: { backgroundColor: "#c0392b", paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12 },
  endBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  hostBody: { flex: 1, flexDirection: "row" },
  hostBoardArea: { flex: 1 },
  hostSidebar: {
    width: 260, backgroundColor: "#0a0a0a", padding: 16,
    borderLeftWidth: 1, borderLeftColor: "#222",
  },
  lbHeader: { color: "#00c781", fontSize: 18, fontWeight: "bold", marginBottom: 14 },
  lbRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" },
  lbRank: { color: "#fff", width: 32, fontSize: 16 },
  lbDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  lbName: { color: "#fff", flex: 1, fontSize: 15, fontWeight: "500" },
  lbPos: { color: "#aaa", fontSize: 14 },

  // Overlay / modals
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  eventCard: {
    backgroundColor: "#1e1e1e", borderRadius: 22, padding: 28,
    width: "90%", maxWidth: 440, alignItems: "center",
    borderWidth: 1, borderColor: "#333", gap: 12,
  },
  eventEmoji: { fontSize: 56 },
  eventTitle: { color: "#fff", fontSize: 24, fontWeight: "bold", textAlign: "center" },
  eventDesc: { color: "#ccc", fontSize: 16, textAlign: "center", lineHeight: 22 },
  eventBtn: { paddingVertical: 16, paddingHorizontal: 48, borderRadius: 14, width: "100%", alignItems: "center" },
  eventBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  trapTimer: { color: "#fff", fontSize: 32, fontWeight: "bold" },
});