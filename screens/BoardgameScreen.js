/**
 * BoardGameScreen.js
 *
 * ROOT CAUSE FIXES:
 *
 * 1. POSITION RESETS TO 0 ON EVERY ROLL
 *    runTransaction was the culprit. Firestore Web SDK transactions do an optimistic
 *    local write (onSnapshot fires with position:4), then commit to the server.
 *    If the server rejects the transaction for ANY reason (auth, contention, etc.),
 *    the SDK fires a second onSnapshot reverting to position:0. Replaced with
 *    plain updateDoc using sessionRef.current.players (always fresh from onSnapshot).
 *
 * 2. MAP / HUD SHOWS 0 FOR EVERYONE
 *    Same cause — the revert wipes out the write so every client sees 0.
 *
 * 3. PLAYER NOT FOUND (position stays 0 even locally)
 *    find(p.name === playerName) fails when nickname generator renames players.
 *    Now uses find(p.uid === playerUid) with name fallback.
 *
 * 4. KICK / LEAVE DON'T UPDATE OTHER SCREENS
 *    Also used runTransaction. Replaced with sessionRef-based updateDoc.
 *    After a successful updateDoc, Firestore fires onSnapshot on ALL connected
 *    clients immediately — host, players, everyone.
 *
 * ARCHITECTURE:
 *   sessionRef.current  — always the latest data from onSnapshot (server-confirmed)
 *   myStateRef.current  — this player's latest state from onSnapshot
 *   Both are updated INSIDE the onSnapshot callback (not via useEffect) so they
 *   are synchronously current before any setState calls.
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

const SPACE_CFG = {
  normal:  { bg: "#1a3d1a", border: "#27ae60", label: ""  },
  lava:    { bg: "#3d1200", border: "#e74c3c", label: "L" },
  cannon:  { bg: "#00213d", border: "#2980b9", label: "C" },
  trap:    { bg: "#3d2d00", border: "#d68910", label: "T" },
  mystery: { bg: "#2a0a3d", border: "#8e44ad", label: "?" },
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
  const getSpaceType = (idx) => (idx === 0 || idx === boardEnd) ? "normal" : (board[idx]?.type || "normal");
  const getStyle = (idx) => {
    const cfg  = SPACE_CFG[getSpaceType(idx)] || SPACE_CFG.normal;
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
            const here      = getPlayersAt(idx);
            const spaceType = getSpaceType(idx);
            const cfg       = SPACE_CFG[spaceType] || SPACE_CFG.normal;
            return (
              <View key={idx} style={[bS.tile, { width: tileSize, height: tileSize }, getStyle(idx)]}>
                {idx === boardEnd ? (
                  <Text style={{ fontSize: tileSize * 0.48 }}>🐍</Text>
                ) : idx === 0 ? (
                  <Text style={{ fontSize: tileSize * 0.4 }}>🏁</Text>
                ) : spaceType !== "normal" ? (
                  /* Non-normal tiles: show large colored label */
                  <Text style={[bS.tileLabel, {
                    fontSize: tileSize * 0.36,
                    color: cfg.border,
                  }]}>
                    {cfg.label}
                  </Text>
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
  board:     { paddingBottom: 8 },
  row:       { flexDirection: "row", justifyContent: "center", marginBottom: 4 },
  tile:      { borderRadius: 9, margin: 2, alignItems: "center", justifyContent: "center", position: "relative" },
  tileNum:   { color: "#4a6a4a", fontWeight: "bold" },
  tileLabel: { fontWeight: "bold" },
  tokenRow:  { position: "absolute", bottom: 3, flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  token:     { margin: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
});

