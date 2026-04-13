/**
 * Lobby.js — HOST-ONLY Lobby Screen
 *
 * Fixed:
 * - Kick uses arrayRemove (atomic Firestore op — no race condition, no stale reads)
 * - Settings modal removed — all settings live in HostGameMenu
 * - boardSize: session.settings.boardSize if set manually; otherwise formula
 * - Formula: f(x) = 9.14*(x-1)^0.714 + 25, max 150
 * - No minimum floor on manual boardSize — if host sets 1, board has 1 tile
 * - Host leave sets status='abandoned' → all connected clients navigate away
 * - Leave button bottom-left on screen
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  SafeAreaView, Modal, Alert, ScrollView, Animated, Dimensions,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, getDoc } from "firebase/firestore";

const BOARD_COLS = 10;
const { width: SCREEN_W } = Dimensions.get("window");
const TILE_SIZE = Math.min(52, Math.floor((SCREEN_W - 64) / BOARD_COLS));

const calcBoardSize = (numPlayers) =>
  Math.min(150, Math.round(9.14 * Math.pow(Math.max(1, numPlayers - 1), 0.714) + 25));

const NICK_ADJ  = ["Swift","Brave","Clever","Bold","Quick","Bright","Sharp","Fierce","Calm","Wild","Sly","Wise","Daring","Lucky","Keen"];
const NICK_NOUN = ["Fox","Wolf","Eagle","Bear","Lion","Tiger","Hawk","Shark","Raven","Dragon","Falcon","Puma","Cobra","Viper","Lynx"];
const randomNick = () =>
  NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)] +
  NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)] +
  Math.floor(Math.random() * 100);

function buildSnakeRows(total) {
  const rows = [];
  for (let rowStart = 0; rowStart <= total; rowStart += BOARD_COLS) {
    const spaces = [];
    for (let s = rowStart; s < rowStart + BOARD_COLS && s <= total; s++) spaces.push(s);
    if (Math.floor(rowStart / BOARD_COLS) % 2 === 1) spaces.reverse();
    rows.push(spaces);
  }
  return rows.reverse();
}

function BoardPreview({ players, boardSize }) {
  const rows = buildSnakeRows(boardSize);
  const sz   = Math.min(TILE_SIZE, Math.floor((SCREEN_W - 64) / BOARD_COLS));
  const atPos = (idx) => players.filter((p) => (p.position || 0) === idx);
  return (
    <View style={brd.wrapper}>
      <Text style={brd.title}>Board Preview — {boardSize} tiles</Text>
      <ScrollView>
        {rows.map((row, ri) => (
          <View key={ri} style={brd.row}>
            {row.map((idx) => {
              const here  = atPos(idx);
              return (
                <View key={idx} style={[brd.tile, { width: sz, height: sz }, idx === boardSize && brd.tileEnd, idx === 0 && brd.tileStart]}>
                  <Text style={brd.tileNum}>{idx === boardSize ? "END" : idx === 0 ? "GO" : idx}</Text>
                  <View style={brd.tokens}>{here.slice(0,4).map((p,pi) => <View key={pi} style={[brd.token,{backgroundColor:p.color||"#888"}]}/>)}</View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
const brd = StyleSheet.create({
  wrapper:   { backgroundColor:"#0d0d0d", borderRadius:16, padding:14, marginTop:20, borderWidth:1, borderColor:"#222" },
  title:     { color:"#00c781", fontSize:15, fontWeight:"bold", marginBottom:10, textAlign:"center" },
  row:       { flexDirection:"row", justifyContent:"center", marginBottom:3 },
  tile:      { borderRadius:7, margin:2, alignItems:"center", justifyContent:"center", backgroundColor:"#1a2a1a", borderWidth:1, borderColor:"#2a3a2a" },
  tileEnd:   { backgroundColor:"#001a3d", borderColor:"#3498db", borderWidth:2 },
  tileStart: { backgroundColor:"#003322", borderColor:"#00c781" },
  tileNum:   { color:"#555", fontSize:10, fontWeight:"bold" },
  tokens:    { flexDirection:"row", flexWrap:"wrap", justifyContent:"center" },
  token:     { width:7, height:7, borderRadius:4, margin:1 },
});

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [session,       setSession]       = useState(null);
  const [players,       setPlayers]       = useState([]);
  const [isLobbyLocked, setIsLobbyLocked] = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [showLeave,     setShowLeave]     = useState(false);
  const [kickTarget,    setKickTarget]    = useState(null);
  const [hoveredPlayer, setHoveredPlayer] = useState(null);
  const [starting,      setStarting]      = useState(false);

  const pinPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pinPulse, { toValue: 1.03, duration: 1200, useNativeDriver: true }),
      Animated.timing(pinPulse, { toValue: 1,    duration: 1200, useNativeDriver: true }),
    ])).start();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    return onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      setPlayers(data.players || []);
      setIsLobbyLocked(data.isLobbyLocked || false);
      setLoading(false);
      // If host abandoned the session, non-host players leave
      if (!isHost && data.status === "abandoned") {
        navigation.reset({ index: 0, routes: [{ name: "JoinGameScreen" }] });
      }
    });
  }, [sessionId, isHost]);

  const toggleLobbyLock = async () => {
    try {
      await updateDoc(doc(db, "gameSessions", sessionId), { isLobbyLocked: !isLobbyLocked });
    } catch { Alert.alert("Error", "Failed to update lock."); }
  };

  // KICK FIX: arrayRemove is atomic — Firestore removes the exact object from
  // the array in a single operation, no stale reads, no race conditions.
  const confirmKick = async (player) => {
    setKickTarget(null);
    try {
      await updateDoc(doc(db, "gameSessions", sessionId), {
        players:       arrayRemove(player),      // removes exact matching object
        kickedPlayers: arrayUnion(player.name),  // blocks re-join
      });
    } catch (err) {
      console.error("Kick error:", err);
      Alert.alert("Error", "Failed to kick player.");
    }
  };

  // START GAME — reads settings from HostGameMenu (already in session.settings)
  const handleStartGame = async () => {
    if (players.length === 0) { Alert.alert("No Players", "Wait for at least one player to join."); return; }
    if (starting) return;
    setStarting(true);

    try {
      const snap = await getDoc(doc(db, "gameSessions", sessionId));
      if (!snap.exists()) { setStarting(false); return; }
      const sd = snap.data();
      const currentPlayers = sd.players || [];

      // Board size: manual override takes priority; otherwise compute from formula
      const manualSize = sd.settings?.boardSize;
      const boardEnd   = (manualSize != null && manualSize > 0)
        ? manualSize
        : calcBoardSize(currentPlayers.length);

      // Build board
      const spaceTypes = ["normal","normal","normal","normal","lava","cannon","trap","mystery"];
      const board = Array.from({ length: boardEnd + 1 }, (_, i) => ({
        index: i,
        type: (i === 0 || i === boardEnd) ? "normal" : spaceTypes[Math.floor(Math.random() * spaceTypes.length)],
      }));

      // Nickname generator
      let finalPlayers = currentPlayers;
      if (sd.settings?.nicknameGenerator) {
        const used = new Set();
        finalPlayers = currentPlayers.map((p) => {
          let nick = randomNick();
          while (used.has(nick)) nick = randomNick();
          used.add(nick);
          return { ...p, name: nick };
        });
      }

      // Load + optionally randomize questions
      let questions = [];
      const gid = sd.gameId || gameId;
      if (gid) {
        const gSnap = await getDoc(doc(db, "games", gid));
        if (gSnap.exists()) {
          questions = gSnap.data()?.questions || [];
          if (sd.settings?.randomizeQuestions) {
            questions = [...questions].sort(() => Math.random() - 0.5);
          }
        }
      }

      // Game-end timestamp for countdown timer
      const gameDurationSecs = (sd.settings?.gameDuration || 10) * 60;
      const gameEndsAt       = Date.now() + gameDurationSecs * 1000;

      await updateDoc(doc(db, "gameSessions", sessionId), {
        status:               "playing",
        board,
        players:              finalPlayers,
        questions,
        currentQuestionIndex: 0,
        gameEndsAt,
        settings: { ...sd.settings, boardSize: boardEnd },
      });

      navigation.replace("BoardGameScreen", {
        sessionId,
        gameId: gid,
        playerName:  route.params.hostName || "Host",
        playerColor: "#00c781",
        isHost:      true,
      });
    } catch (err) {
      console.error("Start error:", err);
      Alert.alert("Error", "Failed to start the game.");
      setStarting(false);
    }
  };

  // LEAVE
  const handleLeaveConfirm = async () => {
    setShowLeave(false);
    if (isHost) {
      try { await updateDoc(doc(db, "gameSessions", sessionId), { status: "abandoned" }); }
      catch (err) { console.error(err); }
      navigation.navigate("Dashboard");
    } else {
      navigation.navigate("JoinGameScreen");
    }
  };

  if (loading) return (
    <SafeAreaView style={S.container}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadingText}>Loading lobby…</Text>
    </SafeAreaView>
  );

  const maxPlayers  = session?.settings?.maxPlayers || 30;
  const manualSize  = session?.settings?.boardSize;
  const previewSize = (manualSize != null && manualSize > 0) ? manualSize : calcBoardSize(players.length);

  return (
    <SafeAreaView style={S.container}>
      <ScrollView contentContainerStyle={S.scrollContent}>

        <Animated.View style={[S.pinCard, { transform: [{ scale: pinPulse }] }]}>
          <Text style={S.pinLabel}>GAME PIN</Text>
          <Text style={S.pin}>{pin || "------"}</Text>
          <Text style={S.pinHint}>Share with players</Text>
        </Animated.View>

        <Text style={S.playerCount}>{players.length} / {maxPlayers} players</Text>

        {/* Settings summary (read-only — edit in HostGameMenu) */}
        <View style={S.settingsSummary}>
          <Text style={S.settingsLabel}>Settings</Text>
          <View style={S.settingsRow}>
            <Text style={S.settingsItem}>Duration: {session?.settings?.gameDuration || 10} min</Text>
            <Text style={S.settingsItem}>Time/Q: {session?.settings?.timePerQuestion || 20}s</Text>
            <Text style={S.settingsItem}>Tiles: {manualSize != null ? manualSize : `Auto (~${previewSize})`}</Text>
          </View>
          {session?.settings?.nicknameGenerator && (
            <Text style={S.nickBadge}>Nickname generator ON</Text>
          )}
        </View>

        {/* Player list */}
        {players.length === 0 ? (
          <View style={S.emptyArea}><Text style={S.emptyText}>Waiting for players to join…</Text></View>
        ) : (
          <View style={S.playerGrid}>
            {players.map((item, index) => (
              <View
                key={item.uid || index}
                style={S.playerCard}
                onMouseEnter={() => setHoveredPlayer(item.uid)}
                onMouseLeave={() => setHoveredPlayer(null)}
              >
                <View style={[S.playerDot, { backgroundColor: item.color || "#888" }]} />
                <Text style={S.playerName} numberOfLines={1}>{item.name || "Player"}</Text>
                {isHost && (
                  <TouchableOpacity style={S.kickBtn} onPress={() => setKickTarget(item)} activeOpacity={0.8}>
                    <Text style={S.kickBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <BoardPreview players={players} boardSize={previewSize} />
      </ScrollView>

      {/* Host controls */}
      {isHost && (
        <View style={S.hostBar}>
          <TouchableOpacity style={[S.lockBtn, isLobbyLocked && S.lockBtnActive]} onPress={toggleLobbyLock}>
            <Text style={[S.lockText, isLobbyLocked && { color: "#00c781" }]}>
              {isLobbyLocked ? "LOCKED" : "OPEN"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.startBtn, (players.length === 0 || starting) && S.startBtnDisabled]}
            onPress={handleStartGame}
            disabled={players.length === 0 || starting}
          >
            <Text style={S.startBtnText}>{starting ? "Starting…" : "Start Game"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Leave button */}
      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveBtnText}>Leave</Text>
      </TouchableOpacity>

      {/* Kick modal */}
      <Modal visible={!!kickTarget} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={S.modalTitle}>Kick Player?</Text>
            <Text style={S.modalText}>
              Remove <Text style={{ color: kickTarget?.color || "#fff", fontWeight: "bold" }}>{kickTarget?.name}</Text> from the game?
            </Text>
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.cancelModal} onPress={() => setKickTarget(null)}>
                <Text style={S.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.dangerModal} onPress={() => confirmKick(kickTarget)}>
                <Text style={S.dangerText}>Kick</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Leave modal */}
      <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={S.modalTitle}>{isHost ? "Close Lobby?" : "Leave Lobby?"}</Text>
            <Text style={S.modalText}>
              {isHost ? "This will disconnect all players." : "Are you sure you want to leave?"}
            </Text>
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.cancelModal} onPress={() => setShowLeave(false)}>
                <Text style={S.cancelText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.dangerModal} onPress={handleLeaveConfirm}>
                <Text style={S.dangerText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: "#111" },
  scrollContent:{ padding: 20, paddingBottom: 140 },
  loadingText:  { color: "#fff", marginTop: 16, fontSize: 18, textAlign: "center" },
  pinCard:   { backgroundColor: "#1e1e1e", borderRadius: 22, padding: 28, alignItems: "center", marginBottom: 16, borderWidth: 2, borderColor: "#00c781" },
  pinLabel:  { color: "#888", fontSize: 13, letterSpacing: 4, marginBottom: 8 },
  pin:       { fontSize: 60, fontWeight: "bold", color: "#00c781", letterSpacing: 14 },
  pinHint:   { color: "#555", fontSize: 13, marginTop: 6 },
  playerCount: { color: "#888", fontSize: 16, textAlign: "center", marginBottom: 12 },
  settingsSummary: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#2a2a2a" },
  settingsLabel:   { color: "#666", fontSize: 11, letterSpacing: 1, fontWeight: "bold", marginBottom: 6 },
  settingsRow:     { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  settingsItem:    { color: "#ccc", fontSize: 14 },
  nickBadge:       { color: "#00c781", fontSize: 12, marginTop: 6 },
  emptyArea: { alignItems: "center", paddingVertical: 36 },
  emptyText: { color: "#555", fontSize: 17 },
  playerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  playerCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#2a2a2a", minWidth: 120, flex: 1 },
  playerDot:  { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  playerName: { color: "#fff", fontSize: 15, flex: 1 },
  kickBtn:    { backgroundColor: "#3a0000", borderRadius: 8, width: 26, height: 26, justifyContent: "center", alignItems: "center", marginLeft: 6 },
  kickBtnText:{ color: "#ff6b6b", fontSize: 13, fontWeight: "bold" },
  hostBar: { position: "absolute", bottom: 50, left: 0, right: 0, flexDirection: "row", gap: 12, paddingHorizontal: 20, alignItems: "center" },
  lockBtn:       { backgroundColor: "#1e1e1e", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "#333" },
  lockBtnActive: { backgroundColor: "#003322", borderColor: "#00c781" },
  lockText:      { color: "#888", fontSize: 12, fontWeight: "bold" },
  startBtn:         { flex: 1, backgroundColor: "#00c781", borderRadius: 16, paddingVertical: 18, alignItems: "center" },
  startBtnDisabled: { backgroundColor: "#1e1e1e", opacity: 0.4 },
  startBtnText:     { color: "#000", fontSize: 19, fontWeight: "bold" },
  leaveBtn:     { position: "absolute", bottom: 12, left: 20, backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  leaveBtnText: { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal:   { backgroundColor: "#1e1e1e", borderRadius: 20, padding: 28, width: "85%", maxWidth: 360, borderWidth: 1, borderColor: "#333" },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  modalText:  { color: "#ccc", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  modalBtns:  { flexDirection: "row", gap: 12 },
  cancelModal: { flex: 1, backgroundColor: "#2a2a2a", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelText:  { color: "#fff", fontWeight: "bold" },
  dangerModal: { flex: 1, backgroundColor: "#c0392b", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  dangerText:  { color: "#fff", fontWeight: "bold" },
});