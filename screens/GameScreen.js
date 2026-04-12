/**
 * GameScreen.js — Player join & customize screen
 *
 * FIX #1: Taken colors shown greyed/disabled, can't be selected
 * FIX #2: Color wheel — native browser <input type="color"> (no npm install)
 * FIX #12: Kick detection — if host adds you to kickedPlayers, modal + go back
 * Previous fix retained: color change never resets username
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, SafeAreaView, FlatList, Modal, Animated, Platform,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";

const PRESET_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#e91e63",
  "#ff5722", "#00bcd4", "#8bc34a", "#ff9800",
];

// ─── Pawn shape ───────────────────────────────────────────────────────────────
function PawnIcon({ color, size = 52 }) {
  return (
    <View style={{ alignItems: "center", width: size, height: size * 1.35 }}>
      <View style={{ width: size * 0.44, height: size * 0.44, borderRadius: size * 0.22, backgroundColor: color }} />
      <View style={{ width: size * 0.16, height: size * 0.14, backgroundColor: color, marginTop: 2 }} />
      <View style={{ width: size * 0.54, height: size * 0.28, borderRadius: size * 0.08, backgroundColor: color, marginTop: 2 }} />
      <View style={{ width: size * 0.64, height: size * 0.14, borderRadius: size * 0.07, backgroundColor: color, marginTop: 2 }} />
    </View>
  );
}

// ─── Color wheel + swatch picker ─────────────────────────────────────────────
function ColorPicker({ color, onChange, takenColors = [] }) {
  const inputRef = useRef(null);

  // FIX #2: Opens the browser's native color wheel (works on Chrome/Safari/Firefox)
  const openWheel = () => {
    if (Platform.OS === "web" && inputRef.current) inputRef.current.click();
  };

  const handleWheelChange = (e) => {
    const c = e.target.value;
    if (takenColors.includes(c)) return;
    onChange(c);
  };

  return (
    <View style={cpStyles.root}>
      {/* Big clickable color circle = opens color wheel */}
      <TouchableOpacity onPress={openWheel} activeOpacity={0.85}>
        <View style={[cpStyles.wheelRing, { borderColor: color }]}>
          <View style={[cpStyles.wheelFill, { backgroundColor: color }]}>
            <Text style={cpStyles.wheelIcon}>🎨</Text>
          </View>
        </View>
        <Text style={cpStyles.wheelHint}>Tap to open color wheel</Text>
      </TouchableOpacity>

      {/* Hidden native input — browser opens color picker on click */}
      {Platform.OS === "web" && (
        <input
          ref={inputRef}
          type="color"
          value={color}
          onChange={handleWheelChange}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        />
      )}

      {/* Quick preset swatches */}
      <View style={cpStyles.swatchRow}>
        {PRESET_COLORS.map((c) => {
          const taken = takenColors.includes(c);
          const active = color === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => !taken && onChange(c)}
              disabled={taken}
              activeOpacity={0.75}
              style={[
                cpStyles.swatch,
                { backgroundColor: c },
                active && cpStyles.swatchActive,
                taken && cpStyles.swatchTaken,
              ]}
            >
              {taken && <Text style={cpStyles.takenX}>✕</Text>}
              {active && !taken && <Text style={cpStyles.checkmark}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={cpStyles.legend}>Greyed colours are taken</Text>
    </View>
  );
}

const cpStyles = StyleSheet.create({
  root: { alignItems: "center", width: "100%", maxWidth: 380, marginBottom: 20 },
  wheelRing: {
    width: 116, height: 116, borderRadius: 58, borderWidth: 5,
    justifyContent: "center", alignItems: "center", marginBottom: 8,
  },
  wheelFill: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center" },
  wheelIcon: { fontSize: 38 },
  wheelHint: { color: "#555", fontSize: 12, textAlign: "center", marginBottom: 16 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  swatch: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: "center", alignItems: "center",
    borderWidth: 2.5, borderColor: "transparent",
  },
  swatchActive: { borderColor: "#fff", transform: [{ scale: 1.18 }] },
  swatchTaken: { opacity: 0.25 },
  takenX: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  checkmark: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  legend: { color: "#444", fontSize: 11, marginTop: 10 },
});

// ─── Main component ───────────────────────────────────────────────────────────
export default function GameScreen({ route, navigation }) {
  const { sessionId, isHost, gameId } = route.params;

  const [session, setSession]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [username, setUsername]       = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [hasJoined, setHasJoined]     = useState(false);
  const [playerUid]                   = useState(`guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  const [showNameTaken, setShowNameTaken]     = useState(false);
  const [showColorTaken, setShowColorTaken]   = useState(false);
  const [showKicked, setShowKicked]           = useState(false);

  // Keep refs so Firestore callbacks don't get stale closures
  const usernameRef    = useRef(username);
  const colorRef       = useRef(selectedColor);
  const hasJoinedRef   = useRef(hasJoined);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { colorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { hasJoinedRef.current = hasJoined; }, [hasJoined]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ── Firestore listener ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, "gameSessions", sessionId), (snap) => {
      if (!snap.exists()) { setError("Session not found"); setLoading(false); return; }
      const data = snap.data();
      setSession(data);
      setLoading(false);

      // FIX #12: Kick detection
      if (hasJoinedRef.current) {
        const kicked = data.kickedPlayers || [];
        if (kicked.includes(usernameRef.current)) {
          setShowKicked(true);
          return;
        }
      }

      // Navigate when game starts
      if (data.status === "playing" && hasJoinedRef.current) {
        navigation.replace("BoardGameScreen", {
          sessionId,
          gameId: data.gameId || gameId,
          playerName: usernameRef.current,
          playerColor: colorRef.current,
          playerUid,
          isHost: false,
        });
      }
    }, (err) => { setError("Failed to connect"); setLoading(false); });
    return () => unsub();
  }, [sessionId]);

  // ── Derived: taken colors = colors used by OTHER players ──────────────────
  const takenColors = (session?.players || [])
    .filter((p) => p.uid !== playerUid)
    .map((p) => p.color)
    .filter(Boolean);

  // ── Color select — NEVER touches username ────────────────────────────────
  const handleColorSelect = useCallback((c) => {
    if (takenColors.includes(c)) { setShowColorTaken(true); return; }
    setSelectedColor(c);
    colorRef.current = c;
  }, [takenColors]);

  // ── Join ─────────────────────────────────────────────────────────────────
  const handleJoin = useCallback(async () => {
    const name = username.trim();
    if (!name) return;
    const existingNames = (session?.players || []).map((p) => p.name);
    if (existingNames.includes(name)) { setShowNameTaken(true); return; }
    if (takenColors.includes(selectedColor)) { setShowColorTaken(true); return; }
    try {
      const newPlayer = {
        uid: playerUid, name, color: selectedColor,
        joinedAt: new Date().toISOString(),
        score: 0, position: 0, correctStreak: 0, totalCorrect: 0,
        luck: 0, stunned: false,
      };
      await updateDoc(doc(db, "gameSessions", sessionId), {
        players: [...(session?.players || []), newPlayer],
      });
      setHasJoined(true);
      hasJoinedRef.current = true;
    } catch (err) { console.error("Join error:", err); }
  }, [username, selectedColor, session, sessionId, playerUid, takenColors]);

  if (loading) return (
    <SafeAreaView style={S.container}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadingText}>Connecting…</Text>
    </SafeAreaView>
  );

  if (error) return (
    <SafeAreaView style={S.container}>
      <Text style={S.errorText}>{error}</Text>
      <TouchableOpacity style={S.backBtn} onPress={() => navigation.goBack()}>
        <Text style={S.backBtnText}>Go Back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const players = session?.players || [];

  // ── Pre-join: customize screen ─────────────────────────────────────────────
  if (!hasJoined) {
    return (
      <SafeAreaView style={S.container}>
        <Text style={S.gameTitle}>🎲 Brain Board</Text>
        <Text style={S.subtitle}>Pick your colour & name</Text>

        <Animated.View style={{ transform: [{ scale: pulseAnim }], marginBottom: 16 }}>
          <PawnIcon color={selectedColor} size={80} />
        </Animated.View>

        <ColorPicker color={selectedColor} onChange={handleColorSelect} takenColors={takenColors} />

        <View style={S.nameSection}>
          <Text style={S.inputLabel}>Your Name</Text>
          <TextInput
            style={S.nameInput}
            placeholder="Enter your name…"
            placeholderTextColor="#444"
            value={username}
            onChangeText={setUsername}
            maxLength={20}
            autoCapitalize="words"
          />
        </View>

        <TouchableOpacity
          style={[S.joinBtn, !username.trim() && S.joinBtnDisabled]}
          onPress={handleJoin}
          disabled={!username.trim()}
          activeOpacity={0.85}
        >
          <Text style={S.joinBtnText}>Join Game →</Text>
        </TouchableOpacity>

        <InfoModal visible={showNameTaken} title="Name Taken"
          message="That name is already in use. Choose a different one."
          onDismiss={() => setShowNameTaken(false)} />
        <InfoModal visible={showColorTaken} title="Colour Taken"
          message="Another player is already using that colour. Pick a different one!"
          onDismiss={() => setShowColorTaken(false)} />
      </SafeAreaView>
    );
  }

  // ── Post-join: waiting lobby ───────────────────────────────────────────────
  return (
    <SafeAreaView style={S.container}>
      <Text style={S.gameTitle}>🎲 Brain Board</Text>
      <Text style={S.waitingSub}>Waiting for the host to start…</Text>

      <View style={S.myCard}>
        <PawnIcon color={selectedColor} size={48} />
        <View style={{ marginLeft: 14, flex: 1 }}>
          <Text style={S.myNameLabel}>Playing as</Text>
          <Text style={[S.myName, { color: selectedColor }]}>{username}</Text>
        </View>
      </View>

      <View style={S.listCard}>
        <Text style={S.listTitle}>Players in Lobby ({players.length})</Text>
        <FlatList
          data={players}
          keyExtractor={(_, i) => i.toString()}
          renderItem={({ item }) => (
            <View style={[S.playerRow, item.name === username && S.playerRowMe]}>
              <View style={[S.dot, { backgroundColor: item.color || "#888" }]} />
              <Text style={[S.rowName, item.name === username && { color: selectedColor }]}>
                {item.name}
              </Text>
              {item.name === username && <Text style={S.youBadge}>You</Text>}
            </View>
          )}
        />
      </View>

      {/* Kicked modal */}
      <Modal visible={showKicked} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={{ fontSize: 52, marginBottom: 12 }}>🚫</Text>
            <Text style={S.modalTitle}>You've Been Kicked</Text>
            <Text style={S.modalText}>The host has removed you from this game.</Text>
            <TouchableOpacity style={S.modalBtn} onPress={() => {
              setShowKicked(false);
              navigation.navigate("JoinGameScreen");
            }}>
              <Text style={S.modalBtnText}>Back to Menu</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoModal({ visible, title, message, onDismiss }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={S.overlay}>
        <View style={S.modal}>
          <Text style={S.modalTitle}>{title}</Text>
          <Text style={S.modalText}>{message}</Text>
          <TouchableOpacity style={S.modalBtn} onPress={onDismiss}>
            <Text style={S.modalBtnText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center", padding: 24 },
  loadingText: { color: "#fff", marginTop: 16, fontSize: 18 },
  errorText: { color: "#ff6b6b", fontSize: 18, textAlign: "center" },
  backBtn: { marginTop: 20, backgroundColor: "#333", padding: 14, borderRadius: 12 },
  backBtnText: { color: "#fff", fontWeight: "bold" },

  gameTitle: { fontSize: 36, fontWeight: "bold", color: "#00c781", marginBottom: 4, textAlign: "center" },
  subtitle: { fontSize: 15, color: "#888", marginBottom: 18 },

  nameSection: { width: "100%", maxWidth: 380, marginBottom: 20 },
  inputLabel: { color: "#888", fontSize: 13, marginBottom: 8, marginLeft: 4 },
  nameInput: {
    backgroundColor: "#1e1e1e", color: "#fff", fontSize: 20, padding: 16,
    borderRadius: 14, borderWidth: 1.5, borderColor: "#333", width: "100%",
  },
  joinBtn: {
    backgroundColor: "#00c781", paddingVertical: 18, width: "100%",
    maxWidth: 380, borderRadius: 16, alignItems: "center",
  },
  joinBtnDisabled: { backgroundColor: "#1e1e1e", opacity: 0.4 },
  joinBtnText: { color: "#fff", fontSize: 20, fontWeight: "bold" },

  waitingSub: { color: "#888", fontSize: 15, marginBottom: 24 },
  myCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e",
    borderRadius: 16, padding: 20, width: "100%", maxWidth: 400,
    marginBottom: 20, borderWidth: 1, borderColor: "#333",
  },
  myNameLabel: { color: "#555", fontSize: 12, marginBottom: 2 },
  myName: { fontSize: 24, fontWeight: "bold" },
  listCard: {
    backgroundColor: "#1e1e1e", borderRadius: 16, padding: 20,
    width: "100%", maxWidth: 400, flex: 1,
    borderWidth: 1, borderColor: "#333", marginBottom: 20,
  },
  listTitle: { color: "#00c781", fontSize: 16, fontWeight: "bold", marginBottom: 12 },
  playerRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
  },
  playerRowMe: { backgroundColor: "#003322", borderRadius: 8, paddingHorizontal: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  rowName: { color: "#fff", fontSize: 16, flex: 1 },
  youBadge: {
    backgroundColor: "#00c781", color: "#000", fontSize: 11, fontWeight: "bold",
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal: {
    backgroundColor: "#1e1e1e", borderRadius: 20, padding: 32,
    width: "85%", maxWidth: 360, alignItems: "center", borderWidth: 1, borderColor: "#333",
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  modalText: { color: "#ccc", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  modalBtn: { backgroundColor: "#00c781", paddingVertical: 14, width: "100%", borderRadius: 14, alignItems: "center" },
  modalBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
});