/**
 * BoardGameScreen.js
 *
 * Fixed:
 * - movePlayer: async/await + getDoc for fresh data + try/catch that ALWAYS exits moving
 * - correctCount = CUMULATIVE (wrong answers never reset roll progress)
 * - streak = CONSECUTIVE only (resets on wrong, drives luck bonuses)
 * - useEffect clears selAnswer + feedback whenever questionIndex changes
 * - Game timer from session.gameEndsAt (host ends game when it hits 0)
 * - Question timer from session.settings.timePerQuestion (auto-advances on timeout)
 * - Leave button bottom-left; host leave = abandoned detection for all players
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, ActivityIndicator, SafeAreaView, Modal,
} from "react-native";
import { db, auth } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";

const { width: SCREEN_W } = Dimensions.get("window");
const BOARD_COLS = 10;
const BASE_TILE  = Math.min(72, Math.max(36, Math.floor((SCREEN_W - 32) / BOARD_COLS)));
const HOST_TILE  = Math.min(80, Math.max(44, Math.floor((SCREEN_W * 0.65 - 32) / BOARD_COLS)));

const SPACE_TYPES = {
  normal:  { bg: "#1a2a1a", border: "#2ecc71" },
  lava:    { bg: "#2a0a00", border: "#e74c3c" },
  cannon:  { bg: "#001a2a", border: "#3498db" },
  trap:    { bg: "#2a1a00", border: "#f39c12" },
  mystery: { bg: "#1a0a2a", border: "#9b59b6" },
};

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
    <View style={bS.board}>
      {rows.map((row, ri) => (
        <View key={ri} style={bS.row}>
          {row.map((idx) => {
            const here   = getPlayersAt(idx);
            const isEnd  = idx === boardEnd;
            const isStart= idx === 0;
            return (
              <View key={idx} style={[bS.tile, { width: tileSize, height: tileSize }, getStyle(idx)]}>
                {isEnd ? (
                  <Text style={{ fontSize: tileSize * 0.48 }}>🐍</Text>
                ) : isStart ? (
                  <Text style={{ fontSize: tileSize * 0.4 }}>🏁</Text>
                ) : (
                  <Text style={[bS.tileNum, { fontSize: tileSize * 0.28 }]}>{idx}</Text>
                )}
                <View style={bS.tokenRow}>
                  {here.slice(0, 3).map((p, pi) => (
                    <View key={pi} style={[bS.token, {
                      backgroundColor: p.color || "#888",
                      width: tileSize * 0.22, height: tileSize * 0.22, borderRadius: tileSize * 0.11,
                    }]} />
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

const bS = StyleSheet.create({
  board:    { paddingBottom: 8 },
  row:      { flexDirection: "row", justifyContent: "center", marginBottom: 4 },
  tile:     { borderRadius: 9, margin: 2, alignItems: "center", justifyContent: "center", position: "relative" },
  tileNum:  { color: "#556", fontWeight: "bold" },
  tokenRow: { position: "absolute", bottom: 3, flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  token:    { margin: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
});

const DICE_EMOJI = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const getDiceFace = (n) => DICE_EMOJI[(n - 1)] || "-";

const formatTime = (secs) => {
  if (secs == null || secs < 0) return "--:--";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor = "#00c781", playerUid, isHost, gameId } = route.params;

  const [session,  setSession]  = useState(null);
  const [game,     setGame]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [myState,  setMyState]  = useState(null);

  const [viewMode,   setViewMode]   = useState("questions");
  const [showKicked, setShowKicked] = useState(false);
  const [showLeave,  setShowLeave]  = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);

  // Questions
  const [questionIndex, setQuestionIndex]   = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answerFeedback, setAnswerFeedback] = useState(null);

  // Counters
  // correctCount: cumulative toward next roll — NEVER reset by wrong answers
  // streak: consecutive correct — resets on wrong, drives luck bonuses
  const [correctCount, setCorrectCount] = useState(0);
  const [streak,       setStreak]       = useState(0);
  const [luck,         setLuck]         = useState(0);

  // Phase
  const [phase,        setPhase]       = useState("questions");
  const [diceValue,    setDiceValue]   = useState(null);
  const [diceRolling,  setDiceRolling] = useState(false);
  const [highlightPos, setHighlightPos]= useState(null);

  // Space events
  const [spaceEvent,   setSpaceEvent]  = useState(null);
  const [trapTimer,    setTrapTimer]   = useState(10);
  const [trapAnswered, setTrapAnswered]= useState(false);
  const trapRef = useRef(null);

  // Timers
  const [gameTimeLeft,     setGameTimeLeft]     = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(null);
  const gameTimerRef     = useRef(null);
  const questionTimerRef = useRef(null);

  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const boardScrollRef = useRef(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  // ── Load questions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (game) return;
    if (session?.questions?.length) { setGame({ questions: session.questions }); return; }
    const gid = gameId || session?.gameId;
    if (!gid) return;
    getDoc(doc(db, "games", gid)).then((s) => { if (s.exists()) setGame(s.data()); }).catch(console.error);
  }, [session, gameId, game]);

  // ── Session listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      const me = (data.players || []).find((p) => p.name === playerName);
      if (me) setMyState(me);
      setLoading(false);
      if (!isHost) {
        if (data.status === "abandoned") { setShowAbandoned(true); return; }
        if ((data.kickedPlayers || []).includes(playerName)) { setShowKicked(true); return; }
      }
    });
    return () => unsub();
  }, [sessionId, playerName, isHost]);

  // ── Set question when index changes (also clears answer state) ────────────
  useEffect(() => {
    if (!game?.questions?.length) return;
    setCurrentQuestion(game.questions[questionIndex % game.questions.length]);
    setSelectedAnswer(null);
    setAnswerFeedback(null);
  }, [questionIndex, game]);

  // ── Auto-show map during rolling/moving ───────────────────────────────────
  useEffect(() => {
    if (phase === "rolling" || phase === "moving") setViewMode("map");
    if (phase === "questions") setViewMode("questions");
  }, [phase]);

  // ── Game timer (from session.gameEndsAt) ──────────────────────────────────
  useEffect(() => {
    const endsAt = session?.gameEndsAt;
    if (!endsAt) return;
    clearInterval(gameTimerRef.current);

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setGameTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(gameTimerRef.current);
        // Only the host triggers game end to avoid race conditions
        if (isHost) {
          updateDoc(doc(db, "gameSessions", sessionId), { status: "ended" }).catch(console.error);
        }
      }
    };
    tick();
    gameTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(gameTimerRef.current);
  }, [session?.gameEndsAt, isHost, sessionId]);

  // ── Question timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(questionTimerRef.current);
    const timeLimit = session?.settings?.timePerQuestion;
    if (!timeLimit || phase !== "questions" || !currentQuestion || selectedAnswer !== null) {
      setQuestionTimeLeft(null);
      return;
    }
    setQuestionTimeLeft(timeLimit);
    questionTimerRef.current = setInterval(() => {
      setQuestionTimeLeft((t) => {
        if (t === null) return null;
        if (t <= 1) {
          clearInterval(questionTimerRef.current);
          // Time up = wrong answer, but correctCount stays
          setAnswerFeedback("wrong");
          setStreak(0);
          setLuck(0);
          setTimeout(() => setQuestionIndex((i) => i + 1), 700);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(questionTimerRef.current);
  }, [questionIndex, phase, session?.settings?.timePerQuestion]);

  // ── Scroll to board position ───────────────────────────────────────────────
  const scrollToPos = useCallback((pos, boardEnd) => {
    if (!boardScrollRef.current) return;
    const rowIdx    = Math.floor(pos / BOARD_COLS);
    const totalRows = Math.ceil((boardEnd + 1) / BOARD_COLS);
    const visualRow = totalRows - 1 - rowIdx;
    const scrollY   = visualRow * (BASE_TILE + 6) - 50;
    boardScrollRef.current.scrollTo({ y: Math.max(0, scrollY), animated: true });
  }, []);

  // ── Answer handler ─────────────────────────────────────────────────────────
  const handleAnswer = useCallback((ansIdx) => {
    if (selectedAnswer !== null || phase !== "questions") return;
    clearInterval(questionTimerRef.current);
    const q       = currentQuestion;
    const correct = q?.correctAnswers?.[ansIdx] === true;

    setSelectedAnswer(ansIdx);
    setAnswerFeedback(correct ? "correct" : "wrong");

    if (correct) {
      const newStreak = streak + 1;
      const newCount  = correctCount + 1; // cumulative — never reset by wrong
      const newLuck   = Math.min(40, newStreak >= 2 ? luck + 5 : luck);
      setStreak(newStreak);
      setLuck(newLuck);

      if (newCount >= 3) {
        // Earned a roll — reset the cumulative count
        setCorrectCount(0);
        setTimeout(() => {
          setPhase("rolling");
          setDiceValue(null);
        }, 900);
      } else {
        setCorrectCount(newCount);
        setTimeout(() => setQuestionIndex((i) => i + 1), 900);
      }
    } else {
      // Wrong: reset streak + luck, but correctCount stays
      setStreak(0);
      setLuck(0);
      setTimeout(() => setQuestionIndex((i) => i + 1), 900);
    }
  }, [selectedAnswer, phase, currentQuestion, correctCount, streak, luck]);

  // ── Dice roll ──────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);

    Animated.sequence([
      Animated.timing(diceAnim, { toValue: 10,  duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 8,   duration: 80, useNativeDriver: true }),
      Animated.timing(diceAnim, { toValue: 0,   duration: 80, useNativeDriver: true }),
    ]).start();

    await new Promise((r) => setTimeout(r, 500));

    let roll = Math.floor(Math.random() * 6) + 1;
    if (luck > 0) {
      const r2 = Math.floor(Math.random() * 6) + 1;
      if (luck >= 20) roll = Math.max(roll, r2);
    }
    if (streak >= 8) roll = Math.min(6, roll + 1);

    setDiceValue(roll);
    setDiceRolling(false);
    setTimeout(() => movePlayer(roll), 700);
  }, [diceRolling, luck, streak]);

  // ── Move player ────────────────────────────────────────────────────────────
  // Key fix: async for-loop + getDoc for fresh data + try/catch ALWAYS exits moving
  const movePlayer = useCallback(async (spaces) => {
    // Snapshot myState/session at call time to avoid stale closure on the async path
    const snap0 = await getDoc(doc(db, "gameSessions", sessionId)).catch(() => null);
    if (!snap0?.exists()) { setPhase("questions"); setDiceValue(null); return; }
    const liveData = snap0.data();
    const liveMe   = (liveData.players || []).find((p) => p.name === playerName);
    if (!liveMe)     { setPhase("questions"); setDiceValue(null); return; }

    const boardEnd = liveData.settings?.boardSize || 25;
    const oldPos   = liveMe.position || 0;
    const newPos   = Math.min(oldPos + spaces, boardEnd);

    setPhase("moving");

    // Animate step by step
    for (let cur = oldPos; cur <= newPos; cur++) {
      setHighlightPos(cur);
      scrollToPos(cur, boardEnd);
      await new Promise((r) => setTimeout(r, 280));
    }
    setHighlightPos(newPos);

    // Write + handle landing — always escape moving on any failure
    try {
      const freshSnap = await getDoc(doc(db, "gameSessions", sessionId));
      if (!freshSnap.exists()) throw new Error("session gone");
      const freshData = freshSnap.data();

      const updated = (freshData.players || []).map((p) =>
        p.name === playerName ? { ...p, position: newPos, color: playerColor } : p
      );
      await updateDoc(doc(db, "gameSessions", sessionId), { players: updated });

      if (newPos >= boardEnd) {
        await updateDoc(doc(db, "gameSessions", sessionId), { status: "ended", winner: playerName });
        return; // game-over modal appears via snapshot
      }

      handleSpaceLanding(freshData.board?.[newPos], newPos, boardEnd, freshData.questions);
    } catch (err) {
      console.error("movePlayer error:", err);
      // Guaranteed exit from moving phase
      setPhase("questions");
      setDiceValue(null);
      setQuestionIndex((i) => i + 1);
    }
  }, [playerName, playerColor, sessionId, scrollToPos]);

  // ── Space landing ──────────────────────────────────────────────────────────
  const handleSpaceLanding = useCallback((space, pos, boardEnd, sessionQuestions) => {
    const type = space?.type || "normal";
    if (type === "normal") {
      setPhase("questions");
      setDiceValue(null);
      setQuestionIndex((i) => i + 1);
      return;
    }
    if (type === "trap") {
      const pool = sessionQuestions?.length ? sessionQuestions : (game?.questions || []);
      if (pool.length) {
        const trapQ = pool[Math.floor(Math.random() * pool.length)];
        setSpaceEvent({ type: "trap", question: trapQ });
        setTrapTimer(10);
        setTrapAnswered(false);
        setPhase("space_event");
        clearInterval(trapRef.current);
        trapRef.current = setInterval(() => {
          setTrapTimer((t) => {
            if (t <= 1) { clearInterval(trapRef.current); handleTrapFail(); return 0; }
            return t - 1;
          });
        }, 1000);
      } else {
        setPhase("questions");
        setDiceValue(null);
        setQuestionIndex((i) => i + 1);
      }
      return;
    }
    setSpaceEvent({ type });
    setPhase("space_event");
  }, [game]);

  const handleTrapFail = useCallback(async () => {
    clearInterval(trapRef.current);
    try {
      const snap = await getDoc(doc(db, "gameSessions", sessionId));
      if (snap.exists()) {
        const upd = (snap.data().players || []).map((p) =>
          p.name === playerName ? { ...p, stunned: true } : p
        );
        await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
      }
    } catch (err) { console.error(err); }
    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
  }, [playerName, sessionId]);

  const resolveEvent = useCallback(async (opts = {}) => {
    clearInterval(trapRef.current);
    try {
      const snap = await getDoc(doc(db, "gameSessions", sessionId));
      if (!snap.exists()) { setSpaceEvent(null); setPhase("questions"); setDiceValue(null); return; }
      const freshData = snap.data();
      const boardEnd  = freshData.settings?.boardSize || 25;
      const me        = (freshData.players || []).find((p) => p.name === playerName);
      const cur       = me?.position || 0;
      let newPos      = cur;
      let stun        = false;

      switch (spaceEvent?.type) {
        case "lava":    newPos = Math.max(0,        cur - (Math.floor(Math.random() * 4) + 1)); break;
        case "cannon":  newPos = Math.min(boardEnd, cur + (Math.floor(Math.random() * 4) + 1)); break;
        case "mystery": newPos = Math.min(boardEnd, cur + 2); break;
        case "trap":    stun = !opts.correct; break;
      }

      const upd = (freshData.players || []).map((p) =>
        p.name === playerName ? { ...p, position: newPos, stunned: stun } : p
      );
      await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
      if (newPos !== cur) { setHighlightPos(newPos); scrollToPos(newPos, boardEnd); }
    } catch (err) { console.error("resolveEvent:", err); }

    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
    setQuestionIndex((i) => i + 1);
  }, [spaceEvent, playerName, sessionId, scrollToPos]);

  // ── Leave handler ─────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    setShowLeave(false);
    if (!isHost) {
      try {
        const snap = await getDoc(doc(db, "gameSessions", sessionId));
        if (snap.exists()) {
          const fresh = snap.data();
          const upd   = (fresh.players || []).filter((p) => p.name !== playerName);
          await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
        }
      } catch (err) { console.error("Leave error:", err); }
    }
    const dest = auth.currentUser ? "Dashboard" : "Home";
    navigation.reset({ index: 0, routes: [{ name: dest }] });
  }, [isHost, playerName, sessionId, navigation]);

  const exitGame = () => {
    const dest = auth.currentUser ? "Dashboard" : "Home";
    navigation.reset({ index: 0, routes: [{ name: dest }] });
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadingText}>Loading game…</Text>
    </SafeAreaView>
  );

  const board    = session?.board    || [];
  const players  = session?.players  || [];
  const boardEnd = session?.settings?.boardSize || 25;
  const myPos    = myState?.position || 0;
  const isStunned= myState?.stunned  === true;
  const ROLL_AT  = 3;

  // ═══════════════════════════════════════════════════════════════════════
  // HOST VIEW
  // ═══════════════════════════════════════════════════════════════════════
  if (isHost) {
    const sorted = [...players].sort((a, b) => (b.position || 0) - (a.position || 0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>Brain Board — Host</Text>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            {gameTimeLeft != null && (
              <Text style={[S.gameTimerHost, gameTimeLeft <= 30 && { color: "#e74c3c" }]}>
                {formatTime(gameTimeLeft)}
              </Text>
            )}
            <TouchableOpacity style={S.endBtn} onPress={async () => {
              await updateDoc(doc(db, "gameSessions", sessionId), { status: "ended" }).catch(console.error);
              exitGame();
            }}>
              <Text style={S.endBtnText}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.hostBody}>
          <ScrollView ref={boardScrollRef} style={S.hostBoardArea} contentContainerStyle={{ padding: 12 }}>
            <SnakeBoard board={board} players={players} myPosition={-1} highlightPos={highlightPos} boardEnd={boardEnd} tileSize={HOST_TILE} />
          </ScrollView>
          <View style={S.hostSidebar}>
            <Text style={S.lbHeader}>Leaderboard</Text>
            {sorted.slice(0, 10).map((p, i) => (
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>#{i + 1}</Text>
                <View style={[S.lbDot, { backgroundColor: p.color || "#888" }]} />
                <Text style={S.lbName} numberOfLines={1}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position || 0}/{boardEnd}</Text>
                {p.stunned && <Text style={[S.lbPos, { color: "#e74c3c" }]}>stunned</Text>}
              </View>
            ))}
          </View>
        </View>

        {/* Leave button */}
        <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
          <Text style={S.leaveBtnText}>Leave</Text>
        </TouchableOpacity>

        {session?.status === "ended" && !gameOverDismissed && (
          <GameOverModal session={session} myPos={-1} boardEnd={boardEnd}
            onExit={() => { setGameOverDismissed(true); exitGame(); }} />
        )}

        <LeaveModal visible={showLeave} isHost={true}
          onStay={() => setShowLeave(false)} onLeave={handleLeave} />
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PLAYER VIEW
  // ═══════════════════════════════════════════════════════════════════════
  const showMap = viewMode === "map" || phase === "rolling" || phase === "moving";

  return (
    <SafeAreaView style={S.container}>

      {/* HUD */}
      <View style={S.hud}>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>CORRECT</Text>
          <Text style={S.hudValue}>{correctCount}/{ROLL_AT}</Text>
        </View>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>LUCK</Text>
          <Text style={S.hudValue}>{luck}%</Text>
        </View>
        <View style={S.hudItem}>
          <Text style={S.hudLabel}>SPACE</Text>
          <Text style={[S.hudValue, { color: playerColor }]}>{myPos}/{boardEnd}</Text>
        </View>
        {gameTimeLeft != null && (
          <View style={S.hudItem}>
            <Text style={S.hudLabel}>TIME</Text>
            <Text style={[S.hudValue, gameTimeLeft <= 30 && { color: "#e74c3c" }]}>
              {formatTime(gameTimeLeft)}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[S.mapToggle, showMap && S.mapToggleActive]}
          onPress={() => setViewMode((v) => v === "map" ? "questions" : "map")}
        >
          <Text style={S.mapToggleText}>Map</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={S.mainArea}>
        {showMap ? (
          <ScrollView ref={boardScrollRef} contentContainerStyle={{ padding: 10 }}>
            <SnakeBoard board={board} players={players} myPosition={myPos}
              highlightPos={highlightPos} boardEnd={boardEnd} tileSize={BASE_TILE} />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={S.questionsArea}>
            {isStunned ? (
              <View style={S.stunnedCard}>
                <Text style={S.stunnedTitle}>Stunned</Text>
                <Text style={S.stunnedSub}>Answer {ROLL_AT} correct in a row to recover</Text>
              </View>
            ) : currentQuestion ? (
              <View style={S.questionCard}>
                {/* Progress dots */}
                <View style={S.progressDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[S.dot, i < correctCount && S.dotFilled]} />
                  ))}
                </View>
                <Text style={S.progressText}>{correctCount}/{ROLL_AT} correct — {ROLL_AT - correctCount} more to roll</Text>

                {/* Question timer */}
                {questionTimeLeft != null && (
                  <Text style={[S.questionTimer, questionTimeLeft <= 5 && { color: "#e74c3c" }]}>
                    {questionTimeLeft}s
                  </Text>
                )}

                <Text style={S.questionText}>{currentQuestion.question}</Text>
                <View style={S.answersGrid}>
                  {(currentQuestion.type === "multipleChoice"
                    ? currentQuestion.answers
                    : ["True", "False"]
                  ).map((ans, i) => {
                    const isSelected = selectedAnswer === i;
                    const isCorrect  = currentQuestion.correctAnswers?.[i] === true;
                    let bg = "#1e1e1e", bc = "#333";
                    if (isSelected) {
                      bg = answerFeedback === "correct" ? "#003d1a" : "#3d0000";
                      bc = answerFeedback === "correct" ? "#00c781" : "#e74c3c";
                    } else if (selectedAnswer !== null && isCorrect) {
                      bg = "#003d1a"; bc = "#00c781";
                    }
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
                    {answerFeedback === "correct" ? "Correct!" : "Wrong!"}
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

      {/* Rolling panel */}
      {phase === "rolling" && (
        <View style={S.dicePanel}>
          <Text style={S.dicePanelTitle}>Roll the Dice!</Text>
          <Animated.Text style={[S.diceFace, { transform: [{ translateX: diceAnim }] }]}>
            {diceValue ? getDiceFace(diceValue) : "-"}
          </Animated.Text>
          {diceValue
            ? <Text style={S.diceResult}>Rolled a {diceValue} — moving…</Text>
            : <TouchableOpacity style={S.rollBtn} onPress={handleRoll} disabled={diceRolling}>
                <Text style={S.rollBtnText}>{diceRolling ? "Rolling…" : "Roll!"}</Text>
              </TouchableOpacity>
          }
          {luck > 0 && <Text style={S.luckHint}>Luck bonus: {luck}% — higher chance of big numbers</Text>}
        </View>
      )}

      {/* Moving panel */}
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
              <Text style={[S.eventTitle, { color: "#e74c3c" }]}>Lava Space</Text>
              <Text style={S.eventDesc}>You'll be pushed back a few spaces.</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#e74c3c" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>OK</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "cannon" && (<>
              <Text style={[S.eventTitle, { color: "#3498db" }]}>Cannon Space</Text>
              <Text style={S.eventDesc}>You're being launched forward!</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#3498db" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>Launch!</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "mystery" && (<>
              <Text style={[S.eventTitle, { color: "#9b59b6" }]}>Mystery Box</Text>
              <Text style={S.eventDesc}>+2 bonus spaces!</Text>
              <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#9b59b6" }]} onPress={() => resolveEvent()}>
                <Text style={S.eventBtnText}>Collect</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "trap" && spaceEvent.question && (<>
              <Text style={[S.eventTitle, { color: "#f39c12" }]}>Trap — Answer Fast!</Text>
              <Text style={[S.trapTimer, trapTimer <= 3 && { color: "#e74c3c" }]}>{trapTimer}s</Text>
              <Text style={S.eventDesc}>{spaceEvent.question.question}</Text>
              <View style={S.answersGrid}>
                {(spaceEvent.question.type === "multipleChoice"
                  ? spaceEvent.question.answers : ["True", "False"]
                ).map((ans, i) => (
                  <TouchableOpacity key={i} style={[S.ansBtn, { borderColor: "#444" }]} disabled={trapAnswered}
                    onPress={() => {
                      clearInterval(trapRef.current);
                      setTrapAnswered(true);
                      resolveEvent({ correct: spaceEvent.question.correctAnswers?.[i] === true });
                    }}>
                    <Text style={S.ansBtnText}>{ans}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>)}
          </View>
        </View>
      </Modal>

      {/* Game over */}
      {session?.status === "ended" && !gameOverDismissed && (
        <GameOverModal session={session} myPos={myPos} boardEnd={boardEnd}
          onExit={() => { setGameOverDismissed(true); exitGame(); }} />
      )}

      {/* Kicked */}
      <Modal visible={showKicked} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.eventCard}>
            <Text style={S.eventTitle}>You've Been Kicked</Text>
            <Text style={S.eventDesc}>The host has removed you from this game.</Text>
            <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#00c781" }]}
              onPress={() => { setShowKicked(false); navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] }); }}>
              <Text style={S.eventBtnText}>Back to Menu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Abandoned */}
      <Modal visible={showAbandoned} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.eventCard}>
            <Text style={S.eventTitle}>Game Ended</Text>
            <Text style={S.eventDesc}>The host has left the game.</Text>
            <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#00c781" }]}
              onPress={() => { setShowAbandoned(false); navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] }); }}>
              <Text style={S.eventBtnText}>Back to Menu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Leave button */}
      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveBtnText}>Leave</Text>
      </TouchableOpacity>

      <LeaveModal visible={showLeave} isHost={false}
        onStay={() => setShowLeave(false)} onLeave={handleLeave} />
    </SafeAreaView>
  );
}

