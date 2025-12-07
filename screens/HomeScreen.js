import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableHighlight,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function HomeScreen({ navigation }) {
  const [hoveredButton, setHoveredButton] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const aboutUsSectionRef = useRef(null);

  // ——— AUTH CHECK (FIXED) ———
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          await handleAuthenticatedUser(user.uid);
        } else {
          await checkStoredToken();
        }
      } catch (err) {
        console.error("Auth check failed:", err);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigation]);

  const handleAuthenticatedUser = async (uid) => {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      await AsyncStorage.setItem("userToken", uid);
      setIsLoading(false);
      navigation.replace(
        userData.accountType === "Teacher"
          ? "TeacherDashboard"
          : "StudentDashboard"
      );
    } else {
      await AsyncStorage.removeItem("userToken");
      setIsLoading(false);
    }
  };

  const checkStoredToken = async () => {
    const token = await AsyncStorage.getItem("userToken");
    if (token) {
      const userDoc = await getDoc(doc(db, "users", token));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setIsLoading(false);
        navigation.replace(
          userData.accountType === "Teacher"
            ? "TeacherDashboard"
            : "StudentDashboard"
        );
      } else {
        await AsyncStorage.removeItem("userToken");
        setIsLoading(false);
      }
    } else {
      setIsLoading(false);
    }
  };

  // ——— WEB SCROLLBAR & SMOOTH SCROLL ———
  useEffect(() => {
    if (Platform.OS === "web") {
      document.body.style.overflowY = "scroll";
      document.body.style.scrollBehavior = "smooth";

      const style = document.createElement("style");
      style.innerHTML = `
        body {
          scrollbar-width: thin;
          scrollbar-color: #666 #111;
        }
        body::-webkit-scrollbar { width: 10px; }
        body::-webkit-scrollbar-track { background: #111; }
        body::-webkit-scrollbar-thumb {
          background-color: #666;
          border-radius: 8px;
          border: 2px solid #111;
        }
        body::-webkit-scrollbar-thumb:hover { background-color: #888; }
      `;
      document.head.appendChild(style);

      return () => {
        document.head.removeChild(style);
        document.body.style.overflowY = "";
        document.body.style.scrollBehavior = "";
      };
    }
  }, []);

  const getNavTextStyle = (buttonName) => [
    styles.navText,
    { color: hoveredButton === buttonName ? "#00e092" : "#fff" },
  ];

  const getSignupBtnStyle = () => [
    styles.signupBtn,
    {
      backgroundColor: hoveredButton === "signup" ? "#00e092" : "#00c781",
      transform: [{ scale: hoveredButton === "signup" ? 1.05 : 1 }],
    },
  ];

  const getCtaBtnStyle = () => [
    styles.ctaBtn,
    {
      backgroundColor: hoveredButton === "cta" ? "#00e092" : "#00c781",
      transform: [{ scale: hoveredButton === "cta" ? 1.05 : 1 }],
    },
  ];

  const scrollToAboutUs = () => {
    if (Platform.OS === "web" && aboutUsSectionRef.current) {
      aboutUsSectionRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00c781" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Fixed Header */}
      <View style={styles.header}>
        <View style={styles.leftSection}>
          <Text style={styles.logo}>Brain Board</Text>

          <TouchableOpacity
            style={styles.navBtn}
            onPress={scrollToAboutUs}
            onMouseEnter={() => setHoveredButton("aboutUs")}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={getNavTextStyle("aboutUs")}>About Us</Text>
          </TouchableOpacity>

          <View style={styles.searchContainer}>
            <Text style={styles.searchIcon}>Search</Text>
            <TextInput
              style={styles.searchInput}
              placeholder='Ex: "Biology Unit 1"'
              placeholderTextColor="#ccc"
            />
          </View>
        </View>

        <View style={styles.navLinks}>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => navigation.navigate("JoinGameScreen")}
            onMouseEnter={() => setHoveredButton("joinGame")}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={getNavTextStyle("joinGame")}>Join Game</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => navigation.navigate("Login")}
            onMouseEnter={() => setHoveredButton("login")}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={getNavTextStyle("login")}>Login</Text>
          </TouchableOpacity>

          <TouchableHighlight
            style={getSignupBtnStyle()}
            underlayColor="#009f66"
            onPress={() => {
              navigation.navigate("SignUp");
              setHoveredButton(null);
            }}
            onMouseEnter={() => setHoveredButton("signup")}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={styles.signupText}>Sign Up</Text>
          </TouchableHighlight>
        </View>
      </View>

      {/* Scrollable Content */}
      <View style={styles.scrollContainer}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Welcome To Brain Board!</Text>
          <Text style={styles.heroSubtitle}>
            A free educational online <Text style={styles.italic}>board game</Text>{" "}
            for your classroom to learn while having fun.
          </Text>
          <TouchableOpacity
            style={getCtaBtnStyle()}
            onPress={() => {
              navigation.navigate("SignUp");
              setHoveredButton(null);
            }}
            onMouseEnter={() => setHoveredButton("cta")}
            onMouseLeave={() => setHoveredButton(null)}
          >
            <Text style={styles.ctaText}>Sign Up For Free</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.features}>
          <View style={styles.featureCard}>
            <Text style={styles.featureTitle}>Unique Experience!</Text>
            <View style={styles.placeholder} />
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureTitle}>Learn!</Text>
            <View style={styles.placeholder} />
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureTitle}>Create Your Own!</Text>
            <View style={styles.placeholder} />
          </View>
        </View>

        <View style={styles.aboutUsSection} ref={aboutUsSectionRef}>
          <Text style={styles.aboutUsTitle}>About Us</Text>
          <Text style={styles.aboutUsText}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris...
          </Text>
        </View>
      </View>
    </View>
  );
}

// ——— STYLES (UNCHANGED) ———
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111",
    height: "100vh",
    width: "100%",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: "rgba(17, 17, 17, 0.95)",
    backdropFilter: "blur(8px)",
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(17, 17, 17, 0.95)",
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 100,
    overflowY: "auto",
    minHeight: "100vh",
  },
  logo: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginRight: 12,
  },
  navLinks: {
    flexDirection: "row",
    alignItems: "center",
  },
  navBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginHorizontal: 5,
  },
  navText: {
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  signupBtn: {
    backgroundColor: "#00c781",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginLeft: 5,
  },
  signupText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginLeft: 12,
    height: 36,
    borderWidth: 2,
    borderColor: "#222",
  },
  searchIcon: {
    color: "#ccc",
    fontSize: 18,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
  },
  hero: {
    alignItems: "center",
    marginVertical: 40,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
    marginBottom: 15,
  },
  heroSubtitle: {
    fontSize: 16,
    color: "#ccc",
    textAlign: "center",
    marginBottom: 25,
    paddingHorizontal: 10,
  },
  italic: {
    fontStyle: "italic",
  },
  ctaBtn: {
    backgroundColor: "#00c781",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  ctaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  features: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 60,
    flexWrap: "wrap",
  },
  featureCard: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 5,
    marginVertical: 10,
  },
  featureTitle: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 22,
    marginBottom: 10,
  },
  placeholder: {
    width: "100%",
    height: 280,
    borderRadius: 15,
    backgroundColor: "#222",
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: "#fff",
    marginHorizontal: 8,
    opacity: 0.5,
  },
  aboutUsSection: {
    marginVertical: 40,
    paddingHorizontal: 10,
  },
  aboutUsTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    textAlign: "center",
    marginBottom: 15,
  },
  aboutUsText: {
    fontSize: 16,
    color: "#ccc",
    textAlign: "center",
    lineHeight: 24,
  },
});