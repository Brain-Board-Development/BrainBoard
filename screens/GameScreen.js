/**
 * GameScreen.js — Player join & customise screen
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, SafeAreaView, FlatList, Modal, Animated, Platform,
} from "react-native";
import { db, auth } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";

// ── Nickname helpers ──────────────────────────────────────────────────────────
const NICK_ADJ  = ["Swift","Brave","Clever","Bold","Quick","Bright","Sharp","Fierce","Calm","Wild","Sly","Wise","Daring","Lucky","Keen","Epic","Cosmic","Royal","Silent","Golden"];
const NICK_NOUN = ["Fox","Wolf","Eagle","Bear","Lion","Tiger","Hawk","Shark","Raven","Dragon","Falcon","Puma","Cobra","Viper","Lynx","Phoenix","Titan","Nova","Blaze","Storm"];
const genNick = () =>
  NICK_ADJ[Math.floor(Math.random() * NICK_ADJ.length)] +
  NICK_NOUN[Math.floor(Math.random() * NICK_NOUN.length)] +
  Math.floor(Math.random() * 100);

// ── Preset colours ────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#e74c3c","#e67e22","#f1c40f","#2ecc71",
  "#1abc9c","#3498db","#9b59b6","#e91e63",
  "#ff5722","#00bcd4","#8bc34a","#ff9800",
];

// ── Pawn icon ─────────────────────────────────────────────────────────────────
function PawnIcon({ color, size }) {
  const s = size || 52;
  return (
    <View style={{ alignItems: "center", width: s, height: s * 1.35 }}>
      <View style={{ width: s*0.44, height: s*0.44, borderRadius: s*0.22, backgroundColor: color }} />
      <View style={{ width: s*0.16, height: s*0.14, backgroundColor: color, marginTop: 2 }} />
      <View style={{ width: s*0.54, height: s*0.28, borderRadius: s*0.08, backgroundColor: color, marginTop: 2 }} />
      <View style={{ width: s*0.64, height: s*0.14, borderRadius: s*0.07, backgroundColor: color, marginTop: 2 }} />
    </View>
  );
}

// ── Colour picker ─────────────────────────────────────────────────────────────
function ColorPicker({ color, onChange, takenColors }) {
  const inputRef = useRef(null);
  const taken = takenColors || [];
  return (
    <View style={cp.root}>
      <TouchableOpacity
        onPress={() => { if (Platform.OS === "web" && inputRef.current) inputRef.current.click(); }}
        activeOpacity={0.85}
      >
        <View style={[cp.ring, { borderColor: color }]}>
          <View style={[cp.fill, { backgroundColor: color }]}>
            <Text style={cp.icon}>🎨</Text>
          </View>
        </View>
        <Text style={cp.hint}>Tap to open colour wheel</Text>
      </TouchableOpacity>
      {Platform.OS === "web" && (
        <input
          ref={inputRef}
          type="color"
          value={color}
          onChange={(e) => { const c = e.target.value; if (!taken.includes(c)) onChange(c); }}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        />
      )}
      <View style={cp.row}>
        {PRESET_COLORS.map((c) => {
          const isTaken  = taken.includes(c);
          const isActive = color === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => { if (!isTaken) onChange(c); }}
              disabled={isTaken}
              activeOpacity={0.75}
              style={[cp.swatch, { backgroundColor: c }, isActive && cp.swActive, isTaken && cp.swTaken]}
            >
              {isTaken  && <Text style={cp.x}>✕</Text>}
              {isActive && !isTaken && <Text style={cp.check}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={cp.hint2}>Greyed colours are taken</Text>
    </View>
  );
}
const cp = StyleSheet.create({
  root:     { alignItems: "center", width: "100%", maxWidth: 380, marginBottom: 20 },
  ring:     { width: 116, height: 116, borderRadius: 58, borderWidth: 5, justifyContent: "center", alignItems: "center", marginBottom: 8 },
  fill:     { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center" },
  icon:     { fontSize: 38 },
  hint:     { color: "#555", fontSize: 12, textAlign: "center", marginBottom: 16 },
  hint2:    { color: "#444", fontSize: 11, marginTop: 10 },
  row:      { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  swatch:   { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center", borderWidth: 2.5, borderColor: "transparent" },
  swActive: { borderColor: "#fff", transform: [{ scale: 1.18 }] },
  swTaken:  { opacity: 0.25 },
  x:        { color: "#fff", fontSize: 15, fontWeight: "bold" },
  check:    { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

// ── Simple info modal ─────────────────────────────────────────────────────────
function InfoModal({ visible, title, message, onDismiss }) {
  return (
    <Modal visible={!!visible} transparent animationType="fade">
      <View style={S.overlay}>
        <View style={S.modal}>
          <Text style={S.mTtl}>{title}</Text>
          <Text style={S.mTxt}>{message}</Text>
          <TouchableOpacity style={S.mBtn} onPress={onDismiss}>
            <Text style={S.mBtnTxt}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function GameScreen({ route, navigation }) {
  const { sessionId, gameId } = route.params || {};

  // State
  const [session,        setSession]       = useState(null);
  const [loading,        setLoading]       = useState(true);
  const [connError,      setConnError]     = useState(null);
  const [username,       setUsername]      = useState("");
  const [selectedColor,  setSelectedColor] = useState(PRESET_COLORS[0]);
  const [hasJoined,      setHasJoined]     = useState(false);
  const [showNameTaken,  setShowNameTaken] = useState(false);
  const [showColorTaken, setShowColorTaken]= useState(false);
  const [showKicked,     setShowKicked]    = useState(false);
  const [showLeave,      setShowLeave]     = useState(false);
  const [showAbandoned,  setShowAbandoned] = useState(false);
  const [playerUid]                        = useState(
    () => "guest_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)
  );

  // Refs — kept in sync by effects; read in async callbacks to avoid stale closures
  const usernameRef  = useRef("");
  const colorRef     = useRef(PRESET_COLORS[0]);
  const hasJoinedRef = useRef(false);
  const sessionRef   = useRef(null);

  // Animated value for pawn pulse
  const pulseVal = useRef(new Animated.Value(1)).current;

  // ── ALL hooks before any return ───────────────────────────────────────────

  useEffect(() => { usernameRef.current  = username;      }, [username]);
  useEffect(() => { colorRef.current     = selectedColor; }, [selectedColor]);
  useEffect(() => { hasJoinedRef.current = hasJoined;     }, [hasJoined]);

  // Pulse animation
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseVal, { toValue: 1.1, duration: 750, useNativeDriver: false }),
        Animated.timing(pulseVal, { toValue: 1.0, duration: 750, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Auto-generate nickname when host has nicknames enabled
  // nicknamesEnabled is a plain variable (not a hook) so this useEffect is always called
  const nicknamesEnabled = !!(session && session.settings && session.settings.nicknameGenerator);
  useEffect(() => {
    if (nicknamesEnabled && !usernameRef.current) {
      setUsername(genNick());
    }
  }, [nicknamesEnabled]);

  // Firestore session listener
  useEffect(() => {
    if (!sessionId) return;
    const ref = doc(db, "gameSessions", sessionId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setConnError("Session not found.");
          setLoading(false);
          return;
        }
        const data = snap.data();
        sessionRef.current = data;
        setSession(data);
        setLoading(false);

        if (data.status === "abandoned") { setShowAbandoned(true); return; }

        if (hasJoinedRef.current) {
          if ((data.kickedPlayers || []).includes(usernameRef.current)) {
            setShowKicked(true);
            return;
          }
          if (data.status === "playing") {
            navigation.replace("BoardGameScreen", {
              sessionId,
              gameId:      data.gameId || gameId,
              playerName:  usernameRef.current,
              playerColor: colorRef.current,
              playerUid,
              isHost:      false,
            });
          }
        }
      },
      () => { setConnError("Failed to connect."); setLoading(false); }
    );
    return () => unsub();
  }, [sessionId]);

  // Derived
  const takenColors = (session ? session.players || [] : [])
    .filter((p) => p.uid !== playerUid)
    .map((p) => p.color)
    .filter(Boolean);

  // Callbacks
  const handleColorChange = useCallback((c) => {
    if (takenColors.includes(c)) { setShowColorTaken(true); return; }
    setSelectedColor(c);
    colorRef.current = c;
  }, [takenColors]);

  const handleJoin = useCallback(async () => {
    const name = usernameRef.current.trim();
    if (!name) return;
    const existing = (sessionRef.current ? sessionRef.current.players || [] : []).map((p) => p.name);
    if (existing.includes(name)) { setShowNameTaken(true); return; }
    if ((sessionRef.current ? sessionRef.current.players || [] : []).some(
      (p) => p.color === colorRef.current && p.uid !== playerUid
    )) { setShowColorTaken(true); return; }

    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      const newPlayer = {
        uid: playerUid, name, color: colorRef.current,
        joinedAt: new Date().toISOString(),
        score: 0, position: 0, correctStreak: 0, totalCorrect: 0, luck: 0, stunned: false,
      };
      const currentPlayers = sessionRef.current ? sessionRef.current.players || [] : [];
      await updateDoc(doc(db, "gameSessions", sessionId), {
        players: [...currentPlayers, newPlayer],
      });
      setHasJoined(true);
    } catch (err) {
      console.error("Join error:", err);
    }
  }, [playerUid, sessionId]);

  const handleLeave = useCallback(async () => {
    setShowLeave(false);
    if (hasJoinedRef.current) {
      try {
        const sess = sessionRef.current;
        if (sess) {
          const upd = (sess.players || []).filter(
            (p) => p.uid !== playerUid && p.name !== usernameRef.current
          );
          await updateDoc(doc(db, "gameSessions", sessionId), { players: upd });
        }
      } catch (err) { console.error("Leave:", err); }
    }
    const isReal = auth.currentUser && !auth.currentUser.isAnonymous;
    navigation.navigate(isReal ? "Dashboard" : "JoinGameScreen");
  }, [sessionId, playerUid]);

  // ── Renders ───────────────────────────────────────────────────────────────

  if (loading) return (
    <SafeAreaView style={S.center}>
      <ActivityIndicator size="large" color="#00c781" />
      <Text style={S.loadTxt}>Connecting…</Text>
    </SafeAreaView>
  );

  if (connError) return (
    <SafeAreaView style={S.center}>
      <Text style={S.errTxt}>{connError}</Text>
      <TouchableOpacity style={S.backBtn} onPress={() => navigation.goBack()}>
        <Text style={S.backBtnTxt}>Go Back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const players = session ? session.players || [] : [];

  if (!hasJoined) {
    return (
      <SafeAreaView style={S.container}>
        <Text style={S.title}>Brain Board</Text>
        <Text style={S.sub}>Pick your colour &amp; name</Text>

        <Animated.View style={{ transform: [{ scale: pulseVal }], marginBottom: 16 }}>
          <PawnIcon color={selectedColor} size={80} />
        </Animated.View>

        <ColorPicker color={selectedColor} onChange={handleColorChange} takenColors={takenColors} />

        {nicknamesEnabled ? (
          <View style={S.nameBox}>
            <Text style={S.nameLbl}>Your Name (auto-generated)</Text>
            <View style={S.nickRow}>
              <View style={S.nickDisplay}>
                <Text style={S.nickTxt} numberOfLines={1}>{username}</Text>
              </View>
              <TouchableOpacity style={S.shuffleBtn} onPress={() => setUsername(genNick())} activeOpacity={0.8}>
                <Text style={S.shuffleTxt}>🔀 Shuffle</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={S.nameBox}>
            <Text style={S.nameLbl}>Your Name</Text>
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
        )}

        <TouchableOpacity
          style={[S.joinBtn, !username.trim() && S.joinOff]}
          onPress={handleJoin}
          disabled={!username.trim()}
          activeOpacity={0.85}
        >
          <Text style={S.joinTxt}>Join Game →</Text>
        </TouchableOpacity>

        <TouchableOpacity style={S.leaveBtn} onPress={() => navigation.navigate("JoinGameScreen")}>
          <Text style={S.leaveTxt}>Leave</Text>
        </TouchableOpacity>

        <InfoModal
          visible={showNameTaken}
          title="Name Taken"
          message={nicknamesEnabled ? "That name is taken — tap Shuffle for a new one." : "That name is already in use."}
          onDismiss={() => setShowNameTaken(false)}
        />
        <InfoModal
          visible={showColorTaken}
          title="Colour Taken"
          message="Another player is using that colour. Pick a different one."
          onDismiss={() => setShowColorTaken(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.container}>
      <Text style={S.title}>Brain Board</Text>
      <Text style={S.waiting}>Waiting for the host to start…</Text>

      <View style={S.myCard}>
        <PawnIcon color={selectedColor} size={48} />
        <View style={{ marginLeft: 14, flex: 1 }}>
          <Text style={S.myLbl}>Playing as</Text>
          <Text style={[S.myName, { color: selectedColor }]} numberOfLines={1}>{username}</Text>
        </View>
      </View>

      <View style={S.listCard}>
        <Text style={S.listTitle}>Players in Lobby ({players.length})</Text>
        <FlatList
          data={players}
          keyExtractor={(_, i) => String(i)}
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

      <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
        <Text style={S.leaveTxt}>Leave</Text>
      </TouchableOpacity>

      <InfoModal visible={showKicked} title="Kicked"
        message="The host has removed you from this game."
        onDismiss={() => { setShowKicked(false); navigation.navigate("JoinGameScreen"); }} />
      <InfoModal visible={showAbandoned} title="Lobby Closed"
        message="The host has ended the lobby."
        onDismiss={() => { setShowAbandoned(false); navigation.navigate("JoinGameScreen"); }} />

      <Modal visible={showLeave} transparent animationType="fade">
        <View style={S.overlay}>
          <View style={S.modal}>
            <Text style={S.mTtl}>Leave Game?</Text>
            <Text style={S.mTxt}>Are you sure you want to leave?</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity style={[S.mBtn, { flex: 1, backgroundColor: "#2a2a2a" }]} onPress={() => setShowLeave(false)}>
                <Text style={S.mBtnTxt}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.mBtn, { flex: 1, backgroundColor: "#c0392b" }]} onPress={handleLeave}>
                <Text style={S.mBtnTxt}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  center:     { flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  container:  { flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center", padding: 24 },
  loadTxt:    { color: "#fff", marginTop: 16, fontSize: 18 },
  errTxt:     { color: "#ff6b6b", fontSize: 18, textAlign: "center" },
  backBtn:    { marginTop: 20, backgroundColor: "#333", padding: 14, borderRadius: 12 },
  backBtnTxt: { color: "#fff", fontWeight: "bold" },
  title:   { fontSize: 36, fontWeight: "bold", color: "#00c781", marginBottom: 4, textAlign: "center" },
  sub:     { fontSize: 15, color: "#888", marginBottom: 18 },
  waiting: { color: "#888", fontSize: 15, marginBottom: 24 },
  nameBox:    { width: "100%", maxWidth: 380, marginBottom: 20 },
  nameLbl:    { color: "#888", fontSize: 13, marginBottom: 8, marginLeft: 4 },
  nameInput:  { backgroundColor: "#1e1e1e", color: "#fff", fontSize: 20, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: "#333", width: "100%" },
  nickRow:    { flexDirection: "row", gap: 10, alignItems: "stretch" },
  nickDisplay:{ flex: 1, backgroundColor: "#1e1e1e", borderRadius: 14, borderWidth: 1.5, borderColor: "#9b59b6", padding: 16, justifyContent: "center" },
  nickTxt:    { color: "#fff", fontSize: 18, fontWeight: "600" },
  shuffleBtn: { backgroundColor: "#9b59b6", paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  shuffleTxt: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  joinBtn:  { backgroundColor: "#00c781", paddingVertical: 18, width: "100%", maxWidth: 380, borderRadius: 16, alignItems: "center" },
  joinOff:  { backgroundColor: "#1e1e1e", opacity: 0.4 },
  joinTxt:  { color: "#fff", fontSize: 20, fontWeight: "bold" },
  leaveBtn: { position: "absolute", bottom: 16, left: 16, backgroundColor: "#2a0000", paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12 },
  leaveTxt: { color: "#ff6b6b", fontSize: 14, fontWeight: "bold" },
  myCard:     { flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e", borderRadius: 16, padding: 20, width: "100%", maxWidth: 400, marginBottom: 20, borderWidth: 1, borderColor: "#333" },
  myLbl:      { color: "#555", fontSize: 12, marginBottom: 2 },
  myName:     { fontSize: 24, fontWeight: "bold" },
  listCard:   { backgroundColor: "#1e1e1e", borderRadius: 16, padding: 20, width: "100%", maxWidth: 400, flex: 1, borderWidth: 1, borderColor: "#333", marginBottom: 60 },
  listTitle:  { color: "#00c781", fontSize: 16, fontWeight: "bold", marginBottom: 12 },
  playerRow:  { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#2a2a2a" },
  playerRowMe:{ backgroundColor: "#003322", borderRadius: 8, paddingHorizontal: 8 },
  dot:        { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  rowName:    { color: "#fff", fontSize: 16, flex: 1 },
  youBadge:   { backgroundColor: "#00c781", color: "#000", fontSize: 11, fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal:   { backgroundColor: "#1e1e1e", borderRadius: 20, padding: 32, width: "85%", maxWidth: 360, alignItems: "center", borderWidth: 1, borderColor: "#333" },
  mTtl:    { color: "#fff", fontSize: 22, fontWeight: "bold", marginBottom: 12, textAlign: "center" },
  mTxt:    { color: "#ccc", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 24 },
  mBtn:    { backgroundColor: "#00c781", paddingVertical: 14, width: "100%", borderRadius: 14, alignItems: "center" },
  mBtnTxt: { color: "#fff", fontWeight: "bold", fontSize: 16 },
});