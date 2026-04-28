/**
 * Lobby.js
 * Space distribution: 60% mystery, 10% normal, 10% lava, 10% cannon, 10% trap
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  SafeAreaView, Modal, ScrollView, Animated, Dimensions, TextInput,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";

const BOARD_COLS = 10;
const { width: SCREEN_W } = Dimensions.get("window");
const TILE_SIZE = Math.min(48, Math.floor((SCREEN_W - 64) / BOARD_COLS));

const SPACE_CFG = {
  normal:  { bg: "#1a3d1a", border: "#27ae60", label: ""  },
  lava:    { bg: "#3d1200", border: "#e74c3c", label: "L" },
  cannon:  { bg: "#00213d", border: "#2980b9", label: "C" },
  trap:    { bg: "#3d2d00", border: "#d68910", label: "T" },
  mystery: { bg: "#2a0a3d", border: "#8e44ad", label: "?" },
};

// Distribution: 60% mystery, 10% normal, 10% lava, 10% cannon, 10% trap (pool of 10)
const SPACE_POOL = [
  "mystery", "mystery", "mystery", "mystery", "mystery", "mystery",
  "normal",
  "lava",
  "cannon",
  "trap",
];

const calcBoardSize = (n) =>
  Math.min(150, Math.round(9.14 * Math.pow(Math.max(1, n - 1), 0.714) + 25));

function Pawn({ color, size = 14 }) {
  const c = color || "#888";
  const s = size;
  return (
    <View style={{ width: s, height: s * 1.25, alignItems: "center", justifyContent: "flex-end" }}>
      <View style={{ width: s * 0.44, height: s * 0.44, borderRadius: s * 0.22,
          backgroundColor: c, borderWidth: 1.5, borderColor: "rgba(0,0,0,0.55)" }}>
        <View style={{ position:"absolute", top: s*0.06, left: s*0.09,
            width: s*0.13, height: s*0.11, borderRadius: s*0.06,
            backgroundColor: "rgba(255,255,255,0.35)" }} />
      </View>
      <View style={{ width: s * 0.14, height: s * 0.1, backgroundColor: c,
          borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: "rgba(0,0,0,0.55)" }} />
      <View style={{ width: s * 0.62, height: s * 0.22,
          borderTopLeftRadius: s * 0.04, borderTopRightRadius: s * 0.04,
          borderBottomLeftRadius: s * 0.12, borderBottomRightRadius: s * 0.12,
          backgroundColor: c, borderWidth: 1.5, borderColor: "rgba(0,0,0,0.55)" }} />
      <View style={{ width: s * 0.78, height: s * 0.14, borderRadius: s * 0.04,
          backgroundColor: c, borderWidth: 1.5, borderColor: "rgba(0,0,0,0.55)" }} />
    </View>
  );
}

function buildSnakeRows(total) {
  const rows = [];
  for (let r = 0; r <= total; r += BOARD_COLS) {
    const row = [];
    for (let s = r; s < r + BOARD_COLS && s <= total; s++) row.push(s);
    if (Math.floor(r / BOARD_COLS) % 2 === 1) row.reverse();
    rows.push(row);
  }
  return rows.reverse();
}

const NICK_ADJ  = ["Swift","Brave","Clever","Bold","Quick","Bright","Sharp","Fierce","Calm","Wild","Sly","Wise","Daring","Lucky","Keen"];
const NICK_NOUN = ["Fox","Wolf","Eagle","Bear","Lion","Tiger","Hawk","Shark","Raven","Dragon","Falcon","Puma","Cobra","Viper","Lynx"];
const randomNick = () =>
  NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)] +
  NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)] +
  Math.floor(Math.random() * 100);

function BoardPreview({ players, boardSize }) {
  const sz   = Math.min(TILE_SIZE, Math.floor((SCREEN_W - 64) / BOARD_COLS));
  const rows = buildSnakeRows(boardSize);

  const sampleBoard = useMemo(() => {
    return Array.from({ length: boardSize + 1 }, (_, i) => {
      if (i === 0 || i === boardSize) return { type: "normal" };
      return { type: SPACE_POOL[Math.floor(Math.random() * SPACE_POOL.length)] };
    });
  }, [boardSize]);

  const playersAt = (idx) => players.filter((p) => (p.position || 0) === idx);

  return (
    <View style={brd.wrapper}>
      <Text style={brd.title}>Board Preview — {boardSize} tiles</Text>
      <Text style={brd.sub}>(Sample — actual layout generated at start)</Text>
      <ScrollView nestedScrollEnabled>
        {rows.map((row, ri) => (
          <View key={ri} style={brd.row}>
            {row.map((idx) => {
              const type    = sampleBoard[idx] ? sampleBoard[idx].type : "normal";
              const cfg     = SPACE_CFG[type] || SPACE_CFG.normal;
              const isEnd   = idx === boardSize;
              const isStart = idx === 0;
              const here    = playersAt(idx);
              return (
                <View key={idx} style={[
                  brd.tile,
                  { width: sz, height: sz, backgroundColor: cfg.bg, borderColor: cfg.border },
                  (isEnd || isStart) && brd.tileSpecial,
                ]}>
                  {isEnd ? (
                    <Text style={[brd.lbl, { color: "#2980b9", fontSize: sz * 0.28 }]}>END</Text>
                  ) : isStart ? (
                    <Text style={[brd.lbl, { color: "#27ae60", fontSize: sz * 0.28 }]}>GO</Text>
                  ) : type !== "normal" ? (
                    <Text style={[brd.lbl, { color: cfg.border, fontSize: sz * 0.38 }]}>{cfg.label}</Text>
                  ) : (
                    <Text style={[brd.num, { fontSize: sz * 0.26 }]}>{idx}</Text>
                  )}
                  {here.length > 0 && (
                    <View style={brd.tokens}>
                      {here.slice(0, 4).map((p, i) => (
                        <Pawn key={i} color={p.color || "#888"} size={sz * 0.55}/>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={brd.legend}>
        {Object.entries(SPACE_CFG).map(([type, cfg]) => (
          <View key={type} style={brd.legendRow}>
            <View style={[brd.swatch, { backgroundColor: cfg.bg, borderColor: cfg.border }]} />
            <Text style={[brd.legendTxt, { color: cfg.border }]}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const brd = StyleSheet.create({
  wrapper:     { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, marginTop: 20, borderWidth: 1, borderColor: "#222" },
  title:       { color: "#00c781", fontSize: 15, fontWeight: "bold", marginBottom: 4, textAlign: "center" },
  sub:         { color: "#444", fontSize: 11, textAlign: "center", marginBottom: 10 },
  row:         { flexDirection: "row", justifyContent: "center", marginBottom: 3 },
  tile:        { borderRadius: 7, margin: 2, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  tileSpecial: { borderWidth: 2 },
  lbl:         { fontWeight: "bold" },
  num:         { color: "#3a5a3a", fontWeight: "bold" },
  tokens:      { position: "absolute", bottom: 2, flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  token:       { width: 7, height: 7, borderRadius: 4, margin: 1 },
  legend:      { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#222" },
  legendRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  swatch:      { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5 },
  legendTxt:   { fontSize: 11, fontWeight: "600" },
});

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [players,    setPlayers]    = useState([]);
  const [session,    setSession]    = useState(null);
  const [locked,     setLocked]     = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [showLeave,  setShowLeave]  = useState(false);
  const [kickTarget, setKickTarget] = useState(null);
  const [starting,   setStarting]   = useState(false);
  const [writeError, setWriteError] = useState(null);

  // Host-plays: name & color chosen in lobby before start
  const [hostName,   setHostName]   = useState("");
  const [hostColor,  setHostColor]  = useState("#00c781");
  const [hostNameErr,setHostNameErr]= useState(false);
  const hostUid = useRef("host_" + Date.now()).current;

  const sessionRef = useRef(null);
  const pinPulse   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pinPulse, { toValue: 1.03, duration: 1200, useNativeDriver: false }),
      Animated.timing(pinPulse, { toValue: 1.0,  duration: 1200, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      sessionRef.current = data;
      setSession(data);
      setPlayers(data.players || []);
      setLocked(data.isLobbyLocked || false);
      setLoading(false);
      if (!isHost && data.status === "abandoned") {
        navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] });
      }
    });
  }, [sessionId, isHost]);

  const toggleLock = async () => {
    try {
      await updateDoc(doc(db, "gameSessions", sessionId), { isLobbyLocked: !locked });
    } catch (err) { setWriteError("Lock failed: " + err.message); }
  };

  const confirmKick = async (player) => {
    setKickTarget(null);
    setWriteError(null);
    try {
      const sess = sessionRef.current;
      if (!sess) return;
      const upd    = (sess.players || []).filter((p) => p.name !== player.name);
      const kicked = [...(sess.kickedPlayers || [])];
      if (!kicked.includes(player.name)) kicked.push(player.name);
      await updateDoc(doc(db, "gameSessions", sessionId), { players: upd, kickedPlayers: kicked });
    } catch (err) {
      console.error("Kick:", err);
      setWriteError("Kick failed — " + err.message + ". Check Firestore rules.");
    }
  };

  const handleStartGame = async () => {
    const hostPlays = session?.settings?.hostPlays;

    // If hostPlays is on, the host must have entered a name
    if (hostPlays) {
      if (!hostName.trim()) { setHostNameErr(true); setWriteError("Enter your name before starting."); return; }
    }
    if (players.length === 0 && !hostPlays) { setWriteError("Wait for at least one player."); return; }
    if (starting) return;
    setStarting(true);
    setWriteError(null);
    setHostNameErr(false);

    try {
      const sd = sessionRef.current;
      if (!sd) { setStarting(false); return; }
      const currentPlayers = sd.players || [];
      const manualSize     = sd.settings ? sd.settings.boardSize : null;
      const boardEnd       = (manualSize != null && manualSize > 0)
        ? manualSize : calcBoardSize(currentPlayers.length);

      const board = Array.from({ length: boardEnd + 1 }, (_, i) => ({
        index: i,
        type:  (i === 0 || i === boardEnd)
          ? "normal"
          : SPACE_POOL[Math.floor(Math.random() * SPACE_POOL.length)],
      }));

      let finalPlayers = currentPlayers;
      if (sd.settings && sd.settings.nicknameGenerator) {
        const used = new Set();
        finalPlayers = currentPlayers.map((p) => {
          let nick = randomNick();
          while (used.has(nick)) nick = randomNick();
          used.add(nick);
          return { ...p, name: nick };
        });
      }

      let questions = [];
      const gid = sd.gameId || gameId;
      if (gid) {
        const gSnap = await getDoc(doc(db, "games", gid));
        if (gSnap.exists()) {
          questions = (gSnap.data() || {}).questions || [];

          // ── Fisher-Yates shuffle helper ──────────────────────────────────
          const shuffle = (arr) => {
            const a = [...arr];
            for (let i = a.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [a[i], a[j]] = [a[j], a[i]];
            }
            return a;
          };

          // Question/answer randomisation now happens per-player in BoardGameScreen
          // so each player gets a unique order every game.
        }
      }

      const durSecs = ((sd.settings && sd.settings.gameDuration) || 10) * 60;
      const hostPlays = !!(sd.settings && sd.settings.hostPlays);

      // If hostPlays is on, inject the host as the first player
      if (hostPlays) {
        const hName  = hostName.trim() || "Host";
        const hColor = hostColor;
        const hostPlayer = {
          uid: hostUid, name: hName, color: hColor,
          joinedAt: new Date().toISOString(),
          score: 0, position: 0, correctStreak: 0, totalCorrect: 0,
          luck: 0, stunned: false, isHostPlayer: true,
        };
        if (!finalPlayers.some(p => p.uid === hostUid)) {
          finalPlayers = [hostPlayer, ...finalPlayers];
        }
      }

      await updateDoc(doc(db, "gameSessions", sessionId), {
        status:               "playing",
        board,
        players:              finalPlayers,
        questions,
        currentQuestionIndex: 0,
        gameEndsAt:           Date.now() + durSecs * 1000,
        settings:             { ...(sd.settings || {}), boardSize: boardEnd },
      });

      if (hostPlays) {
        navigation.replace("BoardGameScreen", {
          sessionId,
          gameId:        gid,
          playerName:    hostName.trim() || "Host",
          playerColor:   hostColor,
          playerUid:     hostUid,
          isHost:        true,
          hostIsPlaying: true,
        });
      } else {
        navigation.replace("BoardGameScreen", {
          sessionId,
          gameId:     gid,
          playerName: "Host",
          playerColor:"#00c781",
          isHost:     true,
        });
      }
    } catch (err) {
      console.error("Start:", err);
      setWriteError("Failed to start — " + err.message + ". Check Firestore rules.");
      setStarting(false);
    }
  };

  const handleLeaveConfirm = async () => {
    setShowLeave(false);
    if (isHost) {
      try { await updateDoc(doc(db, "gameSessions", sessionId), { status: "abandoned" }); } catch {}
      navigation.navigate("Dashboard");
    } else {
      navigation.navigate("JoinGameScreen");
    }
  };

  if (loading) return (
    <SafeAreaView style={S.container}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadTxt}>Loading lobby…</Text>
    </SafeAreaView>
  );

  const maxPlayers  = (session && session.settings) ? session.settings.maxPlayers || 30 : 30;
  const manualSize  = (session && session.settings) ? session.settings.boardSize : null;
  const previewSize = (manualSize != null && manualSize > 0) ? manualSize : calcBoardSize(players.length);

  return (
    <SafeAreaView style={S.container}>
      <ScrollView contentContainerStyle={S.scroll}>

        {writeError ? (
          <View style={S.errBanner}>
            <Text style={S.errTxt} numberOfLines={3}>{writeError}</Text>
            <TouchableOpacity onPress={() => setWriteError(null)}>
              <Text style={S.errClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Animated.View style={[S.pinCard, { transform: [{ scale: pinPulse }] }]}>
          <Text style={S.pinLbl}>GAME PIN</Text>
          <Text style={S.pin}>{pin || "------"}</Text>
          <Text style={S.pinHint}>Share with players</Text>
        </Animated.View>

        <Text style={S.countTxt}>{players.length} / {maxPlayers} players</Text>

        <View style={S.settingsBox}>
          <Text style={S.settingsLbl}>Settings</Text>
          <View style={S.settingsRow}>
            <Text style={S.settingsItem}>
              Duration: {(session && session.settings) ? session.settings.gameDuration || 10 : 10} min
            </Text>
            <Text style={S.settingsItem}>
              Time/Q: {(session && session.settings) ? session.settings.timePerQuestion || 20 : 20}s
            </Text>
            <Text style={S.settingsItem}>
              Tiles: {manualSize != null ? manualSize : "Auto (~" + previewSize + ")"}
            </Text>
          </View>
          {(session && session.settings && session.settings.nicknameGenerator) ? (
            <Text style={S.badge}>🎲 Nickname generator ON</Text>
          ) : null}
          {(session && session.settings && session.settings.randomizeQuestions) ? (
            <Text style={S.badge}>🔀 Questions randomized</Text>
          ) : null}
          {(session && session.settings && session.settings.randomizeAnswers) ? (
            <Text style={S.badge}>🔀 Answer order randomized</Text>
          ) : null}
          {(session && session.settings && session.settings.showCorrectAnswer === false) ? (
            <Text style={[S.badge, { color: "#e74c3c" }]}>❌ Correct answer hidden</Text>
          ) : null}
        </View>

        {/* Host-plays name & color picker — only shown when setting is on */}
        {isHost && session?.settings?.hostPlays ? (
          <View style={S.hostPickerBox}>
            <Text style={S.hostPickerTitle}>🎮 You're playing! Enter your name</Text>
            <TextInput
              style={[S.hostNameInput, hostNameErr && S.hostNameInputErr]}
              placeholder="Your name…"
              placeholderTextColor="#444"
              value={hostName}
              onChangeText={t => { setHostName(t); setHostNameErr(false); setWriteError(null); }}
              maxLength={20}
              autoCapitalize="words"
            />
            <Text style={S.hostPickerSubtitle}>Pick your colour</Text>
            <View style={S.hostColorRow}>
              {["#00c781","#e74c3c","#e67e22","#f1c40f","#3498db","#9b59b6","#e91e63","#1abc9c","#ff5722","#00bcd4"].map(c => {
                const taken  = players.some(p => p.color === c);
                const active = hostColor === c;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => !taken && setHostColor(c)}
                    disabled={taken}
                    style={[S.hostSwatch, { backgroundColor: c }, active && S.hostSwatchActive, taken && S.hostSwatchTaken]}
                  >
                    {active && <Text style={S.hostSwatchCheck}>✓</Text>}
                    {taken  && <Text style={S.hostSwatchCheck}>✕</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {players.length === 0 ? (
          <View style={S.emptyArea}>
            <Text style={S.emptyTxt}>Waiting for players to join…</Text>
          </View>
        ) : (
          <View style={S.playerGrid}>
            {players.map((item, index) => (
              <View key={item.uid || index} style={S.playerCard}>
                <Pawn color={item.color || "#888"} size={18}/>
                <View style={{width:8}}/>
                <Text style={S.playerName} numberOfLines={1}>{item.name || "Player"}</Text>
                {isHost ? (
                  <TouchableOpacity style={S.kickBtn} onPress={() => setKickTarget(item)}>
                    <Text style={S.kickTxt}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))}
          </View>
        )}

        <BoardPreview players={players} boardSize={previewSize} />
      </ScrollView>

      {isHost ? (
        <View style={S.hostBar}>
          <TouchableOpacity style={[S.lockBtn, locked && S.lockOn]} onPress={toggleLock}>
            <Text style={[S.lockTxt, locked && { color: "#00c781" }]}>
              {locked ? "LOCKED" : "OPEN"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.startBtn, (players.length === 0 || starting) && S.startOff]}
            onPress={handleStartGame}
            disabled={players.length === 0 || starting}
          >
            <Text style={S.startTxt}>{starting ? "Starting…" : "Start Game"}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveTxt}>Leave</Text>
      </TouchableOpacity>

      <Modal visible={!!kickTarget} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>Kick Player?</Text>
          <Text style={S.mTxt}>
            Remove{" "}
            <Text style={{ color: kickTarget ? kickTarget.color || "#fff" : "#fff", fontWeight: "bold" }}>
              {kickTarget ? kickTarget.name : ""}
            </Text>
            {" "}from the game?
          </Text>
          <View style={S.mRow}>
            <TouchableOpacity style={S.mGrey} onPress={() => setKickTarget(null)}>
              <Text style={S.mBtnTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.mRed} onPress={() => confirmKick(kickTarget)}>
              <Text style={S.mBtnTxt}>Kick</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.overlay}><View style={S.modal}>
          <Text style={S.mTtl}>{isHost ? "Close Lobby?" : "Leave Lobby?"}</Text>
          <Text style={S.mTxt}>{isHost ? "This will disconnect all players." : "Are you sure?"}</Text>
          <View style={S.mRow}>
            <TouchableOpacity style={S.mGrey} onPress={() => setShowLeave(false)}>
              <Text style={S.mBtnTxt}>Stay</Text>
            </TouchableOpacity>
            <TouchableOpacity style={S.mRed} onPress={handleLeaveConfirm}>
              <Text style={S.mBtnTxt}>Leave</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  scroll:    { padding: 20, paddingBottom: 140 },
  loadTxt:   { color: "#fff", marginTop: 16, fontSize: 18, textAlign: "center" },
  errBanner: { backgroundColor: "#3a0000", borderRadius: 10, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: "#e74c3c" },
  errTxt:    { color: "#ff6b6b", fontSize: 13, flex: 1, lineHeight: 18 },
  errClose:  { color: "#ff6b6b", fontSize: 16, fontWeight: "bold", marginLeft: 8 },
  pinCard:   { backgroundColor: "#1e1e1e", borderRadius: 22, padding: 28, alignItems: "center", marginBottom: 16, borderWidth: 2, borderColor: "#00c781" },
  pinLbl:    { color: "#888", fontSize: 13, letterSpacing: 4, marginBottom: 8 },
  pin:       { fontSize: 60, fontWeight: "bold", color: "#00c781", letterSpacing: 14 },
  pinHint:   { color: "#555", fontSize: 13, marginTop: 6 },
  countTxt:  { color: "#888", fontSize: 16, textAlign: "center", marginBottom: 12 },
  settingsBox:  { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#2a2a2a" },
  settingsLbl:  { color: "#666", fontSize: 11, letterSpacing: 1, fontWeight: "bold", marginBottom: 6 },
  settingsRow:  { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  settingsItem: { color: "#ccc", fontSize: 14 },
  badge:        { color: "#00c781", fontSize: 12, marginTop: 4 },
  emptyArea:  { alignItems: "center", paddingVertical: 36 },
  emptyTxt:   { color: "#555", fontSize: 17 },

  hostPickerBox:     { backgroundColor: "#0d1a12", borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1.5, borderColor: "#00c781" },
  hostPickerTitle:   { color: "#00c781", fontSize: 15, fontWeight: "bold", marginBottom: 10 },
  hostPickerSubtitle:{ color: "#888", fontSize: 12, marginTop: 12, marginBottom: 8 },
  hostNameInput:     { backgroundColor: "#1e1e1e", color: "#fff", fontSize: 18, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: "#333" },
  hostNameInputErr:  { borderColor: "#e74c3c" },
  hostColorRow:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hostSwatch:        { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center", borderWidth: 2.5, borderColor: "transparent" },
  hostSwatchActive:  { borderColor: "#fff", transform: [{ scale: 1.2 }] },
  hostSwatchTaken:   { opacity: 0.25 },
  hostSwatchCheck:   { color: "#fff", fontSize: 14, fontWeight: "bold" },
  playerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  playerCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#2a2a2a", minWidth: 120, flex: 1 },
  playerDot:  { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  playerName: { color: "#fff", fontSize: 15, flex: 1 },
  kickBtn:    { backgroundColor: "#3a0000", borderRadius: 8, width: 26, height: 26, justifyContent: "center", alignItems: "center", marginLeft: 6 },
  kickTxt:    { color: "#ff6b6b", fontSize: 13, fontWeight: "bold" },
  hostBar:    { position: "absolute", bottom: 50, left: 0, right: 0, flexDirection: "row", gap: 12, paddingHorizontal: 20, alignItems: "center" },
  lockBtn:    { backgroundColor: "#1e1e1e", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "#333" },
  lockOn:     { backgroundColor: "#003322", borderColor: "#00c781" },
  lockTxt:    { color: "#888", fontSize: 12, fontWeight: "bold" },
  startBtn:   { flex: 1, backgroundColor: "#00c781", borderRadius: 16, paddingVertical: 18, alignItems: "center" },
  startOff:   { backgroundColor: "#1e1e1e", opacity: 0.4 },
  startTxt:   { color: "#000", fontSize: 19, fontWeight: "bold" },
  leaveBtn:   { position: "absolute", bottom: 12, left: 20, backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  leaveTxt:   { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal:      { backgroundColor: "#1e1e1e", borderRadius: 20, padding: 28, width: "85%", maxWidth: 360, borderWidth: 1, borderColor: "#333" },
  mTtl:       { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  mTxt:       { color: "#ccc", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  mRow:       { flexDirection: "row", gap: 12 },
  mGrey:      { flex: 1, backgroundColor: "#2a2a2a", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  mRed:       { flex: 1, backgroundColor: "#c0392b", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  mBtnTxt:    { color: "#fff", fontWeight: "bold" },
});