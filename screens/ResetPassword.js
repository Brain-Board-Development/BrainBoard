/**
 * ResetPasswordScreen.js
 * 
 * This screen allows users to request a password reset link via email.
 * It is part of the authentication flow and appears when a user clicks
 * "Forgot Password?" from the Login screen.
 * 
 * What it does:
 * 1. Renders a clean, centered form with:
 *    • A title and instruction text
 *    • An email input field with real-time validation
 *    • Visual feedback (border color changes) for valid/invalid input
 *    • Error messages (client-side or Firebase server errors)
 *    • Success message when reset email is sent
 *    • A loading spinner during submission
 *    • A "Send Reset Link" button (disabled until valid email)
 *    • Links to "Log In" and "Home" screens
 * 
 * 2. Features:
 *    • Real-time email validation using regex
 *    • Dynamic button styling based on input validity and hover state
 *    • Hover effects on web (color change on buttons/links)
 *    • Responsive layout (max width 400px, centered)
 *    • Firebase `sendPasswordResetEmail()` integration
 *    • Error handling for common Firebase Auth errors
 *    • Clears input and messages on new input attempt
 * 
 * 3. Navigation:
 *    • "Log In" → navigates to Login screen
 *    • "Home" → navigates to Home screen (guest landing page)
 * 
 * 4. Platform Support:
 *    • Works on iOS, Android, and Web
 *    • Web-specific hover interactions using `onMouseEnter`/`onMouseLeave`
 * 
 * Important: This screen does NOT reset the password itself — it only
 * triggers Firebase to send a secure reset link to the user's inbox.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebaseConfig";

/**
 * ResetPasswordScreen – main component for password reset request
 * @param {object} navigation – React Navigation prop to move between screens
 */
