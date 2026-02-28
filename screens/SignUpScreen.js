/*
 * SignUpScreen.jsx
 * 
 * Multi-step sign-up flow using Firebase Auth & Firestore.
 * All account types now redirect to Dashboard.js after success.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  Modal,
  FlatList,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStackNavigator } from "@react-navigation/stack";
import { auth, db } from "../firebaseConfig";
import {
  createUserWithEmailAndPassword,
  signInWithCredential,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs, getDoc } from "firebase/firestore";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";

const Stack = createStackNavigator();

// Random username generation helpers
const adjectives = [
  "Adventurous", "Agile", "Alert", "Ambitious", "Ancient", "Artistic", "Astonishing", "Authentic",
  "Blazing", "Bold", "Brave", "Bright", "Brilliant", "Calm", "Cautious", "Charming", "Cheerful",
  "Clever", "Colorful", "Confident", "Cool", "Cosmic", "Creative", "Cunning", "Curious", "Daring",
  "Dazzling", "Defiant", "Delightful", "Dynamic", "Eager", "Elegant", "Energetic", "Enigmatic",
  "Epic", "Fabulous", "Famous", "Fearless", "Fierce", "Fiery", "Flamboyant", "Flashy", "Friendly",
  "Gallant", "Gleaming", "Glorious", "Graceful", "Grand", "Happy", "Harmonious", "Heroic",
  "Imaginative", "Immense", "Incredible", "Inquisitive", "Intrepid", "Jolly", "Joyful", "Keen",
  "Lively", "Luminous", "Majestic", "Mighty", "Mystic", "Noble", "Optimistic", "Playful",
  "Powerful", "Proud", "Quick", "Radiant", "Resilient", "Robust", "Sassy", "Serene", "Sharp",
  "Shimmering", "Silent", "Sleek", "Smart", "Sparkling", "Spirited", "Splendid", "Steadfast",
  "Stellar", "Striking", "Strong", "Stunning", "Swift", "Tenacious", "Thrilling", "Valiant",
  "Vibrant", "Vigorous", "Vivid", "Witty", "Wonderful", "Zealous", "Zesty"
];

const nouns = [
  "Arrow", "Aurora", "Badger", "Beacon", "Bear", "Blaze", "Bolt", "Breeze", "Cactus", "Castle",
  "Cat", "Cheetah", "Circuit", "Cloud", "Comet", "Crest", "Crow", "Crystal", "Dawn", "Deer",
  "Dragon", "Drift", "Eagle", "Echo", "Ember", "Falcon", "Fawn", "Flame", "Fox", "Galaxy",
  "Gem", "Ghost", "Glider", "Goblin", "Gorilla", "Grove", "Hawk", "Horizon", "Horse", "Hound",
  "Island", "Jaguar", "Jewel", "Knight", "Lake", "Lantern", "Leaf", "Leopard", "Lion", "Lunar",
  "Mage", "Meadow", "Meteor", "Mist", "Moon", "Mountain", "Nebula", "Ninja", "Oak", "Ocean",
  "Owl", "Panther", "Peak", "Pegasus", "Phantom", "Phoenix", "Pine", "Pixel", "Puma", "Quest",
  "Raven", "Ridge", "River", "Robot", "Rocket", "Rose", "Saber", "Shadow", "Shark", "Sky",
  "Slime", "Sparrow", "Spear", "Star", "Storm", "Sword", "Tiger", "Titan", "Tree", "Viper",
  "Voyage", "Wave", "Weasel", "Whale", "Wind", "Wizard", "Wolf", "Wraith", "Zephyr", "Zone"
];

function generateRandomUsername() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 10000);
  return `${adj}${noun}${num}`;
}

// Custom Dropdown Component
function CustomDropdown({ label, value, onValueChange, items, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0, width: 0 });
  const dropdownRef = useRef(null);

  const handleLayout = () => {
    if (dropdownRef.current) {
      dropdownRef.current.measureInWindow((x, y, width, height) => {
        setDropdownPosition({ x, y: y + height, width: width || 100 });
      });
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.dropdownItem,
        hoveredItem === item.value && { backgroundColor: "#333" },
      ]}
      onPress={() => {
        onValueChange(item.value);
        setIsOpen(false);
      }}
      {...(Platform.OS === "web" && {
        onMouseEnter: () => setHoveredItem(item.value),
        onMouseLeave: () => setHoveredItem(null),
      })}
    >
      <Text style={styles.dropdownItemText}>{item.label || item}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.dropdownWrapper}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity
        ref={dropdownRef}
        style={[
          styles.dropdown,
          { borderColor: value ? "#00e092" : "#222" },
        ]}
        onPress={() => {
          handleLayout();
          setIsOpen(true);
        }}
        onLayout={handleLayout}
      >
        <Text style={[styles.dropdownText, !value && { color: "#ccc" }]}>
          {value
            ? items.find((item) => item.value === value)?.label || value
            : placeholder}
        </Text>
      </TouchableOpacity>
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setIsOpen(false)}
        >
          <View
            style={[
              styles.dropdownModal,
              {
                position: "absolute",
                top: dropdownPosition.y || 100,
                left: dropdownPosition.x || 20,
                width: dropdownPosition.width || 100,
                minHeight: 50,
              },
            ]}
          >
            {items && items.length > 0 ? (
              <FlatList
                data={items}
                renderItem={renderItem}
                keyExtractor={(item) => item.value.toString()}
                style={styles.dropdownList}
              />
            ) : (
              <Text style={styles.dropdownItemText}>No items available</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Account Type Screen
function AccountTypeScreen({ navigation }) {
  const [hoveredButton, setHoveredButton] = useState(null);

  const getButtonStyle = (type) => [
    styles.button,
    {
      backgroundColor:
        type === "student"
          ? hoveredButton === "student"
            ? "#3395FF"
            : "#007BFF"
          : type === "teacher"
          ? hoveredButton === "teacher"
            ? "#FF8C00"
            : "#FF6200"
          : hoveredButton === "personal"
          ? "#8B5CF6"
          : "#6F42C1",
      transform: [{ scale: hoveredButton === type ? 1.04 : 1 }],
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Select Who You Are</Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={getButtonStyle("student")}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("DateOfBirthScreen", { accountType: "Student" })}
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("student"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.buttonText}>Student</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={getButtonStyle("teacher")}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("DateOfBirthScreen", { accountType: "Teacher" })}
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("teacher"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.buttonText}>Educator</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={getButtonStyle("personal")}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("DateOfBirthScreen", { accountType: "Personal" })}
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("personal"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text style={styles.buttonText}>Personal</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomContainer}>
          <View style={styles.homeContainer}>
            <Text style={styles.promptText}>Go to </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Home")}
              {...(Platform.OS === "web" && {
                onMouseEnter: () => setHoveredButton("home"),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text
                style={[
                  styles.linkText,
                  { color: hoveredButton === "home" ? "#00e092" : "#00c781" },
                ]}
              >
                Home
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Date of Birth Screen
function DateOfBirthScreen({ navigation, route }) {
  const today = new Date();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [dateError, setDateError] = useState("");
  const [hoveredButton, setHoveredButton] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);

  const days = Array.from({ length: 31 }, (_, i) => ({
    value: (i + 1).toString().padStart(2, "0"),
    label: (i + 1).toString().padStart(2, "0"),
  }));

  const months = [
    { value: "01", label: "January" },
    { value: "02", label: "February" },
    { value: "03", label: "March" },
    { value: "04", label: "April" },
    { value: "05", label: "May" },
    { value: "06", label: "June" },
    { value: "07", label: "July" },
    { value: "08", label: "August" },
    { value: "09", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const years = Array.from(
    { length: today.getFullYear() - 1900 + 1 },
    (_, i) => ({
      value: (1900 + i).toString(),
      label: (1900 + i).toString(),
    })
  ).reverse();

  useEffect(() => {
    if (hasInteracted) validateDateOfBirth();
  }, [day, month, year]);

  const validateDateOfBirth = () => {
    if (!day || !month || !year) {
      setDateError("Please select day, month, and year");
      return false;
    }

    const dateStr = `${year}-${month}-${day}`;
    const selectedDate = new Date(dateStr);
    const minAge = 13;
    const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());

    if (isNaN(selectedDate.getTime())) {
      setDateError("Invalid date");
      return false;
    }

    if (selectedDate > maxDate) {
      setDateError(`You must be at least ${minAge} years old`);
      return false;
    }

    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
    if (parseInt(day) > daysInMonth) {
      setDateError(`Invalid day for ${months.find((m) => m.value === month)?.label}`);
      return false;
    }

    setDateError("");
    return true;
  };

  const handleNext = () => {
    if (validateDateOfBirth()) {
      const selectedDate = new Date(`${year}-${month}-${day}`);
      navigation.navigate("UsernameScreen", {
        accountType: route.params.accountType,
        dateOfBirth: selectedDate,
      });
    }
  };

  const getNextBtnStyle = () => [
    styles.signUpBtn,
    {
      backgroundColor:
        hasInteracted && !dateError
          ? hoveredButton === "next"
            ? "#00e092"
            : "#00c781"
          : "#666",
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Enter Your Date of Birth</Text>
        <View style={styles.inputContainer}>
          <View style={styles.dropdownContainer}>
            <CustomDropdown
              label="Month"
              value={month}
              onValueChange={(value) => {
                setMonth(value);
                setHasInteracted(true);
              }}
              items={months}
              placeholder="Month"
            />
            <CustomDropdown
              label="Day"
              value={day}
              onValueChange={(value) => {
                setDay(value);
                setHasInteracted(true);
              }}
              items={days}
              placeholder="Day"
            />
            <CustomDropdown
              label="Year"
              value={year}
              onValueChange={(value) => {
                setYear(value);
                setHasInteracted(true);
              }}
              items={years}
              placeholder="Year"
            />
          </View>
          {dateError ? <Text style={styles.errorText}>{dateError}</Text> : null}
        </View>

        <TouchableOpacity
          style={getNextBtnStyle()}
          activeOpacity={0.7}
          onPress={handleNext}
          disabled={!!dateError || !hasInteracted}
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("next"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          <Text style={styles.signUpText}>Next</Text>
        </TouchableOpacity>

        <View style={styles.bottomContainer}>
          <View style={styles.homeContainer}>
            <Text style={styles.promptText}>Go to </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Home")}
              {...(Platform.OS === "web" && {
                onMouseEnter: () => setHoveredButton("home"),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text
                style={[
                  styles.linkText,
                  { color: hoveredButton === "home" ? "#00e092" : "#00c781" },
                ]}
              >
                Home
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Username Screen
function UsernameScreen({ navigation, route }) {
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [hoveredButton, setHoveredButton] = useState(null);
  const usernameInputRef = useRef(null);

  const validateUsername = (value) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setUsernameError("");
      return false;
    }
    if (trimmed.length < 3) {
      setUsernameError("Username must be at least 3 characters");
      return false;
    }
    if (!/^[A-Za-z0-9]+$/.test(trimmed)) {
      setUsernameError("Only letters and numbers allowed");
      return false;
    }
    setUsernameError("");
    return true;
  };

  const handleUsernameChange = (text) => {
    setUsername(text);
    validateUsername(text);
  };

  const handleReroll = () => {
    const newName = generateRandomUsername();
    setUsername(newName);
    validateUsername(newName);
  };

  const handleSubmit = () => {
    const trimmed = username.trim();
    setUsername(trimmed);
    if (validateUsername(trimmed)) handleNext();
  };

  const handleNext = () => {
    navigation.navigate("EmailScreen", {
      accountType: route.params.accountType,
      dateOfBirth: route.params.dateOfBirth,
      username,
    });
  };

  const getInputBorderColor = () => {
    if (!username) return "#222";
    if (usernameError) return "#ff4d4d";
    return "#00e092";
  };

  const getNextBtnStyle = () => [
    styles.signUpBtn,
    {
      backgroundColor:
        username && !usernameError
          ? hoveredButton === "next"
            ? "#00e092"
            : "#00c781"
          : "#666",
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Enter/Choose Username</Text>
        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <View style={styles.inputWithIcon}>
              <TextInput
                ref={usernameInputRef}
                style={[
                  styles.input,
                  { borderColor: getInputBorderColor() },
                ]}
                placeholder="CuriousPeak8043"
                placeholderTextColor="#666"
                autoCapitalize="none"
                value={username}
                onChangeText={handleUsernameChange}
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={styles.rerollIcon}
                onPress={handleReroll}
                {...(Platform.OS === "web" && {
                  onMouseEnter: () => setHoveredButton("reroll"),
                  onMouseLeave: () => setHoveredButton(null),
                })}
              >
                <Image
                  source={require("../assets/generate.png")}
                  style={[
                    styles.rerollImage,
                    hoveredButton === "reroll" && { tintColor: "#00e092" },
                  ]}
                />
              </TouchableOpacity>
            </View>
            {usernameError ? (
              <Text style={styles.errorText}>{usernameError}</Text>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          style={getNextBtnStyle()}
          activeOpacity={0.7}
          onPress={handleNext}
          disabled={!username || !!usernameError}
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("next"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          <Text style={styles.signUpText}>Next</Text>
        </TouchableOpacity>

        <View style={styles.bottomContainer}>
          <View style={styles.homeContainer}>
            <Text style={styles.promptText}>Go to </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Home")}
              {...(Platform.OS === "web" && {
                onMouseEnter: () => setHoveredButton("home"),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text
                style={[
                  styles.linkText,
                  { color: hoveredButton === "home" ? "#00e092" : "#00c781" },
                ]}
              >
                Home
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Email & Password Screen – now redirects everyone to Dashboard
function EmailScreen({ navigation, route }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [serverError, setServerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);
  const [isAgreed, setIsAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const validateEmail = (input) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  const validatePassword = (input) => input.length >= 8;

  const handleEmailChange = (text) => {
    setEmail(text);
    setEmailError(validateEmail(text) ? "" : "Please enter a valid email address");
  };

  const handlePasswordChange = (text) => {
    setPassword(text);
    setPasswordError(validatePassword(text) ? "" : "Password must be at least 8 characters");
  };

  const handleConfirmPasswordChange = (text) => {
    setConfirmPassword(text);
    setConfirmError(text === password ? "" : "Passwords do not match");
  };

  const handleSignUp = async () => {
    if (!validateEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }
    if (!validatePassword(password)) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      return;
    }
    if (!isAgreed) {
      setServerError("You must agree to the terms and conditions");
      return;
    }

    setIsLoading(true);
    setServerError("");

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        accountType: route.params.accountType,
        username: route.params.username,
        email,
        dateOfBirth: route.params.dateOfBirth.toISOString(),
        createdAt: new Date().toISOString(),
      });

      await AsyncStorage.setItem("userToken", user.uid);
      console.log("Sign-up successful - UID:", user.uid);

      // ALL account types go to Dashboard now
      navigation.replace("Dashboard");
    } catch (error) {
      console.error("Sign-up error:", error);
      let message = "Sign-up failed";
      if (error.code === "auth/email-already-in-use") {
        message = "Email already in use. Please log in.";
        navigation.navigate("Login");
      } else if (error.code === "auth/invalid-email") {
        message = "Invalid email address";
      } else if (error.code === "auth/weak-password") {
        message = "Password is too weak";
      } else if (error.code === "permission-denied") {
        message = "Permission denied — check Firebase rules";
      } else {
        message = error.message || "Unknown error";
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
      // Check username uniqueness
      const q = query(collection(db, "users"), where("username", "==", route.params.username));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setServerError("Username already taken. Please choose another.");
        setIsLoading(false);
        navigation.navigate("UsernameScreen", {
          accountType: route.params.accountType,
          dateOfBirth: route.params.dateOfBirth,
        });
        return;
      }

      let user;
      if (Platform.OS === "web") {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        user = result.user;
      } else {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const credential = GoogleAuthProvider.credential(userInfo.idToken);
        const result = await signInWithCredential(auth, credential);
        user = result.user;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        await setDoc(doc(db, "users", user.uid), {
          uid: user.uid,
          accountType: route.params.accountType,
          username: route.params.username,
          email: user.email,
          dateOfBirth: route.params.dateOfBirth.toISOString(),
          createdAt: new Date().toISOString(),
        });
      }

      await AsyncStorage.setItem("userToken", user.uid);
      console.log("Google sign-up successful - UID:", user.uid);

      // ALL account types go to Dashboard
      navigation.replace("Dashboard");
    } catch (error) {
      console.error("Google Sign-In error:", error);
      let message = "Google sign-in failed";
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === "auth/popup-closed-by-user") {
        message = "Sign-in cancelled";
      } else if (error.code === "auth/email-already-in-use") {
        message = "Account already exists. Please log in.";
        navigation.navigate("Login");
      } else {
        message = error.message || "Unknown error";
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

  const getSignUpBtnStyle = () => [
    styles.signUpBtn,
    {
      backgroundColor:
        email && password && confirmPassword && !emailError && !passwordError && !confirmError && isAgreed
          ? hoveredButton === "signUp"
            ? "#00e092"
            : "#00c781"
          : "#666",
    },
  ];

  const getGoogleBtnStyle = () => [
    styles.signUpBtn,
    { backgroundColor: hoveredButton === "google" ? "#60a5fa" : "#4285F4" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Enter Your Email and Password</Text>

        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={{
                ...styles.input,
                borderColor: getInputBorderColor(email, emailError),
              }}
              placeholder="Email"
              placeholderTextColor="#ccc"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={handleEmailChange}
            />
            {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
          </View>

          <View style={styles.inputWrapper}>
            <View style={styles.passwordContainer}>
              <TextInput
                style={{
                  ...styles.input,
                  borderColor: getInputBorderColor(password, passwordError),
                }}
                placeholder="Password"
                placeholderTextColor="#ccc"
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={handlePasswordChange}
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
                  style={{
                    ...styles.eyeIcon,
                    tintColor: hoveredButton === "passwordEye" ? "#00e092" : "#ccc",
                  }}
                />
              </TouchableOpacity>
            </View>
            {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}
          </View>

          <View style={styles.inputWrapper}>
            <View style={styles.passwordContainer}>
              <TextInput
                style={{
                  ...styles.input,
                  borderColor: getInputBorderColor(confirmPassword, confirmError),
                }}
                placeholder="Confirm Password"
                placeholderTextColor="#ccc"
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={handleConfirmPasswordChange}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                {...(Platform.OS === "web" && {
                  onMouseEnter: () => setHoveredButton("confirmPasswordEye"),
                  onMouseLeave: () => setHoveredButton(null),
                })}
              >
                <Image
                  source={showConfirmPassword ? require("../assets/hide.png") : require("../assets/view.png")}
                  style={{
                    ...styles.eyeIcon,
                    tintColor: hoveredButton === "confirmPasswordEye" ? "#00e092" : "#ccc",
                  }}
                />
              </TouchableOpacity>
            </View>
            {confirmError ? <Text style={styles.errorText}>{confirmError}</Text> : null}
          </View>

          {serverError ? <Text style={styles.errorText}>{serverError}</Text> : null}
        </View>

        <View style={styles.termsContainer}>
          <TouchableOpacity
            style={styles.checkbox}
            onPress={() => setIsAgreed(!isAgreed)}
          >
            <Text style={styles.checkboxText}>{isAgreed ? "✓" : " "}</Text>
          </TouchableOpacity>
          <Text style={styles.promptText}>I agree to the </Text>
          <TouchableOpacity
            onPress={() => console.log("Navigate to Terms")}
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("terms"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text
              style={[
                styles.linkText,
                { color: hoveredButton === "terms" ? "#00e092" : "#00c781" },
              ]}
            >
              Terms and Conditions
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={getSignUpBtnStyle()}
          activeOpacity={0.7}
          onPress={handleSignUp}
          disabled={
            isLoading ||
            !email.trim() ||
            !password.trim() ||
            !confirmPassword.trim() ||
            emailError ||
            passwordError ||
            confirmError ||
            !isAgreed
          }
          {...(Platform.OS === "web" && {
            onMouseEnter: () => setHoveredButton("signUp"),
            onMouseLeave: () => setHoveredButton(null),
          })}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.signUpText}>Sign Up</Text>
          )}
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
              <Image
                source={require("../assets/google.png")}
                style={{ width: 20, height: 20, marginRight: 10 }}
              />
              <Text style={styles.signUpText}>Continue with Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.loginPrompt}>
          <Text style={styles.promptText}>Already Have an Account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate("Login")}
            {...(Platform.OS === "web" && {
              onMouseEnter: () => setHoveredButton("loginLink"),
              onMouseLeave: () => setHoveredButton(null),
            })}
          >
            <Text
              style={[
                styles.linkText,
                { color: hoveredButton === "loginLink" ? "#00e092" : "#00c781" },
              ]}
            >
              Log In
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomContainer}>
          <View style={styles.homeContainer}>
            <Text style={styles.promptText}>Go to </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Home")}
              {...(Platform.OS === "web" && {
                onMouseEnter: () => setHoveredButton("home"),
                onMouseLeave: () => setHoveredButton(null),
              })}
            >
              <Text
                style={[
                  styles.linkText,
                  { color: hoveredButton === "home" ? "#00e092" : "#00c781" },
                ]}
              >
                Home
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Main SignUp Flow
export default function SignUpScreen({ route }) {
  const initialScreen = route.params?.startScreen || "AccountTypeScreen";

  return (
    <Stack.Navigator
      initialRouteName={initialScreen}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="AccountTypeScreen" component={AccountTypeScreen} />
      <Stack.Screen name="DateOfBirthScreen" component={DateOfBirthScreen} />
      <Stack.Screen name="UsernameScreen" component={UsernameScreen} />
      <Stack.Screen name="EmailScreen" component={EmailScreen} />
    </Stack.Navigator>
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
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    width: "80%",
    maxWidth: 600,
    marginVertical: 20,
  },
  button: {
    flex: 1,
    paddingVertical: 20,
    marginHorizontal: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    aspectRatio: 1,
    transitionProperty: "transform, backgroundColor",
    transitionDuration: "0.3s",
  },
  buttonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  inputContainer: {
    width: "80%",
    maxWidth: 400,
    marginBottom: 10,
  },
  inputWrapper: {
    marginBottom: 10,
  },
  input: {
    width: "100%",
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 16,
    borderWidth: 2,
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
    width: "80%",
    maxWidth: 400,
    marginVertical: 10,
  },
  promptText: { fontSize: 14, color: "#ccc" },
  linkText: { fontSize: 14, fontWeight: "bold" },
  bottomContainer: {
    width: "100%",
    alignItems: "center",
    marginTop: 20,
  },
  homeContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  inputWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    position: "relative",
  },
  rerollIcon: {
    position: "absolute",
    right: 10,
    padding: 5,
  },
  rerollImage: {
    width: 20,
    height: 20,
    resizeMode: "contain",
    tintColor: "#ccc",
  },
  termsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "80%",
    maxWidth: 400,
    marginVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  checkboxText: {
    color: "#fff",
    fontSize: 14,
  },
  dropdownContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    gap: 10,
    marginBottom: 10,
  },
  dropdownWrapper: {
    flex: 1,
  },
  dropdownLabel: {
    color: "#ccc",
    fontSize: 12,
    marginBottom: 5,
  },
  dropdown: {
    width: "100%",
    backgroundColor: "#222",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 2,
  },
  dropdownText: {
    color: "#fff",
    fontSize: 16,
  },
  dropdownModal: {
    backgroundColor: "#222",
    borderRadius: 8,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: "#333",
    overflow: "visible",
  },
  dropdownList: {
    width: "100%",
  },
  dropdownItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  dropdownItemText: {
    color: "#fff",
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-start",
    alignItems: "flex-start",
  },
});