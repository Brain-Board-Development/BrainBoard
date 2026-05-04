/**
 * Lobby.js
 * Space distribution: 60% mystery, 10% normal, 10% lava, 10% cannon, 10% trap
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, SafeAreaView, Modal, ScrollView, Animated, Dimensions, TextInput, Pressable, Platform, useWindowDimensions,
} from "react-native";
import { db } from "../firebaseConfig";
import { doc, onSnapshot, updateDoc, getDoc } from "firebase/firestore";

const SPACE_POOL = [
  "mystery", "mystery", "mystery",
  "normal", "normal",
  "lava",
  "cannon",
  "trap",
];

const calcBoardSize = (n) =>
  Math.min(150, Math.max(15, Math.round(5 * Math.max(0, n - 1) + 40)));

function Pawn({ color, size = 14 }) {
  const c = color || "#888";
  const s = size;
  const dark = "rgba(0,0,0,0.6)";
  return (
    <View style={{ width: s, height: s * 1.1, alignItems: "center", justifyContent: "flex-end" }}>
      {/* Head — simple circle */}
      <View style={{ width: s * 0.46, height: s * 0.46, borderRadius: s * 0.23,
          backgroundColor: c, borderWidth: 1.5, borderColor: dark }} />
      {/* Body — tapered trapezoid shape */}
      <View style={{ width: s * 0.68, height: s * 0.44,
          borderTopLeftRadius: s * 0.08, borderTopRightRadius: s * 0.08,
          borderBottomLeftRadius: s * 0.18, borderBottomRightRadius: s * 0.18,
          backgroundColor: c, borderWidth: 1.5, borderColor: dark,
          marginTop: s * 0.04 }} />
    </View>
  );
}
function LavaTile({ sz }) {
  // Use SVG-style layering: dark rock slabs, glowing orange cracks between them,
  // bright yellow lava pools at crack nodes
  const rock = "#1c0800";
  const darkCrust = "#2e0d02";
  const glowOrange = "#ff5500";
  const glowYellow = "#ffbb00";
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden", backgroundColor:rock }}>

      {/* ── Rock slab chunks — irregular dark polygons ── */}
      {[
        {t:0,    l:0,    w:0.44, h:0.42, br:[6,2,8,4],  c:"#280c01"},
        {t:0,    l:0.48, w:0.52, h:0.36, br:[2,6,4,8],  c:"#2e0e02"},
        {t:0.45, l:0,    w:0.38, h:0.55, br:[4,8,6,2],  c:"#240b01"},
        {t:0.4,  l:0.42, w:0.58, h:0.6,  br:[8,4,2,6],  c:"#2a0d02"},
        {t:0.2,  l:0.2,  w:0.28, h:0.26, br:[4,4,4,4],  c:"#321002"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute",
            top:sz*r.t, left:sz*r.l, width:sz*r.w, height:sz*r.h,
            borderTopLeftRadius:r.br[0], borderTopRightRadius:r.br[1],
            borderBottomRightRadius:r.br[2], borderBottomLeftRadius:r.br[3],
            backgroundColor:r.c }} />
      ))}

      {/* ── Lava fissures — glowing orange lines between slabs ── */}
      {/* Horizontal main crack */}
      <View style={{ position:"absolute", top:sz*0.41, left:0, right:0,
          height:sz*0.07, backgroundColor:glowOrange }} />
      {/* Vertical main crack */}
      <View style={{ position:"absolute", left:sz*0.43, top:0, bottom:0,
          width:sz*0.07, backgroundColor:glowOrange }} />
      {/* Diagonal sub-crack top-right */}
      <View style={{ position:"absolute", top:sz*0.04, left:sz*0.62,
          width:sz*0.06, height:sz*0.38,
          backgroundColor:"#e04a00",
          transform:[{rotate:"20deg"}] }} />
      {/* Diagonal sub-crack bottom-left */}
      <View style={{ position:"absolute", top:sz*0.55, left:sz*0.08,
          width:sz*0.06, height:sz*0.36,
          backgroundColor:"#e04a00",
          transform:[{rotate:"-15deg"}] }} />

      {/* ── Glow bleed — soft halo around cracks ── */}
      <View style={{ position:"absolute", top:sz*0.35, left:0, right:0,
          height:sz*0.19, backgroundColor:"rgba(255,80,0,0.18)" }} />
      <View style={{ position:"absolute", left:sz*0.37, top:0, bottom:0,
          width:sz*0.19, backgroundColor:"rgba(255,80,0,0.18)" }} />

      {/* ── Lava pools at crack intersections ── */}
      {/* Centre node — brightest */}
      <View style={{ position:"absolute", top:sz*0.36, left:sz*0.38,
          width:sz*0.18, height:sz*0.18, borderRadius:sz*0.09,
          backgroundColor:glowYellow }} />
      {/* Top-centre node */}
      <View style={{ position:"absolute", top:sz*0.0, left:sz*0.39,
          width:sz*0.13, height:sz*0.13, borderRadius:sz*0.065,
          backgroundColor:glowYellow, opacity:0.9 }} />
      {/* Left-centre node */}
      <View style={{ position:"absolute", top:sz*0.38, left:sz*0.0,
          width:sz*0.13, height:sz*0.13, borderRadius:sz*0.065,
          backgroundColor:glowYellow, opacity:0.85 }} />
      {/* Right-centre node */}
      <View style={{ position:"absolute", top:sz*0.38, right:0,
          width:sz*0.13, height:sz*0.13, borderRadius:sz*0.065,
          backgroundColor:glowYellow, opacity:0.85 }} />
      {/* Bottom-centre node */}
      <View style={{ position:"absolute", bottom:0, left:sz*0.39,
          width:sz*0.13, height:sz*0.13, borderRadius:sz*0.065,
          backgroundColor:glowYellow, opacity:0.9 }} />
      {/* Small secondary bubbles */}
      {[{t:0.14,l:0.62},{t:0.68,l:0.16},{t:0.72,l:0.64},{t:0.08,l:0.15}].map((b,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*b.t, left:sz*b.l,
            width:sz*0.07, height:sz*0.07, borderRadius:sz*0.035,
            backgroundColor:"#ff8800", opacity:0.8 }} />
      ))}
    </View>
  );
}

