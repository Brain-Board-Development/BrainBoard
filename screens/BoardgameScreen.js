/**
 * BoardGameScreen.js
 *
 * Mystery box effects (spec-accurate):
 *  1 Push Back   — choose a player, move them -3 spaces
 *  2 Iso Ult     — BO3 quiz duel vs chosen player, winner takes loser's position
 *  3 Stun        — choose a player, they must answer 3 correct in a row to unstun
 *  4 Immunity    — self: protected from negative spaces + effects for 2 spaces / 45s
 *  5 Double Roll — next 2 rolls use 2 dice summed
 *  6 Bad Luck Aura — choose a player, they get -30% luck for 45s
 *
 * Mystery box triggers:
 *  • Landing on a mystery (purple ?) tile
 *  • Rolling a 1 on the dice
 *  • Every 6 total correct answers (cumulative, not consecutive)
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

const MYSTERY_DEFS = {
  1: { emoji: "💥", title: "Push Back",     desc: "Choose a player — move them 3 spaces backward.",          color: "#e74c3c", needsTarget: true  },
  2: { emoji: "⚔️",  title: "Iso Ult",       desc: "Challenge a player to a BO3 quiz duel. Winner takes loser's position!", color: "#3498db", needsTarget: true  },
  3: { emoji: "😵", title: "Stun",           desc: "Choose a player — they must answer 3 in a row to recover.", color: "#e67e22", needsTarget: true  },
  4: { emoji: "🛡️",  title: "Immunity",      desc: "You're protected from negative spaces and effects for 2 landings or 45 seconds.", color: "#2ecc71", needsTarget: false },
  5: { emoji: "🎲", title: "Double Roll",   desc: "Your next 2 rolls each use 2 dice summed together.",     color: "#9b59b6", needsTarget: false },
  6: { emoji: "🌑", title: "Bad Luck Aura", desc: "Choose a player — they lose 30% Luck for 45 seconds.",   color: "#7f8c8d", needsTarget: true  },
};

const DICE_EMOJI = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const getDiceFace  = (n) => DICE_EMOJI[Math.min(5, Math.max(0, n - 1))] || "?";
const formatTime   = (s) => s == null ? "--:--" : `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;

function getCorrectAnswerText(q) {
  if (!q) return "";
  if (q.type === "multipleChoice") {
    const idx = (q.correctAnswers || []).indexOf(true);
    return idx >= 0 ? (q.answers?.[idx] || "") : "";
  }
  return q.correctAnswers?.[0] === true ? "True" : "False";
}

function buildSnakeRows(boardEnd) {
  const rows = [];
  for (let r = 0; r <= boardEnd; r += BOARD_COLS) {
    const row = [];
    for (let s = r; s < r + BOARD_COLS && s <= boardEnd; s++) row.push(s);
    if (Math.floor(r / BOARD_COLS) % 2 === 1) row.reverse();
    rows.push(row);
  }
  return rows.reverse();
}

function SnakeBoard({ board, players, myPosition, highlightPos, boardEnd, tileSize }) {
  const sz   = tileSize || BASE_TILE;
  const rows = buildSnakeRows(boardEnd);
  const getPlayersAt = (idx) => players.filter((p) => (p.position || 0) === idx);
  const getSpaceType = (idx) => {
    if (idx === 0 || idx === boardEnd) return "normal";
    const direct = board[idx];
    if (direct?.type) return direct.type;
    const byIdx = Array.isArray(board) && board.find((s) => s?.index === idx);
    return byIdx?.type || "normal";
  };
  const getTileStyle = (idx) => {
    const cfg = SPACE_CFG[getSpaceType(idx)] || SPACE_CFG.normal;
    const isMe = idx === myPosition, isHL = idx === highlightPos;
    return { backgroundColor: cfg.bg, borderColor: isHL||isMe ? "#fff" : cfg.border, borderWidth: isHL||isMe ? 3 : 1.5, transform: [{ scale: isHL ? 1.12 : 1 }] };
  };
  return (
    <View style={bS.board}>
      {rows.map((row, ri) => (
        <View key={ri} style={bS.row}>
          {row.map((idx) => {
            const here = getPlayersAt(idx), type = getSpaceType(idx), cfg = SPACE_CFG[type] || SPACE_CFG.normal;
            return (
              <View key={idx} style={[bS.tile, { width: sz, height: sz }, getTileStyle(idx)]}>
                {idx === boardEnd ? <Text style={{ fontSize: sz*0.46 }}>🐍</Text>
                  : idx === 0    ? <Text style={{ fontSize: sz*0.38 }}>🏁</Text>
                  : type !== "normal" ? <Text style={{ fontSize: sz*0.36, fontWeight:"bold", color: cfg.border }}>{cfg.label}</Text>
                  : <Text style={{ fontSize: sz*0.26, color:"#4a6a4a", fontWeight:"bold" }}>{idx}</Text>}
                <View style={bS.tokenRow}>
                  {here.slice(0,3).map((p,pi) => (
                    <View key={pi} style={[bS.token, { backgroundColor:p.color||"#888", width:sz*0.22, height:sz*0.22, borderRadius:sz*0.11 }]} />
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
  board: { paddingBottom: 8 }, row: { flexDirection:"row", justifyContent:"center", marginBottom:4 },
  tile:  { borderRadius:9, margin:2, alignItems:"center", justifyContent:"center", position:"relative" },
  tokenRow: { position:"absolute", bottom:3, flexDirection:"row", flexWrap:"wrap", justifyContent:"center" },
  token: { margin:1, borderWidth:1, borderColor:"rgba(255,255,255,0.3)" },
});

// ─── Main Component ────────────────────────────────────────────────────────────
export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor="#00c781", playerUid, isHost, gameId } = route.params;

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

  const [correctCount, setCorrectCount] = useState(0); // cumulative toward roll
  const [streak,       setStreak]       = useState(0); // consecutive (luck bonuses)
  const [luck,         setLuck]         = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0); // ever-growing, for mystery trigger
  const ROLL_AT = 3;

  // Phase
  const [phase,        setPhase]        = useState("questions");
  const [diceValue,    setDiceValue]    = useState(null);
  const [diceRolling,  setDiceRolling]  = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  // Lava / Cannon space roll
  const [spaceRollType,    setSpaceRollType]    = useState(null);
  const [spaceRollValue,   setSpaceRollValue]   = useState(null);
  const [spaceRollRolling, setSpaceRollRolling] = useState(false);
  const spaceRollDiceAnim = useRef(new Animated.Value(0)).current;

  // Trap
  const [spaceEvent,   setSpaceEvent]   = useState(null);
  const [trapTimer,    setTrapTimer]    = useState(10);
  const [trapAnswered, setTrapAnswered] = useState(false);
  const trapRef = useRef(null);

  // Mystery box state
  const [mysteryPhase,    setMysteryPhase]    = useState("idle"); // idle|roll|target|duel|done
  const [mysteryRoll,     setMysteryRoll]     = useState(null);
  const [mysteryRolling,  setMysteryRolling]  = useState(false);
  const [mysteryDef,      setMysteryDef]      = useState(null);
  const [mysteryTarget,   setMysteryTarget]   = useState(null); // chosen player
  const mysteryDiceAnim = useRef(new Animated.Value(0)).current;

  // Mystery bonuses active on self
  const [doubleRollsLeft, setDoubleRollsLeft] = useState(0);   // double dice rolls remaining
  const [immunityLeft,    setImmunityLeft]    = useState(0);   // immunity landings remaining
  const immunityTimerRef  = useRef(null);
  const immunityExpiresAt = useRef(0);

  // Bad luck aura on self (written to myState by opponent)
  // read from myState.badLuckExpires (epoch ms)

  // ISO duel
  const [duelState, setDuelState] = useState(null);
  // { opponentName, round:0-2, myScores:[], oppScores:[], question, answered, result }
  const duelTimerRef = useRef(null);

  // Timers
  const [gameTimeLeft,     setGameTimeLeft]     = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(null);
  const gameTimerRef     = useRef(null);
  const questionTimerRef = useRef(null);

  const timerBarAnim = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const [flashData,  setFlashData]  = useState(null);

  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const boardScrollRef = useRef(null);

  const sessionRef = useRef(null);
  const myStateRef = useRef(null);

  // ── Session listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      sessionRef.current = data;
      const me = (data.players||[]).find(p => (playerUid && p.uid===playerUid) || p.name===playerName);
      if (me) { myStateRef.current = me; setMyState(me); }
      setSession(data);
      setLoading(false);
      if (!isHost) {
        if (data.status==="abandoned") { setShowAbandoned(true); return; }
        if ((data.kickedPlayers||[]).includes(playerName)) { setShowKicked(true); return; }
      }
    });
  }, [sessionId, playerName, playerUid, isHost]);

  // ── Load questions ────────────────────────────────────────────────────────
  useEffect(() => {
    if (game) return;
    if (sessionRef.current?.questions?.length) {
      setGame({ questions: sessionRef.current.questions }); return;
    }
    const gid = gameId || sessionRef.current?.gameId;
    if (!gid) return;
    getDoc(doc(db,"games",gid)).then(s => { if (s.exists()) setGame(s.data()); }).catch(console.error);
  }, [session, gameId, game]);

  // ── Pick question ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.questions?.length) return;
    setCurrentQuestion(game.questions[questionIndex % game.questions.length]);
    setSelectedAnswer(null);
    setAnswerFeedback(null);
  }, [questionIndex, game]);

  // ── Auto-show map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (["rolling","moving","space_roll"].includes(phase)) setViewMode("map");
    if (["questions","mystery"].includes(phase))           setViewMode("questions");
  }, [phase]);

  // ── Game countdown timer ──────────────────────────────────────────────────
  useEffect(() => {
    const endsAt = session?.gameEndsAt;
    if (!endsAt) return;
    clearInterval(gameTimerRef.current);
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setGameTimeLeft(rem);
      if (rem <= 0) {
        clearInterval(gameTimerRef.current);
        if (isHost) updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);
      }
    };
    tick();
    gameTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(gameTimerRef.current);
  }, [session?.gameEndsAt, isHost, sessionId]);

  // ── Question timer bar ────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(questionTimerRef.current);
    timerBarAnim.stopAnimation();
    const timeLimit = session?.settings?.timePerQuestion;
    if (!timeLimit || phase !== "questions") { setQuestionTimeLeft(null); timerBarAnim.setValue(1); return; }
    timerBarAnim.setValue(1);
    Animated.timing(timerBarAnim, { toValue:0, duration:timeLimit*1000, useNativeDriver:false }).start();
    setQuestionTimeLeft(timeLimit);
    questionTimerRef.current = setInterval(() => {
      setQuestionTimeLeft(t => {
        if (t===null) return null;
        if (t<=1) {
          clearInterval(questionTimerRef.current);
          triggerFlash(false, getCorrectAnswerText(currentQuestion));
          setAnswerFeedback("wrong"); setStreak(0); setLuck(0);
          setTimeout(() => setQuestionIndex(i => i+1), 1400);
          return 0;
        }
        return t-1;
      });
    }, 1000);
    return () => clearInterval(questionTimerRef.current);
  }, [questionIndex, phase, session?.settings?.timePerQuestion]);

  // ── Flash ─────────────────────────────────────────────────────────────────
  const triggerFlash = useCallback((isCorrect, txt) => {
    setFlashData({ isCorrect, correctAnswerText: txt });
    flashOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(900),
      Animated.timing(flashOpacity, { toValue:0, duration:500, useNativeDriver:false }),
    ]).start(() => setFlashData(null));
  }, []);

  // ── Scroll board ──────────────────────────────────────────────────────────
  const scrollToPos = useCallback((pos, boardEnd) => {
    if (!boardScrollRef.current) return;
    const rowIdx    = Math.floor(pos / BOARD_COLS);
    const totalRows = Math.ceil((boardEnd+1) / BOARD_COLS);
    const vRow      = totalRows - 1 - rowIdx;
    boardScrollRef.current.scrollTo({ y: Math.max(0, vRow*(BASE_TILE+6)-50), animated:true });
  }, []);

  const exitMoving = () => { setPhase("questions"); setDiceValue(null); setQuestionIndex(i=>i+1); };

  // ── Open mystery box ──────────────────────────────────────────────────────
  const openMysteryBox = useCallback(() => {
    setMysteryRoll(null);
    setMysteryDef(null);
    setMysteryTarget(null);
    setMysteryRolling(false);
    setMysteryPhase("roll");
    setPhase("mystery");
  }, []);

  const handleMysteryRoll = useCallback(async () => {
    if (mysteryRolling) return;
    setMysteryRolling(true);
    Animated.sequence([
      Animated.timing(mysteryDiceAnim,{toValue:12, duration:80,useNativeDriver:false}),
      Animated.timing(mysteryDiceAnim,{toValue:-12,duration:80,useNativeDriver:false}),
      Animated.timing(mysteryDiceAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(mysteryDiceAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    const roll = Math.floor(Math.random()*6)+1;
    const def  = MYSTERY_DEFS[roll];
    setMysteryRoll(roll);
    setMysteryDef(def);
    setMysteryRolling(false);
    // If no target needed, go straight to apply
    if (!def.needsTarget) {
      setMysteryPhase("apply");
    } else {
      setMysteryPhase("target");
    }
  }, [mysteryRolling]);

  const applyMysteryToTarget = useCallback(async (target) => {
    const sess = sessionRef.current;
    const me   = myStateRef.current;
    if (!sess||!me) { setMysteryPhase("idle"); setPhase("questions"); return; }
    const boardEnd = sess.settings?.boardSize || 25;

    switch (mysteryRoll) {
      case 1: { // Push Back — target -3
        const newPos = Math.max(0, (target.position||0) - 3);
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, position:newPos} : p);
        await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
        break;
      }
      case 2: { // Iso Ult — start duel
        setDuelState({
          opponentName: target.name,
          round: 0, myScores: [], oppScores: [],
          question: null, answered: false, result: null,
        });
        setMysteryPhase("idle");
        setPhase("duel");
        return;
      }
      case 3: { // Stun target
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, stunned:true} : p);
        await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
        break;
      }
      case 6: { // Bad Luck Aura — -30% luck for 45s
        const expires = Date.now() + 45000;
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, badLuckExpires:expires} : p);
        await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
        break;
      }
    }
    finishMystery();
  }, [mysteryRoll, sessionId]);

  const applyMysteryNoTarget = useCallback(async () => {
    switch (mysteryRoll) {
      case 4: { // Immunity — 2 landings or 45s
        setImmunityLeft(2);
        immunityExpiresAt.current = Date.now() + 45000;
        clearTimeout(immunityTimerRef.current);
        immunityTimerRef.current = setTimeout(() => setImmunityLeft(0), 45000);
        break;
      }
      case 5: { // Double Roll ×2
        setDoubleRollsLeft(2);
        break;
      }
    }
    finishMystery();
  }, [mysteryRoll]);

  const finishMystery = () => {
    setMysteryPhase("idle");
    setMysteryRoll(null);
    setMysteryDef(null);
    setMysteryTarget(null);
    setPhase("questions");
    setDiceValue(null);
    setQuestionIndex(i => i+1);
  };

  // ── ISO Duel ──────────────────────────────────────────────────────────────
  const advanceDuel = useCallback(() => {
    const questions = sessionRef.current?.questions || game?.questions || [];
    if (!questions.length) return;
    const q = questions[Math.floor(Math.random()*questions.length)];
    setDuelState(prev => ({ ...prev, question:q, answered:false }));
  }, [game]);

  useEffect(() => {
    if (phase === "duel" && duelState && !duelState.question && duelState.result === null) {
      advanceDuel();
    }
  }, [phase, duelState]);

  const handleDuelAnswer = useCallback(async (ansIdx) => {
    if (!duelState || duelState.answered) return;
    const q       = duelState.question;
    const correct = q?.correctAnswers?.[ansIdx] === true;
    setDuelState(prev => {
      const newMyScores = [...prev.myScores, correct ? 1 : 0];
      const newRound    = prev.round + 1;
      if (newRound >= 3) {
        // Duel over
        const myTotal  = newMyScores.reduce((a,b)=>a+b,0);
        const oppTotal = prev.oppScores.reduce((a,b)=>a+b,0);
        const result   = myTotal > oppTotal ? "win" : myTotal < oppTotal ? "lose" : "tie";
        return { ...prev, answered:true, myScores:newMyScores, round:newRound, result };
      }
      return { ...prev, answered:true, myScores:newMyScores, round:newRound };
    });
  }, [duelState]);

  const finishDuel = useCallback(async () => {
    if (!duelState) return;
    const sess = sessionRef.current;
    const me   = myStateRef.current;
    if (sess && me && duelState.result === "win") {
      // Winner takes loser's position
      const opp    = (sess.players||[]).find(p => p.name===duelState.opponentName);
      if (opp) {
        const myPos  = me.position || 0;
        const oppPos = opp.position || 0;
        const upd    = (sess.players||[]).map(p => {
          if ((playerUid && p.uid===playerUid) || p.name===playerName) return {...p, position:oppPos};
          if (p.name===duelState.opponentName) return {...p, position:myPos};
          return p;
        });
        await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
      }
    }
    setDuelState(null);
    setPhase("questions");
    setQuestionIndex(i => i+1);
  }, [duelState, playerName, playerUid, sessionId]);

  // ── Answer handler ────────────────────────────────────────────────────────
  const handleAnswer = useCallback((ansIdx) => {
    if (selectedAnswer!==null || phase!=="questions") return;
    clearInterval(questionTimerRef.current);
    timerBarAnim.stopAnimation();

    const q       = currentQuestion;
    const correct = q?.correctAnswers?.[ansIdx] === true;
    setSelectedAnswer(ansIdx);
    setAnswerFeedback(correct ? "correct" : "wrong");
    triggerFlash(correct, getCorrectAnswerText(q));

    const stunned = myStateRef.current?.stunned === true;
    if (stunned) {
      if (correct) {
        const ns = streak+1;
        setStreak(ns);
        if (ns>=ROLL_AT) {
          setStreak(0);
          const sess = sessionRef.current;
          if (sess) {
            const upd = (sess.players||[]).map(p =>
              (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,stunned:false} : p
            );
            updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
          }
        }
      } else { setStreak(0); }
      setTimeout(() => setQuestionIndex(i=>i+1), 1400);
      return;
    }

    if (correct) {
      const ns = streak+1, nc = correctCount+1;
      setStreak(ns);
      setLuck(Math.min(40, ns>=2 ? luck+5 : luck));

      // Mystery box every 6 total correct
      setTotalCorrect(prev => {
        const next = prev+1;
        if (next%6===0) {
          setTimeout(() => openMysteryBox(), 1500);
        }
        return next;
      });

      if (nc >= ROLL_AT) {
        setCorrectCount(0);
        setTimeout(() => { setPhase("rolling"); setDiceValue(null); }, 1400);
      } else {
        setCorrectCount(nc);
        setTimeout(() => setQuestionIndex(i=>i+1), 1400);
      }
    } else {
      setStreak(0); setLuck(0);
      setTimeout(() => setQuestionIndex(i=>i+1), 1400);
    }
  }, [selectedAnswer, phase, currentQuestion, correctCount, streak, luck,
      playerName, playerUid, sessionId, triggerFlash, openMysteryBox]);

  // ── Dice roll ─────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);
    Animated.sequence([
      Animated.timing(diceAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r=>setTimeout(r,500));

    let roll = Math.floor(Math.random()*6)+1;

    // Double Roll mystery bonus: sum 2 dice
    if (doubleRollsLeft > 0) {
      roll = roll + (Math.floor(Math.random()*6)+1);
      setDoubleRollsLeft(n => n-1);
    } else if (luck > 0) {
      const r2 = Math.floor(Math.random()*6)+1;
      if (luck>=20) roll = Math.max(roll,r2);
    }
    if (streak>=8) roll = Math.min(12, roll+1);

    setDiceValue(roll);
    setDiceRolling(false);

    // Rolling a 1 triggers mystery box (only when not using double roll bonus)
    if (roll===1 && doubleRollsLeft===0) {
      setTimeout(() => openMysteryBox(), 800);
      return;
    }

    setTimeout(() => movePlayer(roll), 800);
  }, [diceRolling, luck, streak, doubleRollsLeft, openMysteryBox]);

  // ── Space dice roll ───────────────────────────────────────────────────────
  const handleSpaceRoll = useCallback(async () => {
    if (spaceRollRolling) return;
    setSpaceRollRolling(true);
    Animated.sequence([
      Animated.timing(spaceRollDiceAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(spaceRollDiceAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(spaceRollDiceAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(spaceRollDiceAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r=>setTimeout(r,500));
    const roll = Math.floor(Math.random()*6)+1;
    setSpaceRollValue(roll);
    setSpaceRollRolling(false);
    setTimeout(() => applySpaceRoll(spaceRollType, roll), 800);
  }, [spaceRollRolling, spaceRollType]);

  const applySpaceRoll = useCallback(async (type, roll) => {
    const me=myStateRef.current, sess=sessionRef.current;
    if (!me||!sess) { setSpaceRollType(null); exitMoving(); return; }
    const boardEnd = sess.settings?.boardSize||25, cur = me.position||0;
    const newPos   = type==="lava" ? Math.max(0,cur-roll) : Math.min(boardEnd,cur+roll);
    setPhase("moving");
    const step = type==="lava" ? -1 : 1;
    for (let p=cur; step>0?p<=newPos:p>=newPos; p+=step) { setHighlightPos(p); scrollToPos(p,boardEnd); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(newPos);
    try {
      const upd = (sessionRef.current?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:newPos,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId),{players:upd});
      if (newPos>=boardEnd) { await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName}); return; }
    } catch(e){ console.error(e); }
    setSpaceRollType(null); setSpaceRollValue(null);
    exitMoving();
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  // ── Move player ───────────────────────────────────────────────────────────
  const movePlayer = useCallback(async (spaces) => {
    const me=myStateRef.current, sess=sessionRef.current;
    if (!me||!sess) { setPhase("questions"); setDiceValue(null); return; }
    const boardEnd=sess.settings?.boardSize||25, oldPos=me.position||0, newPos=Math.min(oldPos+spaces,boardEnd);
    setPhase("moving");
    for (let cur=oldPos;cur<=newPos;cur++) { setHighlightPos(cur); scrollToPos(cur,boardEnd); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(newPos);
    try {
      const latest = sessionRef.current;
      const upd = (latest?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:newPos,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId),{players:upd});
      if (newPos>=boardEnd) { await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName}); return; }
      const landingSpace = (() => {
        const b=latest?.board||[]; const d=b[newPos]; if(d?.type) return d;
        return (Array.isArray(b)&&b.find(s=>s?.index===newPos))||null;
      })();
      handleLanding(landingSpace, newPos, boardEnd, latest?.questions||[]);
    } catch(e) { console.error("movePlayer:",e); exitMoving(); }
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  // ── Space landing ─────────────────────────────────────────────────────────
  const handleLanding = (space, pos, boardEnd, questions) => {
    const type = space?.type||"normal";

    // Check immunity
    if (immunityLeft>0 && (type==="lava"||type==="trap"||type==="cannon")) {
      setImmunityLeft(n => Math.max(0,n-1));
      exitMoving(); return;
    }
    if (immunityLeft>0 && type!=="normal") {
      setImmunityLeft(n => Math.max(0,n-1));
    }

    if (type==="normal") { exitMoving(); return; }
    if (type==="mystery") { openMysteryBox(); return; }
    if (type==="lava"||type==="cannon") { setSpaceRollType(type); setSpaceRollValue(null); setSpaceRollRolling(false); setPhase("space_roll"); return; }
    if (type==="trap") {
      const pool = questions?.length ? questions : [];
      if (pool.length) {
        const trapQ = pool[Math.floor(Math.random()*pool.length)];
        setSpaceEvent({type:"trap",question:trapQ}); setTrapTimer(10); setTrapAnswered(false); setPhase("space_event");
        clearInterval(trapRef.current);
        trapRef.current = setInterval(() => {
          setTrapTimer(t => { if(t<=1){ clearInterval(trapRef.current); handleTrapFail(); return 0; } return t-1; });
        },1000);
      } else { exitMoving(); }
      return;
    }
    exitMoving();
  };

  const handleTrapFail = async () => {
    clearInterval(trapRef.current);
    const sess = sessionRef.current;
    if (sess) {
      const upd = (sess.players||[]).map(p => (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,stunned:true}:p);
      await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
    }
    setSpaceEvent(null); setPhase("questions"); setDiceValue(null);
  };

  const resolveEvent = async (opts={}) => {
    clearInterval(trapRef.current);
    const sess=sessionRef.current;
    if (!sess) { setSpaceEvent(null); exitMoving(); return; }
    const stun = spaceEvent?.type==="trap" && !opts.correct;
    const upd = (sess.players||[]).map(p =>
      (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,stunned:stun}:p
    );
    await updateDoc(doc(db,"gameSessions",sessionId),{players:upd}).catch(console.error);
    setSpaceEvent(null); exitMoving();
  };

  // ── Leave / exit ──────────────────────────────────────────────────────────
  const handleLeave = async () => {
    setShowLeave(false);
    if (!isHost) {
      try {
        const sess=sessionRef.current;
        if (sess) {
          const upd=(sess.players||[]).filter(p=>!(playerUid&&p.uid===playerUid)&&p.name!==playerName);
          await updateDoc(doc(db,"gameSessions",sessionId),{players:upd});
        }
      } catch(e){ console.error(e); }
    }
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0,routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  const exitGame = () => {
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0,routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={{color:"#fff",marginTop:16,fontSize:18}}>Loading game…</Text>
    </SafeAreaView>
  );

  const board    = session?.board    || [];
  const players  = session?.players  || [];
  const boardEnd = session?.settings?.boardSize || 25;
  const myPos    = myState?.position || 0;
  const stunned  = myState?.stunned  === true;
  const showCorrectAnswer = session?.settings?.showAnswersAfter !== false;

  // Bad luck aura check (written to Firestore by opponent)
  const badLuckActive  = myState?.badLuckExpires && myState.badLuckExpires > Date.now();
  const effectiveLuck  = badLuckActive ? Math.max(0, luck - 30) : luck;
  const hasImmunity    = immunityLeft > 0;

  const otherPlayers = players.filter(p =>
    !((playerUid && p.uid===playerUid) || p.name===playerName)
  );

  // ══ HOST VIEW ═════════════════════════════════════════════════════════════
  if (isHost) {
    const sorted = [...players].sort((a,b) => (b.position||0)-(a.position||0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>Brain Board — Host</Text>
          <View style={{flexDirection:"row",gap:12,alignItems:"center"}}>
            {gameTimeLeft!=null && <Text style={[S.timerTxt,gameTimeLeft<=30&&{color:"#e74c3c"}]}>{formatTime(gameTimeLeft)}</Text>}
            <TouchableOpacity style={S.endBtn} onPress={async()=>{ await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error); exitGame(); }}>
              <Text style={S.endBtnTxt}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={S.hostBody}>
          <ScrollView ref={boardScrollRef} style={{flex:1}} contentContainerStyle={{padding:12}}>
            <SnakeBoard board={board} players={players} myPosition={-1} highlightPos={null} boardEnd={boardEnd} tileSize={HOST_TILE}/>
            <Legend />
          </ScrollView>
          <View style={S.hostSide}>
            <Text style={S.lbTitle}>Leaderboard</Text>
            {sorted.slice(0,10).map((p,i)=>(
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>#{i+1}</Text>
                <View style={[S.lbDot,{backgroundColor:p.color||"#888"}]}/>
                <Text style={S.lbName} numberOfLines={1}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position||0}/{boardEnd}</Text>
                {p.stunned && <Text style={[S.lbPos,{color:"#e74c3c"}]}>stunned</Text>}
              </View>
            ))}
          </View>
        </View>
        {session?.status==="ended"&&!gameOverDismissed&&(
          <GameOverModal session={session} myPos={-1} boardEnd={boardEnd} onExit={()=>{setGameOverDismissed(true);exitGame();}}/>
        )}
      </SafeAreaView>
    );
  }

  // ══ PLAYER VIEW ═══════════════════════════════════════════════════════════
  const showMap = viewMode==="map";

  return (
    <SafeAreaView style={S.container}>

      {/* HUD */}
      <View style={S.hud}>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>STREAK</Text>
          <Text style={[S.hudVal,streak>0&&{color:"#f39c12"}]}>{streak>0?`🔥 ${streak}`:streak}</Text>
        </View>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>LUCK</Text>
          <Text style={[S.hudVal,badLuckActive&&{color:"#e74c3c"}]}>{effectiveLuck}%</Text>
        </View>
        <View style={S.hudCell}>
          <Text style={S.hudLbl}>SPACE</Text>
          <Text style={[S.hudVal,{color:playerColor}]}>{myPos}/{boardEnd}</Text>
        </View>
        {hasImmunity && <View style={S.hudCell}><Text style={S.hudLbl}>SHIELD</Text><Text style={[S.hudVal,{color:"#2ecc71"}]}>🛡️{immunityLeft}</Text></View>}
        {doubleRollsLeft>0 && <View style={S.hudCell}><Text style={S.hudLbl}>2×ROLL</Text><Text style={[S.hudVal,{color:"#9b59b6"}]}>×{doubleRollsLeft}</Text></View>}
        {gameTimeLeft!=null && <View style={S.hudCell}><Text style={S.hudLbl}>TIME</Text><Text style={[S.hudVal,gameTimeLeft<=30&&{color:"#e74c3c"}]}>{formatTime(gameTimeLeft)}</Text></View>}
        <TouchableOpacity style={[S.mapBtn,showMap&&S.mapBtnOn]} onPress={()=>setViewMode(v=>v==="map"?"questions":"map")}>
          <Text style={S.mapBtnTxt}>Map</Text>
        </TouchableOpacity>
      </View>

      {/* Timer bar */}
      {!!(session?.settings?.timePerQuestion) && phase==="questions" && !showMap && (
        <View style={S.timerBarTrack}>
          <Animated.View style={[S.timerBarFill,{width:timerBarAnim.interpolate({inputRange:[0,1],outputRange:["0%","100%"]})}]}/>
        </View>
      )}

      <View style={S.main}>

        {/* MAP */}
        {showMap && (
          <ScrollView ref={boardScrollRef} contentContainerStyle={{padding:10}}>
            <SnakeBoard board={board} players={players} myPosition={myPos} highlightPos={highlightPos} boardEnd={boardEnd} tileSize={BASE_TILE}/>
            <Legend />
          </ScrollView>
        )}

        {/* QUESTIONS */}
        {!showMap && phase==="questions" && (
          <ScrollView contentContainerStyle={S.qScroll}>
            {stunned && <View style={S.stunnedBanner}><Text style={S.stunnedTxt}>STUNNED — answer {ROLL_AT} in a row to recover ({streak}/{ROLL_AT})</Text></View>}
            {!stunned && (
              <View style={S.rollProgressBar}>
                {[0,1,2].map(i=><View key={i} style={[S.rollDot,i<correctCount&&S.rollDotOn]}/>)}
                <Text style={S.rollProgressTxt}>{ROLL_AT-correctCount} more correct to roll</Text>
              </View>
            )}
            {currentQuestion ? (
              <View style={S.qCard}>
                <Text style={S.qTxt}>{currentQuestion.question}</Text>
                <View style={S.aGrid}>
                  {(currentQuestion.type==="multipleChoice" ? currentQuestion.answers : ["True","False"]).map((ans,i)=>{
                    const isSel=selectedAnswer===i, isCorr=currentQuestion.correctAnswers?.[i]===true;
                    let bg="#1c1c1c",bc="#383838";
                    if (isSel){ bg=answerFeedback==="correct"?"#003d1a":"#3d0000"; bc=answerFeedback==="correct"?"#00c781":"#e74c3c"; }
                    else if (selectedAnswer!==null&&isCorr&&showCorrectAnswer){ bg="#003d1a"; bc="#00c781"; }
                    return (
                      <TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:bg,borderColor:bc}]} onPress={()=>handleAnswer(i)} disabled={selectedAnswer!==null} activeOpacity={0.75}>
                        <Text style={S.aTxt}>{ans}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : <View style={S.waitBox}><ActivityIndicator color="#00c781"/><Text style={S.waitTxt}>Loading…</Text></View>}
          </ScrollView>
        )}

        {/* ROLLING */}
        {phase==="rolling" && (
          <View style={S.diceBox}>
            <Text style={S.diceTtl}>Roll the Dice!</Text>
            {doubleRollsLeft>0 && <Text style={[S.luckTxt,{color:"#9b59b6"}]}>🎯 Double Roll active — 2 dice summed!</Text>}
            {effectiveLuck>0 && doubleRollsLeft===0 && <Text style={S.luckTxt}>🍀 Luck {effectiveLuck}%</Text>}
            <Animated.Text style={[S.diceFace,{transform:[{translateX:diceAnim}]}]}>{diceValue?getDiceFace(Math.min(6,diceValue)):"?"}</Animated.Text>
            {diceValue ? <Text style={S.diceRes}>Rolled {diceValue}!</Text>
            : <TouchableOpacity style={S.rollBtn} onPress={handleRoll}><Text style={S.rollTxt}>Roll!</Text></TouchableOpacity>}
          </View>
        )}

        {/* SPACE ROLL */}
        {phase==="space_roll" && spaceRollType && (
          <View style={S.diceBox}>
            <Text style={[S.diceTtl,{color:spaceRollType==="lava"?"#e74c3c":"#3498db",fontSize:28}]}>
              {spaceRollType==="lava"?"🌋 Lava Space!":"💥 Cannon Space!"}
            </Text>
            <Text style={S.luckTxt}>{spaceRollType==="lava"?"Roll to see how far you're pushed BACK":"Roll to see how far you're LAUNCHED forward"}</Text>
            <Animated.Text style={[S.diceFace,{transform:[{translateX:spaceRollDiceAnim}]}]}>{spaceRollValue?getDiceFace(spaceRollValue):"?"}</Animated.Text>
            {spaceRollValue
              ? <Text style={[S.diceRes,{color:spaceRollType==="lava"?"#e74c3c":"#3498db"}]}>{spaceRollType==="lava"?`Back ${spaceRollValue} spaces!`:`Forward ${spaceRollValue} spaces!`}</Text>
              : <TouchableOpacity style={[S.rollBtn,{backgroundColor:spaceRollType==="lava"?"#c0392b":"#2980b9"}]} onPress={handleSpaceRoll} disabled={spaceRollRolling}><Text style={S.rollTxt}>{spaceRollRolling?"Rolling…":"Roll!"}</Text></TouchableOpacity>}
          </View>
        )}

        {/* MOVING */}
        {phase==="moving" && <View style={S.movingBox}><ActivityIndicator color="#00c781" size="large"/><Text style={S.movingTxt}>Moving…</Text></View>}

        {/* MYSTERY BOX */}
        {phase==="mystery" && (
          <ScrollView contentContainerStyle={S.mysteryScroll}>
            <Text style={S.mysteryBigTtl}>🎁 Mystery Box!</Text>

            {/* Step 1: Roll */}
            {mysteryPhase==="roll" && (
              <>
                <Text style={S.luckTxt}>Roll to reveal your effect…</Text>
                <Animated.Text style={[S.diceFace,{transform:[{translateX:mysteryDiceAnim}]}]}>{mysteryRoll?getDiceFace(mysteryRoll):"?"}</Animated.Text>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#8e44ad"}]} onPress={handleMysteryRoll} disabled={mysteryRolling}>
                  <Text style={S.rollTxt}>{mysteryRolling?"Rolling…":"Open Box!"}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Step 2a: Apply (no target needed) */}
            {mysteryPhase==="apply" && mysteryDef && (
              <View style={[S.mysteryCard,{borderColor:mysteryDef.color}]}>
                <Text style={S.mysteryEmoji}>{mysteryDef.emoji}</Text>
                <Text style={[S.mysteryTitle,{color:mysteryDef.color}]}>{mysteryDef.title}</Text>
                <Text style={S.mysteryDesc}>{mysteryDef.desc}</Text>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:mysteryDef.color,marginTop:12}]} onPress={applyMysteryNoTarget}>
                  <Text style={S.rollTxt}>Claim!</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2b: Choose target */}
            {mysteryPhase==="target" && mysteryDef && (
              <>
                <View style={[S.mysteryCard,{borderColor:mysteryDef.color}]}>
                  <Text style={S.mysteryEmoji}>{mysteryDef.emoji}</Text>
                  <Text style={[S.mysteryTitle,{color:mysteryDef.color}]}>{mysteryDef.title}</Text>
                  <Text style={S.mysteryDesc}>{mysteryDef.desc}</Text>
                </View>
                <Text style={[S.luckTxt,{marginTop:16,fontSize:15}]}>Choose a player:</Text>
                {otherPlayers.length===0 ? (
                  <Text style={[S.mysteryDesc,{marginTop:8}]}>No other players — effect skipped.</Text>
                ) : null}
                {otherPlayers.map(p => (
                  <TouchableOpacity key={p.name} style={[S.targetBtn,{borderColor:p.color||"#888"}]} onPress={()=>applyMysteryToTarget(p)}>
                    <View style={[S.lbDot,{backgroundColor:p.color||"#888",marginRight:10}]}/>
                    <Text style={[S.targetName,{color:p.color||"#fff"}]}>{p.name}</Text>
                    <Text style={S.targetPos}>Space {p.position||0}</Text>
                  </TouchableOpacity>
                ))}
                {otherPlayers.length===0 && (
                  <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#555",marginTop:12}]} onPress={finishMystery}>
                    <Text style={S.rollTxt}>Skip</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        )}

        {/* ISO DUEL */}
        {phase==="duel" && duelState && (
          <ScrollView contentContainerStyle={S.mysteryScroll}>
            <Text style={[S.mysteryBigTtl,{color:"#3498db"}]}>⚔️ ISO Duel!</Text>
            <Text style={[S.luckTxt,{fontSize:14}]}>vs <Text style={{color:"#fff",fontWeight:"bold"}}>{duelState.opponentName}</Text></Text>
            <Text style={[S.luckTxt,{fontSize:13,marginBottom:12}]}>Round {Math.min(duelState.round+1,3)} of 3  •  You {duelState.myScores.reduce((a,b)=>a+b,0)} – {duelState.oppScores.reduce((a,b)=>a+b,0)} Opponent</Text>

            {duelState.result!==null ? (
              <View style={S.mysteryCard}>
                <Text style={S.mysteryEmoji}>{duelState.result==="win"?"🏆":duelState.result==="lose"?"💀":"🤝"}</Text>
                <Text style={[S.mysteryTitle,{color:duelState.result==="win"?"#2ecc71":duelState.result==="lose"?"#e74c3c":"#aaa"}]}>
                  {duelState.result==="win"?"You Win!":duelState.result==="lose"?"You Lose!":"Tie!"}
                </Text>
                <Text style={S.mysteryDesc}>
                  {duelState.result==="win"?"You swap positions with your opponent!":duelState.result==="lose"?"Your opponent takes your spot!":"No position swap."}
                </Text>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12}]} onPress={finishDuel}>
                  <Text style={S.rollTxt}>Continue</Text>
                </TouchableOpacity>
              </View>
            ) : duelState.question ? (
              <View style={S.qCard}>
                <Text style={[S.qTxt,{fontSize:22}]}>{duelState.question.question}</Text>
                <View style={S.aGrid}>
                  {(duelState.question.type==="multipleChoice"?duelState.question.answers:["True","False"]).map((ans,i)=>(
                    <TouchableOpacity key={i}
                      style={[S.aBtn,{backgroundColor:duelState.answered?(duelState.question.correctAnswers?.[i]===true?"#003d1a":"#3d0000"):"#1c1c1c",borderColor:duelState.answered?(duelState.question.correctAnswers?.[i]===true?"#00c781":"#e74c3c"):"#383838"}]}
                      onPress={()=>handleDuelAnswer(i)} disabled={duelState.answered} activeOpacity={0.75}>
                      <Text style={S.aTxt}>{ans}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {duelState.answered && duelState.round<3 && (
                  <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12}]} onPress={advanceDuel}>
                    <Text style={S.rollTxt}>Next Round →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : <View style={S.waitBox}><ActivityIndicator color="#3498db"/></View>}
          </ScrollView>
        )}

      </View>

      {/* Full-screen flash */}
      {flashData && (
        <Animated.View style={[S.flashOverlay,{backgroundColor:flashData.isCorrect?"#27ae60":"#c0392b",opacity:flashOpacity}]}>
          <Text style={S.flashTtl}>{flashData.isCorrect?"CORRECT":"INCORRECT"}</Text>
          {!flashData.isCorrect&&showCorrectAnswer&&flashData.correctAnswerText?(
            <><Text style={S.flashSubLbl}>Correct answer</Text><Text style={S.flashSubTxt}>"{flashData.correctAnswerText}"</Text></>
          ):null}
        </Animated.View>
      )}

      {/* Trap modal */}
      <Modal visible={phase==="space_event"&&spaceEvent?.type==="trap"} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={[S.mTtl,{color:"#d68910"}]}>Trap — Answer Fast!</Text>
          <Text style={[S.trapSecs,trapTimer<=3&&{color:"#e74c3c"}]}>{trapTimer}s</Text>
          {spaceEvent?.question&&(<>
            <Text style={S.mDesc}>{spaceEvent.question.question}</Text>
            <View style={S.aGrid}>
              {(spaceEvent.question.type==="multipleChoice"?spaceEvent.question.answers:["True","False"]).map((ans,i)=>(
                <TouchableOpacity key={i} style={[S.aBtn,{borderColor:"#555"}]} disabled={trapAnswered}
                  onPress={()=>{clearInterval(trapRef.current);setTrapAnswered(true);resolveEvent({correct:spaceEvent.question.correctAnswers?.[i]===true});}}>
                  <Text style={S.aTxt}>{ans}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>)}
        </View></View>
      </Modal>

      {/* Game over */}
      {session?.status==="ended"&&!gameOverDismissed&&(
        <GameOverModal session={session} myPos={myPos} boardEnd={boardEnd} onExit={()=>{setGameOverDismissed(true);exitGame();}}/>
      )}

      {/* Kicked */}
      <Modal visible={showKicked} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>You've Been Kicked</Text>
          <Text style={S.mDesc}>The host has removed you.</Text>
          <TouchableOpacity style={[S.mBtn,{backgroundColor:"#00c781"}]} onPress={()=>{setShowKicked(false);navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]});}}>
            <Text style={S.mBtnTxt}>Back to Menu</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Abandoned */}
      <Modal visible={showAbandoned} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>Game Ended</Text>
          <Text style={S.mDesc}>The host has ended the game.</Text>
          <TouchableOpacity style={[S.mBtn,{backgroundColor:"#00c781"}]} onPress={()=>{setShowAbandoned(false);navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]});}}>
            <Text style={S.mBtnTxt}>Back to Menu</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>

      {/* Leave */}
      <TouchableOpacity style={S.leaveBtn} onPress={()=>setShowLeave(true)}>
        <Text style={S.leaveBtnTxt}>Leave</Text>
      </TouchableOpacity>
      <LeaveModal visible={showLeave} isHost={false} onStay={()=>setShowLeave(false)} onLeave={handleLeave}/>

    </SafeAreaView>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <View style={S.legend}>
      {Object.entries(SPACE_CFG).map(([type,cfg])=>(
        <View key={type} style={S.legendItem}>
          <View style={[S.legendSwatch,{backgroundColor:cfg.bg,borderColor:cfg.border}]}/>
          <Text style={[S.legendTxt,{color:cfg.border}]}>{type.charAt(0).toUpperCase()+type.slice(1)}</Text>
        </View>
      ))}
    </View>
  );
}

