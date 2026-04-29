/**
 * JoinGameScreen.js
 * FIX #4: Player limit — popup + go back if full
 * FIX #5: Lock button — popup + go back if locked
 */

import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator, Modal, Pressable, Platform, useWindowDimensions,
} from "react-native";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs } from "firebase/firestore";

export default function JoinGameScreen({ navigation }) {
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 500;
  const [gameCode, setGameCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [modal, setModal]         = useState({ visible: false, title: "", message: "", goBack: false });

  const showModal = (title, message, goBack = false) =>
    setModal({ visible: true, title, message, goBack });

  const handleDismiss = () => {
    const shouldGoBack = modal.goBack;
    setModal({ visible: false, title: "", message: "", goBack: false });
    if (shouldGoBack) navigation.navigate("JoinGameScreen");
  };

  const handleJoinGame = async () => {
    const trimmed = gameCode.trim();
    if (trimmed.length !== 6) {
      showModal("Invalid Code", "Please enter the 6-digit game PIN.");
      return;
    }
    setIsJoining(true);
    try {
      const q = query(collection(db, "gameSessions"), where("pin", "==", trimmed));
      const snap = await getDocs(q);

      if (snap.empty) {
        showModal("Not Found", "No game found with that PIN. Check it and try again.");
        return;
      }

      const sessionDoc = snap.docs[0];
      const data = sessionDoc.data();

      // Game already started?
      if (data.status !== "lobby") {
        showModal("Already Started", "This game has already started. You can no longer join.");
        return;
      }

      // FIX #5: Lobby locked?
      if (data.isLobbyLocked) {
        showModal(
          "Lobby Locked",
          "The game you are attempting to join is locked.\n\nThe host has prevented new players from joining. Try again later or ask the host to unlock.",
          true // goBack = true → dismiss sends back
        );
        return;
      }

      // FIX #4: Game full?
      const maxPlayers = data.settings?.maxPlayers ?? 30;
      const currentCount = (data.players || []).length;
      if (currentCount >= maxPlayers) {
        showModal(
          "Game Full",
          `This game is full (${currentCount}/${maxPlayers} players).\n\nYou cannot join. Try a different game.`,
          true
        );
        return;
      }

      navigation.navigate("GameScreen", {
        sessionId: sessionDoc.id,
        gameId: data.gameId,
        isHost: false,
      });
    } catch (err) {
      console.error("Join error:", err);
      showModal("Error", "Could not connect. Check your internet and try again.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Brain Board</Text>
      <Text style={styles.subtitle}>Enter your 6-digit game PIN</Text>

      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor="#333"
        value={gameCode}
        onChangeText={t => setGameCode(t.replace(/[^0-9]/g, ""))}
        keyboardType="numeric"
        maxLength={6}
        editable={!isJoining}
      />

      <TouchableOpacity
        style={[styles.btn, (isJoining || gameCode.length !== 6) && styles.btnDisabled]}
        onPress={handleJoinGame}
        disabled={isJoining || gameCode.length !== 6}
        activeOpacity={0.85}
      >
        {isJoining
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Join Game →</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.backLink} onPress={() => navigation.navigate("Home")}>
        <Text style={styles.backLinkText}>← Back to Home</Text>
      </TouchableOpacity>

      {/* Universal modal */}
      <Modal visible={modal.visible} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{modal.title}</Text>
            <Text style={styles.cardMsg}>{modal.message}</Text>
            <TouchableOpacity style={styles.cardBtn} onPress={handleDismiss}>
              <Text style={styles.cardBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "bold", color: "#00c781", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#888", marginBottom: 24 },
  input: {
    width: "100%", maxWidth: 340, height: 56,
    backgroundColor: "#1e1e1e", borderRadius: 14, color: "#fff",
    fontSize: 22, marginBottom: 12,
    borderWidth: 2, borderColor: "#333",
    textAlign: "center",
    paddingHorizontal: 14,
  },
  btn: {
    width: "100%", maxWidth: 340, height: 52, backgroundColor: "#00c781",
    borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  btnDisabled: { backgroundColor: "#222", opacity: 0.5 },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "bold" },

  backLink: { marginTop: 8 },
  backLinkText: { color: "#555", fontSize: 15 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: "#1e1e1e", borderRadius: 22, padding: 22,
    width: "85%", maxWidth: 380, alignItems: "center",
    borderWidth: 1, borderColor: "#333",
  },
  cardTitle: { fontSize: 18, fontWeight: "bold", color: "#fff", marginBottom: 14, textAlign: "center" },
  cardMsg: { fontSize: 16, color: "#ccc", textAlign: "center", lineHeight: 24, marginBottom: 28 },
  cardBtn: {
    backgroundColor: "#00c781", paddingVertical: 14, width: "100%",
    borderRadius: 14, alignItems: "center",
  },
  cardBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});