// ── Trap tile — stone floor with a spiked pit trap ─────────────────────────

function TrapTile({ sz }) {
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden",
        backgroundColor:"#2a2520" }}>

      {/* ── Stone floor — four cobblestone blocks with mortar lines ── */}
      {[
        {t:0,    l:0,    w:0.47, h:0.47, c:"#3d3530"},
        {t:0,    l:0.53, w:0.47, h:0.47, c:"#362f28"},
        {t:0.53, l:0,    w:0.47, h:0.47, c:"#383028"},
        {t:0.53, l:0.53, w:0.47, h:0.47, c:"#3a3228"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*r.t, left:sz*r.l,
            width:sz*r.w, height:sz*r.h, backgroundColor:r.c,
            borderWidth:0.5, borderColor:"#1a1510" }} />
      ))}
      {/* Mortar cross */}
      <View style={{ position:"absolute", top:sz*0.47, left:0, right:0,
          height:sz*0.06, backgroundColor:"#1a1510" }} />
      <View style={{ position:"absolute", left:sz*0.47, top:0, bottom:0,
          width:sz*0.06, backgroundColor:"#1a1510" }} />

      {/* Stone surface texture — small pits */}
      {[{t:0.08,l:0.1},{t:0.16,l:0.34},{t:0.08,l:0.64},{t:0.28,l:0.72},
        {t:0.62,l:0.08},{t:0.72,l:0.3},{t:0.65,l:0.66},{t:0.78,l:0.8},
      ].map((p,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*p.t, left:sz*p.l,
            width:sz*0.06, height:sz*0.04, borderRadius:sz*0.02,
            backgroundColor:"rgba(0,0,0,0.25)" }} />
      ))}

      {/* ── Pit — dark rectangular hole in floor centre ── */}
      <View style={{ position:"absolute", top:sz*0.19, left:sz*0.18,
          width:sz*0.64, height:sz*0.62,
          borderRadius:sz*0.04,
          backgroundColor:"#0a0806",
          borderWidth:2, borderColor:"#111" }}>
        {/* Pit depth shadow */}
        <View style={{ position:"absolute", top:2, left:2, right:2, bottom:2,
            borderRadius:sz*0.03, backgroundColor:"#050303" }} />
        {/* Pit inner edge highlight (near side lit) */}
        <View style={{ position:"absolute", top:0, left:0, right:0,
            height:sz*0.05, borderTopLeftRadius:sz*0.04, borderTopRightRadius:sz*0.04,
            backgroundColor:"rgba(255,255,255,0.06)" }} />
      </View>

      {/* ── Spikes — sharp triangles pointing up inside pit ── */}
      {[0.26, 0.40, 0.54, 0.68].map((l,i)=>(
        <View key={i} style={{ position:"absolute", bottom:sz*0.21, left:sz*l,
            width:0, height:0,
            borderLeftWidth:sz*0.05, borderRightWidth:sz*0.05, borderBottomWidth:sz*0.22,
            borderLeftColor:"transparent", borderRightColor:"transparent",
            borderBottomColor: i%2===0 ? "#9e9e9e" : "#bdbdbd" }} />
      ))}

      {/* ── Worn cracks extending from pit corners ── */}
      {[{t:0.14,l:0.12,rot:"-40deg",h:0.1},{t:0.16,l:0.76,rot:"40deg",h:0.1},
        {t:0.78,l:0.1, rot:"35deg", h:0.1},{t:0.78,l:0.78,rot:"-35deg",h:0.1},
      ].map((c,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*c.t, left:sz*c.l,
            width:2, height:sz*c.h, backgroundColor:"#0a0806",
            transform:[{rotate:c.rot}] }} />
      ))}
    </View>
  );
}