export default function ResetPasswordScreen({ navigation }) {
  // Tracks which interactive element is currently hovered (web only)
  const [hoveredButton, setHoveredButton] = useState(null);

  // Form state
  const [email, setEmail] = useState("");                    // User's entered email
  const [emailError, setEmailError] = useState("");          // Client-side validation error
  const [serverError, setServerError] = useState("");        // Firebase/server error
  const [successMessage, setSuccessMessage] = useState("");  // Success feedback
  const [isLoading, setIsLoading] = useState(false);         // Submission in progress

  // ——————————————————————————————————————
  // 1. EMAIL VALIDATION (client-side)
  // ——————————————————————————————————————
  /**
   * Validates email format using regex
   * @param {string} input - Email string to validate
   * @returns {boolean} - True if valid, false otherwise
   */
  const validateEmail = (input) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input)) {
      setEmailError("Please enter a valid email address");
      return false;
    }
    setEmailError(""); // Clear error if valid
    return true;
  };

  /**
   * Handles email input changes
   * - Updates state
   * - Clears previous server/success messages
   * - Triggers validation
   * @param {string} text - New email input value
   */
  const handleEmailChange = (text) => {
    setEmail(textText);
    setServerError("");     // Reset server error on new input
    setSuccessMessage("");  // Reset success message on new input
    validateEmail(text);    // Validate immediately
  };

  // ——————————————————————————————————————
  // 2. SEND PASSWORD RESET EMAIL
  // ——————————————————————————————————————
  /**
   * Triggers Firebase to send password reset email
   * Handles loading, success, and error states
   */
  const handleResetPassword = async () => {
    // Prevent submission if email is invalid
    if (!validateEmail(email)) return;

    // Start loading state
    setIsLoading(true);
    setServerError("");
    setSuccessMessage("");

    try {
      // Firebase: Send password reset email
      await sendPasswordResetEmail(auth, email);

      // Success: Show confirmation and clear input
      setSuccessMessage("Password reset link sent! Please check your email.");
      setEmail(""); // Reset form
    } catch (error) {
      console.error("Reset Password error:", error);

      // Map Firebase error codes to user-friendly messages
      let message = "An error occurred while sending the reset link";
      if (error.code === "auth/user-not-found") {
        message = "No user found with that email.";
      } else if (error.code === "auth/invalid-email") {
        message = "Invalid email address.";
      } else if (error.code === "auth/too-many-requests") {
        message = "Too many requests. Please try again later.";
      }
      setServerError(message);
    } finally {
      // Always stop loading
      setIsLoading(false);
    }
  };

  // ——————————————————————————————————————
  // 3. DYNAMIC STYLING HELPERS
  // ——————————————————————————————————————
  /**
   * Determines border color of email input based on state
   * @param {string} value - Current email value
   * @param {string} error - Current email error
   * @returns {string} - Hex color for border
   */
  const getInputBorderColor = (value, error) => {
    if (!value) return "#222";           // Default (empty)
    if (error) return "#ff4d4d";         // Red for error
    return "#00e092";                    // Green for valid
  };

  /**
   * Styles for the "Send Reset Link" button
   * - Disabled if loading, no email, or invalid
   * - Changes color on hover (web)
   * @returns {Array} - Style array for button
   */
  const getSubmitBtnStyle = () => [
    styles.submitBtn,
    {
      backgroundColor:
        email && !emailError
          ? hoveredButton === "submit"
            ? "#00e092"  // Hover (brighter green)
            : "#00c781"  // Active (darker green)
          : "#666",      // Disabled (gray)
    },
  ];

  /**
   * Styles for navigation links ("Log In", "Home")
   * Changes color on hover (web)
   * @param {string} buttonName - Identifier for hovered state
   * @returns {Array} - Style array for text
   */
  const getLinkStyle = (buttonName) => [
    styles.linkText,
    { color: hoveredButton === buttonName ? "#00e092" : "#00c781" },
  ];

  // ——————————————————————————————————————
  // 4. RENDER UI
  // ——————————————————————————————————————
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Page Title */}
        <Text style={styles.title}>Reset Password</Text>

        {/* Instruction Text */}
        <Text style={styles.instructionText}>
          Enter your email address to receive a password reset link.
        </Text>

        {/* Email Input + Feedback */}
        <View style={styles.inputWrapper}>
          <TextInput
            style={[
              styles.input,
              { borderColor: getInputBorderColor(email, emailError) },
            ]}
            placeholder="Email"
            placeholderTextColor="#ccc"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={handleEmailChange}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={handleResetPassword} // Allow "Enter" to submit
          />
          {/* Error Messages */}
          {emailError && <Text style={styles.errorText}>{emailError}</Text>}
          {serverError && <Text style={styles.errorText}>{serverError}</Text>}
          {/* Success Message */}
          {successMessage && <Text style={styles.successText}>{successMessage}</Text>}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={getSubmitBtnStyle()}
          activeOpacity={0.7}
          onPress={handleResetPassword}
          disabled={isLoading || !email || !!emailError}
          // Web: Hover effects
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("submit"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Send Reset Link</Text>
          )}
        </TouchableOpacity>

        {/* "Remembered your password?" + Log In Link */}
        <View style={styles.loginPrompt}>
          <Text style={styles.promptText}>Remembered your password? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate("Login")}
            // Web: Hover
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("login"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={getLinkStyle("login")}>Log In</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bottom Fixed Links (Home) */}
      <View style={styles.bottomContainer}>
        <View style={styles.homeContainer}>
          <Text style={styles.promptText}>Go to </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate("Home")}
            // Web: Hover
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("home"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={getLinkStyle("home")}>Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ——————————————————————————————————————
// STYLES – visual layout and design
// ——————————————————————————————————————
const styles = StyleSheet.create({
  // Full-screen safe area with dark background
  safeArea: {
    flex: 1,
    backgroundColor: "#111",
  },

  // Main content container (centered)
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#111",
  },

  // Page title
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 20,
    alignSelf: "center",
  },

  // Instructional text below title
  instructionText: {
    fontSize: 16,
    color: "#ccc",
    textAlign: "center",
    marginBottom: 20,
    width: "80%",
    maxWidth: 400,
  },

  // Wrapper for input and messages
  inputWrapper: {
    width: "80%",
    maxWidth: 400,
    marginBottom: 15,
  },

  // Email input field
  input: {
    width: "100%",
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 16,
    borderWidth: 2,
    borderColor: "#222",
    // Web: Smooth transition for border color
    ...(Platform.OS === "web" && {
      transitionProperty: "border-color",
      transitionDuration: "0.2s",
    }),
  },

  // Client or server error text
  errorText: {
    color: "#ff4d4d",
    fontSize: 12,
    marginTop: 5,
  },

  // Success confirmation text
  successText: {
    color: "#00e092",
    fontSize: 12,
    marginTop: 5,
  },

  // "Send Reset Link" button
  submitBtn: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginBottom: 15,
    width: "80%",
    maxWidth: 400,
    alignItems: "center",
    // Web: Smooth background transition
    ...(Platform.OS === "web" && {
      transitionProperty: "background-color",
      transitionDuration: "0.2s",
    }),
  },

  // Button text
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },

  // Clickable link text (Log In, Home)
  linkText: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "left",
    // Web: Smooth color transition
    ...(Platform.OS === "web" && {
      transitionProperty: "color",
      transitionDuration: "0.2s",
    }),
  },

  // "Remembered your password?" row
  loginPrompt: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "80%",
    maxWidth: 400,
    marginBottom: 15,
  },

  // Static prompt text
  promptText: {
    fontSize: 14,
    color: "#ccc",
  },

  // Fixed bottom container (for Home link)
  bottomContainer: {
    position: "absolute",
    bottom: 20,
    width: "100%",
    alignItems: "center",
  },

  // "Go to Home" row
  homeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});