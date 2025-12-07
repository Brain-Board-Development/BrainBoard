/**
 * JoinGameScreenMobile.js
 * 
 * This is the **mobile-only** entry point when users open the Brain Board app.
 * It serves as the **initial landing screen** and combines:
 *   • Game code entry (to join a hosted game)
 *   • Authentication state awareness (shows login/signup when logged out)
 *   • User dashboard when logged in (gold balance, profile, store, logout)
 * 
 * What it does:
 * 1. **Guest Mode (Logged Out)**:
 *    • Prominent 6-digit game code input
 *    • "Join Game" button (demo: logs code)
 *    • "Log In" and "Sign Up" buttons below
 *    • "Go to Home" link at bottom
 * 
 * 2. **Logged-In Mode**:
 *    • Shows user's current **gold balance**
 *    • Navigation buttons:
 *      → View Profile
 *      → Store (purchase items)
 *      → Log Out
 * 
 * 3. Input Features:
 *    • Real-time numeric filtering (only 0–9 allowed)
 *    • 6-digit limit via `maxLength`
 *    • Mobile-optimized numeric keyboard
 * 
 * 4. Web Hover Effects (Removed):
 *    • `onMouseEnter`/`onMouseLeave` are **non-functional on mobile**
 *    • Will be ignored by React Native — kept only for code parity with web
 * 
 * 5. Navigation:
 *    • "Join Game" → (future) Game screen with code param
 *    • "Log In" → Login screen
 *    • "Sign Up" → SignUp screen
 *    • "Home" → Home screen (guest landing)
 *    • Profile / Store / Logout → respective screens
 * 
 * Important:
 *    • This screen **replaces the web JoinGameScreen** on iOS/Android
 *    • Currently in **demo mode** — navigation and auth are commented out
 *    • For production: integrate Firebase Auth + Firestore user data
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
} from "react-native";
import { auth } from "../firebaseConfig"; // Firebase auth instance
import { onAuthStateChanged } from "firebase/auth";

/**
 * JoinGameScreenMobile – mobile-first entry screen with auth-aware UI
 * @param {object} navigation – React Navigation prop for screen routing
 */
