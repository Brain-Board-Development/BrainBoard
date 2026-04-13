/**
 * Lobby.js — HOST-ONLY Lobby Screen
 *
 * FIX #5:  Lock button actually writes isLobbyLocked to Firestore (JoinGameScreen reads it)
 * FIX #8:  Settings modal before start (board size, host plays, random names, timers)
 * FIX #9:  Default board size from formula f(x) = 9.14*(x-1)^0.714 + 25, max 150
 * FIX #12: Kick players — hover/press shows kick confirm, adds to kickedPlayers[]
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, SafeAreaView, Modal, Alert,
  ScrollView, TextInput, Switch, Animated, Dimensions,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, arrayUnion, getDoc } from "firebase/firestore";

const BOARD_COLS = 10;
const { width: SCREEN_W } = Dimensions.get("window");
const TILE_SIZE = Math.min(52, Math.floor((SCREEN_W - 64) / BOARD_COLS));

// ─── Board size formula ───────────────────────────────────────────────────────
const calcBoardSize = (numPlayers) =>
  Math.min(150, Math.max(25, Math.round(9.14 * Math.pow(Math.max(1, numPlayers - 1), 0.714) + 25)));

// ─── Build snake rows for preview ────────────────────────────────────────────
function buildSnakeRows(total) {
  const rows = [];
  for (let rowStart = 0; rowStart <= total; rowStart += BOARD_COLS) {
    const spaces = [];
    for (let s = rowStart; s < rowStart + BOARD_COLS && s <= total; s++) spaces.push(s);
    const rowIdx = Math.floor(rowStart / BOARD_COLS);
    if (rowIdx % 2 === 1) spaces.reverse();
    rows.push(spaces);
  }
  return rows.reverse();
}

// ─── Snake board preview ─────────────────────────────────────────────────────
function BoardPreview({ players, boardSize }) {
  const rows = buildSnakeRows(boardSize);
  const tileSize = Math.min(TILE_SIZE, Math.floor((SCREEN_W - 64) / BOARD_COLS));

  const getPlayersAt = (idx) => players.filter((p) => (p.position || 0) === idx);

  return (
    <View style={brd.wrapper}>
      <Text style={brd.title}>🐍 Board Preview ({boardSize} tiles)</Text>
      <ScrollView>
        {rows.map((row, ri) => (
          <View key={ri} style={brd.row}>
            {row.map((idx) => {
              const here = getPlayersAt(idx);
              const isEnd   = idx === boardSize;
              const isStart = idx === 0;
              return (
                <View
                  key={idx}
                  style={[
                    brd.tile,
                    { width: tileSize, height: tileSize },
                    isEnd && brd.tileEnd,
                    isStart && brd.tileStart,
                  ]}
                >
                  <Text style={brd.tileNum}>
                    {isEnd ? "🏁" : isStart ? "🟢" : idx}
                  </Text>
                  <View style={brd.tokens}>
                    {here.slice(0, 4).map((p, pi) => (
                      <View key={pi} style={[brd.token, { backgroundColor: p.color || "#888" }]} />
                    ))}
                  </View>
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
  wrapper: { backgroundColor: "#0d0d0d", borderRadius: 16, padding: 14, marginTop: 20, borderWidth: 1, borderColor: "#222" },
  title: { color: "#00c781", fontSize: 15, fontWeight: "bold", marginBottom: 10, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", marginBottom: 3 },
  tile: {
    borderRadius: 7, margin: 2, alignItems: "center", justifyContent: "center",
    backgroundColor: "#1a2a1a", borderWidth: 1, borderColor: "#2a3a2a",
  },
  tileEnd: { backgroundColor: "#001a3d", borderColor: "#3498db", borderWidth: 2 },
  tileStart: { backgroundColor: "#003322", borderColor: "#00c781" },
  tileNum: { color: "#555", fontSize: 10, fontWeight: "bold" },
  tokens: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center" },
  token: { width: 7, height: 7, borderRadius: 4, margin: 1 },
});

// ─── Settings modal ───────────────────────────────────────────────────────────
function SettingsModal({ visible, playerCount, settings, onConfirm, onCancel }) {
  const suggestedSize = calcBoardSize(playerCount);
  const [boardSize, setBoardSize]       = useState(String(settings?.boardSize || suggestedSize));
  const [hostPlays, setHostPlays]       = useState(settings?.hostPlays ?? false);
  const [randomNames, setRandomNames]   = useState(settings?.randomNames ?? true);
  const [timePerQ, setTimePerQ]         = useState(String(settings?.timePerQuestion || 20));
  const [gameDuration, setGameDuration] = useState(String(settings?.gameDuration || 300));

  useEffect(() => {
    if (visible) {
      const suggested = calcBoardSize(playerCount);
      setBoardSize(String(settings?.boardSize || suggested));
      setHostPlays(settings?.hostPlays ?? false);
      setRandomNames(settings?.randomNames ?? true);
      setTimePerQ(String(settings?.timePerQuestion || 20));
      setGameDuration(String(settings?.gameDuration || 300));
    }
  }, [visible, playerCount, settings]);

  const handleConfirm = () => {
    onConfirm({
      boardSize: Math.min(150, Math.max(10, parseInt(boardSize) || suggestedSize)),
      hostPlays,
      randomNames,
      timePerQuestion: Math.min(120, Math.max(5, parseInt(timePerQ) || 20)),
      gameDuration: Math.min(3600, Math.max(60, parseInt(gameDuration) || 300)),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={sm.overlay}>
        <View style={sm.card}>
          <Text style={sm.title}>⚙️ Game Settings</Text>
          <ScrollView showsVerticalScrollIndicator={false}>

            <View style={sm.row}>
              <View style={sm.rowLeft}>
                <Text style={sm.label}>Board Tiles</Text>
                <Text style={sm.hint}>Formula suggests {calcBoardSize(playerCount)} for {playerCount} player{playerCount !== 1 ? "s" : ""}</Text>
              </View>
              <TextInput
                style={sm.input}
                keyboardType="numeric"
                value={boardSize}
                onChangeText={setBoardSize}
                maxLength={3}
              />
            </View>

            <View style={sm.row}>
              <View style={sm.rowLeft}>
                <Text style={sm.label}>Time per Question</Text>
                <Text style={sm.hint}>Seconds (5–120)</Text>
              </View>
              <TextInput
                style={sm.input}
                keyboardType="numeric"
                value={timePerQ}
                onChangeText={setTimePerQ}
                maxLength={3}
              />
            </View>

            <View style={sm.row}>
              <View style={sm.rowLeft}>
                <Text style={sm.label}>Game Duration</Text>
                <Text style={sm.hint}>Seconds (e.g. 300 = 5 min)</Text>
              </View>
              <TextInput
                style={sm.input}
                keyboardType="numeric"
                value={gameDuration}
                onChangeText={setGameDuration}
                maxLength={4}
              />
            </View>

            <View style={sm.row}>
              <View style={sm.rowLeft}>
                <Text style={sm.label}>Random Name Generator</Text>
                <Text style={sm.hint}>Auto-assign names to players</Text>
              </View>
              <Switch value={randomNames} onValueChange={setRandomNames} trackColor={{ true: "#00c781" }} />
            </View>

            <View style={sm.row}>
              <View style={sm.rowLeft}>
                <Text style={sm.label}>Host Also Plays</Text>
                <Text style={sm.hint}>Host gets a player board too</Text>
              </View>
              <Switch value={hostPlays} onValueChange={setHostPlays} trackColor={{ true: "#00c781" }} />
            </View>
          </ScrollView>

          <View style={sm.btns}>
            <TouchableOpacity style={sm.cancelBtn} onPress={onCancel}>
              <Text style={sm.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={sm.confirmBtn} onPress={handleConfirm}>
              <Text style={sm.confirmText}>▶ Start Game</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const sm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: "#1a1a1a", borderRadius: 22, padding: 28,
    width: "92%", maxWidth: 480, maxHeight: "85%",
    borderWidth: 1, borderColor: "#333",
  },
  title: { color: "#00c781", fontSize: 22, fontWeight: "bold", textAlign: "center", marginBottom: 20 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
  },
  rowLeft: { flex: 1, marginRight: 12 },
  label: { color: "#fff", fontSize: 16, fontWeight: "600" },
  hint: { color: "#666", fontSize: 12, marginTop: 2 },
  input: {
    backgroundColor: "#2a2a2a", color: "#fff", fontSize: 18, fontWeight: "bold",
    padding: 10, borderRadius: 10, width: 70, textAlign: "center",
    borderWidth: 1, borderColor: "#444",
  },
  btns: { flexDirection: "row", gap: 12, marginTop: 20 },
  cancelBtn: { flex: 1, backgroundColor: "#2a2a2a", paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  cancelText: { color: "#888", fontSize: 15, fontWeight: "bold" },
  confirmBtn: { flex: 2, backgroundColor: "#00c781", paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  confirmText: { color: "#000", fontSize: 17, fontWeight: "bold" },
});

// ─── Main Lobby ───────────────────────────────────────────────────────────────
export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [session, setSession]           = useState(null);
  const [players, setPlayers]           = useState([]);
  const [isLobbyLocked, setIsLobbyLocked] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showLeave, setShowLeave]       = useState(false);
  const [kickTarget, setKickTarget]     = useState(null); // player object to kick
  const [hoveredPlayer, setHoveredPlayer] = useState(null);

  const pinPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, { toValue: 1.03, duration: 1200, useNativeDriver: true }),
        Animated.timing(pinPulse, { toValue: 1,    duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setSession(data);
      setPlayers(data.players || []);
      setIsLobbyLocked(data.isLobbyLocked || false);
      setLoading(false);
    });
    return () => unsub();
  }, [sessionId]);

  // FIX #5: toggleLobbyLock — already writes to Firestore; JoinGameScreen checks it
  const toggleLobbyLock = async () => {
    try {
      await updateDoc(doc(db, "gameSessions", sessionId), { isLobbyLocked: !isLobbyLocked });
    } catch (err) { Alert.alert("Error", "Failed to update lock."); }
  };

  // FIX #1: Read fresh data from Firestore before writing to avoid race conditions
  const confirmKick = async (player) => {
    setKickTarget(null);
    try {
      const sessionSnap = await getDoc(doc(db, "gameSessions", sessionId));
      if (!sessionSnap.exists()) return;
      const currentPlayers = sessionSnap.data()?.players || [];
      // Filter by both uid and name to handle any uid mismatch
      const updatedPlayers = currentPlayers.filter(
        (p) => p.uid !== player.uid && p.name !== player.name
      );
      await updateDoc(doc(db, "gameSessions", sessionId), {
        players: updatedPlayers,
        kickedPlayers: arrayUnion(player.name),
      });
    } catch (err) {
      Alert.alert("Error", "Failed to kick player.");
    }
  };

  // FIX #8: Start button shows settings first
  const handleStartPressed = () => {
    if (players.length === 0) {
      Alert.alert("No Players", "Wait for at least one player to join.");
      return;
    }
    setShowSettings(true);
  };

  const handleSettingsConfirm = async (settings) => {
    setShowSettings(false);
    try {
      const boardData = buildBoardData(settings.boardSize);

      // Load questions from the game doc and embed them in the session
      // This prevents players from needing a separate getDoc call with a potentially missing gameId
      let questions = [];
      const gid = session?.gameId || gameId;
      if (gid) {
        const gameSnap = await getDoc(doc(db, "games", gid));
        if (gameSnap.exists()) {
          questions = gameSnap.data()?.questions || [];
        }
      }

      await updateDoc(doc(db, "gameSessions", sessionId), {
        status: "playing",
        settings: { ...session?.settings, ...settings, boardSize: settings.boardSize },
        board: boardData,
        currentQuestionIndex: 0,
        questions, // embed questions directly in the session
      });
      navigation.replace("BoardGameScreen", {
        sessionId,
        gameId: session?.gameId || gameId,
        playerName: route.params.hostName || "Host",
        playerColor: "#00c781",
        isHost: true,
      });
    } catch (err) {
      console.error("Start error:", err);
      Alert.alert("Error", "Failed to start the game.");
    }
  };

  const buildBoardData = (total) => {
    const types = ["normal", "normal", "normal", "normal", "lava", "cannon", "trap", "mystery"];
    return Array.from({ length: total + 1 }, (_, i) => ({
      index: i,
      type: i === 0 || i === total ? "normal" : types[Math.floor(Math.random() * types.length)],
    }));
  };

  if (loading) return (
    <SafeAreaView style={S.container}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadingText}>Loading lobby…</Text>
    </SafeAreaView>
  );

  const suggestedBoardSize = calcBoardSize(players.length);
  const maxPlayers = session?.settings?.maxPlayers || 30;

  return (
    <SafeAreaView style={S.container}>
      <ScrollView contentContainerStyle={S.scrollContent}>

        {/* PIN */}
        <Animated.View style={[S.pinCard, { transform: [{ scale: pinPulse }] }]}>
          <Text style={S.pinLabel}>GAME PIN</Text>
          <Text style={S.pin}>{pin || "------"}</Text>
          <Text style={S.pinHint}>Share with players</Text>
        </Animated.View>

        <Text style={S.playerCount}>{players.length} / {maxPlayers} players</Text>

        {/* Player list with kick button */}
        {players.length === 0 ? (
          <View style={S.emptyArea}>
            <Text style={S.emptyText}>👋 Waiting for players to join…</Text>
          </View>
        ) : (
          <View style={S.playerGrid}>
            {players.map((item, index) => (
              <View
                key={item.uid || index}
                style={S.playerCard}
                // Web hover via onMouseEnter/Leave
                onMouseEnter={() => setHoveredPlayer(item.uid)}
                onMouseLeave={() => setHoveredPlayer(null)}
              >
                <View style={[S.playerDot, { backgroundColor: item.color || "#888" }]} />
                <Text style={S.playerName} numberOfLines={1}>{item.name || "Player"}</Text>
                {/* Kick button shown on hover (or always on mobile) */}
                {isHost && (hoveredPlayer === item.uid || !item._hideKick) && (
                  <TouchableOpacity
                    style={S.kickBtn}
                    onPress={() => setKickTarget(item)}
                    activeOpacity={0.8}
                  >
                    <Text style={S.kickBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Board preview */}
        <BoardPreview players={players} boardSize={suggestedBoardSize} />

      </ScrollView>

      {/* Host controls */}
      {isHost && (
        <View style={S.hostBar}>
          <TouchableOpacity
            style={[S.lockBtn, isLobbyLocked && S.lockBtnActive]}
            onPress={toggleLobbyLock}
          >
            <Text style={S.lockIcon}>{isLobbyLocked ? "🔒" : "🔓"}</Text>
            <Text style={[S.lockText, isLobbyLocked && { color: "#00c781" }]}>
              {isLobbyLocked ? "Locked" : "Open"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[S.startBtn, players.length === 0 && S.startBtnDisabled]}
            onPress={handleStartPressed}
            disabled={players.length === 0}
          >
            <Text style={S.startBtnText}>▶ Start Game</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Leave button */}
      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveBtnText}>Leave</Text>
      </TouchableOpacity>

      {/* FIX #8: Settings modal */}
      <SettingsModal
        visible={showSettings}
        playerCount={players.length}
        settings={session?.settings}
        onConfirm={handleSettingsConfirm}
        onCancel={() => setShowSettings(false)}
      />

      {/* FIX #12: Kick confirm */}
      <Modal visible={!!kickTarget} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={S.modalTitle}>Kick Player?</Text>
            <Text style={S.modalText}>
              Remove <Text style={{ color: kickTarget?.color, fontWeight: "bold" }}>{kickTarget?.name}</Text> from the game?
            </Text>
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.cancelModal} onPress={() => setKickTarget(null)}>
                <Text style={S.cancelModalText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.kickConfirm} onPress={() => confirmKick(kickTarget)}>
                <Text style={S.kickConfirmText}>Kick</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Leave confirm */}
      <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={S.modalTitle}>Leave Lobby?</Text>
            <Text style={S.modalText}>Are you sure you want to leave?</Text>
            <View style={S.modalBtns}>
              <TouchableOpacity style={S.cancelModal} onPress={() => setShowLeave(false)}>
                <Text style={S.cancelModalText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.kickConfirm}
                onPress={() => { setShowLeave(false); navigation.navigate("Dashboard"); }}
              >
                <Text style={S.kickConfirmText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  scrollContent: { padding: 20, paddingBottom: 140 },
  loadingText: { color: "#fff", marginTop: 16, fontSize: 18, textAlign: "center" },

  pinCard: {
    backgroundColor: "#1e1e1e", borderRadius: 22, padding: 28, alignItems: "center",
    marginBottom: 16, borderWidth: 2, borderColor: "#00c781",
  },
  pinLabel: { color: "#888", fontSize: 13, letterSpacing: 4, marginBottom: 8 },
  pin: { fontSize: 60, fontWeight: "bold", color: "#00c781", letterSpacing: 14 },
  pinHint: { color: "#555", fontSize: 13, marginTop: 6 },

  playerCount: { color: "#888", fontSize: 16, textAlign: "center", marginBottom: 16 },

  emptyArea: { alignItems: "center", paddingVertical: 36 },
  emptyText: { color: "#555", fontSize: 17, textAlign: "center" },

  playerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  playerCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e",
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: "#2a2a2a", minWidth: 120, flex: 1,
  },
  playerDot: { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  playerName: { color: "#fff", fontSize: 15, flex: 1 },
  kickBtn: {
    backgroundColor: "#3a0000", borderRadius: 8, width: 26, height: 26,
    justifyContent: "center", alignItems: "center", marginLeft: 6,
  },
  kickBtnText: { color: "#ff6b6b", fontSize: 13, fontWeight: "bold" },

  hostBar: {
    position: "absolute", bottom: 50, left: 0, right: 0,
    flexDirection: "row", gap: 12, paddingHorizontal: 20, alignItems: "center",
  },
  lockBtn: {
    backgroundColor: "#1e1e1e", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18,
    alignItems: "center", borderWidth: 1, borderColor: "#333",
  },
  lockBtnActive: { backgroundColor: "#003322", borderColor: "#00c781" },
  lockIcon: { fontSize: 22 },
  lockText: { color: "#888", fontSize: 11, fontWeight: "bold", marginTop: 2 },
  startBtn: {
    flex: 1, backgroundColor: "#00c781", borderRadius: 16,
    paddingVertical: 18, alignItems: "center",
  },
  startBtnDisabled: { backgroundColor: "#1e1e1e", opacity: 0.4 },
  startBtnText: { color: "#000", fontSize: 19, fontWeight: "bold" },

  leaveBtn: {
    position: "absolute", bottom: 12, left: 20,
    backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12,
  },
  leaveBtnText: { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal: {
    backgroundColor: "#1e1e1e", borderRadius: 20, padding: 28,
    width: "85%", maxWidth: 360, borderWidth: 1, borderColor: "#333",
  },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  modalText: { color: "#ccc", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  modalBtns: { flexDirection: "row", gap: 12 },
  cancelModal: { flex: 1, backgroundColor: "#2a2a2a", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelModalText: { color: "#fff", fontWeight: "bold" },
  kickConfirm: { flex: 1, backgroundColor: "#c0392b", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  kickConfirmText: { color: "#fff", fontWeight: "bold" },
});