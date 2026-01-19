/**
 * JoinGameScreen.js - Updated to allow real lobby joining
 * Players enter 6-digit PIN → validate → join session → go to game
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  doc,          // Added
  updateDoc,    // Added
} from "firebase/firestore";

export default function JoinGameScreen({ navigation }) {
  const [gameCode, setGameCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);

  const handleInputChange = (text) => {
    const numericText = text.replace(/[^0-9]/g, "");
    setGameCode(numericText);
  };

  const handleJoinGame = async () => {
    if (gameCode.length !== 6) {
      Alert.alert("Invalid Code", "Please enter a 6-digit game code.");
      return;
    }

    setIsJoining(true);

    try {
      // 1. Find the session by PIN
      const q = query(collection(db, "gameSessions"), where("pin", "==", gameCode));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        Alert.alert("Not Found", "No game found with that code.");
        return;
      }

      // Get the first (and only) matching session
      const sessionDoc = querySnapshot.docs[0];
      const sessionData = sessionDoc.data();
      const sessionId = sessionDoc.id;

      // 2. Check if game already started
      if (sessionData.status !== "lobby") {
        Alert.alert("Game Started", "This game has already started. You can't join now.");
        return;
      }

      // 3. Get current user info (support logged-in + guest)
      const user = auth.currentUser;
      const playerUid = user?.uid || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const playerName = user?.displayName || user?.email?.split("@")[0] || `Player${Math.floor(Math.random() * 1000)}`;

      // 4. Prevent duplicate join (check by uid)
      if (sessionData.players?.some(p => p.uid === playerUid)) {
        Alert.alert("Already Joined", "You're already in this lobby!");
        navigation.navigate("GameScreen", {
          sessionId,
          gameId: sessionData.gameId,
          isHost: false,
        });
        return;
      }

      // 5. Add player to the session
      const updatedPlayers = [
        ...(sessionData.players || []),
        {
          uid: playerUid,
          name: playerName,
          joinedAt: new Date().toISOString(),
          score: 0,
        },
      ];

      // Update Firestore
      await updateDoc(doc(db, "gameSessions", sessionId), {
        players: updatedPlayers,
      });

      // 6. Navigate to the game screen
      navigation.navigate("GameScreen", {
        sessionId,
        gameId: sessionData.gameId,
        isHost: false,
      });
    } catch (error) {
      console.error("Join failed:", error);
      let message = "Failed to join the game. Please try again.";
      if (error.code === "permission-denied") {
        message = "Permission denied. The game may be full or no longer active.";
      }
      Alert.alert("Error", message);
    } finally {
      setIsJoining(false);
    }
  };

  const getJoinButtonStyle = () => [
    styles.button,
    { backgroundColor: hoveredButton === "joinGame" ? "#00e092" : "#00c781" },
  ];

  const getLinkStyle = (buttonName) => [
    styles.linkText,
    { color: hoveredButton === buttonName ? "#00e092" : "#00c781" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Brain Board</Text>

      <TextInput
        style={styles.input}
        placeholder="Enter Game Code"
        placeholderTextColor="#666"
        value={gameCode}
        onChangeText={handleInputChange}
        keyboardType="numeric"
        textAlign="center"
        maxLength={6}
        autoCapitalize="none"
        editable={!isJoining}
      />

      <TouchableOpacity
        style={getJoinButtonStyle()}
        activeOpacity={0.7}
        onPress={handleJoinGame}
        onMouseEnter={() => setHoveredButton("joinGame")}
        onMouseLeave={() => setHoveredButton(null)}
        disabled={isJoining}
      >
        {isJoining ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Join Game</Text>
        )}
      </TouchableOpacity>

      <View style={styles.homeLinkContainer}>
        <Text style={styles.promptText}>Go to </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("Home")}
          onMouseEnter={() => setHoveredButton("home")}
          onMouseLeave={() => setHoveredButton(null)}
        >
          <Text style={getLinkStyle("home")}>Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 40,
  },
  input: {
    width: 400,
    height: 50,
    backgroundColor: "#222",
    borderRadius: 12,
    paddingHorizontal: 20,
    color: "#fff",
    fontSize: 24,
    textAlign: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#333",
  },
  button: {
    width: 400,
    height: 50,
    backgroundColor: "#00c781",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  homeLinkContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
  },
  promptText: {
    fontSize: 16,
    color: "#ccc",
  },
  linkText: {
    fontSize: 16,
    fontWeight: "bold",
  },
});