import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, Platform, ActivityIndicator, Image,
  useWindowDimensions, ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  signInWithEmailAndPassword, signInWithCredential,
  GoogleAuthProvider, signInWithPopup,
} from "firebase/auth";
import { doc, getDoc, query, collection, where, getDocs } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";

export default function LoginScreen({ navigation }) {
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 500;
  const formW = isMobile ? "100%" : "80%";

  const [identifier,      setIdentifier]      = useState("");
  const [password,        setPassword]        = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [passwordError,   setPasswordError]   = useState("");
  const [serverError,     setServerError]     = useState("");
  const [isLoading,       setIsLoading]       = useState(false);
  const [showPassword,    setShowPassword]    = useState(false);

  const passwordRef = useRef(null);

  const validateIdentifier = (v) => {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^[a-zA-Z0-9_]{3,}$/.test(v);
    setIdentifierError(ok ? "" : "Enter a valid email or username (min 3 chars)");
    return ok;
  };
  const validatePassword = (v) => {
    const ok = v.length >= 8;
    setPasswordError(ok ? "" : "Password must be at least 8 characters");
    return ok;
  };

  const getEmailFromIdentifier = async (id) => {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) return id;
    const q = query(collection(db, "users"), where("username", "==", id));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("auth/user-not-found");
    return snap.docs[0].data().email;
  };

  const handleLogin = async () => {
    if (!validateIdentifier(identifier) || !validatePassword(password)) return;
    setIsLoading(true); setServerError("");
    try {
      const email = await getEmailFromIdentifier(identifier);
      const cred  = await signInWithEmailAndPassword(auth, email, password);
      const userDoc = await getDoc(doc(db, "users", cred.user.uid));
      if (!userDoc.exists()) { setServerError("User data not found. Please sign up first."); setIsLoading(false); return; }
      await AsyncStorage.setItem("userToken", cred.user.uid);
      navigation.replace("Dashboard");
    } catch (err) {
      const code = err.code || "";
      setServerError(code.includes("invalid-credential") || code.includes("wrong-password") ? "Incorrect username/email or password."
        : code.includes("user-not-found") || err.message?.includes("user-not-found") ? "No user found with that username or email."
        : err.message || "An error occurred during login");
    } finally { setIsLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true); setServerError("");
    try {
      let user;
      if (Platform.OS === "web") {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        user = result.user;
      } else {
        setServerError("Google sign-in on mobile requires native setup."); setIsLoading(false); return;
      }
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) { setServerError("No account found. Please sign up first."); setIsLoading(false); return; }
      await AsyncStorage.setItem("userToken", user.uid);
      navigation.replace("Dashboard");
    } catch (err) {
      if (err.code === "auth/popup-closed-by-user") { setIsLoading(false); return; }
      setServerError(err.message || "Google sign-in failed");
    } finally { setIsLoading(false); }
  };

  const borderColor = (v, e) => !v ? "#333" : e ? "#ff4d4d" : "#00c781";

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.container} keyboardShouldPersistTaps="handled">
        <Text style={S.title}>Login</Text>

        <View style={[S.form, { width: formW }]}>
          <TextInput
            style={[S.input, { borderColor: borderColor(identifier, identifierError) }]}
            placeholder="Username or Email" placeholderTextColor="#888"
            autoCapitalize="none" keyboardType="email-address"
            value={identifier} onChangeText={v => { setIdentifier(v); validateIdentifier(v); }}
            returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()}
          />
          {!!identifierError && <Text style={S.err}>{identifierError}</Text>}

          <View style={S.pwRow}>
            <TextInput
              ref={passwordRef}
              style={[S.input, { borderColor: borderColor(password, passwordError), flex: 1 }]}
              placeholder="Password" placeholderTextColor="#888"
              secureTextEntry={!showPassword}
              value={password} onChangeText={v => { setPassword(v); validatePassword(v); }}
              returnKeyType="go" onSubmitEditing={handleLogin}
            />
            <TouchableOpacity style={S.eyeBtn} onPress={() => setShowPassword(p => !p)}>
              <Text style={S.eyeTxt}>{showPassword ? "🙈" : "👁️"}</Text>
            </TouchableOpacity>
          </View>
          {!!passwordError && <Text style={S.err}>{passwordError}</Text>}

          <TouchableOpacity onPress={() => navigation.navigate("ResetPassword", { identifier })} style={{ alignSelf: "flex-end", marginBottom: 8 }}>
            <Text style={S.link}>Forgot Password?</Text>
          </TouchableOpacity>

          {!!serverError && <Text style={[S.err, { marginBottom: 8 }]}>{serverError}</Text>}
        </View>

        <TouchableOpacity
          style={[S.btn, { width: formW, opacity: (!identifier || !password || identifierError || passwordError) ? 0.5 : 1 }]}
          onPress={handleLogin} disabled={isLoading || !identifier || !password || !!identifierError || !!passwordError}
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={S.btnTxt}>Log In</Text>}
        </TouchableOpacity>

        <Text style={S.or}>or</Text>

        <TouchableOpacity style={[S.btn, S.googleBtn, { width: formW }]} onPress={handleGoogleSignIn} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={S.btnTxt}>Continue with Google</Text>}
        </TouchableOpacity>

        <View style={[S.row, { marginTop: 16 }]}>
          <Text style={S.muted}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate("SignUp", { startScreen: "AccountTypeScreen" })}>
            <Text style={S.link}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#111" },
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title:     { fontSize: 28, fontWeight: "bold", color: "#fff", marginBottom: 24 },
  form:      { maxWidth: 400, marginBottom: 10 },
  input:     { backgroundColor: "#1e1e1e", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 16, borderWidth: 2, marginBottom: 10, width: "100%" },
  pwRow:     { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  eyeBtn:    { paddingLeft: 10, paddingVertical: 12 },
  eyeTxt:    { fontSize: 18 },
  err:       { color: "#ff4d4d", fontSize: 12, marginBottom: 6 },
  link:      { color: "#00c781", fontSize: 14, fontWeight: "bold" },
  btn:       { backgroundColor: "#00c781", paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, alignItems: "center", maxWidth: 400, marginVertical: 4 },
  googleBtn: { backgroundColor: "#4285F4" },
  btnTxt:    { color: "#fff", fontSize: 16, fontWeight: "bold" },
  or:        { color: "#666", fontSize: 14, marginVertical: 8 },
  row:       { flexDirection: "row", alignItems: "center" },
  muted:     { color: "#aaa", fontSize: 14 },
});