// ─── Leave modal ──────────────────────────────────────────────────────────────
function LeaveModal({ visible, isHost, onStay, onLeave }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={S.overlay}>
        <View style={S.eventCard}>
          <Text style={S.eventTitle}>{isHost ? "End Game?" : "Leave Game?"}</Text>
          <Text style={S.eventDesc}>
            {isHost ? "Leaving will end the game for all players." : "Are you sure you want to leave?"}
          </Text>
          <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
            <TouchableOpacity style={[S.eventBtn, { flex: 1, backgroundColor: "#2a2a2a" }]} onPress={onStay}>
              <Text style={S.eventBtnText}>Stay</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.eventBtn, { flex: 1, backgroundColor: "#c0392b" }]} onPress={onLeave}>
              <Text style={S.eventBtnText}>Leave</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
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
          <Text style={S.eventTitle}>Game Over</Text>
          {winner && (
            <Text style={[S.eventDesc, { fontSize: 18 }]}>
              Winner: <Text style={{ color: winner.color || "#00c781", fontWeight: "bold" }}>{winner.name}</Text> — Space {winner.position}
            </Text>
          )}
          {myPos >= 0 && <Text style={[S.eventDesc, { color: "#aaa" }]}>You reached space {myPos}/{boardEnd}</Text>}
          <View style={{ width: "100%", marginTop: 12, marginBottom: 4 }}>
            {sorted.slice(0, 10).map((p, i) => (
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>#{i + 1}</Text>
                <View style={[S.lbDot, { backgroundColor: p.color || "#888" }]} />
                <Text style={S.lbName}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position || 0}/{boardEnd}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity style={[S.eventBtn, { backgroundColor: "#00c781" }]} onPress={onExit}>
            <Text style={S.eventBtnText}>Back to Menu</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: "#111" },
  center:      { flex: 1, backgroundColor: "#111", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#fff", marginTop: 16, fontSize: 18 },

  hud: { flexDirection: "row", alignItems: "center", backgroundColor: "#0a0a0a", borderBottomWidth: 2, borderBottomColor: "#222", paddingVertical: 14, paddingHorizontal: 10 },
  hudItem:    { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  hudLabel:   { color: "#555", fontSize: 10, letterSpacing: 1.5, fontWeight: "bold" },
  hudValue:   { color: "#fff", fontSize: 20, fontWeight: "bold", marginTop: 3 },
  mapToggle:  { width: 44, height: 44, borderRadius: 12, backgroundColor: "#1a1a1a", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#333", marginLeft: 4 },
  mapToggleActive: { backgroundColor: "#003322", borderColor: "#00c781" },
  mapToggleText:   { color: "#aaa", fontSize: 12, fontWeight: "bold" },

  mainArea: { flex: 1 },

  questionsArea: { padding: 16, paddingBottom: 32 },
  questionCard:  { gap: 14 },

  progressDots: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 4 },
  dot:          { width: 18, height: 18, borderRadius: 9, backgroundColor: "#2a2a2a", borderWidth: 2, borderColor: "#444" },
  dotFilled:    { backgroundColor: "#00c781", borderColor: "#00c781" },
  progressText: { color: "#555", fontSize: 13, textAlign: "center" },
  questionTimer:{ color: "#f39c12", fontSize: 22, fontWeight: "bold", textAlign: "center" },
  questionText: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 28, textAlign: "center" },

  answersGrid: { gap: 10, marginTop: 8 },
  ansBtn:      { backgroundColor: "#1e1e1e", borderRadius: 12, padding: 18, borderWidth: 2, alignItems: "center" },
  ansBtnText:  { color: "#fff", fontSize: 17, fontWeight: "600" },
  feedback:    { textAlign: "center", fontSize: 20, fontWeight: "bold", marginTop: 8 },

  stunnedCard:  { backgroundColor: "#2a0000", borderRadius: 16, padding: 28, alignItems: "center", margin: 8 },
  stunnedTitle: { color: "#e74c3c", fontSize: 24, fontWeight: "bold" },
  stunnedSub:   { color: "#ccc", fontSize: 16, marginTop: 8, textAlign: "center" },

  waitingCard: { alignItems: "center", gap: 12, paddingVertical: 60 },
  waitingText: { color: "#555", fontSize: 16 },

  dicePanel:     { backgroundColor: "#0a0a0a", borderTopWidth: 2, borderTopColor: "#222", padding: 24, alignItems: "center", gap: 14 },
  dicePanelTitle:{ color: "#fff", fontSize: 22, fontWeight: "bold" },
  diceFace:      { fontSize: 80 },
  diceResult:    { color: "#00c781", fontSize: 22, fontWeight: "bold" },
  rollBtn:       { backgroundColor: "#00c781", paddingVertical: 18, paddingHorizontal: 56, borderRadius: 16 },
  rollBtnText:   { color: "#fff", fontSize: 22, fontWeight: "bold" },
  luckHint:      { color: "#888", fontSize: 13 },

  movingPanel: { backgroundColor: "#0a0a0a", borderTopWidth: 2, borderTopColor: "#222", padding: 28, alignItems: "center", gap: 14 },
  movingText:  { color: "#888", fontSize: 18 },

  hostHeader:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, backgroundColor: "#0a0a0a", borderBottomWidth: 1, borderBottomColor: "#222" },
  hostTitle:   { color: "#00c781", fontSize: 20, fontWeight: "bold" },
  endBtn:      { backgroundColor: "#c0392b", paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12 },
  endBtnText:  { color: "#fff", fontWeight: "bold", fontSize: 15 },
  gameTimerHost:{ color: "#fff", fontSize: 18, fontWeight: "bold" },

  hostBody:    { flex: 1, flexDirection: "row" },
  hostBoardArea:{ flex: 1 },
  hostSidebar: { width: 260, backgroundColor: "#0a0a0a", padding: 16, borderLeftWidth: 1, borderLeftColor: "#222" },
  lbHeader:    { color: "#00c781", fontSize: 18, fontWeight: "bold", marginBottom: 14 },
  lbRow:       { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" },
  lbRank:      { color: "#fff", width: 32, fontSize: 16 },
  lbDot:       { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  lbName:      { color: "#fff", flex: 1, fontSize: 15, fontWeight: "500" },
  lbPos:       { color: "#aaa", fontSize: 14 },

  leaveBtn:     { position: "absolute", bottom: 12, left: 16, backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  leaveBtnText: { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },

  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  eventCard: { backgroundColor: "#1e1e1e", borderRadius: 22, padding: 28, width: "90%", maxWidth: 440, alignItems: "center", borderWidth: 1, borderColor: "#333", gap: 12 },
  eventTitle:  { color: "#fff", fontSize: 24, fontWeight: "bold", textAlign: "center" },
  eventDesc:   { color: "#ccc", fontSize: 16, textAlign: "center", lineHeight: 22 },
  eventBtn:    { paddingVertical: 16, paddingHorizontal: 48, borderRadius: 14, width: "100%", alignItems: "center" },
  eventBtnText:{ color: "#fff", fontSize: 18, fontWeight: "bold" },
  trapTimer:   { color: "#fff", fontSize: 32, fontWeight: "bold" },
});