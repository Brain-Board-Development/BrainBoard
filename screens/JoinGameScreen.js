/**
 * JoinGameScreen.js
 * 
 * This screen allows users to join an active Brain Board game by entering
 * a 6-digit numeric game code provided by the host. It is **web-only**
 * (mobile users are redirected to the Home screen via App.js routing).
 * 
 * What it does:
 * 1. Renders a clean, centered form with:
 *    • App title/logo ("Brain Board")
 *    • Large input field that accepts only digits (0–9)
 *    • "Join Game" button with hover color change (web)
 *    • "Go to Home" link at the bottom
 * 
 * 2. Input handling:
 *    • Real-time filtering: strips any non-numeric characters
 *    • Enforces 6-character limit via `maxLength`
 *    • Uses `keyboardType="numeric"` for mobile number pad
 * 
 * 3. Button behavior:
 *    • Logs entered code to console (for demo/debugging)
 *    • Navigation to Game screen is **commented out**:
 *      ```js
 *      // navigation.navigate("Game", { code: gameCode });
 *      ```
 * 
 * 4. Web-specific UX:
 *    • Hover effects on button and "Home" link
 *    • Color transition: #00c781 → #00e092 (darker → brighter green)
 *    • `onMouseEnter`/`onMouseLeave` handlers for interactive feedback
 * 
 * 5. Navigation:
 *    • "Join Game" → (future) Game screen with `code` param
 *    • "Home" → navigates to guest landing page
 * 
 * Important: This is a **demo implementation**. For production use:
 *    • Uncomment navigation line
 *    • Add Firebase validation (check if code exists & is active)
 *    • Implement loading, success, and error states
 *    • Add input validation feedback (e.g., "Invalid code")
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";

/**
 * JoinGameScreen – main component for joining games via 6-digit code
 * @param {object} navigation – React Navigation prop for screen transitions
 */
export default function JoinGameScreen({ navigation }) {
  // State: holds the current 6-digit game code entered by user
  const [gameCode, setGameCode] = useState("");
  
  // State: tracks which interactive element is hovered (used for web hover styles)
  const [hoveredButton, setHoveredButton] = useState(null);

  /**
   * Handles "Join Game" button press
   * 
   * Current behavior (demo mode):
   *   - Logs the entered game code to console
   * 
   * Future behavior (production):
   *   - Uncomment navigation to go to Game screen with code as parameter
   */
  const handleJoinGame = () => {
    console.log("Joining game with code:", gameCode);
    // navigation.navigate("Game", { code: gameCode });
  };

  /**
   * Filters input to allow only numeric characters (0–9)
   * 
   * @param {string} text - Raw input from TextInput
   * 
   * Process:
   * 1. Uses regex `/[^0-9]/g` to match all non-digit characters
   * 2. Replaces them with empty string → only digits remain
   * 3. Updates state with cleaned numeric string
   */
  const handleInputChange = (text) => {
    const numericText = text.replace(/[^0-9]/g, "");
    setGameCode(numericText);
  };

  /**
   * Returns dynamic style array for "Join Game" button
   * 
   * Applies hover effect on web:
   *   • Default: #00c781 (darker green)
   *   • Hover:   #00e092 (brighter green)
   * 
   * @returns {Array} Combined style objects
   */
  const getJoinButtonStyle = () => [
    styles.button,
    { backgroundColor: hoveredButton === "joinGame" ? "#00e092" : "#00c781" },
  ];

  /**
   * Returns dynamic style array for navigation links (e.g., "Home")
   * 
   * Applies hover color change:
   *   • Default: #00c781
   *   • Hover:   #00e092
   * 
   * @param {string} buttonName - Identifier ("home") to match hover state
   * @returns {Array} Combined style objects
   */
  const getLinkStyle = (buttonName) => [
    styles.linkText,
    { color: hoveredButton === buttonName ? "#00e092" : "#00c781" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* App Title / Logo */}
      <Text style={styles.title}>Brain Board</Text>

      {/* Game Code Input Field */}
      <TextInput
        style={styles.input}
        placeholder="Enter Game Code"
        placeholderTextColor="#666"
        value={gameCode}
        onChangeText={handleInputChange}
        keyboardType="numeric"           // Shows numeric keypad on mobile
        textAlign="center"               // Centers text horizontally
        maxLength={6}                    // Enforces 6-character limit
        autoCapitalize="none"            // Prevents auto-capitalization
      />

      {/* Join Game Button */}
      <TouchableOpacity
        style={getJoinButtonStyle()}
        activeOpacity={0.7}              // Visual press feedback
        onPress={handleJoinGame}
        onMouseEnter={() => setHoveredButton("joinGame")}   // Web: start hover
        onMouseLeave={() => setHoveredButton(null)}         // Web: end hover
      >
        <Text style={styles.buttonText}>Join Game</Text>
      </TouchableOpacity>

      {/* Bottom Navigation Link: "Go to Home" */}
      <View style={styles.homeLinkContainer}>
        <Text style={styles.promptText}>Go to </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("Home")}
          onMouseEnter={() => setHoveredButton("home")}     // Web: start hover
          onMouseLeave={() => setHoveredButton(null)}       // Web: end hover
        >
          <Text style={getLinkStyle("home")}>Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/**
 * STYLES – Responsive, dark-themed, centered layout
 */
const styles = StyleSheet.create({
  // Full-screen container with dark background
  container: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  
  // App title at the top
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 10,
    textAlign: "center",
  },
  
  // Game code input field
  input: {
    width: 400,
    height: 40,
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 15,
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
  },
  
  // Join Game button
  button: {
    width: 400,
    height: 40,
    backgroundColor: "#00c781",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  
  // Button text
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  
  // Container for "Go to Home" link
  homeLinkContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 350,
  },
  
  // Static text before the link
  promptText: {
    fontSize: 14,
    color: "#ccc",
  },
  
  // Clickable "Home" link text
  linkText: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
  },
});