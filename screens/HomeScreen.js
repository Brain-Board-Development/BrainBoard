import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Platform, ActivityIndicator, ScrollView, SafeAreaView,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function HomeScreen({ navigation }) {
  const [isLoading, setIsLoading] = useState(true);
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            await AsyncStorage.setItem("userToken", user.uid);
            navigation.replace("Dashboard");
            return;
          }
        } else {
          const token = await AsyncStorage.getItem("userToken");
          if (token) {
            const userDoc = await getDoc(doc(db, "users", token));
            if (userDoc.exists()) { navigation.replace("Dashboard"); return; }
            await AsyncStorage.removeItem("userToken");
          }
        }
      } catch {}
      setIsLoading(false);
    });
    return () => unsub();
  }, [navigation]);

  if (isLoading) return (
    <View style={S.loading}>
      <ActivityIndicator size="large" color="#00c781" />
    </View>
  );

  return (
    <SafeAreaView style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <Text style={S.logo}>Brain Board</Text>
        <View style={S.navLinks}>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate("JoinGameScreen")}>
            <Text style={S.navTxt}>Join Game</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.navBtn} onPress={() => navigation.navigate("Login")}>
            <Text style={S.navTxt}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.signupBtn} onPress={() => navigation.navigate("SignUp")}>
            <Text style={S.signupTxt}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable body */}
      <ScrollView contentContainerStyle={S.body}>
        {/* Hero */}
        <View style={[S.hero, isMobile && { paddingHorizontal: 20, paddingVertical: 40 }]}>
          <Text style={[S.heroTitle, isMobile && { fontSize: 26 }]}>Welcome To Brain Board!</Text>
          <Text style={[S.heroSubtitle, isMobile && { fontSize: 15 }]}>
            A free educational <Text style={{ fontStyle: "italic" }}>board game</Text> for your classroom.
          </Text>
          <TouchableOpacity style={S.ctaBtn} onPress={() => navigation.navigate("SignUp")}>
            <Text style={S.ctaTxt}>Sign Up For Free</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.ctaBtn, { backgroundColor: "#3498db", marginTop: 12 }]} onPress={() => navigation.navigate("JoinGameScreen")}>
            <Text style={S.ctaTxt}>Join a Game</Text>
          </TouchableOpacity>
        </View>

        {/* Feature cards */}
        <View style={[S.features, isMobile && { flexDirection: "column" }]}>
          {["Unique Experience!", "Learn!", "Create Your Own!"].map(title => (
            <View key={title} style={[S.featureCard, isMobile && { width: "100%", marginHorizontal: 0 }]}>
              <Text style={S.featureTitle}>{title}</Text>
              <View style={S.placeholder} />
            </View>
          ))}
        </View>

        {/* About */}
        <View style={S.about}>
          <Text style={S.aboutTitle}>About Us</Text>
          <Text style={S.aboutTxt}>
            Brain Board is a free multiplayer quiz board game designed for classrooms. Teachers create custom question sets and students race to the finish by answering correctly — with power-ups, duels, and mystery boxes along the way.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  loading:   { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#111" },
  header:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, paddingHorizontal: 16, backgroundColor: "#0d0d0d", borderBottomWidth: 1, borderBottomColor: "#222" },
  logo:      { fontSize: 20, fontWeight: "bold", color: "#00c781" },
  navLinks:  { flexDirection: "row", alignItems: "center", gap: 6 },
  navBtn:    { paddingVertical: 6, paddingHorizontal: 10 },
  navTxt:    { color: "#fff", fontSize: 14, fontWeight: "600" },
  signupBtn: { backgroundColor: "#00c781", paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  signupTxt: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  body:      { paddingBottom: 60 },
  hero:      { alignItems: "center", paddingHorizontal: 40, paddingVertical: 60 },
  heroTitle: { fontSize: 32, fontWeight: "bold", color: "#fff", textAlign: "center", marginBottom: 14 },
  heroSubtitle: { fontSize: 16, color: "#ccc", textAlign: "center", marginBottom: 28, lineHeight: 24 },
  ctaBtn:    { backgroundColor: "#00c781", paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10 },
  ctaTxt:    { color: "#fff", fontSize: 16, fontWeight: "bold" },
  features:  { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 40, gap: 12 },
  featureCard: { flex: 1, alignItems: "center", marginHorizontal: 6 },
  featureTitle:{ color: "#fff", fontWeight: "bold", fontSize: 18, marginBottom: 10, textAlign: "center" },
  placeholder: { width: "100%", height: 200, borderRadius: 14, backgroundColor: "#222" },
  about:     { paddingHorizontal: 24, paddingVertical: 30 },
  aboutTitle:{ fontSize: 24, fontWeight: "bold", color: "#fff", textAlign: "center", marginBottom: 14 },
  aboutTxt:  { fontSize: 15, color: "#ccc", textAlign: "center", lineHeight: 24 },
});