const DICE_EMOJI = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const getDiceFace = (n) => DICE_EMOJI[(n - 1)] || "-";
const formatTime = (s) => {
  if (s == null || s < 0) return "--:--";
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor = "#00c781", playerUid, isHost, gameId } = route.params;

  const [session,  setSession]  = useState(null);
  const [game,     setGame]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [myState,  setMyState]  = useState(null);

  const [viewMode,      setViewMode]      = useState("questions");
  const [showKicked,    setShowKicked]    = useState(false);
  const [showLeave,     setShowLeave]     = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);

  // Questions
  const [questionIndex,   setQuestionIndex]   = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer,  setSelectedAnswer]  = useState(null);
  const [answerFeedback,  setAnswerFeedback]  = useState(null);

  // correctCount = CUMULATIVE toward next roll (wrong never resets it)
  // streak = CONSECUTIVE (resets on wrong, drives luck bonuses only)
  const [correctCount, setCorrectCount] = useState(0);
  const [streak,       setStreak]       = useState(0);
  const [luck,         setLuck]         = useState(0);
  const ROLL_AT = 3;

  // Phase
  const [phase,        setPhase]        = useState("questions");
  const [diceValue,    setDiceValue]    = useState(null);
  const [diceRolling,  setDiceRolling]  = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);

  // Space events
  const [spaceEvent,   setSpaceEvent]   = useState(null);
  const [trapTimer,    setTrapTimer]    = useState(10);
  const [trapAnswered, setTrapAnswered] = useState(false);
  const trapRef = useRef(null);

  // Timers
  const [gameTimeLeft,     setGameTimeLeft]     = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(null);
  const gameTimerRef     = useRef(null);
  const questionTimerRef = useRef(null);

  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const boardScrollRef = useRef(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  // ── REFS updated SYNCHRONOUSLY inside onSnapshot (not via useEffect) ──────
  // This guarantees they are always current when async callbacks run.
  const sessionRef = useRef(null);
  const myStateRef = useRef(null);

  // ── Session listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      // Update refs FIRST, synchronously, before any setState
      sessionRef.current = data;

      // Find this player by UID (works even after nickname generator renames them)
      // Fall back to name match for backwards compatibility
      const me = (data.players || []).find(
        (p) => (playerUid && p.uid === playerUid) || p.name === playerName
      );
      if (me) {
        myStateRef.current = me;
        setMyState(me);
      }

      setSession(data);
      setLoading(false);

      if (!isHost) {
        if (data.status === "abandoned") { setShowAbandoned(true); return; }
        if ((data.kickedPlayers || []).includes(playerName)) { setShowKicked(true); return; }
      }
    });
  }, [sessionId, playerName, playerUid, isHost]);

  // ── Load questions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (game) return;
    if (sessionRef.current?.questions?.length) {
      setGame({ questions: sessionRef.current.questions });
      return;
    }
    const gid = gameId || sessionRef.current?.gameId;
    if (!gid) return;
    getDoc(doc(db, "games", gid))
      .then((s) => { if (s.exists()) setGame(s.data()); })
      .catch(console.error);
  }, [session, gameId, game]);

  // ── Pick question whenever index changes ──────────────────────────────────
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

  // ── Game countdown timer (from session.gameEndsAt) ────────────────────────
  useEffect(() => {
    const endsAt = session?.gameEndsAt;
    if (!endsAt) return;
    clearInterval(gameTimerRef.current);
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setGameTimeLeft(rem);
      if (rem <= 0) {
        clearInterval(gameTimerRef.current);
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

  // ── Scroll board to a tile ────────────────────────────────────────────────
  const scrollToPos = useCallback((pos, boardEnd) => {
    if (!boardScrollRef.current) return;
    const rowIdx    = Math.floor(pos / BOARD_COLS);
    const totalRows = Math.ceil((boardEnd + 1) / BOARD_COLS);
    const visualRow = totalRows - 1 - rowIdx;
    boardScrollRef.current.scrollTo({ y: Math.max(0, visualRow * (BASE_TILE + 6) - 50), animated: true });
  }, []);

  // ── Helper to cleanly exit moving phase ───────────────────────────────────
  const exitMoving = () => {
    setPhase("questions");
    setDiceValue(null);
    setQuestionIndex((i) => i + 1);
  };

  // ── Answer handler ────────────────────────────────────────────────────────
  const handleAnswer = useCallback((ansIdx) => {
    if (selectedAnswer !== null || phase !== "questions") return;
    clearInterval(questionTimerRef.current);

    const q       = currentQuestion;
    const correct = q?.correctAnswers?.[ansIdx] === true;
    setSelectedAnswer(ansIdx);
    setAnswerFeedback(correct ? "correct" : "wrong");

    const stunned = myStateRef.current?.stunned === true;

    if (stunned) {
      // Stun recovery needs ROLL_AT consecutive correct
      if (correct) {
        const ns = streak + 1;
        setStreak(ns);
        if (ns >= ROLL_AT) {
          setStreak(0);
          // Unstun
          const sess = sessionRef.current;
          if (sess) {
            const upd = (sess.players || []).map(p =>
              (playerUid && p.uid === playerUid) || p.name === playerName
                ? { ...p, stunned: false }
                : p
            );
            updateDoc(doc(db, "gameSessions", sessionId), { players: upd }).catch(console.error);
          }
        }
      } else {
        setStreak(0);
      }
      setTimeout(() => setQuestionIndex((i) => i + 1), 900);
      return;
    }

    if (correct) {
      const newStreak = streak + 1;
      const newCount  = correctCount + 1; // CUMULATIVE — wrong never resets
      const newLuck   = Math.min(40, newStreak >= 2 ? luck + 5 : luck);
      setStreak(newStreak);
      setLuck(newLuck);
      if (newCount >= ROLL_AT) {
        setCorrectCount(0);
        setTimeout(() => { setPhase("rolling"); setDiceValue(null); }, 900);
      } else {
        setCorrectCount(newCount);
        setTimeout(() => setQuestionIndex((i) => i + 1), 900);
      }
    } else {
      setStreak(0);
      setLuck(0);
      // correctCount stays — cumulative progress never lost on wrong answer
      setTimeout(() => setQuestionIndex((i) => i + 1), 900);
    }
  }, [selectedAnswer, phase, currentQuestion, correctCount, streak, luck, playerName, playerUid, sessionId]);

  // ── Dice roll ─────────────────────────────────────────────────────────────
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
    // Small delay so the player can see the dice result before movement starts
    setTimeout(() => movePlayer(roll), 800);
  }, [diceRolling, luck, streak]);

  // ── MOVE PLAYER ───────────────────────────────────────────────────────────
  // Uses sessionRef.current and myStateRef.current — both updated SYNCHRONOUSLY
  // inside onSnapshot, so they are never stale cache like getDoc() would be.
  // Uses plain updateDoc (not runTransaction) because transaction commits can be
  // rolled back by the server causing position to snap back to 0.
  const movePlayer = useCallback(async (spaces) => {
    const me   = myStateRef.current;
    const sess = sessionRef.current;

    if (!me || !sess) {
      // Player state not loaded yet — just exit moving safely
      setPhase("questions");
      setDiceValue(null);
      return;
    }

    const boardEnd = sess.settings?.boardSize || 25;
    const oldPos   = me.position || 0;
    const newPos   = Math.min(oldPos + spaces, boardEnd);

    setPhase("moving");

    // Animate step by step
    for (let cur = oldPos; cur <= newPos; cur++) {
      setHighlightPos(cur);
      scrollToPos(cur, boardEnd);
      await new Promise((r) => setTimeout(r, 280));
    }
    setHighlightPos(newPos);

    // Write position — read latest sessionRef AFTER animation (may have updated)
    try {
      const latestSess = sessionRef.current;
      if (!latestSess) throw new Error("no session");

      // Build updated players array — identify self by UID (robust to name changes)
      const updatedPlayers = (latestSess.players || []).map((p) =>
        (playerUid && p.uid === playerUid) || p.name === playerName
          ? { ...p, position: newPos, color: playerColor }
          : p
      );

      await updateDoc(doc(db, "gameSessions", sessionId), { players: updatedPlayers });

      // Check for win condition
      if (newPos >= boardEnd) {
        await updateDoc(doc(db, "gameSessions", sessionId), {
          status: "ended",
          winner: playerName,
        });
        // Game over modal will appear via the onSnapshot listener
        return;
      }

      // Handle space landing — read board from latestSess (not stale closure)
      const landingSpace     = (latestSess.board || [])[newPos];
      const landingQuestions = latestSess.questions || [];
      handleLanding(landingSpace, newPos, boardEnd, landingQuestions);

    } catch (err) {
      console.error("movePlayer error:", err);
      // ALWAYS exit moving phase so the game never freezes
      exitMoving();
    }
  }, [playerName, playerColor, playerUid, sessionId, scrollToPos]);

  // ── Space landing (plain function, not useCallback, reads refs directly) ──
  const handleLanding = (space, pos, boardEnd, questions) => {
    const type = space?.type || "normal";

    if (type === "normal") {
      setPhase("questions");
      setDiceValue(null);
      setQuestionIndex((i) => i + 1);
      return;
    }

    if (type === "trap") {
      const pool = questions?.length ? questions : [];
      if (pool.length) {
        const trapQ = pool[Math.floor(Math.random() * pool.length)];
        setSpaceEvent({ type: "trap", question: trapQ });
        setTrapTimer(10);
        setTrapAnswered(false);
        setPhase("space_event");
        clearInterval(trapRef.current);
        trapRef.current = setInterval(() => {
          setTrapTimer((t) => {
            if (t <= 1) {
              clearInterval(trapRef.current);
              handleTrapFail();
              return 0;
            }
            return t - 1;
          });
        }, 1000);
      } else {
        exitMoving();
      }
      return;
    }

    // lava, cannon, mystery
    setSpaceEvent({ type });
    setPhase("space_event");
  };

  const handleTrapFail = async () => {
    clearInterval(trapRef.current);
    const sess = sessionRef.current;
    if (sess) {
      const upd = (sess.players || []).map((p) =>
        (playerUid && p.uid === playerUid) || p.name === playerName
          ? { ...p, stunned: true }
          : p
      );
      await updateDoc(doc(db, "gameSessions", sessionId), { players: upd }).catch(console.error);
    }
    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
  };

  const resolveEvent = async (opts = {}) => {
    clearInterval(trapRef.current);
    const sess = sessionRef.current;
    const me   = myStateRef.current;
    if (!sess || !me) {
      setSpaceEvent(null);
      exitMoving();
      return;
    }

    const boardEnd = sess.settings?.boardSize || 25;
    const cur      = me.position || 0;
    const type     = spaceEvent?.type;
    let newPos     = cur;
    let stun       = false;

    switch (type) {
      case "lava":    newPos = Math.max(0,        cur - (Math.floor(Math.random() * 4) + 1)); break;
      case "cannon":  newPos = Math.min(boardEnd, cur + (Math.floor(Math.random() * 4) + 1)); break;
      case "mystery": newPos = Math.min(boardEnd, cur + 2); break;
      case "trap":    stun = !opts.correct; break;
    }

    try {
      const latestSess = sessionRef.current;
      const upd = (latestSess?.players || []).map((p) =>
        (playerUid && p.uid === playerUid) || p.name === playerName
          ? { ...p, position: newPos, stunned: stun }
          : p
      );
      await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
    } catch (err) {
      console.error("resolveEvent:", err);
    }

    if (newPos !== cur) {
      setHighlightPos(newPos);
      scrollToPos(newPos, sess.settings?.boardSize || 25);
    }
    setSpaceEvent(null);
    setPhase("questions");
    setDiceValue(null);
    setQuestionIndex((i) => i + 1);
  };

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = async () => {
    setShowLeave(false);
    if (!isHost) {
      try {
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players || []).filter(
            (p) => !(playerUid && p.uid === playerUid) && p.name !== playerName
          );
          await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
        }
      } catch (err) {
        console.error("Leave error:", err);
      }
    }
    // Anonymous (guest) users go to Home/JoinGame, real accounts go to Dashboard
    const isRealAccount = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({ index: 0, routes: [{ name: isRealAccount ? "Dashboard" : "Home" }] });
  };

  const exitGame = () => {
    const isRealAccount = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({ index: 0, routes: [{ name: isRealAccount ? "Dashboard" : "Home" }] });
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
  const stunned  = myState?.stunned  === true;

  // ══ HOST VIEW ═════════════════════════════════════════════════════════════
  if (isHost) {
    const sorted = [...players].sort((a, b) => (b.position || 0) - (a.position || 0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>Brain Board — Host</Text>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            {gameTimeLeft != null && (
              <Text style={[S.timerTxt, gameTimeLeft <= 30 && { color: "#e74c3c" }]}>
                {formatTime(gameTimeLeft)}
              </Text>
            )}
            <TouchableOpacity style={S.endBtn} onPress={async () => {
              await updateDoc(doc(db, "gameSessions", sessionId), { status: "ended" }).catch(console.error);
              exitGame();
            }}>
              <Text style={S.endBtnTxt}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.hostBody}>
          <ScrollView ref={boardScrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
            <SnakeBoard board={board} players={players} myPosition={-1}
              highlightPos={highlightPos} boardEnd={boardEnd} tileSize={HOST_TILE} />
          </ScrollView>
          <View style={S.hostSide}>
            <Text style={S.lbTitle}>Leaderboard</Text>
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

        <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
          <Text style={S.leaveBtnTxt}>Leave</Text>
        </TouchableOpacity>

        {session?.status === "ended" && !gameOverDismissed && (
          <GameOverModal session={session} myPos={-1} boardEnd={boardEnd}
            onExit={() => { setGameOverDismissed(true); exitGame(); }} />
        )}
        <LeaveModal visible={showLeave} isHost onStay={() => setShowLeave(false)} onLeave={handleLeave} />
      </SafeAreaView>
    );
  }

  // ══ PLAYER VIEW ═══════════════════════════════════════════════════════════
  const showMap = viewMode === "map";

  return (
    <SafeAreaView style={S.container}>

      {/* HUD */}
      <View style={S.hud}>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>CORRECT</Text>
          <Text style={S.hudVal}>{stunned ? `${streak}/${ROLL_AT}` : `${correctCount}/${ROLL_AT}`}</Text>
        </View>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>LUCK</Text>
          <Text style={S.hudVal}>{luck}%</Text>
        </View>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>SPACE</Text>
          <Text style={[S.hudVal, { color: playerColor }]}>{myPos}/{boardEnd}</Text>
        </View>
        {gameTimeLeft != null && (
          <View style={S.hudCell}>
            <Text style={S.hudLbl}>TIME</Text>
            <Text style={[S.hudVal, gameTimeLeft <= 30 && { color: "#e74c3c" }]}>
              {formatTime(gameTimeLeft)}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[S.mapBtn, showMap && S.mapBtnOn]}
          onPress={() => setViewMode((v) => v === "map" ? "questions" : "map")}
        >
          <Text style={S.mapBtnTxt}>Map</Text>
        </TouchableOpacity>
      </View>

      <View style={S.main}>

        {/* MAP */}
        {showMap && (
          <ScrollView ref={boardScrollRef} contentContainerStyle={{ padding: 10 }}>
            <SnakeBoard board={board} players={players} myPosition={myPos}
              highlightPos={highlightPos} boardEnd={boardEnd} tileSize={BASE_TILE} />
            {/* Tile legend */}
            <View style={S.legend}>
              {[
                { type:"normal",  label:"Normal" },
                { type:"mystery", label:"Mystery" },
                { type:"lava",    label:"Lava" },
                { type:"cannon",  label:"Cannon" },
                { type:"trap",    label:"Trap" },
              ].map(({ type, label }) => {
                const cfg = SPACE_CFG[type];
                return (
                  <View key={type} style={S.legendItem}>
                    <View style={[S.legendSwatch, { backgroundColor: cfg.bg, borderColor: cfg.border }]} />
                    <Text style={[S.legendTxt, { color: cfg.border }]}>{label}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* QUESTIONS */}
        {!showMap && phase === "questions" && (
          <ScrollView contentContainerStyle={S.qArea}>
            {stunned && (
              <View style={S.stunnedBanner}>
                <Text style={S.stunnedTxt}>
                  STUNNED — answer {ROLL_AT} in a row to recover ({streak}/{ROLL_AT})
                </Text>
              </View>
            )}
            {currentQuestion ? (
              <View style={S.qCard}>
                {!stunned && (
                  <>
                    <View style={S.progDots}>
                      {[0, 1, 2].map((i) => (
                        <View key={i} style={[S.dot, i < correctCount && S.dotOn]} />
                      ))}
                    </View>
                    <Text style={S.progTxt}>{correctCount}/{ROLL_AT} correct — {ROLL_AT - correctCount} more to roll</Text>
                  </>
                )}
                {questionTimeLeft != null && (
                  <Text style={[S.qTimer, questionTimeLeft <= 5 && { color: "#e74c3c" }]}>
                    {questionTimeLeft}s
                  </Text>
                )}
                <Text style={S.qTxt}>{currentQuestion.question}</Text>
                <View style={S.aGrid}>
                  {(currentQuestion.type === "multipleChoice"
                    ? currentQuestion.answers
                    : ["True", "False"]
                  ).map((ans, i) => {
                    const isSel  = selectedAnswer === i;
                    const isCorr = currentQuestion.correctAnswers?.[i] === true;
                    let bg = "#1e1e1e", bc = "#333";
                    if (isSel) {
                      bg = answerFeedback === "correct" ? "#003d1a" : "#3d0000";
                      bc = answerFeedback === "correct" ? "#00c781" : "#e74c3c";
                    } else if (selectedAnswer !== null && isCorr) {
                      bg = "#003d1a"; bc = "#00c781";
                    }
                    return (
                      <TouchableOpacity key={i}
                        style={[S.aBtn, { backgroundColor: bg, borderColor: bc }]}
                        onPress={() => handleAnswer(i)}
                        disabled={selectedAnswer !== null}
                        activeOpacity={0.75}>
                        <Text style={S.aTxt}>{ans}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {answerFeedback && (
                  <Text style={[S.fb, { color: answerFeedback === "correct" ? "#00c781" : "#e74c3c" }]}>
                    {answerFeedback === "correct" ? "Correct!" : "Wrong!"}
                  </Text>
                )}
              </View>
            ) : (
              <View style={S.waitBox}>
                <ActivityIndicator color="#00c781" />
                <Text style={S.waitTxt}>Loading questions…</Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* ROLLING */}
        {phase === "rolling" && (
          <View style={S.diceBox}>
            <Text style={S.diceTtl}>Roll the Dice!</Text>
            {luck > 0 && <Text style={S.luckTxt}>Luck {luck}% — higher chance of big numbers</Text>}
            <Animated.Text style={[S.diceFace, { transform: [{ translateX: diceAnim }] }]}>
              {diceValue ? getDiceFace(diceValue) : "?"}
            </Animated.Text>
            {diceValue ? (
              <Text style={S.diceRes}>Rolled {diceValue} — moving…</Text>
            ) : (
              <TouchableOpacity style={S.rollBtn} onPress={handleRoll}>
                <Text style={S.rollTxt}>Roll!</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* MOVING */}
        {phase === "moving" && (
          <View style={S.movingBox}>
            <ActivityIndicator color="#00c781" size="large" />
            <Text style={S.movingTxt}>Moving…</Text>
          </View>
        )}

      </View>

      {/* Space event modal */}
      <Modal visible={phase === "space_event" && !!spaceEvent} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            {spaceEvent?.type === "lava" && (<>
              <Text style={[S.mTtl, { color: "#e74c3c" }]}>Lava Space</Text>
              <Text style={S.mDesc}>You'll be pushed back a few spaces.</Text>
              <TouchableOpacity style={[S.mBtn, { backgroundColor: "#e74c3c" }]} onPress={() => resolveEvent()}>
                <Text style={S.mBtnTxt}>OK</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "cannon" && (<>
              <Text style={[S.mTtl, { color: "#3498db" }]}>Cannon Space</Text>
              <Text style={S.mDesc}>You're being launched forward!</Text>
              <TouchableOpacity style={[S.mBtn, { backgroundColor: "#3498db" }]} onPress={() => resolveEvent()}>
                <Text style={S.mBtnTxt}>Launch!</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "mystery" && (<>
              <Text style={[S.mTtl, { color: "#9b59b6" }]}>Mystery Space</Text>
              <Text style={S.mDesc}>+2 bonus spaces!</Text>
              <TouchableOpacity style={[S.mBtn, { backgroundColor: "#9b59b6" }]} onPress={() => resolveEvent()}>
                <Text style={S.mBtnTxt}>Collect</Text>
              </TouchableOpacity>
            </>)}
            {spaceEvent?.type === "trap" && spaceEvent.question && (<>
              <Text style={[S.mTtl, { color: "#f39c12" }]}>Trap — Answer Fast!</Text>
              <Text style={[S.trapSecs, trapTimer <= 3 && { color: "#e74c3c" }]}>{trapTimer}s</Text>
              <Text style={S.mDesc}>{spaceEvent.question.question}</Text>
              <View style={S.aGrid}>
                {(spaceEvent.question.type === "multipleChoice"
                  ? spaceEvent.question.answers : ["True", "False"]
                ).map((ans, i) => (
                  <TouchableOpacity key={i} style={[S.aBtn, { borderColor: "#444" }]}
                    disabled={trapAnswered}
                    onPress={() => {
                      clearInterval(trapRef.current);
                      setTrapAnswered(true);
                      resolveEvent({ correct: spaceEvent.question.correctAnswers?.[i] === true });
                    }}>
                    <Text style={S.aTxt}>{ans}</Text>
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
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>You've Been Kicked</Text>
          <Text style={S.mDesc}>The host has removed you from this game.</Text>
          <TouchableOpacity style={[S.mBtn, { backgroundColor: "#00c781" }]}
            onPress={() => { setShowKicked(false); navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] }); }}>
            <Text style={S.mBtnTxt}>Back to Menu</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Host abandoned */}
      <Modal visible={showAbandoned} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>Game Ended</Text>
          <Text style={S.mDesc}>The host has ended the game.</Text>
          <TouchableOpacity style={[S.mBtn, { backgroundColor: "#00c781" }]}
            onPress={() => { setShowAbandoned(false); navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] }); }}>
            <Text style={S.mBtnTxt}>Back to Menu</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Leave button */}
      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveBtnTxt}>Leave</Text>
      </TouchableOpacity>
      <LeaveModal visible={showLeave} isHost={false}
        onStay={() => setShowLeave(false)} onLeave={handleLeave} />

    </SafeAreaView>
  );
}

// ─── Leave Modal ──────────────────────────────────────────────────────────────
function LeaveModal({ visible, isHost, onStay, onLeave }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>{isHost ? "End Game?" : "Leave Game?"}</Text>
        <Text style={S.mDesc}>
          {isHost ? "Leaving will end the game for all players." : "Are you sure you want to leave?"}
        </Text>
        <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
          <TouchableOpacity style={[S.mBtn, { flex: 1, backgroundColor: "#2a2a2a" }]} onPress={onStay}>
            <Text style={S.mBtnTxt}>Stay</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.mBtn, { flex: 1, backgroundColor: "#c0392b" }]} onPress={onLeave}>
            <Text style={S.mBtnTxt}>Leave</Text>
          </TouchableOpacity>
        </View>
      </View></View>
    </Modal>
  );
}

// ─── Game Over Modal ──────────────────────────────────────────────────────────
function GameOverModal({ session, myPos, boardEnd, onExit }) {
  const sorted = [...(session?.players || [])].sort((a, b) => (b.position || 0) - (a.position || 0));
  const winner = sorted[0];
  return (
    <Modal visible transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>Game Over</Text>
        {winner && (
          <Text style={[S.mDesc, { fontSize: 18 }]}>
            Winner: <Text style={{ color: winner.color || "#00c781", fontWeight: "bold" }}>{winner.name}</Text>
            {" — Space "}{winner.position}
          </Text>
        )}
        {myPos >= 0 && <Text style={[S.mDesc, { color: "#555" }]}>You reached space {myPos}/{boardEnd}</Text>}
        <View style={{ width: "100%", marginVertical: 12 }}>
          {sorted.slice(0, 10).map((p, i) => (
            <View key={p.name || i} style={S.lbRow}>
              <Text style={S.lbRank}>#{i + 1}</Text>
              <View style={[S.lbDot, { backgroundColor: p.color || "#888" }]} />
              <Text style={[S.lbName, { flex: 1 }]}>{p.name}</Text>
              <Text style={S.lbPos}>{p.position || 0}/{boardEnd}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[S.mBtn, { backgroundColor: "#00c781" }]} onPress={onExit}>
          <Text style={S.mBtnTxt}>Back to Menu</Text>
        </TouchableOpacity>
      </View></View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  center:    { flex: 1, backgroundColor: "#111", justifyContent: "center", alignItems: "center" },
  loadingText: { color: "#fff", marginTop: 16, fontSize: 18 },

  // HUD
  hud: { flexDirection: "row", alignItems: "center", backgroundColor: "#0a0a0a", borderBottomWidth: 2, borderBottomColor: "#222", paddingVertical: 14, paddingHorizontal: 10 },
  hudCell: { flex: 1, alignItems: "center" },
  hudLbl:  { color: "#444", fontSize: 10, letterSpacing: 1.2, fontWeight: "700" },
  hudVal:  { color: "#fff", fontSize: 20, fontWeight: "bold", marginTop: 2 },
  mapBtn:  { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#333" },
  mapBtnOn:{ backgroundColor: "#002a1a", borderColor: "#00c781" },
  mapBtnTxt: { color: "#aaa", fontSize: 13, fontWeight: "700" },

  main: { flex: 1 },

  // Questions
  qArea: { padding: 16, paddingBottom: 40 },
  qCard: { gap: 16 },
  stunnedBanner:  { backgroundColor: "#280000", borderRadius: 10, padding: 12, marginBottom: 4 },
  stunnedTxt:     { color: "#ff6b6b", fontSize: 14, fontWeight: "bold", textAlign: "center" },
  progDots: { flexDirection: "row", justifyContent: "center", gap: 12 },
  dot:      { width: 18, height: 18, borderRadius: 9, backgroundColor: "#2a2a2a", borderWidth: 2, borderColor: "#444" },
  dotOn:    { backgroundColor: "#00c781", borderColor: "#00c781" },
  progTxt:  { color: "#555", fontSize: 13, textAlign: "center" },
  qTimer:   { color: "#f39c12", fontSize: 22, fontWeight: "bold", textAlign: "center" },
  qTxt:     { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 28, textAlign: "center" },
  aGrid:    { gap: 10 },
  aBtn:     { backgroundColor: "#1e1e1e", borderRadius: 12, padding: 18, borderWidth: 2, alignItems: "center" },
  aTxt:     { color: "#fff", fontSize: 17, fontWeight: "600" },
  fb:       { textAlign: "center", fontSize: 20, fontWeight: "bold" },
  waitBox:  { alignItems: "center", paddingVertical: 80, gap: 14 },
  waitTxt:  { color: "#555", fontSize: 16 },

  legend:      { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch:{ width: 14, height: 14, borderRadius: 3, borderWidth: 1.5 },
  legendTxt:   { fontSize: 11, fontWeight: "600" },

  // Dice
  diceBox:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 20, backgroundColor: "#0d0d0d", padding: 24 },
  diceTtl:  { color: "#fff", fontSize: 22, fontWeight: "bold" },
  luckTxt:  { color: "#888", fontSize: 14 },
  diceFace: { fontSize: 88 },
  diceRes:  { color: "#00c781", fontSize: 22, fontWeight: "bold" },
  rollBtn:  { backgroundColor: "#00c781", paddingVertical: 20, paddingHorizontal: 72, borderRadius: 18 },
  rollTxt:  { color: "#000", fontSize: 24, fontWeight: "bold" },

  // Moving
  movingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#0d0d0d" },
  movingTxt: { color: "#aaa", fontSize: 18 },

  // Host
  hostHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, backgroundColor: "#0a0a0a", borderBottomWidth: 1, borderBottomColor: "#222" },
  hostTitle:  { color: "#00c781", fontSize: 20, fontWeight: "bold" },
  timerTxt:   { color: "#fff", fontSize: 18, fontWeight: "bold" },
  endBtn:     { backgroundColor: "#c0392b", paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12 },
  endBtnTxt:  { color: "#fff", fontWeight: "bold", fontSize: 15 },
  hostBody:   { flex: 1, flexDirection: "row" },
  hostSide:   { width: 260, backgroundColor: "#0a0a0a", padding: 16, borderLeftWidth: 1, borderLeftColor: "#222" },
  lbTitle:    { color: "#00c781", fontSize: 18, fontWeight: "bold", marginBottom: 14 },
  lbRow:      { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" },
  lbRank:     { color: "#fff", width: 32, fontSize: 15 },
  lbDot:      { width: 13, height: 13, borderRadius: 7, marginRight: 10 },
  lbName:     { color: "#fff", fontSize: 14, fontWeight: "500" },
  lbPos:      { color: "#aaa", fontSize: 13 },

  // Leave
  leaveBtn:    { position: "absolute", bottom: 12, left: 16, backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  leaveBtnTxt: { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },

  // Overlay / modals
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", alignItems: "center" },
  modal: { backgroundColor: "#1a1a1a", borderRadius: 22, padding: 28, width: "90%", maxWidth: 440, alignItems: "center", borderWidth: 1, borderColor: "#2a2a2a", gap: 14 },
  mTtl:    { color: "#fff", fontSize: 24, fontWeight: "bold", textAlign: "center" },
  mDesc:   { color: "#bbb", fontSize: 16, textAlign: "center", lineHeight: 22 },
  mBtn:    { paddingVertical: 16, paddingHorizontal: 48, borderRadius: 14, width: "100%", alignItems: "center" },
  mBtnTxt: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  trapSecs:{ color: "#fff", fontSize: 36, fontWeight: "bold" },
});