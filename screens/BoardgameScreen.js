/**
 * BoardGameScreen.js
 *
 * KEY CHANGES IN THIS VERSION:
 * - "Questions" button always visible — resets everything back to questions
 * - closeMBox() ALWAYS sets phase="questions" so player is never stuck
 * - Inventory holds ONLY mystery_box and deflector (duel is immediate from mystery box)
 * - Every modal/popup has an X close button
 * - Duel starts immediately from mystery box (no inventory step, no accept/pass)
 * - Roll 1 = no movement + mystery_box to inventory + popup with close button
 * - Equal-probability mystery effects via MYSTERY_KEYS array
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Dimensions, ActivityIndicator, SafeAreaView, Modal, Image,
} from "react-native";
import { db, auth } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, runTransaction, getDoc, deleteField } from "firebase/firestore";

const { width: SCREEN_W } = Dimensions.get("window");
const BOARD_COLS = 10;
const BASE_TILE  = Math.min(96, Math.max(44, Math.floor((SCREEN_W - 32) / BOARD_COLS)));
const HOST_TILE  = Math.min(96, Math.max(48, Math.floor((SCREEN_W * 0.65 - 32) / BOARD_COLS)));

const SPACE_CFG = {
  normal:  { bg:"#1a3d1a", border:"#27ae60", label:"" },
  lava:    { bg:"#3d1200", border:"#e74c3c", label:"L" },
  cannon:  { bg:"#00213d", border:"#2980b9", label:"C" },
  trap:    { bg:"#3d2d00", border:"#d68910", label:"T" },
  mystery: { bg:"#2a0a3d", border:"#8e44ad", label:"?" },
};

// All effects. Only mystery_box and deflector go to inventory.
// Duel is needsTarget:true — shows target picker immediately from mystery box.
const MYSTERY_DEFS = {
  pushback:   { emoji:"💥", title:"Push Back",     desc:"Push a player 3 spaces backward.",                color:"#e74c3c", needsTarget:true,  inventoryType:null },
  duel:       { emoji:"⚔️",  title:"1v1 a Player",  desc:"Challenge a player to a 3-question quiz duel.",   color:"#3498db", needsTarget:true,  inventoryType:null },
  stun:       { emoji:"😵", title:"Stun",           desc:"A player must answer 3 in a row to recover.",     color:"#e67e22", needsTarget:true,  inventoryType:null },
  immunity:   { emoji:"🛡️",  title:"Immunity",      desc:"Protected from effects & bad tiles for 2 landings or 45 s.", color:"#2ecc71", needsTarget:false, inventoryType:null },
  doubleroll: { emoji:"🎲", title:"Double Roll",    desc:"Your next 2 rolls each sum 2 dice.",               color:"#9b59b6", needsTarget:false, inventoryType:null },
  deflector:  { emoji:"🪞", title:"Deflector",      desc:"Saved to inventory! Reflects next incoming effect back for 30 s.", color:"#00bcd4", needsTarget:false, inventoryType:"deflector" },
  badluck:    { emoji:"🌑", title:"Bad Luck Aura",  desc:"A player loses 30% Luck for 45 seconds.",         color:"#7f8c8d", needsTarget:true,  inventoryType:null },
};
const MYSTERY_KEYS = Object.keys(MYSTERY_DEFS); // equal-chance roll across all keys

// INVENTORY: only mystery_box and deflector can be stored
const INVENTORY_DEFS = {
  mystery_box: { emoji:"🎁", label:"Mystery Box", desc:"Open for a random effect" },
  deflector:   { emoji:"🪞", label:"Deflector",   desc:"Reflect next effect (30 s)" },
};

const DICE_EMOJI = ["⚀","⚁","⚂","⚃","⚄","⚅"];
const getDiceFace = (n) => DICE_EMOJI[Math.min(5, Math.max(0, n - 1))] || "?";
const formatTime  = (s) => s == null ? "--:--" : `${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;

function getCorrectText(q) {
  if (!q) return "";
  if (q.type === "multiSelect") {
    const corrects = (q.correctAnswers||[]).map((v,i) => v ? q.answers?.[i] : null).filter(Boolean);
    return corrects.length ? corrects.join(", ") : "";
  }
  if (q.type === "multipleChoice") {
    const i = (q.correctAnswers||[]).indexOf(true);
    return i >= 0 ? (q.answers?.[i] || "") : "";
  }
  return q.correctAnswers?.[0] === true ? "True" : "False";
}

function buildSnakeRows(be) {
  const rows = [];
  for (let r = 0; r <= be; r += BOARD_COLS) {
    const row = [];
    for (let s = r; s < r + BOARD_COLS && s <= be; s++) row.push(s);
    if (Math.floor(r / BOARD_COLS) % 2 === 1) row.reverse();
    rows.push(row);
  }
  return rows.reverse();
}

function SnakeBoard({ board, players, myPosition, highlightPos, boardEnd, tileSize }) {
  const sz = tileSize || BASE_TILE;
  const rows = buildSnakeRows(boardEnd);
  const playersAt = (i) => players.filter(p => (p.position||0) === i);
  const spaceType = (i) => {
    if (i === 0 || i === boardEnd) return "normal";
    const d = board[i]; if (d?.type) return d.type;
    return (Array.isArray(board) && board.find(s => s?.index === i))?.type || "normal";
  };
  const tileStyle = (i) => {
    const cfg = SPACE_CFG[spaceType(i)] || SPACE_CFG.normal;
    const isMe = i === myPosition, isHL = i === highlightPos;
    return { backgroundColor:cfg.bg, borderColor:isHL||isMe?"#fff":cfg.border, borderWidth:isHL||isMe?3:1.5, transform:[{scale:isHL?1.12:1}] };
  };
  return (
    <View style={bS.board}>
      {rows.map((row,ri) => (
        <View key={ri} style={bS.row}>
          {row.map(i => {
            const here = playersAt(i), type = spaceType(i), cfg = SPACE_CFG[type]||SPACE_CFG.normal;
            return (
              <View key={i} style={[bS.tile, {width:sz,height:sz}, tileStyle(i)]}>
                {i===boardEnd ? <Text style={{fontSize:sz*0.46}}>🐍</Text>
                 : i===0     ? <Text style={{fontSize:sz*0.38}}>🏁</Text>
                 : type!=="normal" ? (
                    type==="mystery"
                      ? <View style={[bS.mysteryBadge,{width:sz*0.52,height:sz*0.52}]}><Text style={[bS.mysteryBadgeTxt,{fontSize:sz*0.34}]}>?</Text></View>
                      : <Text style={{fontSize:sz*0.36,fontWeight:"bold",color:cfg.border}}>{cfg.label}</Text>
                  )
                 : <Text style={{fontSize:sz*0.26,color:"#4a6a4a",fontWeight:"bold"}}>{i}</Text>}
                <View style={bS.tokenRow}>
                  {here.slice(0,3).map((p,pi) => (
                    <View key={pi} style={[bS.token, {backgroundColor:p.color||"#888",width:sz*0.28,height:sz*0.28,borderRadius:sz*0.14}]}/>
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
  board:    {paddingBottom:8},
  row:      {flexDirection:"row",justifyContent:"center",marginBottom:4},
  tile:     {borderRadius:9,margin:2,alignItems:"center",justifyContent:"center",position:"relative"},
  tokenRow: {position:"absolute",bottom:3,flexDirection:"row",flexWrap:"wrap",justifyContent:"center"},
  token:    {margin:1,borderWidth:1.5,borderColor:"rgba(255,255,255,0.4)"},
  mysteryBadge:   {backgroundColor:"#8e44ad",borderRadius:6,alignItems:"center",justifyContent:"center"},
  mysteryBadgeTxt:{color:"#fff",fontWeight:"900"},
});

function CloseBtn({ onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={S.closeBtn} hitSlop={{top:10,bottom:10,left:10,right:10}}>
      <Text style={S.closeBtnTxt}>✕</Text>
    </TouchableOpacity>
  );
}

function Legend() {
  return (
    <View style={S.legend}>
      {Object.entries(SPACE_CFG).map(([t, cfg]) => (
        <View key={t} style={S.legendItem}>
          <View style={[S.legendSwatch, {backgroundColor:cfg.bg,borderColor:cfg.border}]}/>
          <Text style={[S.legendTxt, {color:cfg.border}]}>{t.charAt(0).toUpperCase()+t.slice(1)}</Text>
        </View>
      ))}
    </View>
  );
}

function DiceFace({ value, style }) {
  return (
    <Text style={style}>
      {value ? getDiceFace(Math.min(6, value)) : "?"}
    </Text>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function BoardGameScreen({ route, navigation }) {
  const { sessionId, playerName, playerColor="#00c781", playerUid, isHost, hostIsPlaying, gameId } = route.params;

  const [session,  setSession]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [myState,  setMyState]  = useState(null);
  const [viewMode, setViewMode] = useState("questions");

  // Questions — loaded ONCE from session (shuffled by Lobby)
  const [questions, setQuestions] = useState(null);
  const questionsSetRef = useRef(false);
  const [qIdx,    setQIdx]    = useState(0);
  const qList = questions || [];
  const curQ  = qList.length ? qList[qIdx % qList.length] : null;
  const [selAns, setSelAns] = useState(null);        // single-select / sentinel
  const [multiSelAnswers, setMultiSelAnswers] = useState([]); // for multiSelect questions
  const [ansFB,  setAnsFB]  = useState(null);

  // Progress
  const [cc,     setCc]     = useState(0);
  const [streak, setStreak] = useState(0);
  const [luck,   setLuck]   = useState(0);
  const [total,  setTotal]  = useState(0);
  const ROLL_AT = 3;

  // Phase
  const [phase,        setPhase]        = useState("questions");
  const phaseRef = useRef("questions"); // always mirrors phase — safe to read in async code & onSnapshot
  const setPhaseSync = useCallback((next) => {
    const val = typeof next === "function" ? next(phaseRef.current) : next;
    phaseRef.current = val;
    setPhase(val);
  }, []);
  const [diceValue,    setDiceValue]    = useState(null);
  const [diceRolling,  setDiceRolling]  = useState(false);
  const [highlightPos, setHighlightPos] = useState(null);
  const diceAnim = useRef(new Animated.Value(0)).current;

  // Space roll
  const [srType,    setSrType]    = useState(null);
  const [srValue,   setSrValue]   = useState(null);
  const [srRolling, setSrRolling] = useState(false);
  const srAnim = useRef(new Animated.Value(0)).current;

  // Trap
  const [trapEvent,    setTrapEvent]    = useState(null);
  const [trapTimer,    setTrapTimer]    = useState(10);
  const [trapAnswered, setTrapAnswered] = useState(false);
  const trapRef = useRef(null);

  // Mystery box overlay (never a separate phase — always a Modal overlay)
  const [mBoxOpen,    setMBoxOpen]    = useState(false);
  const [mBoxStep,    setMBoxStep]    = useState("roll"); // roll | target | apply | inventory
  const [mBoxKey,     setMBoxKey]     = useState(null);
  const [mBoxDef,     setMBoxDef]     = useState(null);
  const [mBoxRolling, setMBoxRolling] = useState(false);
  const savedPhaseRef = useRef(null); // phase to restore after mystery box closes
  const mBoxAnim = useRef(new Animated.Value(0)).current;

  // Inventory — only mystery_box and deflector
  const [inventory,   setInventory]   = useState([]);
  const [invFullItem, setInvFullItem] = useState(null);
  const [itemToast,   setItemToast]   = useState(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  // Roll-1 popup
  const [roll1Notif, setRoll1Notif] = useState(false);

  // Active bonuses
  const [doubleRollsLeft, setDoubleRollsLeft] = useState(0);
  const [immunityLeft,    setImmunityLeft]    = useState(0);
  const [immunitySecsLeft,setImmunitySecsLeft]= useState(0);
  const immunityTimerRef  = useRef(null);
  const immunitySecsRef   = useRef(null);
  const [deflectorActive, setDeflectorActive] = useState(false);
  const [deflectorSecsLeft,setDeflectorSecsLeft]=useState(0);
  const deflectorTimerRef = useRef(null);
  const deflectorSecsRef  = useRef(null);

  // Stun — mirrors 1v1 architecture: detected via top-level session field, not players array
  const [isStunned,    setIsStunned]    = useState(false);
  const [stunBy,       setStunBy]       = useState(""); // who stunned you (for display)
  const [stunRecovery, setStunRecovery] = useState(0);
  const [stunQIdx,     setStunQIdx]     = useState(0);
  const [stunSelAns,   setStunSelAns]   = useState(null);
  const prevStunnedRef = useRef(false);

  // Notifications (from opponents' effects)
  const [notif,          setNotif]           = useState("");
  const [showNotif,      setShowNotif]        = useState(false);
  const [interruptedPhase,setInterruptedPhase]= useState(null);
  const lastNotifId = useRef(0);

  // 1v1 duel countdown (shown to both players before duel starts)
  const [duelCountdown,    setDuelCountdown]    = useState(null); // 3|2|1|null
  const duelCountdownRef   = useRef(null);
  const duelSeenRef        = useRef(false); // tracks if we've already started countdown for current duel

  // Duel
  const [duelAnswered, setDuelAnswered] = useState(false);
  const [duelView,    setDuelView]    = useState("active"); // "active" | "done" — drives JSX exclusively
  const lastDuelRound  = useRef(-1);

  // Timers
  const [gameLeft,  setGameLeft]  = useState(null);
  const [qTimeLeft, setQTimeLeft] = useState(null);
  const gameTimerRef = useRef(null);
  const qTimerRef    = useRef(null);
  const timerBar     = useRef(new Animated.Value(1)).current;

  // Flash
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const [flashData, setFlashData] = useState(null);
  const [zoomImage, setZoomImage] = useState(null); // base64/url of image to show fullscreen

  const [gameOverDone, setGameOverDone] = useState(false);
  const boardRef = useRef(null);

  const sessionRef = useRef(null);
  const myStateRef = useRef(null);

  // ── Session listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      sessionRef.current = data;

      // Load questions ONCE — shuffle locally so every player gets a different random order
      if (!questionsSetRef.current && data.questions?.length) {
        questionsSetRef.current = true;

        // Fisher-Yates shuffle
        const fyShuffle = (arr) => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        };

        // 1. Randomise question order
        let qs = fyShuffle(data.questions);

        // 2. Randomise answer order within each question (skip trueFalse)
        qs = qs.map(q => {
          if (q.type === 'trueFalse' || !Array.isArray(q.answers) || q.answers.length < 2) return q;
          const n = q.answers.length;
          const idx = Array.from({length: n}, (_, i) => i);
          for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [idx[i], idx[j]] = [idx[j], idx[i]];
          }
          return {
            ...q,
            answers:        idx.map(i => q.answers[i]),
            correctAnswers: idx.map(i => q.correctAnswers[i]),
          };
        });

        setQuestions(qs);
      }

      const me = (data.players||[]).find(p => (playerUid && p.uid===playerUid) || p.name===playerName);
      if (me) {
        myStateRef.current = me;
        setMyState(me);

        // Notification interrupt — save phase so we can restore it
        if (me.notification?.id > lastNotifId.current) {
          lastNotifId.current = me.notification.id;
          setNotif(me.notification.text || "");
          setShowNotif(true);
          const cur = phaseRef.current;
          if (cur !== "questions" && cur !== "duel") {
            setInterruptedPhase(cur);
          }
        }

        // Stun: just reset recovery counter on each new stun.
        // The stun Modal reads myState.stunned directly — no phase change needed.
        const wasStunned = prevStunnedRef.current;
        if (me.stunned && !wasStunned) {
          setStunRecovery(0);
          setStunQIdx(0);
          setStunSelAns(null);
        }
        prevStunnedRef.current = !!me.stunned;
      }

      setSession(data);
      setLoading(false);

      if (!isHost || hostIsPlaying) {
        if (data.status === "abandoned") return;
        if ((data.kickedPlayers||[]).includes(playerName)) return;
      }

      // ── Stun detection — mirrors activeDuel: reads top-level field, not players array ──
      // This is why 1v1 works reliably: it never depends on finding "me" in the players array.
      // We do the same for stun.
      const stunMap = data.activeStuns || {};
      const myStunEntry = stunMap[playerName];
      if (myStunEntry) {
        if (!prevStunnedRef.current) {
          // Newly stunned — reset counters and show modal
          prevStunnedRef.current = true;
          setIsStunned(true);
          setStunBy(myStunEntry.by || "");
          setStunRecovery(0);
          setStunQIdx(0);
          setStunSelAns(null);
        }
      } else {
        if (prevStunnedRef.current) {
          prevStunnedRef.current = false;
          setIsStunned(false);
        }
      }

      // Duel detection
      const ad = data.activeDuel;
      if (ad) {
        const involved = ad.challengerUid===playerUid || ad.opponentUid===playerUid
          || ad.challengerName===playerName || ad.opponentName===playerName;
        if (involved) {
          if (ad.status === "active") {
            if (ad.currentRound !== lastDuelRound.current) {
              lastDuelRound.current = ad.currentRound;
              setDuelAnswered(false);
            }
            // First time seeing this duel → 3-2-1 countdown
            if (!duelSeenRef.current) {
              duelSeenRef.current = true;
              setDuelCountdown(3);
              clearInterval(duelCountdownRef.current);
              let count = 3;
              duelCountdownRef.current = setInterval(() => {
                count--;
                if (count <= 0) {
                  clearInterval(duelCountdownRef.current);
                  setDuelCountdown(null);
                  setPhaseSync("duel");
                } else {
                  setDuelCountdown(count);
                }
              }, 1000);
            }
          }
          if (ad.status === "done") {
            clearInterval(duelCountdownRef.current);
            setDuelCountdown(null);
            setDuelView("done");
            setPhaseSync("duel");
          }
        }
      } else {
        duelSeenRef.current = false;
        clearInterval(duelCountdownRef.current);
        setDuelCountdown(null);
        setDuelView("active");
      }
    });
  }, [sessionId, playerName, playerUid, isHost, hostIsPlaying]);

  // ── Pick question ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!qList.length) return;
    setSelAns(null);
    setAnsFB(null);
    setMultiSelAnswers([]);
  }, [qIdx]);

  // ── Auto map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (["rolling","moving","space_roll","rolled"].includes(phase)) setViewMode("map");
    if (["questions","duel"].includes(phase))                       setViewMode("questions");
  }, [phase]);

  // ── Game timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const endsAt = session?.gameEndsAt;
    if (!endsAt) return;
    clearInterval(gameTimerRef.current);
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setGameLeft(rem);
      if (rem <= 0) {
        clearInterval(gameTimerRef.current);
        if (isHost) updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);
      }
    };
    tick();
    gameTimerRef.current = setInterval(tick, 1000);
    return () => clearInterval(gameTimerRef.current);
  }, [session?.gameEndsAt, isHost, sessionId]);

  // ── Question timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(qTimerRef.current);
    timerBar.stopAnimation();
    const tl = curQ?.timeLimit || session?.settings?.timePerQuestion;
    if (!tl || phase !== "questions") { setQTimeLeft(null); timerBar.setValue(1); return; }
    timerBar.setValue(1);
    Animated.timing(timerBar, {toValue:0, duration:tl*1000, useNativeDriver:false}).start();
    setQTimeLeft(tl);
    const frozen = curQ;
    qTimerRef.current = setInterval(() => {
      setQTimeLeft(t => {
        if (t === null) return null;
        if (t <= 1) {
          clearInterval(qTimerRef.current);
          setSelAns(-1); setAnsFB("wrong"); setStreak(0); setLuck(0);
          triggerFlash(false, getCorrectText(frozen));
          setTimeout(() => setQIdx(i => i+1), 1400);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(qTimerRef.current);
  }, [qIdx, phase, curQ?.timeLimit, session?.settings?.timePerQuestion]);

  // ── Flash ─────────────────────────────────────────────────────────────────
  const triggerFlash = useCallback((ok, txt) => {
    setFlashData({isCorrect:ok, text:txt});
    flashOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(900),
      Animated.timing(flashOpacity, {toValue:0, duration:500, useNativeDriver:false}),
    ]).start(() => setFlashData(null));
  }, []);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const scrollToPos = useCallback((pos, be) => {
    if (!boardRef.current) return;
    const r = Math.floor(pos / BOARD_COLS), total = Math.ceil((be+1) / BOARD_COLS), vr = total - 1 - r;
    boardRef.current.scrollTo({y: Math.max(0, vr*(BASE_TILE+6)-50), animated:true});
  }, []);

  // ── Panic: always return to questions ────────────────────────────────────
  const forceQuestions = useCallback(() => {
    setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null); setMBoxRolling(false);
    setRoll1Notif(false); setShowNotif(false);
    setInterruptedPhase(null);
    // If coming from "rolled", the current question was already answered — advance to next
    const cur = phaseRef.current;
    setPhaseSync("questions"); setViewMode("questions"); setDiceValue(null);
    if (cur === "rolled" || cur === "rolling") setQIdx(i => i+1);
    clearInterval(trapRef.current); setTrapEvent(null); setTrapAnswered(false);
  }, [setPhaseSync]);

  // exitMoving: show "Back to Questions" prompt
  const exitMoving = () => { setPhaseSync("rolled"); setDiceValue(null); };

  // ── Item toast ────────────────────────────────────────────────────────────
  const showItemToast = useCallback((type, reason) => {
    const def = INVENTORY_DEFS[type];
    if (!def) return;
    const reasonLine = reason ? ` — ${reason}` : "";
    setItemToast({emoji:def.emoji, text:`${def.label} added to inventory!${reasonLine}`});
    toastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(toastAnim, {toValue:1, duration:300, useNativeDriver:false}),
      Animated.delay(2800),
      Animated.timing(toastAnim, {toValue:0, duration:300, useNativeDriver:false}),
    ]).start(() => setItemToast(null));
  }, []);

  // ── Inventory ─────────────────────────────────────────────────────────────
  const addToInventory = useCallback((type, reason) => {
    setInventory(prev => {
      if (prev.length >= 3) { setInvFullItem({type, reason}); return prev; }
      const item = {type, id:Date.now()};
      showItemToast(type, reason);
      return [...prev, item];
    });
  }, [showItemToast]);

  const removeFromInventory = useCallback((id) => setInventory(prev => prev.filter(i => i.id !== id)), []);

  const useInventoryItem = useCallback((item) => {
    // NOTE: we do NOT remove from inventory here — removal happens after the item is consumed.
    // For mystery_box: removed when closeMBox finalises (claim or target chosen).
    // For deflector: removed immediately since activating it IS consuming it.
    if (item.type === "mystery_box") {
      // Pass the item id so closeMBox can remove it after use
      openMysteryBox(item.id);
    } else if (item.type === "deflector") {
      setDeflectorActive(true);
      setDeflectorSecsLeft(30);
      clearTimeout(deflectorTimerRef.current);
      clearInterval(deflectorSecsRef.current);
      deflectorTimerRef.current = setTimeout(() => { setDeflectorActive(false); setDeflectorSecsLeft(0); }, 30000);
      deflectorSecsRef.current  = setInterval(() => setDeflectorSecsLeft(s => { if(s<=1){ clearInterval(deflectorSecsRef.current); return 0; } return s-1; }), 1000);
      const sess = sessionRef.current;
      if (sess) {
        const exp = Date.now() + 30000;
        const upd = (sess.players||[]).map(p =>
          (playerUid&&p.uid===playerUid) || p.name===playerName ? {...p, deflectorExpires:exp} : p
        );
        updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
      }
    }
  }, [removeFromInventory, playerName, playerUid, sessionId]);

  // ── Open mystery box (Modal overlay on map) ───────────────────────────────
  // mBoxInventoryItemId: if box was opened FROM inventory, hold the item id so
  // X (close without claiming) puts it BACK into inventory rather than consuming it.
  const mBoxInventoryItemId = useRef(null);

  const openMysteryBox = useCallback((inventoryItemId = null) => {
    mBoxInventoryItemId.current = inventoryItemId;
    const cur = phaseRef.current;
    savedPhaseRef.current = cur === "moving" ? "rolled" : cur;
    setMBoxOpen(true); setMBoxStep("roll"); setMBoxKey(null); setMBoxDef(null); setMBoxRolling(false);
    setViewMode("map");
  }, []);

  const handleMBoxRoll = useCallback(async () => {
    if (mBoxRolling) return;
    setMBoxRolling(true);
    Animated.sequence([
      Animated.timing(mBoxAnim, {toValue:12, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:-12, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:8, duration:80, useNativeDriver:false}),
      Animated.timing(mBoxAnim, {toValue:0, duration:80, useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    const key = MYSTERY_KEYS[Math.floor(Math.random() * MYSTERY_KEYS.length)];
    const def = MYSTERY_DEFS[key];
    setMBoxKey(key);
    setMBoxDef(def);
    setMBoxRolling(false);
    if (def.inventoryType) setMBoxStep("inventory");
    else if (def.needsTarget) setMBoxStep("target");
    else setMBoxStep("apply");
  }, [mBoxRolling]);

  // closeMBox: called by X button — item NOT consumed, restore to inventory if applicable
  const closeMBox = useCallback(() => {
    setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
    // If opened from inventory and user pressed X without claiming, put item back
    const itemId = mBoxInventoryItemId.current;
    mBoxInventoryItemId.current = null;
    if (itemId) {
      setInventory(prev => {
        if (prev.find(i => i.id === itemId)) return prev; // already there
        return [...prev, { type: "mystery_box", id: itemId }];
      });
    }
    const restore = savedPhaseRef.current;
    savedPhaseRef.current = null;
    if (restore && restore !== "questions") {
      setPhaseSync(restore);
      if (["rolling","moving","space_roll"].includes(restore)) setViewMode("map");
      else setViewMode("questions");
    } else {
      setPhaseSync("questions"); setDiceValue(null); setViewMode("questions");
    }
  }, [setPhaseSync]);

  // Apply effect that doesn't need a target (immunity, doubleroll, or inventory item)
  const claimMBoxNoTarget = useCallback(async () => {
    if (!mBoxDef) return;
    // Peek at restore target BEFORE closeMBox clears savedPhaseRef
    const willReturnToQ = !savedPhaseRef.current || savedPhaseRef.current === "questions";
    const itemId = mBoxInventoryItemId.current; mBoxInventoryItemId.current = null; if (itemId) removeFromInventory(itemId);
    if (mBoxDef.inventoryType) {
      addToInventory(mBoxDef.inventoryType, "mystery box reward");
      closeMBox();
      if (willReturnToQ) setQIdx(i => i+1);
      return;
    }
    switch (mBoxKey) {
      case "immunity": {
        setImmunityLeft(2);
        setImmunitySecsLeft(45);
        clearTimeout(immunityTimerRef.current);
        clearInterval(immunitySecsRef.current);
        immunityTimerRef.current = setTimeout(() => { setImmunityLeft(0); setImmunitySecsLeft(0); }, 45000);
        immunitySecsRef.current  = setInterval(() => setImmunitySecsLeft(s => { if(s<=1){ clearInterval(immunitySecsRef.current); return 0; } return s-1; }), 1000);
        const exp = Date.now() + 45000;
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players||[]).map(p =>
            (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p, immunityExpires:exp} : p
          );
          updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        }
        break;
      }
      case "doubleroll":
        setDoubleRollsLeft(2);
        break;
    }
    closeMBox();
    if (willReturnToQ) setQIdx(i => i+1);
  }, [mBoxDef, mBoxKey, addToInventory, closeMBox, playerName, playerUid, sessionId]);

  // Apply effect on a chosen target
  const claimMBoxTarget = useCallback(async (target) => {
    if (!mBoxKey) { closeMBox(); return; }

    // Peek at restore target BEFORE closeMBox clears savedPhaseRef
    const willReturnToQ = !savedPhaseRef.current || savedPhaseRef.current === "questions";
    const itemId2 = mBoxInventoryItemId.current; mBoxInventoryItemId.current = null; if (itemId2) removeFromInventory(itemId2);

    // Fetch FRESH player data from Firestore so deflector/immunity checks are accurate
    let freshSess;
    try {
      const snap = await getDoc(doc(db,"gameSessions",sessionId));
      freshSess = snap.data();
    } catch(e) { console.error(e); closeMBox(); return; }

    const sess = freshSess || sessionRef.current;

    const tPlayer = (sess.players||[]).find(p => p.name === target.name);
    const tImmune = tPlayer?.immunityExpires > Date.now();
    const tDeflect = tPlayer?.deflectorExpires > Date.now();

    if (tDeflect) {
      setNotif(`Your ${mBoxDef?.title} was deflected back at you by ${target.name}! 🪞`);
      setShowNotif(true);
      const notifBack = {text:`You deflected ${playerName}'s ${mBoxDef?.title} back at them! 🪞`, id:Date.now()};
      // Single write: clear deflector + send notification atomically
      const upd = (sess.players||[]).map(p =>
        p.name===target.name ? {...p, deflectorExpires:0, notification:notifBack} : p
      );
      updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
      closeMBox();
      if (willReturnToQ) setQIdx(i => i+1);
      return;
    }

    if (tImmune && ["pushback","stun","badluck","duel"].includes(mBoxKey)) {
      setNotif(`${target.name} is immune! Your ${mBoxDef?.title} was blocked.`);
      setShowNotif(true);
      setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
      const restore = savedPhaseRef.current; savedPhaseRef.current = null;
      if (restore && restore !== "questions") { setPhaseSync(restore); setViewMode(["rolling","moving","space_roll"].includes(restore)?"map":"questions"); }
      // Only advance question if we're going back to questions
      if (!restore || restore === "questions") setQIdx(i => i+1);
      return;
    }

    switch (mBoxKey) {
      case "pushback": {
        const np = Math.max(0, (target.position||0) - 3);
        const notif = {text:`You were pushed back 3 spaces by ${playerName}! 💥`, id:Date.now()};
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, position:np, notification:notif} : p);
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        break;
      }
      case "stun": {
        const notif = {text:`You've been stunned by ${playerName}! 😵 Answer 3 in a row to recover.`, id:Date.now()};
        // Write to top-level activeStuns map AND notification in one atomic write
        // Use dot-notation to only update the specific target's entry, not the whole map
        await updateDoc(doc(db,"gameSessions",sessionId), {
          [`activeStuns.${target.name}`]: { by: playerName, id: Date.now() },
          players: (sess.players||[]).map(p => p.name===target.name ? {...p, notification:notif} : p),
        }).catch(console.error);
        break;
      }
      case "badluck": {
        const exp = Date.now() + 45000;
        const notif = {text:`${playerName} cursed you with Bad Luck Aura! 🌑 –30% Luck for 45s`, id:Date.now()};
        const upd = (sess.players||[]).map(p => p.name===target.name ? {...p, badLuckExpires:exp, notification:notif} : p);
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
        break;
      }
      case "duel": {
        const qs = sess.questions || qList;
        if (qs.length) {
          const shuffled = [...qs].sort(() => Math.random()-0.5).slice(0, 3);
          const activeDuel = {
            challengerName:playerName, challengerUid:playerUid||playerName, challengerColor:playerColor,
            opponentName:target.name, opponentUid:target.uid||target.name, opponentColor:target.color||"#888",
            questions:shuffled, currentRound:0, roundStartedAt:Date.now(),
            c_0:null,c_1:null,c_2:null, o_0:null,o_1:null,o_2:null,
            status:"active", winnerName:null,
            challengerDismissed:false, opponentDismissed:false,
          };
          const notif = {text:`${playerName} has challenged you to a 1v1! ⚔️`, id:Date.now()};
          const updP = (sess.players||[]).map(p => p.name===target.name ? {...p, notification:notif} : p);
          await updateDoc(doc(db,"gameSessions",sessionId), {activeDuel, players:updP}).catch(console.error);
        }
        setMBoxOpen(false); setMBoxKey(null); setMBoxDef(null);
        setPhaseSync("questions"); setDiceValue(null);
        return;
      }
    }
    closeMBox();
    if (willReturnToQ) setQIdx(i => i+1);
  }, [mBoxKey, mBoxDef, playerName, playerUid, playerColor, sessionId, closeMBox, qList]);

  // ── 1v1 Duel answer ───────────────────────────────────────────────────────
  const handleDuelAnswer = useCallback(async (ansIdx) => {
    if (duelAnswered) return;
    const sess = sessionRef.current;
    if (!sess?.activeDuel || sess.activeDuel.status !== "active") return;
    const ad = sess.activeDuel, r = ad.currentRound;
    const isChallenger = ad.challengerUid===playerUid || ad.challengerName===playerName;
    const myKey  = isChallenger ? `c_${r}` : `o_${r}`;
    const othKey = isChallenger ? `o_${r}` : `c_${r}`;
    const q = ad.questions[r];
    const correct = q?.correctAnswers?.[ansIdx] === true;
    const timeSec = Math.max(0, (Date.now() - ad.roundStartedAt) / 1000);
    setDuelAnswered(true);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db,"gameSessions",sessionId);
        const snap = await tx.get(ref);
        const d = snap.data(), duel = d.activeDuel;
        if (!duel || duel.status !== "active") return;
        if (duel[myKey] !== null) return;
        const upd = {[`activeDuel.${myKey}`]: {correct, timeSec}};
        const other = duel[othKey];
        if (other !== null) {
          const nextR = r + 1;
          if (nextR >= 3) {
            // Compute winner from all answers
            const cA = [duel.c_0,duel.c_1,duel.c_2].map((a,i) => (isChallenger&&i===r) ? {correct,timeSec} : a);
            const oA = [duel.o_0,duel.o_1,duel.o_2].map((a,i) => (!isChallenger&&i===r) ? {correct,timeSec} : a);
            const cC = cA.filter(a=>a?.correct).length;
            const oC = oA.filter(a=>a?.correct).length;
            const cT = cA.reduce((s,a)=>s+(a?.timeSec||0),0)/3;
            const oT = oA.reduce((s,a)=>s+(a?.timeSec||0),0)/3;
            let winner;
            if (cC > oC) winner = duel.challengerName;
            else if (oC > cC) winner = duel.opponentName;
            else if (cT < oT) winner = duel.challengerName;
            else if (oT < cT) winner = duel.opponentName;
            else winner = "tie";
            upd["activeDuel.status"] = "done";
            upd["activeDuel.winnerName"] = winner;
          } else {
            upd["activeDuel.currentRound"] = nextR;
            upd["activeDuel.roundStartedAt"] = Date.now();
          }
        }
        tx.update(ref, upd);
      });
    } catch(e) { console.error("duelAnswer:", e); }
  }, [duelAnswered, playerName, playerUid, sessionId]);

  // ── Dismiss duel (both must dismiss before activeDuel clears) ─────────────
  const dismissDuel = useCallback(async () => {
    const ad = sessionRef.current?.activeDuel;
    const me = myStateRef.current;
    if (!ad) { setPhaseSync("questions"); setQIdx(i=>i+1); return; }
    const isChallenger = ad.challengerName===playerName || ad.challengerUid===playerUid;
    const myKey  = isChallenger ? "challengerDismissed" : "opponentDismissed";
    const othKey = isChallenger ? "opponentDismissed" : "challengerDismissed";

    // Swap logic: winner swaps only if they were BEHIND (lower position)
    if (ad.winnerName === playerName) {
      const otherName = isChallenger ? ad.opponentName : ad.challengerName;
      const opp = (sessionRef.current?.players||[]).find(p => p.name===otherName);
      const myPos = me?.position||0, oppPos = opp?.position||0;
      if (opp && myPos < oppPos) {
        const upd = (sessionRef.current.players||[]).map(p => {
          if ((playerUid&&p.uid===playerUid)||p.name===playerName) return {...p, position:oppPos};
          if (p.name===otherName) return {...p, position:myPos};
          return p;
        });
        await updateDoc(doc(db,"gameSessions",sessionId), {players:upd}).catch(console.error);
      }
    }

    if (ad[othKey]) {
      await updateDoc(doc(db,"gameSessions",sessionId), {activeDuel:null}).catch(console.error);
    } else {
      await updateDoc(doc(db,"gameSessions",sessionId), {[`activeDuel.${myKey}`]:true}).catch(console.error);
    }
    setDuelView("active"); // reset for next duel
    setPhaseSync("questions");
    setQIdx(i => i+1);
  }, [playerName, playerUid, sessionId]);

  // ── Answer handler (normal questions — stun questions are in the stun Modal) ──
  // Toggle a multi-select answer choice (doesn't submit — user taps Confirm)
  const handleMultiToggle = useCallback((ansIdx) => {
    if (selAns !== null || phase !== "questions") return;
    setMultiSelAnswers(prev =>
      prev.includes(ansIdx) ? prev.filter(i => i !== ansIdx) : [...prev, ansIdx]
    );
  }, [selAns, phase]);

  const scoreAndAdvance = useCallback((correct) => {
    if (correct) {
      const ns = streak+1, nc = cc+1;
      setStreak(ns); setLuck(Math.min(40, ns>=2 ? luck+5 : luck));
      setTotal(prev => { const next=prev+1; if(next%6===0) addToInventory("mystery_box","6 correct answers in a row"); return next; });
      if (nc >= ROLL_AT) { setCc(0); setTimeout(() => { setPhaseSync("rolling"); setDiceValue(null); }, 1400); }
      else { setCc(nc); setTimeout(() => setQIdx(i => i+1), 1400); }
    } else {
      setStreak(0); setLuck(0);
      setTimeout(() => setQIdx(i => i+1), 1400);
    }
  }, [streak, cc, luck, addToInventory, setPhaseSync]);

  // Confirm multi-select submission
  const handleMultiConfirm = useCallback(() => {
    if (selAns !== null || phase !== "questions" || !curQ) return;
    clearInterval(qTimerRef.current); timerBar.stopAnimation();
    const correctIdxs = (curQ.correctAnswers||[]).map((v,i)=>v?i:null).filter(i=>i!==null);
    const selected = [...multiSelAnswers].sort();
    const correct = selected.length === correctIdxs.length &&
      selected.every((v,i) => v === correctIdxs[i]);
    setSelAns(-2); // -2 = multiselect submitted
    setAnsFB(correct ? "correct" : "wrong");
    triggerFlash(correct, getCorrectText(curQ));
    scoreAndAdvance(correct);
  }, [selAns, phase, curQ, multiSelAnswers, triggerFlash, scoreAndAdvance]);

  const handleAnswer = useCallback((ansIdx) => {
    if (selAns !== null || phase !== "questions") return;
    clearInterval(qTimerRef.current); timerBar.stopAnimation();
    const correct = curQ?.correctAnswers?.[ansIdx] === true;
    setSelAns(ansIdx);
    setAnsFB(correct ? "correct" : "wrong");
    triggerFlash(correct, getCorrectText(curQ));
    scoreAndAdvance(correct);
  }, [selAns, phase, curQ, triggerFlash, scoreAndAdvance]);

  // ── Stun Modal answer handler ─────────────────────────────────────────────
  const handleStunAnswer = useCallback((ansIdx) => {
    if (stunSelAns !== null) return;
    const q = qList[stunQIdx % qList.length];
    if (!q) return;
    const correct = q?.correctAnswers?.[ansIdx] === true;
    setStunSelAns(ansIdx);
    if (correct) {
      const ns = stunRecovery + 1;
      setStunRecovery(ns);
      if (ns >= ROLL_AT) {
        // All 3 correct — write to Firestore to clear stun
        updateDoc(doc(db,"gameSessions",sessionId), {
          [`activeStuns.${playerName}`]: deleteField(),
        }).catch(console.error);
        // Reset UI immediately — don't wait for Firestore roundtrip or the modal freezes
        setTimeout(() => {
          setStunRecovery(0);
          setStunQIdx(0);
          setStunSelAns(null);
          setIsStunned(false); // local immediate clear — Firestore will confirm shortly
        }, 600);
        return;
      }
    } else {
      setStunRecovery(0);
    }
    setTimeout(() => { setStunQIdx(i => i+1); setStunSelAns(null); }, 1200);
  }, [stunSelAns, stunQIdx, stunRecovery, qList, playerName, sessionId]);
  const handleRoll = useCallback(async () => {
    if (diceRolling) return;
    setDiceRolling(true);
    Animated.sequence([
      Animated.timing(diceAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(diceAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    let roll = Math.floor(Math.random()*6)+1;
    if (doubleRollsLeft > 0) { roll = roll + Math.floor(Math.random()*6)+1; setDoubleRollsLeft(n=>n-1); }
    else if (luck > 0) { const r2=Math.floor(Math.random()*6)+1; if(luck>=20) roll=Math.max(roll,r2); }
    if (streak >= 8) roll = Math.min(12, roll+1);
    setDiceValue(roll); setDiceRolling(false);

    if (roll === 1 && doubleRollsLeft === 0) {
      // Roll 1: no movement, mystery_box to inventory — toast shows via addToInventory
      addToInventory("mystery_box", "you rolled a 1! 🎲");
      // Return to rolled phase so user taps "Back to Questions"
      setPhaseSync("rolled");
      return;
    }
    setTimeout(() => movePlayer(roll), 800);
  }, [diceRolling, luck, streak, doubleRollsLeft, addToInventory]);

  // ── Space dice roll ───────────────────────────────────────────────────────
  const handleSpaceRoll = useCallback(async () => {
    if (srRolling) return;
    setSrRolling(true);
    Animated.sequence([
      Animated.timing(srAnim,{toValue:10, duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:-10,duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:8,  duration:80,useNativeDriver:false}),
      Animated.timing(srAnim,{toValue:0,  duration:80,useNativeDriver:false}),
    ]).start();
    await new Promise(r => setTimeout(r, 500));
    const roll = Math.floor(Math.random()*6)+1;
    setSrValue(roll); setSrRolling(false);
    setTimeout(() => applySpaceRoll(srType, roll), 800);
  }, [srRolling, srType]);

  const applySpaceRoll = useCallback(async (type, roll) => {
    const me=myStateRef.current, sess=sessionRef.current;
    if (!me||!sess) { setSrType(null); exitMoving(); return; }
    const be=sess.settings?.boardSize||25, cur=me.position||0;
    const np = type==="lava" ? Math.max(0,cur-roll) : Math.min(be,cur+roll);
    setPhaseSync("moving");
    const srSafetyTimer = setTimeout(() => {
      if (phaseRef.current === "moving") setPhaseSync("rolled");
    }, 8000);
    const step = type==="lava" ? -1 : 1;
    for (let p=cur; step>0?p<=np:p>=np; p+=step) { setHighlightPos(p); scrollToPos(p,be); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(np);
    try {
      const upd = (sessionRef.current?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:np,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId), {players:upd});
      clearTimeout(srSafetyTimer);
      if (np>=be) { await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName}); return; }
    } catch(e) { clearTimeout(srSafetyTimer); console.error(e); }
    setSrType(null); setSrValue(null); exitMoving();
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  // ── Move player ───────────────────────────────────────────────────────────
  const movePlayer = useCallback(async (spaces) => {
    const me=myStateRef.current, sess=sessionRef.current;
    if (!me||!sess) { setPhaseSync("questions"); setDiceValue(null); return; }
    const be=sess.settings?.boardSize||25, op=me.position||0, np=Math.min(op+spaces,be);
    setPhaseSync("moving");

    // Safety net: if we're still in "moving" after 8s, force to rolled
    const safetyTimer = setTimeout(() => {
      if (phaseRef.current === "moving") setPhaseSync("rolled");
    }, 8000);
    for (let c=op; c<=np; c++) { setHighlightPos(c); scrollToPos(c,be); await new Promise(r=>setTimeout(r,280)); }
    setHighlightPos(np);
    try {
      const ls = sessionRef.current;
      const upd = (ls?.players||[]).map(p =>
        (playerUid&&p.uid===playerUid)||p.name===playerName ? {...p,position:np,color:playerColor} : p
      );
      await updateDoc(doc(db,"gameSessions",sessionId), {players:upd});
      clearTimeout(safetyTimer);
      if (np>=be) { await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended",winner:playerName}); return; }
      const space = (() => { const b=ls?.board||[]; const d=b[np]; if(d?.type) return d; return (Array.isArray(b)&&b.find(s=>s?.index===np))||null; })();
      handleLanding(space, np, be, ls?.questions||[]);
    } catch(e) { clearTimeout(safetyTimer); console.error("movePlayer:",e); exitMoving(); }
  }, [playerName,playerColor,playerUid,sessionId,scrollToPos]);

  // ── Space landing ─────────────────────────────────────────────────────────
  const handleLanding = (space, pos, be, qs) => {
    const type = space?.type || "normal";
    if (immunityLeft>0 && ["lava","trap","cannon"].includes(type)) { setImmunityLeft(n=>Math.max(0,n-1)); exitMoving(); return; }
    if (immunityLeft>0 && type!=="normal") setImmunityLeft(n=>Math.max(0,n-1));
    if (type==="normal") { exitMoving(); return; }
    if (type==="mystery") { openMysteryBox(); return; }
    if (type==="lava"||type==="cannon") { setSrType(type); setSrValue(null); setSrRolling(false); setPhaseSync("space_roll"); return; }
    if (type==="trap") {
      const pool = qs?.length ? qs : [];
      if (pool.length) {
        const trapQ = pool[Math.floor(Math.random()*pool.length)];
        setTrapEvent({question:trapQ}); setTrapTimer(10); setTrapAnswered(false); setPhaseSync("space_event");
        clearInterval(trapRef.current);
        trapRef.current = setInterval(() => {
          setTrapTimer(t => { if(t<=1){ clearInterval(trapRef.current); handleTrapFail(); return 0; } return t-1; });
        }, 1000);
      } else { exitMoving(); }
      return;
    }
    exitMoving();
  };

  const handleTrapFail = async () => {
    clearInterval(trapRef.current);
    setTrapEvent(null); setPhaseSync("questions"); setDiceValue(null); setQIdx(i=>i+1);
    // Use activeStuns — same mechanism as player-applied stun
    await updateDoc(doc(db,"gameSessions",sessionId), {
      [`activeStuns.${playerName}`]: { by: "Trap", id: Date.now() },
    }).catch(console.error);
  };

  const resolveEvent = async (opts={}) => {
    clearInterval(trapRef.current);
    setTrapEvent(null); setPhaseSync("questions"); setDiceValue(null); setQIdx(i=>i+1);
    if (trapEvent?.question && !opts.correct) {
      await updateDoc(doc(db,"gameSessions",sessionId), {
        [`activeStuns.${playerName}`]: { by: "Trap", id: Date.now() },
      }).catch(console.error);
    }
  };

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = async () => {
    if (!isHost || hostIsPlaying) {
      try {
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players||[]).filter(p => !(playerUid&&p.uid===playerUid) && p.name!==playerName);
          await updateDoc(doc(db,"gameSessions",sessionId),{players:upd});
        }
      } catch(e) { console.error(e); }
    }
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0, routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  const exitGame = () => {
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.reset({index:0, routes:[{name:isReal?"Dashboard":"Home"}]});
  };

  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781"/>
      <Text style={{color:"#fff",marginTop:16,fontSize:18}}>Loading…</Text>
    </SafeAreaView>
  );

  const board    = session?.board || [];
  const players  = session?.players || [];
  const boardEnd = session?.settings?.boardSize || 25;
  const myPos    = myState?.position || 0;
  const stunned  = isStunned; // controlled by activeStuns top-level field, not players array
  const showCA   = session?.settings?.showAnswersAfter !== false;
  const badLuck  = myState?.badLuckExpires && myState.badLuckExpires > Date.now();
  const effLuck  = badLuck ? Math.max(0, luck-30) : luck;
  // Display luck at ×2.5 so 40% real luck shows as 100% — cosmetic only, math unchanged
  const dispLuck = Math.min(100, Math.round(effLuck * 2.5));
  const otherPs  = players.filter(p => !((playerUid&&p.uid===playerUid)||p.name===playerName));
  const activeDuel = session?.activeDuel;

  // ══ HOST VIEW ════════════════════════════════════════════════════════════
  if (isHost && !hostIsPlaying) {
    const sorted = [...players].sort((a,b) => (b.position||0)-(a.position||0));
    return (
      <SafeAreaView style={S.container}>
        <View style={S.hostHeader}>
          <Text style={S.hostTitle}>Brain Board — Host</Text>
          <View style={{flexDirection:"row",gap:12,alignItems:"center"}}>
            {gameLeft!=null&&<Text style={[S.timerTxt,gameLeft<=30&&{color:"#e74c3c"}]}>{formatTime(gameLeft)}</Text>}
            <TouchableOpacity style={S.endBtn} onPress={async()=>{await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);exitGame();}}>
              <Text style={S.endBtnTxt}>End Game</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={S.hostBody}>
          <ScrollView ref={boardRef} style={{flex:1}} contentContainerStyle={{padding:12}}>
            <SnakeBoard board={board} players={players} myPosition={-1} highlightPos={null} boardEnd={boardEnd} tileSize={HOST_TILE}/>
            <Legend/>
          </ScrollView>
          <View style={S.hostSide}>
            <Text style={S.lbTitle}>Leaderboard</Text>
            {sorted.slice(0,10).map((p,i)=>(
              <View key={p.name} style={S.lbRow}>
                <Text style={S.lbRank}>#{i+1}</Text>
                <View style={[S.lbDot,{backgroundColor:p.color||"#888"}]}/>
                <Text style={S.lbName} numberOfLines={1}>{p.name}</Text>
                <Text style={S.lbPos}>{p.position||0}/{boardEnd}</Text>
                {p.stunned&&<Text style={[S.lbPos,{color:"#e74c3c"}]}>stunned</Text>}
              </View>
            ))}
          </View>
        </View>
        {session?.status==="ended"&&!gameOverDone&&<GameOverModal session={session} myPos={-1} boardEnd={boardEnd} onExit={()=>{setGameOverDone(true);exitGame();}}/>}
      </SafeAreaView>
    );
  }

  // ══ PLAYER VIEW ══════════════════════════════════════════════════════════
  const showMap = viewMode === "map";

  return (
    <SafeAreaView style={[S.container, isStunned&&S.containerStunned]}>

      {/* ─ HUD ─ */}
      <View style={[S.hud, isStunned&&S.hudStunned]}>
        <View style={S.hudCell}><Text style={S.hudLbl}>STREAK</Text><Text style={[S.hudVal,streak>0&&{color:"#f39c12"}]}>{streak>0?`🔥${streak}`:streak}</Text></View>
        <View style={S.hudCell}><Text style={S.hudLbl}>LUCK</Text><Text style={[S.hudVal,badLuck&&{color:"#e74c3c"}]}>{dispLuck}%</Text></View>
        <View style={S.hudCell}><Text style={S.hudLbl}>SPACE</Text><Text style={[S.hudVal,{color:playerColor}]}>{myPos}/{boardEnd}</Text></View>
        {immunityLeft>0&&<View style={S.hudCell}><Text style={S.hudLbl}>SHIELD</Text><Text style={[S.hudVal,{color:"#2ecc71"}]}>🛡️{immunityLeft} · {immunitySecsLeft}s</Text></View>}
        {deflectorActive&&<View style={S.hudCell}><Text style={S.hudLbl}>REFLECT</Text><Text style={[S.hudVal,{color:"#00bcd4"}]}>🪞{deflectorSecsLeft}s</Text></View>}
        {doubleRollsLeft>0&&<View style={S.hudCell}><Text style={S.hudLbl}>2×ROLL</Text><Text style={[S.hudVal,{color:"#9b59b6"}]}>×{doubleRollsLeft}</Text></View>}
        {gameLeft!=null&&<View style={S.hudCell}><Text style={S.hudLbl}>TIME</Text><Text style={[S.hudVal,gameLeft<=30&&{color:"#e74c3c"}]}>{formatTime(gameLeft)}</Text></View>}
        {/* Questions panic button — always visible */}
        <TouchableOpacity style={[S.qBtn, phase==="questions"&&!showMap&&S.qBtnActive]} onPress={forceQuestions}>
          <Text style={S.qBtnTxt}>Questions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.mapBtn, showMap&&S.mapBtnOn]} onPress={()=>setViewMode(v=>v==="map"?"questions":"map")}>
          <Text style={S.mapBtnTxt}>Map</Text>
        </TouchableOpacity>
        {hostIsPlaying&&<TouchableOpacity style={S.hudEndBtn} onPress={async()=>{await updateDoc(doc(db,"gameSessions",sessionId),{status:"ended"}).catch(console.error);exitGame();}}><Text style={S.hudEndBtnTxt}>End</Text></TouchableOpacity>}
      </View>

      {/* Timer bar */}
      {!!(curQ?.timeLimit||session?.settings?.timePerQuestion) && phase==="questions" && !showMap && (
        <View style={S.timerTrack}>
          <Animated.View style={[S.timerFill, {width:timerBar.interpolate({inputRange:[0,1],outputRange:["0%","100%"]})}]}/>
        </View>
      )}

      <View style={S.main}>

        {/* MAP */}
        {showMap && (
          <ScrollView ref={boardRef} contentContainerStyle={{padding:10}}>
            <SnakeBoard board={board} players={players} myPosition={myPos} highlightPos={highlightPos} boardEnd={boardEnd} tileSize={BASE_TILE}/>
            <Legend/>
          </ScrollView>
        )}

        {/* QUESTIONS */}
        {!showMap && phase==="questions" && (
          <ScrollView contentContainerStyle={S.qScroll}>
            <View style={S.rollBar}>
              {[0,1,2].map(i=><View key={i} style={[S.rollDot,i<cc&&S.rollDotOn]}/>)}
              <Text style={S.rollTxt2}>{ROLL_AT-cc} more correct to roll</Text>
            </View>
            {curQ ? (
              <View style={S.qCard}>
                {curQ.imageUrl ? (
                  <TouchableOpacity onPress={()=>setZoomImage(curQ.imageUrl)} activeOpacity={0.85}>
                    <Image source={{uri:curQ.imageUrl}} style={S.qImage} resizeMode="contain"/>
                    <Text style={S.zoomHint}>Tap to zoom</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={S.qTxt}>{curQ.question}</Text>
                {curQ.type==="multiSelect" ? (
                  <>
                    <Text style={{color:"#888",fontSize:13,marginBottom:8,textAlign:"center"}}>Select ALL correct answers, then tap Confirm</Text>
                    <View style={S.aGrid}>
                      {(curQ.answers||[]).map((ans,i) => {
                        const isSel=multiSelAnswers.includes(i);
                        const isCorr=curQ.correctAnswers?.[i]===true;
                        let bg=isSel?"#001d33":"#1c1c1c", bc=isSel?"#3498db":"#383838";
                        if(selAns!=null&&isCorr&&showCA){bg="#003d1a";bc="#00c781";}
                        if(selAns!=null&&isSel&&!isCorr){bg="#3d0000";bc="#e74c3c";}
                        return (
                          <TouchableOpacity key={i}
                            style={[S.aBtn,{backgroundColor:bg,borderColor:bc,flexDirection:"row",alignItems:"center"}]}
                            onPress={()=>handleMultiToggle(i)} disabled={selAns!==null} activeOpacity={0.75}>
                            {/* Fixed 32px checkbox column so layout never shifts */}
                            <View style={{width:32,alignItems:"center"}}>
                              <Text style={{fontSize:20,color:isSel?"#3498db":"#444"}}>{isSel?"☑":"☐"}</Text>
                            </View>
                            <Text style={[S.aTxt,{flex:1,textAlign:"left"}]}>{ans}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {/* Always reserve space for Confirm — opacity 0 when nothing selected so layout is stable */}
                    <TouchableOpacity
                      style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12,alignSelf:"center",opacity:selAns===null&&multiSelAnswers.length>0?1:0}]}
                      onPress={handleMultiConfirm}
                      disabled={selAns!==null||multiSelAnswers.length===0}>
                      <Text style={S.rollTxtBig}>Confirm</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={S.aGrid}>
                    {(curQ.type==="multipleChoice"?curQ.answers:["True","False"]).map((ans,i)=>{
                      const isSel=selAns===i, isCorr=curQ.correctAnswers?.[i]===true;
                      let bg="#1c1c1c",bc="#383838";
                      if(isSel){bg=ansFB==="correct"?"#003d1a":"#3d0000";bc=ansFB==="correct"?"#00c781":"#e74c3c";}
                      else if(selAns!==null&&isCorr&&showCA){bg="#003d1a";bc="#00c781";}
                      return (<TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:bg,borderColor:bc}]} onPress={()=>handleAnswer(i)} disabled={selAns!==null} activeOpacity={0.75}><Text style={S.aTxt}>{ans}</Text></TouchableOpacity>);
                    })}
                  </View>
                )}
              </View>
            ) : <View style={S.waitBox}><ActivityIndicator color="#00c781"/><Text style={S.waitTxt}>Loading…</Text></View>}
          </ScrollView>
        )}

        {/* ROLLING */}
        {phase==="rolling" && (
          <View style={S.diceBox}>
            <Text style={S.diceTtl}>Roll the Dice!</Text>
            {doubleRollsLeft>0&&<Text style={[S.luckTxt,{color:"#9b59b6"}]}>🎯 Double Roll active!</Text>}
            {effLuck>0&&doubleRollsLeft===0&&<Text style={S.luckTxt}>🍀 Luck {dispLuck}%</Text>}
            <Animated.View style={{transform:[{translateX:diceAnim}]}}><DiceFace value={diceValue} style={S.diceFace}/></Animated.View>
            {diceValue ? <Text style={S.diceRes}>Rolled {diceValue}!</Text>
            : <TouchableOpacity style={S.rollBtn} onPress={handleRoll}><Text style={S.rollTxtBig}>Roll!</Text></TouchableOpacity>}
          </View>
        )}

        {/* SPACE ROLL */}
        {phase==="space_roll" && srType && (
          <View style={S.diceBox}>
            <Text style={[S.diceTtl,{color:srType==="lava"?"#e74c3c":"#3498db",fontSize:28}]}>{srType==="lava"?"🌋 Lava!":"💥 Cannon!"}</Text>
            <Text style={S.luckTxt}>{srType==="lava"?"Roll to see how far you're pushed BACK":"Roll to see how far you're LAUNCHED forward"}</Text>
            <Animated.View style={{transform:[{translateX:srAnim}]}}><DiceFace value={srValue} style={S.diceFace}/></Animated.View>
            {srValue ? <Text style={[S.diceRes,{color:srType==="lava"?"#e74c3c":"#3498db"}]}>{srType==="lava"?`Back ${srValue} spaces!`:`Forward ${srValue} spaces!`}</Text>
            : <TouchableOpacity style={[S.rollBtn,{backgroundColor:srType==="lava"?"#c0392b":"#2980b9"}]} onPress={handleSpaceRoll} disabled={srRolling}><Text style={S.rollTxtBig}>{srRolling?"Rolling…":"Roll!"}</Text></TouchableOpacity>}
          </View>
        )}

        {/* MOVING */}
        {phase==="moving" && <View style={S.movingBox}><ActivityIndicator color="#00c781" size="large"/><Text style={S.movingTxt}>Moving…</Text></View>}

        {/* ROLLED — prompt to return to questions */}
        {phase==="rolled" && (
          <View style={S.rolledBox}>
            <Text style={S.rolledEmoji}>✅</Text>
            <Text style={S.rolledTtl}>Move done!</Text>
            <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781",marginTop:8}]} onPress={()=>{ setPhaseSync("questions"); setQIdx(i=>i+1); }}>
              <Text style={S.rollTxtBig}>Back to Questions</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 1v1 DUEL */}
        {phase==="duel" && activeDuel && (
          <ScrollView contentContainerStyle={S.duelScroll}>
            <Text style={[S.mysteryBigTtl,{color:"#3498db"}]}>⚔️ 1v1 Duel!</Text>
            <Text style={[S.luckTxt,{fontSize:15,marginBottom:8}]}>
              <Text style={{color:activeDuel.challengerColor||"#fff"}}>{activeDuel.challengerName}</Text>
              {" vs "}
              <Text style={{color:activeDuel.opponentColor||"#fff"}}>{activeDuel.opponentName}</Text>
            </Text>
            {duelView==="active" && (() => {
              const r = activeDuel.currentRound;
              const isChallenger = activeDuel.challengerUid===playerUid||activeDuel.challengerName===playerName;
              const myKey = isChallenger?`c_${r}`:`o_${r}`;
              const alreadyAnswered = activeDuel[myKey] !== null;
              const q = activeDuel.questions?.[r];
              const cC=[activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].filter(a=>a?.correct).length;
              const oC=[activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].filter(a=>a?.correct).length;
              return (
                <>
                  <Text style={[S.luckTxt,{fontSize:13,marginBottom:8}]}>Round {r+1}/3 • {activeDuel.challengerName} {cC} – {oC} {activeDuel.opponentName}</Text>
                  {alreadyAnswered||duelAnswered ? (
                    <View style={S.waitBox}><ActivityIndicator color="#3498db"/><Text style={S.waitTxt}>Waiting for opponent…</Text></View>
                  ) : q ? (
                    <View style={S.qCard}>
                      {q.imageUrl ? (
                        <TouchableOpacity onPress={()=>setZoomImage(q.imageUrl)} activeOpacity={0.85}>
                          <Image source={{uri:q.imageUrl}} style={S.qImage} resizeMode="contain"/>
                          <Text style={S.zoomHint}>Tap to zoom</Text>
                        </TouchableOpacity>
                      ) : null}
                      <Text style={[S.qTxt,{fontSize:22}]}>{q.question}</Text>
                      <View style={S.aGrid}>
                        {(q.type==="multipleChoice"?q.answers:q.type==="multiSelect"?q.answers:["True","False"]).map((ans,i)=>(
                          <TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:"#1c1c1c",borderColor:"#383838"}]} onPress={()=>handleDuelAnswer(i)} activeOpacity={0.75}><Text style={S.aTxt}>{ans}</Text></TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ) : <View style={S.waitBox}><ActivityIndicator color="#3498db"/></View>}
                </>
              );
            })()}
            {duelView==="done" && (() => {
              const iWon=activeDuel.winnerName===playerName, isTie=activeDuel.winnerName==="tie";
              const isChallenger=activeDuel.challengerName===playerName||activeDuel.challengerUid===playerUid;
              const otherName=isChallenger?activeDuel.opponentName:activeDuel.challengerName;
              const opp=(players||[]).find(p=>p.name===otherName);
              const myP=myState?.position||0, oppP=opp?.position||0;
              const swaps=iWon&&myP<oppP;
              const cC=[activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].filter(a=>a?.correct).length;
              const oC=[activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].filter(a=>a?.correct).length;
              const cT=([activeDuel.c_0,activeDuel.c_1,activeDuel.c_2].reduce((s,a)=>s+(a?.timeSec||0),0)/3).toFixed(1);
              const oT=([activeDuel.o_0,activeDuel.o_1,activeDuel.o_2].reduce((s,a)=>s+(a?.timeSec||0),0)/3).toFixed(1);
              return (
                <View style={[S.mysteryCard,{borderColor:isTie?"#aaa":iWon?"#2ecc71":"#e74c3c",width:"100%"}]}>
                  <Text style={S.mysteryEmoji}>{isTie?"🤝":iWon?"🏆":"💀"}</Text>
                  <Text style={[S.mysteryTitle,{color:isTie?"#aaa":iWon?"#2ecc71":"#e74c3c"}]}>{isTie?"Tie!":iWon?"You Win!":"You Lose!"}</Text>
                  <Text style={[S.luckTxt,{fontSize:14,marginTop:4}]}>{activeDuel.challengerName}: {cC}/3 • avg {cT}s</Text>
                  <Text style={[S.luckTxt,{fontSize:14}]}>{activeDuel.opponentName}: {oC}/3 • avg {oT}s</Text>
                  {iWon&&<Text style={[S.mysteryDesc,{marginTop:6}]}>{swaps?"Swapping positions! 🚀":"Already ahead — no swap needed."}</Text>}
                  {!iWon&&!isTie&&<Text style={[S.mysteryDesc,{marginTop:6}]}>Your opponent takes your position.</Text>}
                  <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#3498db",marginTop:12}]} onPress={dismissDuel}><Text style={S.rollTxtBig}>Continue</Text></TouchableOpacity>
                </View>
              );
            })()}
          </ScrollView>
        )}

      </View>

      {/* Vertical inventory hotbar (right side) */}
      <View style={S.hotbar}>
        {[0,1,2].map(i => {
          const item = inventory[i];
          const def  = item ? INVENTORY_DEFS[item.type] : null;
          const borderC = item ? (item.type==="deflector"?"#00bcd4":"#f39c12") : "#333";
          return (
            <TouchableOpacity key={i} style={[S.hotbarSlot, item&&S.hotbarSlotFull, {borderColor:borderC}]} onPress={()=>item&&useInventoryItem(item)} activeOpacity={0.75}>
              {item ? (
                <>
                  <Text style={S.hotbarEmoji}>{def?.emoji}</Text>
                  <Text style={S.hotbarLabel} numberOfLines={2}>{def?.label}</Text>
                </>
              ) : <Text style={S.hotbarEmpty}>—</Text>}
            </TouchableOpacity>
          );
        })}
        <Text style={S.hotbarHint}>TAP{"\n"}TO{"\n"}USE</Text>
      </View>

      {/* Mystery box overlay */}
      <Modal visible={mBoxOpen} transparent animationType="fade">
        <View style={S.mysteryOverlay}>
          <View style={S.mysteryPanel}>
            <CloseBtn onPress={closeMBox}/>
            <Text style={S.mysteryBigTtl}>🎁 Mystery Box!</Text>

            {mBoxStep==="roll" && (
              <>
                <Text style={S.luckTxt}>Roll to reveal your effect…</Text>
                <Animated.View style={{transform:[{translateX:mBoxAnim}]}}><DiceFace value={null} style={[S.diceFace,{fontSize:72}]}/></Animated.View>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#8e44ad"}]} onPress={handleMBoxRoll} disabled={mBoxRolling}>
                  <Text style={S.rollTxtBig}>{mBoxRolling?"Rolling…":"Open Box!"}</Text>
                </TouchableOpacity>
              </>
            )}

            {(mBoxStep==="apply"||mBoxStep==="inventory") && mBoxDef && (
              <View style={[S.mysteryCard,{borderColor:mBoxDef.color}]}>
                <Text style={S.mysteryEmoji}>{mBoxDef.emoji}</Text>
                <Text style={[S.mysteryTitle,{color:mBoxDef.color}]}>{mBoxDef.title}</Text>
                <Text style={S.mysteryDesc}>{mBoxStep==="inventory"?"Added to your inventory!":mBoxDef.desc}</Text>
                <TouchableOpacity style={[S.rollBtn,{backgroundColor:mBoxDef.color,marginTop:12}]} onPress={claimMBoxNoTarget}>
                  <Text style={S.rollTxtBig}>{mBoxStep==="inventory"?"Save to Inventory":"Claim!"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {mBoxStep==="target" && mBoxDef && (
              <>
                <View style={[S.mysteryCard,{borderColor:mBoxDef.color}]}>
                  <Text style={S.mysteryEmoji}>{mBoxDef.emoji}</Text>
                  <Text style={[S.mysteryTitle,{color:mBoxDef.color}]}>{mBoxDef.title}</Text>
                  <Text style={S.mysteryDesc}>{mBoxDef.desc}</Text>
                </View>
                <Text style={[S.luckTxt,{marginTop:14,fontSize:16}]}>Choose a player:</Text>
                {otherPs.map(p=>(
                  <TouchableOpacity key={p.name} style={[S.targetBtn,{borderColor:p.color||"#888"}]} onPress={()=>claimMBoxTarget(p)}>
                    <View style={{width:16,height:16,borderRadius:8,backgroundColor:p.color||"#888",marginRight:10}}/>
                    <Text style={[S.targetName,{color:p.color||"#fff"}]}>{p.name}</Text>
                    <Text style={S.targetPos}>Space {p.position||0}</Text>
                  </TouchableOpacity>
                ))}
                {otherPs.length===0 && <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#555",marginTop:12}]} onPress={closeMBox}><Text style={S.rollTxtBig}>No players — Close</Text></TouchableOpacity>}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Inventory full */}
      <Modal visible={!!invFullItem} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <CloseBtn onPress={()=>setInvFullItem(null)}/>
          <Text style={S.mTtl}>Inventory Full!</Text>
          <Text style={S.mDesc}>Discard an item to make room, or lose the new one.</Text>
          {inventory.map(item=>{
            const def=INVENTORY_DEFS[item.type];
            return (
              <TouchableOpacity key={item.id} style={[S.targetBtn,{width:"100%",marginVertical:4}]} onPress={()=>{removeFromInventory(item.id);setInventory(p=>[...p,{type:invFullItem.type,id:Date.now()}]);showItemToast(invFullItem.type, invFullItem.reason);setInvFullItem(null);}}>
                <Text style={{fontSize:22,marginRight:8}}>{def?.emoji}</Text>
                <Text style={{color:"#fff",flex:1}}>{def?.label}</Text>
                <Text style={{color:"#e74c3c"}}>Discard</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#333",marginTop:6}]} onPress={()=>setInvFullItem(null)}><Text style={S.rollTxtBig}>Lose Item</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* Roll-1 notification */}

      {/* ── STUN MODAL — top-level field detection mirrors 1v1 duel ── */}
      <Modal visible={isStunned} transparent animationType="fade">
        <View style={[S.overlay, {backgroundColor:"rgba(160,80,0,0.97)"}]}>
          <View style={[S.modal, {borderColor:"#f39c12",borderWidth:2.5,backgroundColor:"#2e1500",width:"92%",maxWidth:480}]}>
            <Text style={{fontSize:44,textAlign:"center"}}>😵</Text>
            <Text style={[S.mTtl,{color:"#f39c12",fontSize:26}]}>STUNNED!</Text>
            {stunBy ? <Text style={[S.mDesc,{color:"#ffcc88",fontSize:14,marginTop:-4}]}>by {stunBy}</Text> : null}
            <Text style={[S.mDesc,{color:"#ffcc88",fontSize:16}]}>
              Answer {ROLL_AT} questions correctly in a row to break free!
            </Text>
            <View style={{flexDirection:"row",gap:12,marginVertical:8}}>
              {[0,1,2].map(i=>(
                <View key={i} style={[S.rollDot, i<stunRecovery && {backgroundColor:"#f39c12",borderColor:"#f39c12",width:20,height:20,borderRadius:10}]}/>
              ))}
              <Text style={{color:"#ffcc88",fontSize:14,marginLeft:4}}>{stunRecovery}/{ROLL_AT}</Text>
            </View>
            {(() => {
              if (!qList.length) return <ActivityIndicator color="#f39c12"/>;
              const sq = qList[stunQIdx % qList.length];
              if (!sq) return <ActivityIndicator color="#f39c12"/>;
              return (
                <View style={{width:"100%",gap:12}}>
                  {sq.imageUrl ? (
                    <TouchableOpacity onPress={()=>setZoomImage(sq.imageUrl)} activeOpacity={0.85}>
                      <Image source={{uri:sq.imageUrl}} style={[S.qImage,{height:140}]} resizeMode="contain"/>
                      <Text style={S.zoomHint}>Tap to zoom</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[S.qTxt,{fontSize:22,color:"#fff",marginBottom:4}]}>{sq.question}</Text>
                  {(sq.type==="multipleChoice" ? sq.answers : sq.type==="multiSelect" ? sq.answers : ["True","False"]).map((ans,i) => {
                    const isSel = stunSelAns===i;
                    const isCorr = sq.correctAnswers?.[i]===true;
                    let bg="#3d2000", bc="#6b3a00";
                    if (isSel) { bg=isCorr?"#003d1a":"#3d0000"; bc=isCorr?"#00c781":"#e74c3c"; }
                    else if (stunSelAns!==null && isCorr) { bg="#003d1a"; bc="#00c781"; }
                    return (
                      <TouchableOpacity key={i} style={[S.aBtn,{backgroundColor:bg,borderColor:bc}]}
                        onPress={()=>handleStunAnswer(i)} disabled={stunSelAns!==null} activeOpacity={0.75}>
                        <Text style={S.aTxt}>{ans}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Duel countdown (3-2-1 before duel starts) */}
      <Modal visible={duelCountdown !== null} transparent animationType="fade">
        <View style={S.overlay}><View style={[S.modal,{borderColor:"#3498db",borderWidth:2}]}>
          <Text style={{fontSize:52}}>⚔️</Text>
          <Text style={[S.mTtl,{color:"#3498db"}]}>1v1 Starting!</Text>
          <Text style={{color:"#fff",fontSize:88,fontWeight:"900",textAlign:"center",lineHeight:96}}>{duelCountdown}</Text>
          <Text style={S.mDesc}>Get ready…</Text>
        </View></View>
      </Modal>

      {/* Effect notification */}
      <Modal visible={showNotif} transparent animationType="fade">
        <View style={S.overlay}><View style={[S.modal,{borderColor:"#e67e22",borderWidth:2}]}>
          <CloseBtn onPress={()=>{ setShowNotif(false); if(interruptedPhase){setPhaseSync(interruptedPhase);setInterruptedPhase(null);} }}/>
          <Text style={{fontSize:52}}>⚡</Text>
          <Text style={[S.mTtl,{color:"#e67e22"}]}>Effect Applied!</Text>
          <Text style={[S.mDesc,{fontSize:18,lineHeight:26}]}>{notif}</Text>
          <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#e67e22",marginTop:8}]} onPress={()=>{ setShowNotif(false); if(interruptedPhase){setPhaseSync(interruptedPhase);setInterruptedPhase(null);} }}><Text style={S.rollTxtBig}>Got it</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* Trap */}
      <Modal visible={phase==="space_event" && !!trapEvent} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <CloseBtn onPress={()=>{ clearInterval(trapRef.current); setTrapEvent(null); setPhaseSync("questions"); setDiceValue(null); }}/>
          <Text style={[S.mTtl,{color:"#d68910"}]}>Trap — Answer Fast!</Text>
          <Text style={[{color:"#fff",fontSize:40,fontWeight:"bold",textAlign:"center"},trapTimer<=3&&{color:"#e74c3c"}]}>{trapTimer}s</Text>
          {trapEvent?.question && (
            <>
              {trapEvent.question.imageUrl ? (
                <TouchableOpacity onPress={()=>setZoomImage(trapEvent.question.imageUrl)} activeOpacity={0.85}>
                  <Image source={{uri:trapEvent.question.imageUrl}} style={[S.qImage,{height:120}]} resizeMode="contain"/>
                  <Text style={S.zoomHint}>Tap to zoom</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={S.mDesc}>{trapEvent.question.question}</Text>
              <View style={S.aGrid}>
                {(trapEvent.question.type==="multipleChoice"?trapEvent.question.answers:trapEvent.question.type==="multiSelect"?trapEvent.question.answers:["True","False"]).map((ans,i)=>(
                  <TouchableOpacity key={i} style={[S.aBtn,{borderColor:"#555"}]} disabled={trapAnswered}
                    onPress={()=>{ clearInterval(trapRef.current); setTrapAnswered(true); resolveEvent({correct:trapEvent.question.correctAnswers?.[i]===true}); }}>
                    <Text style={S.aTxt}>{ans}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View></View>
      </Modal>

      {/* Game over */}
      {session?.status==="ended" && !gameOverDone && <GameOverModal session={session} myPos={myPos} boardEnd={boardEnd} onExit={()=>{ setGameOverDone(true); exitGame(); }}/>}

      {/* Kicked */}
      <Modal visible={!!(myState&&(session?.kickedPlayers||[]).includes(playerName))} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}><Text style={S.mTtl}>You've Been Kicked</Text><Text style={S.mDesc}>The host removed you.</Text><TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={()=>navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]})}><Text style={S.rollTxtBig}>Back</Text></TouchableOpacity></View></View>
      </Modal>
      <Modal visible={session?.status==="abandoned" && (!isHost||hostIsPlaying)} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}><Text style={S.mTtl}>Game Ended</Text><Text style={S.mDesc}>The host ended the game.</Text><TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={()=>navigation.reset({index:0,routes:[{name:"JoinGameScreen"}]})}><Text style={S.rollTxtBig}>Back</Text></TouchableOpacity></View></View>
      </Modal>

      {/* Image zoom modal — tap any question image to see it fullscreen */}
      <Modal visible={!!zoomImage} transparent animationType="fade">
        <TouchableOpacity style={S.zoomOverlay} activeOpacity={1} onPress={()=>setZoomImage(null)}>
          <Image source={{uri:zoomImage||""}} style={S.zoomImg} resizeMode="contain"/>
          <Text style={S.zoomClose}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>

      {/* Flash — fully opaque bg, text never fades */}
      {flashData && (
        <Animated.View style={[S.flashOverlay, {opacity: flashOpacity}]}>
          <View style={[S.flashBg, {backgroundColor: flashData.isCorrect ? "#27ae60" : "#c0392b"}]}/>
          <View style={S.flashContent}>
            <Text style={S.flashTtl}>{flashData.isCorrect ? "CORRECT" : "INCORRECT"}</Text>
            {!flashData.isCorrect && showCA && flashData.text ? (
              <>
                <Text style={S.flashSubLbl}>Correct answer</Text>
                <Text style={S.flashSubTxt}>"{flashData.text}"</Text>
              </>
            ) : null}
          </View>
        </Animated.View>
      )}

      {/* Item toast */}
      {itemToast && (
        <Animated.View style={[S.toast,{opacity:toastAnim,transform:[{translateY:toastAnim.interpolate({inputRange:[0,1],outputRange:[-60,0]})}]}]}>
          <Text style={S.toastTxt}>{itemToast.emoji} {itemToast.text}</Text>
        </Animated.View>
      )}

      {/* Leave */}
      <TouchableOpacity style={S.leaveBtn} onPress={handleLeave}><Text style={S.leaveBtnTxt}>Leave</Text></TouchableOpacity>

    </SafeAreaView>
  );
}

function GameOverModal({ session, myPos, boardEnd, onExit }) {
  const sorted = [...(session?.players||[])].sort((a,b) => (b.position||0)-(a.position||0));
  const w = sorted[0];
  return (
    <Modal visible transparent animationType="fade">
      <View style={S.overlay}><View style={S.modal}>
        <Text style={S.mTtl}>Game Over!</Text>
        {w&&<Text style={[S.mDesc,{fontSize:20}]}>🏆 <Text style={{color:w.color||"#00c781",fontWeight:"bold"}}>{w.name}</Text> wins! Space {w.position}</Text>}
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
        <TouchableOpacity style={[S.rollBtn,{backgroundColor:"#00c781"}]} onPress={onExit}><Text style={S.rollTxtBig}>Back to Menu</Text></TouchableOpacity>
      </View></View>
    </Modal>
  );
}

const S = StyleSheet.create({
  container:        { flex:1, backgroundColor:"#111" },
  containerStunned: { backgroundColor:"#2e200a" },
  center:           { flex:1, backgroundColor:"#111", justifyContent:"center", alignItems:"center" },

  hud:        { flexDirection:"row", alignItems:"center", backgroundColor:"#0a0a0a", borderBottomWidth:2, borderBottomColor:"#222", paddingVertical:22, paddingHorizontal:12, flexWrap:"wrap", gap:6 },
  hudStunned: { backgroundColor:"#3d2806" },
  hudCell:    { alignItems:"center", paddingHorizontal:14, minWidth:72 },
  hudLbl:     { color:"#555", fontSize:13, letterSpacing:1.2, fontWeight:"700" },
  hudVal:     { color:"#fff", fontSize:30, fontWeight:"bold", marginTop:4 },

  // Questions panic button
  qBtn:       { paddingHorizontal:18, paddingVertical:14, borderRadius:14, backgroundColor:"#1a1a1a", borderWidth:1.5, borderColor:"#555" },
  qBtnActive: { backgroundColor:"#002200", borderColor:"#00c781" },
  qBtnTxt:    { color:"#aaa", fontSize:13, fontWeight:"700" },

  mapBtn:     { paddingHorizontal:18, paddingVertical:14, borderRadius:14, backgroundColor:"#1a1a1a", borderWidth:1.5, borderColor:"#333" },
  mapBtnOn:   { backgroundColor:"#002a1a", borderColor:"#00c781" },
  mapBtnTxt:  { color:"#aaa", fontSize:16, fontWeight:"700" },
  hudEndBtn:  { paddingHorizontal:16, paddingVertical:14, borderRadius:14, backgroundColor:"#3a0000", borderWidth:1.5, borderColor:"#c0392b" },
  hudEndBtnTxt:{ color:"#ff6b6b", fontSize:16, fontWeight:"700" },

  timerTrack: { width:"100%", height:7, backgroundColor:"#1a1a1a" },
  timerFill:  { height:7, backgroundColor:"#00c781", alignSelf:"flex-start" },

  main: { flex:1 },

  qScroll:      { flexGrow:1, justifyContent:"center", padding:22, paddingRight:100, paddingBottom:80 },
  qCard:        { gap:16 },
  stunnedBanner:{ backgroundColor:"#5c3800", borderRadius:12, padding:14, marginBottom:8, borderWidth:1.5, borderColor:"#d68910" },
  stunnedTxt:   { color:"#f39c12", fontSize:16, fontWeight:"bold", textAlign:"center" },
  rollBar:      { flexDirection:"row", alignItems:"center", justifyContent:"center", gap:10, marginBottom:14 },
  rollDot:      { width:16, height:16, borderRadius:8, backgroundColor:"#2a2a2a", borderWidth:2, borderColor:"#444" },
  rollDotOn:    { backgroundColor:"#00c781", borderColor:"#00c781" },
  rollTxt2:     { color:"#555", fontSize:13, marginLeft:4 },
  qImage:       { width:"100%", height:200, borderRadius:12, marginBottom:4, backgroundColor:"#1e1e1e" },
  zoomHint:     { color:"#555", fontSize:11, textAlign:"center", marginBottom:12 },
  zoomOverlay:  { flex:1, backgroundColor:"rgba(0,0,0,0.95)", justifyContent:"center", alignItems:"center" },
  zoomImg:      { width:"100%", height:"80%", borderRadius:8 },
  zoomClose:    { color:"#666", fontSize:14, marginTop:16 },
  qTxt:         { color:"#fff", fontSize:28, fontWeight:"700", lineHeight:38, textAlign:"center" },
  aGrid:        { gap:12 },
  aBtn:         { borderRadius:14, padding:22, borderWidth:2.5, alignItems:"center" },
  aTxt:         { color:"#fff", fontSize:20, fontWeight:"600" },
  waitBox:      { alignItems:"center", paddingVertical:80, gap:14 },
  waitTxt:      { color:"#555", fontSize:16 },

  legend:       { flexDirection:"row", flexWrap:"wrap", justifyContent:"center", gap:10, paddingVertical:10 },
  legendItem:   { flexDirection:"row", alignItems:"center", gap:5 },
  legendSwatch: { width:16, height:16, borderRadius:3, borderWidth:1.5 },
  legendTxt:    { fontSize:12, fontWeight:"600" },

  diceBox:   { flex:1, alignItems:"center", justifyContent:"center", gap:18, backgroundColor:"#0d0d0d", padding:24, paddingRight:100 },
  diceTtl:   { color:"#fff", fontSize:26, fontWeight:"bold", textAlign:"center" },
  luckTxt:   { color:"#888", fontSize:15, textAlign:"center" },
  diceFace:  { fontSize:96, color:"#fff" },
  diceRes:   { color:"#00c781", fontSize:24, fontWeight:"bold" },
  rollBtn:   { backgroundColor:"#00c781", paddingVertical:20, paddingHorizontal:60, borderRadius:18 },
  rollTxtBig:{ color:"#000", fontSize:24, fontWeight:"bold" },

  movingBox: { flex:1, alignItems:"center", justifyContent:"center", gap:16, backgroundColor:"#0d0d0d" },
  movingTxt: { color:"#aaa", fontSize:18 },

  rolledBox:  { flex:1, alignItems:"center", justifyContent:"center", gap:16, backgroundColor:"#0d0d0d" },
  rolledEmoji:{ fontSize:64 },
  rolledTtl:  { color:"#fff", fontSize:26, fontWeight:"bold" },

  // Hotbar
  hotbar:      { position:"absolute", right:0, top:"35%", flexDirection:"column", alignItems:"center", gap:6, paddingVertical:12, paddingHorizontal:6, backgroundColor:"rgba(0,0,0,0.85)", borderTopLeftRadius:16, borderBottomLeftRadius:16 },
  hotbarSlot:  { width:80, height:80, borderRadius:12, backgroundColor:"#1a1a1a", borderWidth:2.5, borderColor:"#333", alignItems:"center", justifyContent:"center", gap:3 },
  hotbarSlotFull: { backgroundColor:"#1e1a00" },
  hotbarEmoji: { fontSize:28 },
  hotbarLabel: { color:"#fff", fontSize:9, fontWeight:"700", textAlign:"center", paddingHorizontal:2 },
  hotbarEmpty: { color:"#333", fontSize:22 },
  hotbarHint:  { color:"#444", fontSize:8, fontWeight:"700", textAlign:"center", marginTop:4 },

  // Mystery overlay
  mysteryOverlay: { flex:1, backgroundColor:"rgba(0,0,0,0.82)", justifyContent:"center", alignItems:"center" },
  mysteryPanel:   { backgroundColor:"#160a22", borderRadius:24, borderWidth:2, borderColor:"#8e44ad", padding:28, width:"85%", maxWidth:440, alignItems:"center", gap:14, position:"relative" },
  mysteryBigTtl:  { color:"#8e44ad", fontSize:30, fontWeight:"900", textAlign:"center" },
  mysteryCard:    { backgroundColor:"#1a0a2a", borderRadius:20, borderWidth:2, padding:24, alignItems:"center", gap:8, width:"100%" },
  mysteryEmoji:   { fontSize:52 },
  mysteryTitle:   { fontSize:26, fontWeight:"bold", textAlign:"center" },
  mysteryDesc:    { color:"#ccc", fontSize:16, textAlign:"center", lineHeight:24 },
  targetBtn:      { flexDirection:"row", alignItems:"center", backgroundColor:"#1a1a1a", borderRadius:14, borderWidth:2, paddingVertical:14, paddingHorizontal:18, marginVertical:3 },
  targetName:     { flex:1, fontSize:18, fontWeight:"600" },
  targetPos:      { color:"#555", fontSize:14 },

  duelScroll:     { flexGrow:1, justifyContent:"flex-start", padding:24, paddingBottom:80, alignItems:"center", gap:14 },

  // Close button
  closeBtn:    { position:"absolute", top:12, right:12, width:32, height:32, borderRadius:16, backgroundColor:"rgba(255,255,255,0.1)", alignItems:"center", justifyContent:"center", zIndex:10 },
  closeBtnTxt: { color:"#aaa", fontSize:16, fontWeight:"bold" },

  // Toast
  toast:    { position:"absolute", bottom:24, right:100, backgroundColor:"#1a1a00", borderWidth:1.5, borderColor:"#f39c12", borderRadius:14, paddingVertical:10, paddingHorizontal:16, zIndex:998, maxWidth:260 },
  toastTxt: { color:"#f39c12", fontSize:13, fontWeight:"bold", lineHeight:18 },

  flashOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0, zIndex:999 },
  flashBg:      { position:"absolute", top:0, left:0, right:0, bottom:0 },
  flashContent: { flex:1, justifyContent:"center", alignItems:"center" },
  flashTtl:     { color:"#fff", fontSize:72, fontWeight:"900", letterSpacing:2, textAlign:"center" },
  flashSubLbl:  { color:"rgba(255,255,255,0.85)", fontSize:22, marginTop:20 },
  flashSubTxt:  { color:"#fff", fontSize:28, fontWeight:"bold", textAlign:"center", paddingHorizontal:32 },

  hostHeader: { flexDirection:"row", justifyContent:"space-between", alignItems:"center", padding:18, backgroundColor:"#0a0a0a", borderBottomWidth:1, borderBottomColor:"#222" },
  hostTitle:  { color:"#00c781", fontSize:20, fontWeight:"bold" },
  timerTxt:   { color:"#fff", fontSize:18, fontWeight:"bold" },
  endBtn:     { backgroundColor:"#c0392b", paddingVertical:10, paddingHorizontal:22, borderRadius:12 },
  endBtnTxt:  { color:"#fff", fontWeight:"bold", fontSize:15 },
  hostBody:   { flex:1, flexDirection:"row" },
  hostSide:   { width:380, backgroundColor:"#0a0a0a", padding:24, borderLeftWidth:1, borderLeftColor:"#222" },
  lbTitle:    { color:"#00c781", fontSize:32, fontWeight:"bold", marginBottom:24 },
  lbRow:      { flexDirection:"row", alignItems:"center", paddingVertical:18, borderBottomWidth:1, borderBottomColor:"#1a1a1a" },
  lbRank:     { color:"#fff", width:60, fontSize:28, fontWeight:"bold" },
  lbDot:      { width:26, height:26, borderRadius:13, marginRight:16 },
  lbName:     { color:"#fff", fontSize:26, fontWeight:"500", flex:1 },
  lbPos:      { color:"#aaa", fontSize:24 },

  leaveBtn:    { position:"absolute", bottom:12, left:16, backgroundColor:"#2a0000", paddingVertical:12, paddingHorizontal:22, borderRadius:12 },
  leaveBtnTxt: { color:"#ff6b6b", fontSize:15, fontWeight:"bold" },

  overlay: { flex:1, backgroundColor:"rgba(0,0,0,0.92)", justifyContent:"center", alignItems:"center" },
  modal:   { backgroundColor:"#1a1a1a", borderRadius:22, padding:28, width:"90%", maxWidth:440, alignItems:"center", borderWidth:1, borderColor:"#2a2a2a", gap:12, position:"relative" },
  mTtl:    { color:"#fff", fontSize:24, fontWeight:"bold", textAlign:"center" },
  mDesc:   { color:"#bbb", fontSize:16, textAlign:"center", lineHeight:22 },
});