function LeaveModal({visible,isHost,onStay,onLeave}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>{isHost?"End Game?":"Leave Game?"}</Text>
        <Text style={S.mDesc}>{isHost?"This will end the game for all players.":"Are you sure you want to leave?"}</Text>
        <View style={{flexDirection:"row",gap:12,width:"100%"}}>
          <TouchableOpacity style={[S.mBtn,{flex:1,backgroundColor:"#2a2a2a"}]} onPress={onStay}><Text style={S.mBtnTxt}>Stay</Text></TouchableOpacity>
          <TouchableOpacity style={[S.mBtn,{flex:1,backgroundColor:"#c0392b"}]} onPress={onLeave}><Text style={S.mBtnTxt}>Leave</Text></TouchableOpacity>
        </View>
      </View></View>
    </Modal>
  );
}

function GameOverModal({session,myPos,boardEnd,onExit}) {
  const sorted = [...(session?.players||[])].sort((a,b)=>(b.position||0)-(a.position||0));
  const winner = sorted[0];
  return (
    <Modal visible transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>Game Over!</Text>
        {winner&&<Text style={[S.mDesc,{fontSize:20}]}>🏆 <Text style={{color:winner.color||"#00c781",fontWeight:"bold"}}>{winner.name}</Text> wins! Space {winner.position}</Text>}
        {myPos>=0&&<Text style={[S.mDesc,{color:"#666"}]}>You reached space {myPos}/{boardEnd}</Text>}
        <View style={{width:"100%",marginVertical:12}}>
          {sorted.slice(0,10).map((p,i)=>(
            <View key={p.name||i} style={S.lbRow}>
              <Text style={S.lbRank}>#{i+1}</Text>
              <View style={[S.lbDot,{backgroundColor:p.color||"#888"}]}/>
              <Text style={[S.lbName,{flex:1}]}>{p.name}</Text>
              <Text style={S.lbPos}>{p.position||0}/{boardEnd}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[S.mBtn,{backgroundColor:"#00c781"}]} onPress={onExit}><Text style={S.mBtnTxt}>Back to Menu</Text></TouchableOpacity>
      </View></View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  container: { flex:1, backgroundColor:"#111" },
  center:    { flex:1, backgroundColor:"#111", justifyContent:"center", alignItems:"center" },

  hud:     { flexDirection:"row", alignItems:"center", backgroundColor:"#0a0a0a", borderBottomWidth:2, borderBottomColor:"#222", paddingVertical:12, paddingHorizontal:10 },
  hudCell: { flex:1, alignItems:"center" },
  hudLbl:  { color:"#444", fontSize:9, letterSpacing:1.5, fontWeight:"700" },
  hudVal:  { color:"#fff", fontSize:17, fontWeight:"bold", marginTop:2 },
  mapBtn:  { paddingHorizontal:12, paddingVertical:8, borderRadius:10, backgroundColor:"#1a1a1a", borderWidth:1, borderColor:"#333" },
  mapBtnOn:{ backgroundColor:"#002a1a", borderColor:"#00c781" },
  mapBtnTxt: { color:"#aaa", fontSize:12, fontWeight:"700" },

  timerBarTrack: { width:"100%", height:6, backgroundColor:"#1a1a1a" },
  timerBarFill:  { height:6, backgroundColor:"#00c781", alignSelf:"flex-start" },

  main: { flex:1 },

  qScroll:     { flexGrow:1, justifyContent:"center", padding:20, paddingBottom:60 },
  qCard:       { gap:18 },
  stunnedBanner: { backgroundColor:"#280000", borderRadius:12, padding:14, marginBottom:8 },
  stunnedTxt:    { color:"#ff6b6b", fontSize:15, fontWeight:"bold", textAlign:"center" },
  rollProgressBar: { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:8, marginBottom:12 },
  rollDot:         { width:14, height:14, borderRadius:7, backgroundColor:"#2a2a2a", borderWidth:2, borderColor:"#444" },
  rollDotOn:       { backgroundColor:"#00c781", borderColor:"#00c781" },
  rollProgressTxt: { color:"#555", fontSize:12, marginLeft:4 },
  qTxt:    { color:"#fff", fontSize:28, fontWeight:"700", lineHeight:38, textAlign:"center" },
  aGrid:   { gap:12 },
  aBtn:    { borderRadius:14, padding:22, borderWidth:2.5, alignItems:"center" },
  aTxt:    { color:"#fff", fontSize:20, fontWeight:"600" },
  waitBox: { alignItems:"center", paddingVertical:80, gap:14 },
  waitTxt: { color:"#555", fontSize:16 },

  legend:       { flexDirection:"row", flexWrap:"wrap", justifyContent:"center", gap:10, paddingVertical:10 },
  legendItem:   { flexDirection:"row", alignItems:"center", gap:5 },
  legendSwatch: { width:14, height:14, borderRadius:3, borderWidth:1.5 },
  legendTxt:    { fontSize:11, fontWeight:"600" },

  diceBox:  { flex:1, alignItems:"center", justifyContent:"center", gap:18, backgroundColor:"#0d0d0d", padding:24 },
  diceTtl:  { color:"#fff", fontSize:24, fontWeight:"bold", textAlign:"center" },
  luckTxt:  { color:"#888", fontSize:14, textAlign:"center" },
  diceFace: { fontSize:96 },
  diceRes:  { color:"#00c781", fontSize:24, fontWeight:"bold" },
  rollBtn:  { backgroundColor:"#00c781", paddingVertical:20, paddingHorizontal:72, borderRadius:18 },
  rollTxt:  { color:"#000", fontSize:26, fontWeight:"bold" },

  movingBox: { flex:1, alignItems:"center", justifyContent:"center", gap:16, backgroundColor:"#0d0d0d" },
  movingTxt: { color:"#aaa", fontSize:18 },

  mysteryScroll: { flexGrow:1, justifyContent:"flex-start", padding:24, paddingBottom:60, alignItems:"center", gap:16 },
  mysteryBigTtl: { color:"#8e44ad", fontSize:32, fontWeight:"900", textAlign:"center" },
  mysteryCard:   { backgroundColor:"#1a0a2a", borderRadius:20, borderWidth:2, padding:24, alignItems:"center", gap:8, width:"90%", maxWidth:400 },
  mysteryEmoji:  { fontSize:52 },
  mysteryTitle:  { fontSize:26, fontWeight:"bold", textAlign:"center" },
  mysteryDesc:   { color:"#ccc", fontSize:16, textAlign:"center", lineHeight:22 },
  targetBtn:     { flexDirection:"row", alignItems:"center", backgroundColor:"#1a1a1a", borderRadius:14, borderWidth:2, paddingVertical:14, paddingHorizontal:18, width:"90%", maxWidth:400 },
  targetName:    { flex:1, fontSize:18, fontWeight:"600" },
  targetPos:     { color:"#555", fontSize:14 },

  flashOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0, justifyContent:"center", alignItems:"center", zIndex:999 },
  flashTtl:     { color:"#000", fontSize:64, fontWeight:"900", letterSpacing:2, textAlign:"center" },
  flashSubLbl:  { color:"rgba(0,0,0,0.7)", fontSize:20, marginTop:20 },
  flashSubTxt:  { color:"#000", fontSize:26, fontWeight:"bold", textAlign:"center", paddingHorizontal:32 },

  hostHeader: { flexDirection:"row", justifyContent:"space-between", alignItems:"center", padding:18, backgroundColor:"#0a0a0a", borderBottomWidth:1, borderBottomColor:"#222" },
  hostTitle:  { color:"#00c781", fontSize:20, fontWeight:"bold" },
  timerTxt:   { color:"#fff", fontSize:18, fontWeight:"bold" },
  endBtn:     { backgroundColor:"#c0392b", paddingVertical:10, paddingHorizontal:22, borderRadius:12 },
  endBtnTxt:  { color:"#fff", fontWeight:"bold", fontSize:15 },
  hostBody:   { flex:1, flexDirection:"row" },
  hostSide:   { width:260, backgroundColor:"#0a0a0a", padding:16, borderLeftWidth:1, borderLeftColor:"#222" },
  lbTitle:    { color:"#00c781", fontSize:18, fontWeight:"bold", marginBottom:14 },
  lbRow:      { flexDirection:"row", alignItems:"center", paddingVertical:10, borderBottomWidth:1, borderBottomColor:"#1a1a1a" },
  lbRank:     { color:"#fff", width:32, fontSize:15 },
  lbDot:      { width:13, height:13, borderRadius:7, marginRight:10 },
  lbName:     { color:"#fff", fontSize:14, fontWeight:"500" },
  lbPos:      { color:"#aaa", fontSize:13 },

  leaveBtn:    { position:"absolute", bottom:12, left:16, backgroundColor:"#2a0000", paddingVertical:10, paddingHorizontal:20, borderRadius:12 },
  leaveBtnTxt: { color:"#ff6b6b", fontSize:14, fontWeight:"bold" },

  overlay: { flex:1, backgroundColor:"rgba(0,0,0,0.92)", justifyContent:"center", alignItems:"center" },
  modal:   { backgroundColor:"#1a1a1a", borderRadius:22, padding:28, width:"90%", maxWidth:440, alignItems:"center", borderWidth:1, borderColor:"#2a2a2a", gap:12 },
  mTtl:    { color:"#fff", fontSize:24, fontWeight:"bold", textAlign:"center" },
  mDesc:   { color:"#bbb", fontSize:16, textAlign:"center", lineHeight:22 },
  mBtn:    { paddingVertical:16, borderRadius:14, width:"100%", alignItems:"center" },
  mBtnTxt: { color:"#fff", fontSize:18, fontWeight:"bold" },
  trapSecs:{ color:"#fff", fontSize:36, fontWeight:"bold" },
});