// ── Cannon tile — top-down view of a cannon pointing LEFT ─────────────────

function CannonTile({ sz }) {
  return (
    <View style={{ width:sz, height:sz, borderRadius:7, overflow:"hidden",
        backgroundColor:"#0e1620" }}>

      {/* ── Stone/brick floor ── */}
      {[{t:0,l:0,w:0.5,h:0.5,c:"#16202c"},{t:0,l:0.5,w:0.5,h:0.5,c:"#131d28"},
        {t:0.5,l:0,w:0.5,h:0.5,c:"#14202a"},{t:0.5,l:0.5,w:0.5,h:0.5,c:"#16222e"},
      ].map((r,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*r.t, left:sz*r.l,
            width:sz*r.w, height:sz*r.h, backgroundColor:r.c,
            borderWidth:0.5, borderColor:"#0a1218" }} />
      ))}

      {/* ── Wooden carriage platform ── */}
      <View style={{ position:"absolute", top:sz*0.28, left:sz*0.16,
          width:sz*0.74, height:sz*0.44,
          borderRadius:sz*0.04,
          backgroundColor:"#4a3520",
          borderWidth:1.5, borderColor:"#2c1e10" }}>
        {/* Wood grain lines */}
        {[0.2,0.4,0.6,0.8].map((t,i)=>(
          <View key={i} style={{ position:"absolute", top:`${t*100}%`, left:0, right:0,
              height:0.5, backgroundColor:"rgba(0,0,0,0.2)" }} />
        ))}
        {/* Corner bolts */}
        {[[0.06,0.1],[0.88,0.1],[0.06,0.74],[0.88,0.74]].map(([x,y],i)=>(
          <View key={i} style={{ position:"absolute",
              top:sz*y*0.44, left:sz*x*0.74,
              width:sz*0.07, height:sz*0.07, borderRadius:sz*0.035,
              backgroundColor:"#6e5030", borderWidth:1, borderColor:"#2c1e10" }} />
        ))}
      </View>

      {/* ── Barrel — viewed top-down, thick cylinder pointing left ── */}
      {/* Drop shadow */}
      <View style={{ position:"absolute", top:sz*0.37, left:sz*0.04,
          width:sz*0.66, height:sz*0.28,
          borderRadius:sz*0.14,
          backgroundColor:"rgba(0,0,0,0.45)" }} />
      {/* Barrel body */}
      <View style={{ position:"absolute", top:sz*0.34, left:sz*0.06,
          width:sz*0.64, height:sz*0.26,
          borderRadius:sz*0.13,
          backgroundColor:"#546e7a",
          borderWidth:1.5, borderColor:"#263238" }}>
        {/* Top specular highlight */}
        <View style={{ position:"absolute", top:2, left:sz*0.08, right:sz*0.14,
            height:sz*0.07, borderRadius:sz*0.04,
            backgroundColor:"rgba(255,255,255,0.15)" }} />
        {/* Reinforcement rings */}
        {[0.12, 0.34, 0.58, 0.78].map((l,i)=>(
          <View key={i} style={{ position:"absolute", top:0, left:sz*l*0.64,
              width:sz*0.05, height:"100%",
              backgroundColor: i===0||i===3 ? "#455a64" : "#4a6572",
              borderLeftWidth:0.5, borderRightWidth:0.5,
              borderColor:"#263238" }} />
        ))}
      </View>
      {/* Muzzle — wider darker opening at LEFT end */}
      <View style={{ position:"absolute", top:sz*0.36, left:sz*0.04,
          width:sz*0.12, height:sz*0.22,
          borderRadius:sz*0.11,
          backgroundColor:"#37474f",
          borderWidth:1.5, borderColor:"#1c2d36" }}>
        {/* Bore hole */}
        <View style={{ position:"absolute", top:sz*0.03, left:sz*0.02,
            width:sz*0.08, height:sz*0.15,
            borderRadius:sz*0.075, backgroundColor:"#0a1018" }} />
      </View>
      {/* Breech cap — thicker right end */}
      <View style={{ position:"absolute", top:sz*0.31, left:sz*0.62,
          width:sz*0.13, height:sz*0.32,
          borderRadius:sz*0.07,
          backgroundColor:"#546e7a",
          borderWidth:1.5, borderColor:"#263238" }}>
        {/* Touch-hole */}
        <View style={{ position:"absolute", top:sz*0.03, left:sz*0.04,
            width:sz*0.05, height:sz*0.05, borderRadius:sz*0.025,
            backgroundColor:"#1c2d36" }} />
      </View>

      {/* ── Wheels — top-down circles, lower half of tile ── */}
      {[{side:"left",l:sz*0.14},{side:"right",l:sz*0.56}].map(({side,l},wi)=>(
        <View key={wi} style={{ position:"absolute", bottom:sz*0.04, left:l,
            width:sz*0.3, height:sz*0.3, borderRadius:sz*0.15,
            backgroundColor:"#5d4037", borderWidth:2, borderColor:"#3e2723" }}>
          {/* Hub */}
          <View style={{ position:"absolute", top:sz*0.08, left:sz*0.08,
              width:sz*0.14, height:sz*0.14, borderRadius:sz*0.07,
              backgroundColor:"#8d6e63", borderWidth:1, borderColor:"#3e2723" }} />
          {/* Spokes */}
          {[0,45,90,135].map(deg=>(
            <View key={deg} style={{ position:"absolute", top:"50%", left:"50%",
                width:sz*0.26, height:1.5, backgroundColor:"#4e342e",
                marginLeft:-sz*0.13, marginTop:-0.75,
                transform:[{rotate:`${deg}deg`}] }} />
          ))}
        </View>
      ))}

      {/* ── Cannonball resting beside carriage ── */}
      <View style={{ position:"absolute", top:sz*0.1, left:sz*0.74,
          width:sz*0.18, height:sz*0.18, borderRadius:sz*0.09,
          backgroundColor:"#424242",
          borderWidth:1, borderColor:"#212121" }}>
        <View style={{ position:"absolute", top:2, left:3,
            width:sz*0.06, height:sz*0.06, borderRadius:sz*0.03,
            backgroundColor:"rgba(255,255,255,0.2)" }} />
      </View>

      {/* ── Smoke puffs at muzzle ── */}
      {[{t:0.3, l:-0.05,r:0.1,o:0.4},{t:0.2,l:-0.04,r:0.08,o:0.25},
        {t:0.44,l:-0.06,r:0.07,o:0.3}].map((b,i)=>(
        <View key={i} style={{ position:"absolute", top:sz*b.t, left:sz*b.l,
            width:sz*b.r*2, height:sz*b.r*2, borderRadius:sz*b.r,
            backgroundColor:"#b0bec5", opacity:b.o }} />
      ))}
    </View>
  );
}

