import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  signInWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { doc, getDoc, query, collection, where, getDocs } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";

export default function LoginScreen({ navigation }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const identifierInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const validateIdentifier = (input) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const usernameRegex = /^[a-zA-Z0-9_]{3,}$/;
    if (!emailRegex.test(input) && !usernameRegex.test(input)) {
      setIdentifierError("Please enter a valid email or username (min 3 characters)");
      return false;
    }
    setIdentifierError("");
    return true;
  };

  const validatePassword = (input) => {
    if (input.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const handleIdentifierChange = (text) => {
    setIdentifier(text);
    validateIdentifier(text);
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    validatePassword(text);
  };

  const getEmailFromIdentifier = async (identifier) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(identifier)) {
      return identifier;
    }
    const q = query(collection(db, "users"), where("username", "==", identifier));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      throw new Error("auth/user-not-found");
    }
    const userDoc = querySnapshot.docs[0];
    return userDoc.data().email;
  };

  const handleLogin = async () => {
    if (!validateIdentifier(identifier) || !validatePassword(password)) return;
    setIsLoading(true);
    setServerError("");

    try {
      const email = await getEmailFromIdentifier(identifier);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        setServerError("User data not found. Please sign up first.");
        setIsLoading(false);
        navigation.navigate("SignUp", { startScreen: "AccountTypeScreen" });
        return;
      }

      const userData = userDoc.data();
      await AsyncStorage.setItem("userToken", user.uid);
      console.log("Login successful - UID:", user.uid, "Account type:", userData.accountType || "Unknown");

      // ALL users go to Dashboard now
      navigation.replace("Dashboard");
    } catch (error) {
      console.error("Login error:", error);
      let message = "An error occurred during login";
      if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
        message = "Incorrect username/email or password.";
      } else if (error.code === "auth/user-not-found" || error.message.includes("user-not-found")) {
        message = "No user found with that username or email.";
      } else {
        message = error.message;
      }
      setServerError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setServerError("");

    try {
      let user;
      if (Platform.OS === "web") {
        const provider = new GoogleAuthProvider();
        const userCredential = await signInWithPopup(auth, provider);
        user = userCredential.user;
      } else {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const googleCredential = GoogleAuthProvider.credential(userInfo.idToken);
        const userCredential = await signInWithCredential(auth, googleCredential);
        user = userCredential.user;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        setServerError("User data not found. Please complete sign-up.");
        setIsLoading(false);
        navigation.navigate("SignUp", { startScreen: "AccountTypeScreen", email: user.email });
        return;
      }

      const userData = userDoc.data();
      await AsyncStorage.setItem("userToken", user.uid);
      console.log("Google login successful - UID:", user.uid, "Account type:", userData.accountType || "Unknown");

      // ALL users go to Dashboard now
      navigation.replace("Dashboard");
    } catch (error) {
      console.error("Google Sign-In error:", error);
      let message = "Failed to sign in with Google";
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === "auth/popup-closed-by-user") {
        message = "Google Sign-In was cancelled";
      } else if (error.code === statusCodes.IN_PROGRESS) {
        message = "Google Sign-In is in progress";
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        message = "Play Services not available";
      } else if (error.code === "auth/user-not-found") {
        message = "No user found. Please sign up first.";
        navigation.navigate("SignUp", { startScreen: "AccountTypeScreen" });
      } else {
        message = error.message;
      }
      setServerError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const getInputBorderColor = (value, error) => {
    if (!value) return "#222";
    if (error) return "#ff4d4d";
    return "#00e092";
  };

  const getLoginBtnStyle = () => [
    styles.signUpBtn,
    {
      backgroundColor:
        identifier && password && !identifierError && !passwordError
          ? hoveredButton === "login" ? "#00e092" : "#00c781"
          : "#666",
    },
  ];

  const getGoogleBtnStyle = () => [
    styles.signUpBtn,
    { backgroundColor: hoveredButton === "google" ? "#60a5fa" : "#4285F4" },
  ];

  const getLinkStyle = (buttonName) => [
    styles.linkText,
    { color: hoveredButton === buttonName ? "#00e092" : "#00c781" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Login</Text>

        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              ref={identifierInputRef}
              style={[
                styles.input,
                { borderColor: getInputBorderColor(identifier, identifierError) },
              ]}
              placeholder="Username or Email"
              placeholderTextColor="#ccc"
              autoCapitalize="none"
              keyboardType="email-address"
              value={identifier}
              onChangeText={handleIdentifierChange}
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              blurOnSubmit={false}
            />
            {identifierError && <Text style={styles.errorText}>{identifierError}</Text>}
          </View>

          <View style={styles.inputWrapper}>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={passwordInputRef}
                style={[
                  styles.input,
                  { borderColor: getInputBorderColor(password, passwordError) },
                ]}
                placeholder="Password"
                placeholderTextColor="#ccc"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={handlePasswordChange}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                {...(Platform.OS === "web" && {
                  onMouseEnter: () => setHoveredButton("passwordEye"),
                  onMouseLeave: () => setHoveredButton(null),
                })}
              >
                <Image
                  source={showPassword ? require("../assets/hide.png") : require("../assets/view.png")}
                  style={[
                    styles.eyeIcon,
                    { tintColor: hoveredButton === "passwordEye" ? "#00e092" : "#ccc" },
                  ]}
                />
              </TouchableOpacity>
            </View>
            {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
          </View>

          {serverError && <Text style={styles.errorText}>{serverError}</Text>}

          <View style={styles.alignContainer}>
            <View style={styles.loginPrompt}>
              <Text style={styles.promptText}>Forgot Password? </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate("ResetPassword", { identifier })}
                {...(Platform.OS === "web" && {
                  onMouseEnter: () => setHoveredButton("forgotPassword"),
                  onMouseLeave: () => setHoveredButton(null),
                })}
              >
                <Text style={getLinkStyle("forgotPassword")}>Reset Password</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={getLoginBtnStyle()}
          activeOpacity={0.7}
          onPress={handleLogin}
          disabled={isLoading || !identifier.trim() || !password.trim() || identifierError || passwordError}
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("login"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.signUpText}>Log in</Text>}
        </TouchableOpacity>

        <Text style={styles.orText}>or</Text>

        <TouchableOpacity
          style={getGoogleBtnStyle()}
          activeOpacity={0.7}
          onPress={handleGoogleSignIn}
          disabled={isLoading}
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("google"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Image source={require("../assets/google.png")} style={{ width: 20, height: 20, marginRight: 10 }} />
              <Text style={styles.signUpText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.alignContainer}>
          <View style={styles.loginPrompt}>
            <Text style={styles.promptText}>Don't have an account? </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("SignUp", { startScreen: "AccountTypeScreen" })}
              {...(Platform.OS === "web" && {
                onMouseEnter: () => setHoveredButton("signup"),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text style={getLinkStyle("signup")}>Sign Up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#111" },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#111",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 20,
  },
  inputContainer: { width: "80%", maxWidth: 400, marginBottom: 10 },
  inputWrapper: { marginBottom: 10 },
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
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    position: "relative",
  },
  eyeButton: { position: "absolute", right: 10, padding: 5 },
  eyeIcon: { width: 20, height: 20, resizeMode: "contain" },
  errorText: { color: "#ff4d4d", fontSize: 12, marginTop: 5 },
  signUpBtn: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    marginVertical: 10,
    width: "80%",
    maxWidth: 400,
    alignItems: "center",
  },
  signUpText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  orText: { color: "#ccc", fontSize: 14, marginVertical: 10, alignSelf: "center" },
  alignContainer: {
    width: "80%",
    maxWidth: 400,
    alignSelf: "center",
  },
  loginPrompt: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  promptText: { fontSize: 14, color: "#ccc" },
  linkText: { fontSize: 14, fontWeight: "bold" },
});