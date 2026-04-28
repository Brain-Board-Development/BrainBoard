import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, ActivityIndicator, ScrollView, useWindowDimensions,
} from "react-native";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebaseConfig";

export default function ResetPasswordScreen({ navigation, route }) {
  const { width: winW } = useWindowDimensions();
  const formW = winW < 500 ? "100%" : "80%";

  const [email,          setEmail]          = useState(route?.params?.identifier || "");
  const [emailError,     setEmailError]     = useState("");
  const [serverError,    setServerError]    = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading,      setIsLoading]      = useState(false);

  const validateEmail = (v) => {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    setEmailError(ok ? "" : "Please enter a valid email address");
    return ok;
  };

  const handleEmailChange = (text) => {
    setEmail(text);          // ← bug fix: was setEmail(textText)
    setServerError("");
    setSuccessMessage("");
    validateEmail(text);
  };

  const handleReset = async () => {
    if (!validateEmail(email)) return;
    setIsLoading(true); setServerError(""); setSuccessMessage("");
    try {
      await sendPasswordResetEmail(auth, email);
      setSuccessMessage("Reset link sent! Check your email.");
      setEmail("");
    } catch (err) {
      const code = err.code || "";
      setServerError(code === "auth/user-not-found" ? "No user found with that email."
        : code === "auth/invalid-email" ? "Invalid email address."
        : code === "auth/too-many-requests" ? "Too many requests. Try again later."
        : "An error occurred. Please try again.");
    } finally { setIsLoading(false); }
  };

  const borderColor = (v, e) => !v ? "#333" : e ? "#ff4d4d" : "#00c781";

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.container} keyboardShouldPersistTaps="handled">
        <Text style={S.title}>Reset Password</Text>
        <Text style={S.info}>Enter your email and we'll send you a reset link.</Text>

        <View style={[S.form, { width: formW }]}>
          <TextInput
            style={[S.input, { borderColor: borderColor(email, emailError) }]}
            placeholder="Email" placeholderTextColor="#888"
            autoCapitalize="none" keyboardType="email-address"
            value={email} onChangeText={handleEmailChange}
            returnKeyType="send" onSubmitEditing={handleReset}
          />
          {!!emailError     && <Text style={S.err}>{emailError}</Text>}
          {!!serverError    && <Text style={S.err}>{serverError}</Text>}
          {!!successMessage && <Text style={S.success}>{successMessage}</Text>}
        </View>

        <TouchableOpacity
          style={[S.btn, { width: formW, opacity: (!email || !!emailError) ? 0.5 : 1 }]}
          onPress={handleReset} disabled={isLoading || !email || !!emailError}
        >
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={S.btnTxt}>Send Reset Link</Text>}
        </TouchableOpacity>

        <View style={S.row}>
          <Text style={S.muted}>Remembered it? </Text>
          <TouchableOpacity onPress={() => navigation.navigate("Login")}>
            <Text style={S.link}>Log In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: "#111" },
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title:     { fontSize: 26, fontWeight: "bold", color: "#fff", marginBottom: 10 },
  info:      { fontSize: 14, color: "#aaa", textAlign: "center", marginBottom: 24, maxWidth: 340 },
  form:      { maxWidth: 400, marginBottom: 12 },
  input:     { backgroundColor: "#1e1e1e", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 16, borderWidth: 2, marginBottom: 8, width: "100%" },
  err:       { color: "#ff4d4d", fontSize: 12, marginBottom: 6 },
  success:   { color: "#00c781", fontSize: 13, marginBottom: 6 },
  btn:       { backgroundColor: "#00c781", paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, alignItems: "center", maxWidth: 400, marginBottom: 16 },
  btnTxt:    { color: "#fff", fontSize: 16, fontWeight: "bold" },
  row:       { flexDirection: "row", alignItems: "center" },
  muted:     { color: "#aaa", fontSize: 14 },
  link:      { color: "#00c781", fontSize: 14, fontWeight: "bold" },
});