export default function JoinGameScreenMobile({ navigation }) {
  // Form state
  const [gameCode, setGameCode] = useState("");              // 6-digit game code
  const [hoveredButton, setHoveredButton] = useState(null);  // Web hover (ignored on mobile)

  // Auth state
  const [user, setUser] = useState(null);                    // Firebase user object
  const [goldBalance, setGoldBalance] = useState(0);         // User's gold (mocked)

  // ——————————————————————————————————————
  // 1. AUTH STATE LISTENER (runs on mount)
  // ——————————————————————————————————————
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // TODO: Fetch real gold from Firestore
        setGoldBalance(1250); // Mock value
      } else {
        setGoldBalance(0);
      }
    });

    return () => unsubscribe(); // Cleanup listener
  }, []);

  // ——————————————————————————————————————
  // 2. HANDLE GAME CODE INPUT
  // ——————————————————————————————————————
  /**
   * Filters input to numeric only and enforces 6-digit limit
   * @param {string} text - Raw input from TextInput
   */
  const handleInputChange = (text) => {
    const numericText = text.replace(/[^0-9]/g, "").slice(0, 6);
    setGameCode(numericText);
  };

  // ——————————————————————————————————————
  // 3. JOIN GAME (DEMO MODE)
  // ——————————————————————————————————————
  /**
   * Logs code to console; navigation commented for testing
   */
  const handleJoinGame = () => {
    if (gameCode.length !== 6) {
      console.warn("Game code must be 6 digits");
      return;
    }
    console.log("Joining game with code:", gameCode);
    // navigation.navigate("Game", { code: gameCode });
  };

  // ——————————————————————————————————————
  // 4. LOGOUT HANDLER
  // ——————————————————————————————————————
  /**
   * Signs out user via Firebase and clears local state
   */
  const handleLogout = async () => {
    try {
      await auth.signOut();
      setGoldBalance(0);
      // navigation.navigate("JoinGameScreenMobile"); // Optional: force refresh
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // ——————————————————————————————————————
  // 5. DYNAMIC STYLES (hover ignored on mobile)
  // ——————————————————————————————————————
  const getJoinButtonStyle = () => [
    styles.button,
    { backgroundColor: hoveredButton === "joinGame" ? "#00e092" : "#00c781" },
  ];

  const getLinkStyle = (buttonName) => [
    styles.linkText,
    { color: hoveredButton === buttonName ? "#00e092" : "#00c781" },
  ];

  // ——————————————————————————————————————
  // 6. RENDER UI
  // ——————————————————————————————————————
  return (
    <SafeAreaView style={styles.container}>
      {/* App Title */}
      <Text style={styles.title}>Brain Board</Text>

      {/* Game Code Input */}
      <TextInput
        style={[
          styles.input,
          gameCode.length === 6 && styles.inputValid,
        ]}
        placeholder="Enter 6-digit Game Code"
        placeholderTextColor="#666"
        value={gameCode}
        onChangeText={handleInputChange}
        keyboardType="number-pad"
        textAlign="center"
        maxLength={6}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={handleJoinGame}
      />

      {/* Character Counter */}
      <Text style={styles.counterText}>{gameCode.length}/6</Text>

      {/* Join Game Button */}
      <TouchableOpacity
        style={getJoinButtonStyle()}
        activeOpacity={0.7}
        onPress={handleJoinGame}
        disabled={gameCode.length !== 6}
        // Web hover (no effect on mobile)
        onMouseEnter={() => Platform.OS === "web" && setHoveredButton("joinGame")}
        onMouseLeave={() => Platform.OS === "web" && setHoveredButton(null)}
      >
        <Text style={styles.buttonText}>
          {gameCode.length === 6 ? "Join Game" : "Enter 6 digits"}
        </Text>
      </TouchableOpacity>

      {/* ——————— AUTH-DEPENDENT UI ——————— */}
      {user ? (
        /* ——— LOGGED IN: USER DASHBOARD ——— */
        <View style={styles.authContainer}>
          {/* Gold Balance */}
          <View style={styles.goldContainer}>
            <Text style={styles.goldIcon}>Gold</Text>
            <Text style={styles.goldAmount}>{goldBalance}</Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => navigation.navigate("Profile")}
            >
              <Text style={styles.smallButtonText}>Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => navigation.navigate("Store")}
            >
              <Text style={styles.smallButtonText}>Store</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.smallButton, styles.logoutButton]}
              onPress={handleLogout}
            >
              <Text style={styles.logoutButtonText}>Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* ——— LOGGED OUT: AUTH PROMPTS ——— */
        <View style={styles.authContainer}>
          <TouchableOpacity
            style={styles.authButton}
            onPress={() => navigation.navigate("Login")}
          >
            <Text style={styles.authButtonText}>Log In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.authButton, styles.signupButton]}
            onPress={() => navigation.navigate("SignUp")}
          >
            <Text style={styles.signupButtonText}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Navigation */}
      <View style={styles.homeLinkContainer}>
        <Text style={styles.promptText}>Go to </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("Home")}
          onMouseEnter={() => Platform.OS === "web" && setHoveredButton("home")}
          onMouseLeave={() => Platform.OS === "web" && setHoveredButton(null)}
        >
          <Text style={getLinkStyle("home")}>Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ——————————————————————————————————————
// STYLES – Mobile-optimized, responsive, dark theme
// ——————————————————————————————————————
const styles = StyleSheet.create({
  // Full screen container
  container: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },

  // App title
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 30,
    textAlign: "center",
  },

  // Game code input
  input: {
    width: 350,
    height: 50,
    backgroundColor: "#222",
    borderRadius: 10,
    paddingHorizontal: 15,
    color: "#fff",
    marginBottom: 8,
    fontSize: 20,
    textAlign: "center",
    borderWidth: 2,
    borderColor: "#333",
  },

  // Valid input (6 digits)
  inputValid: {
    borderColor: "#00c781",
  },

  // Character counter
  counterText: {
    color: "#888",
    fontSize: 14,
    marginBottom: 15,
  },

  // Join Game button
  button: {
    width: 350,
    height: 50,
    backgroundColor: "#00c781",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 7.5,
  },

  // Button text
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },

  // Container for auth-related UI
  authContainer: {
    width: 350,
    marginTop: 20,
    alignItems: "center",
  },

  // Gold balance row
  goldContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 15,
  },
  goldIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  goldAmount: {
    color: "#00e092",
    fontSize: 18,
    fontWeight: "bold",
  },

  // Row of small action buttons
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    gap: 10,
  },
  smallButton: {
    flex: 1,
    backgroundColor: "#222",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  smallButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  logoutButton: {
    backgroundColor: "#ff4d4d",
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  // Log In / Sign Up buttons
  authButton: {
    width: "100%",
    backgroundColor: "#222",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  authButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  signupButton: {
    backgroundColor: "#00c781",
  },
  signupButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Bottom "Go to Home" link
  homeLinkContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 350,
    marginTop: 25,
  },
  promptText: {
    fontSize: 14,
    color: "#ccc",
  },
  linkText: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
  },
});