export default function Lobby({ route, navigation }) {
  const { sessionId, pin, gameId, isHost } = route.params;

  const [players,    setPlayers]    = useState([]);
  const [session,    setSession]    = useState(null);
  const [locked,     setLocked]     = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [showLeave,    setShowLeave]    = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
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
            <Text style={S.hostPickerTitle}>You're playing! Enter your name</Text>
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

        <TouchableOpacity
          style={S.tutorialBtn}
          onPress={() => setShowTutorial(true)}
          activeOpacity={0.85}
        >
          <Text style={S.tutorialBtnTxt}>Tutorial</Text>
        </TouchableOpacity>
      </ScrollView>

      {isHost ? (
        <View style={S.hostBar}>
          <TouchableOpacity style={S.leaveBtn} onPress={() => setShowLeave(true)}>
            <Text style={S.leaveTxt}>Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tutorialBarBtn} onPress={() => setShowTutorial(true)}>
            <Text style={S.tutorialBarBtnTxt}>Tutorial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.lockBtn, locked && S.lockOn]} onPress={toggleLock}>
            <Text style={[S.lockTxt, locked && { color: "#00c781" }]}>
              {locked ? "LOCKED" : "OPEN"}
            </Text>
          </TouchableOpacity>
          <Pressable
            style={({hovered, pressed}) => [
              S.startBtn,
              (players.length === 0 || starting) && S.startOff,
              Platform.OS === 'web' && hovered && players.length > 0 && !starting && { borderColor: '#fff', borderWidth: 2.5 },
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleStartGame}
            disabled={players.length === 0 || starting}
          >
            <Text style={S.startTxt}>{starting ? "Starting…" : "Start Game"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={S.hostBar}>
          <TouchableOpacity style={[S.leaveBtn, {flex:1, maxWidth:200}]} onPress={() => setShowLeave(true)}>
            <Text style={S.leaveTxt}>Leave Game</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tutorialBarBtn} onPress={() => setShowTutorial(true)}>
            <Text style={S.tutorialBarBtnTxt}>Tutorial</Text>
          </TouchableOpacity>
        </View>
      )}

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
      {/* Tutorial Modal */}
      <Modal visible={showTutorial} transparent animationType="slide" onRequestClose={() => setShowTutorial(false)}>
        <View style={S.tutorialOverlay}>
          <View style={S.tutorialModal}>
            <View style={S.tutorialHeader}>
              <Text style={S.tutorialTitle}>How to Play</Text>
              <TouchableOpacity onPress={() => setShowTutorial(false)} style={S.tutorialClose}>
                <Text style={S.tutorialCloseTxt}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={S.tutorialScroll} showsVerticalScrollIndicator>

              {/* ── OVERVIEW ── */}
              <Text style={S.tutSecTitle}>How to Play</Text>
              <Text style={S.tutText}>
                Brain Board is a multiplayer quiz race. Answer questions correctly to earn dice rolls — move your piece forward, and be the first to reach the end of the board!
              </Text>
              <Text style={S.tutText}>
                Answer <Text style={S.tutBold}>3 correct questions</Text> in a row to earn a dice roll. The more you answer, the further you go.
              </Text>

              {/* ── TURN FLOW ── */}
              <View style={S.tutDivider}/>
              <Text style={S.tutSecTitle}>Turn Flow</Text>
              {[
                ["1. Answer Questions", "You are shown one question at a time with a countdown timer. Answer before time runs out!"],
                ["2. Roll the Dice", "After 3 correct answers, you earn a dice roll. The number you roll is how many spaces you move forward."],
                ["3. Land on a Space", "After moving, the space you land on triggers an event — good or bad!"],
                ["4. Repeat", "Keep answering to earn more rolls. First player to reach the final tile wins."],
              ].map(([title, desc]) => (
                <View key={title} style={S.tutStep}>
                  <Text style={S.tutStepTitle}>{title}</Text>
                  <Text style={S.tutStepDesc}>{desc}</Text>
                </View>
              ))}

              {/* ── TILES ── */}
              <View style={S.tutDivider}/>
              <Text style={S.tutSecTitle}>Board Spaces</Text>

              {[
                {bg:'#27ae60',btc:'#33cc77',bbc:'#145a32',label:'42',title:'Normal Space',desc:'Nothing happens. Just move forward and keep answering!'},
                {bg:'#c0392b',btc:'#e74c3c',bbc:'#7b241c',label:'🔥',title:'Lava',desc:"You've landed in lava! Roll the dice — you'll be pushed backwards by that many spaces."},
                {bg:'#0369a1',btc:'#38bdf8',bbc:'#0c4a6e',label:'✦',title:'Cannon',desc:"A magical blue orb launches you forward! Roll the dice to see how many spaces you fly."},
                {bg:'#ea580c',btc:'#fb923c',bbc:'#7c2d12',label:'✕',title:'Trap',desc:"An evil rune curse traps you! Answer a bonus question to break free or lose progress."},
                {bg:'#8b5cf6',btc:'#c4b5fd',bbc:'#5b2c6f',label:'?',title:'Mystery Box',desc:'A random item is awarded — could be good or bad. Items go into your inventory.'},
              ].map(({bg,btc,bbc,label,title,desc})=>(
                <View key={title} style={[S.tutStep,{flexDirection:'row',alignItems:'center',paddingVertical:10}]}>
                  <View style={{width:48,height:48,borderRadius:18,backgroundColor:bg,
                    borderTopWidth:2,borderLeftWidth:2,borderBottomWidth:5,borderRightWidth:5,
                    borderTopColor:btc,borderLeftColor:btc,borderBottomColor:bbc,borderRightColor:bbc,
                    alignItems:'center',justifyContent:'center',marginRight:12}}>
                    <Text style={{color:'#fff',fontWeight:'900',fontSize:label.length>1?20:16}}>{label}</Text>
                  </View>
                  <View style={{flex:1}}>
                    <Text style={S.tutStepTitle}>{title}</Text>
                    <Text style={S.tutStepDesc}>{desc}</Text>
                  </View>
                </View>
              ))}

              {/* ── ITEMS ── */}
              <View style={S.tutDivider}/>
              <Text style={S.tutSecTitle}>Mystery Box Items</Text>
              {[
                ["Immunity", "Protects you from the next negative space effect or attack. Lasts 2 landings or 45 seconds."],
                ["Double Dice Roll", "Your next roll uses two dice — you move the total of both!"],
                ["Push Back", "Target another player and push them back 3 spaces."],
                ["Stun", "Target a player — they must answer 3 questions in a row correctly to break free. Until then they can't roll."],
                ["Deflector", "If someone attacks you in the next 30 seconds, the effect bounces back to them instead."],
                ["1v1 Duel", "Challenge another player to a 3-question duel. Most correct answers wins — the loser swaps positions with the winner if the winner is behind."],
              ].map(([name, desc]) => (
                <View key={name} style={S.tutItem}>
                  <Text style={S.tutItemName}>{name}</Text>
                  <Text style={S.tutItemDesc}>{desc}</Text>
                </View>
              ))}

              {/* ── STREAKS ── */}
              <View style={S.tutDivider}/>
              <Text style={S.tutSecTitle}>Streaks & Luck</Text>
              <Text style={S.tutText}>
                <Text style={S.tutBold}>Streak</Text> — Every consecutive correct answer adds to your streak. Higher streaks build your Luck stat.
              </Text>
              <Text style={S.tutText}>
                <Text style={S.tutBold}>Luck</Text> — A percentage chance that your dice roll gets re-rolled if it's low, and you keep the better result. Get on a hot streak to maximize your luck!
              </Text>
              <Text style={S.tutText}>
                Getting a question <Text style={S.tutBold}>wrong</Text> resets your streak to 0.
              </Text>

              {/* ── WINNING ── */}
              <View style={S.tutDivider}/>
              <Text style={S.tutSecTitle}>Winning</Text>
              <Text style={S.tutText}>
                The first player to reach or pass the <Text style={S.tutBold}>final tile</Text> (the snake head) wins the game! If a timer is set, the player furthest along when time expires wins.
              </Text>

              <View style={{height:20}}/>
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  scroll:    { padding: 12, paddingBottom: 120 },
  loadTxt:   { color: "#fff", marginTop: 16, fontSize: 18, textAlign: "center" },
  errBanner: { backgroundColor: "#3a0000", borderRadius: 10, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: "#e74c3c" },
  errTxt:    { color: "#ff6b6b", fontSize: 13, flex: 1, lineHeight: 18 },
  errClose:  { color: "#ff6b6b", fontSize: 16, fontWeight: "bold", marginLeft: 8 },
  pinCard:   { backgroundColor: "#1e1e1e", borderRadius: 22, padding: 16, alignItems: "center", marginBottom: 10, borderWidth: 2, borderColor: "#00c781" },
  pinLbl:    { color: "#888", fontSize: 13, letterSpacing: 4, marginBottom: 8 },
  pin:       { fontSize: 40, fontWeight: "bold", color: "#00c781", letterSpacing: 8 },
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
  hostSwatch:        { width: 30, height: 30, borderRadius: 15, justifyContent: "center", alignItems: "center", borderWidth: 2.5, borderColor: "transparent" },
  hostSwatchActive:  { borderColor: "#fff", transform: [{ scale: 1.2 }] },
  hostSwatchTaken:   { opacity: 0.25 },
  hostSwatchCheck:   { color: "#fff", fontSize: 14, fontWeight: "bold" },
  playerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  playerCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1e1e1e", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: "#2a2a2a", minWidth: 120, flex: 1 },
  playerDot:  { width: 14, height: 14, borderRadius: 7, marginRight: 10 },
  playerName: { color: "#fff", fontSize: 15, flex: 1 },
  kickBtn:    { backgroundColor: "#3a0000", borderRadius: 8, width: 26, height: 26, justifyContent: "center", alignItems: "center", marginLeft: 6 },
  kickTxt:    { color: "#ff6b6b", fontSize: 13, fontWeight: "bold" },
  hostBar:    { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10, paddingBottom: 20, alignItems: "center", backgroundColor: "rgba(13,13,13,0.95)", borderTopWidth: 1, borderTopColor: "#222" },
  lockBtn:    { backgroundColor: "#1e1e1e", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "#333" },
  lockOn:     { backgroundColor: "#003322", borderColor: "#00c781" },
  lockTxt:    { color: "#888", fontSize: 12, fontWeight: "bold" },
  tutorialBtn:    { backgroundColor: "#0d1e2e", borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 20, borderWidth: 1.5, borderColor: "#3498db" },
  tutorialBtnTxt: { color: "#3498db", fontSize: 16, fontWeight: "bold" },
  tutorialOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
  tutorialModal:  { backgroundColor: "#1a1a1a", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%", borderWidth: 1, borderColor: "#333" },
  tutorialHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#222" },
  tutorialTitle:  { color: "#fff", fontSize: 20, fontWeight: "bold" },
  tutorialClose:  { width: 36, height: 36, borderRadius: 18, backgroundColor: "#2a2a2a", alignItems: "center", justifyContent: "center" },
  tutorialCloseTxt:{ color: "#fff", fontSize: 22, fontWeight: "bold", lineHeight: 26 },
  tutorialScroll: { padding: 20, paddingBottom: 40 },
  tutSecTitle:    { color: "#00c781", fontSize: 17, fontWeight: "900", marginBottom: 10, marginTop: 4 },
  tutText:        { color: "#ccc", fontSize: 14, lineHeight: 22, marginBottom: 10 },
  tutBold:        { color: "#fff", fontWeight: "bold" },
  tutDivider:     { height: 1, backgroundColor: "#2a2a2a", marginVertical: 18 },
  tutStep:        { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: "#00c781" },
  tutStepTitle:   { color: "#fff", fontWeight: "bold", fontSize: 14, marginBottom: 4 },
  tutStepDesc:    { color: "#aaa", fontSize: 13, lineHeight: 20 },
  tutTileRow:     { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16, backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12 },
  tutTileBox:     { width: 56, height: 56, borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tutTileDesc:    { flex: 1 },
  tutTileTitle:   { color: "#fff", fontWeight: "bold", fontSize: 14, marginBottom: 3 },
  tutTileText:    { color: "#aaa", fontSize: 12, lineHeight: 18 },
  tutItem:        { backgroundColor: "#1a1a1a", borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: "#8e44ad" },
  tutItemName:    { color: "#c084fc", fontWeight: "bold", fontSize: 13, marginBottom: 3 },
  tutItemDesc:    { color: "#aaa", fontSize: 12, lineHeight: 18 },
  tutorialBody:   { color: "#888", fontSize: 15 },
  startBtn:   { flex: 1, backgroundColor: "#00c781", borderRadius: 16, paddingVertical: 14, alignItems: "center" },
  startOff:   { backgroundColor: "#1e1e1e", opacity: 0.4 },
  startTxt:   { color: "#000", fontSize: 16, fontWeight: "bold" },
  leaveBtn:   { backgroundColor: "#2a0000", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "#5a0000" },
  tutorialBarBtn:    { backgroundColor: "#0d1e2e", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: "#3498db" },
  tutorialBarBtnTxt: { color: "#3498db", fontSize: 13, fontWeight: "bold" },
  leaveTxt:   { color: "#ff6b6b", fontSize: 13, fontWeight: "bold" },
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  modal:      { backgroundColor: "#1e1e1e", borderRadius: 20, padding: 28, width: "85%", maxWidth: 360, borderWidth: 1, borderColor: "#333" },
  mTtl:       { color: "#fff", fontSize: 16, fontWeight: "bold", marginBottom: 12 },
  mTxt:       { color: "#ccc", fontSize: 15, lineHeight: 22, marginBottom: 24 },
  mRow:       { flexDirection: "row", gap: 12 },
  mGrey:      { flex: 1, backgroundColor: "#2a2a2a", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  mRed:       { flex: 1, backgroundColor: "#c0392b", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  mBtnTxt:    { color: "#fff", fontWeight: "bold" },
});