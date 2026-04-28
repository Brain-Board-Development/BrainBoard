/*
 * SignUpScreen.jsx
 * Multi-step sign-up flow using Firebase Auth & Firestore.
 * All account types now redirect to Dashboard.js after success.
 * MOBILE FIXES:
 * - Removed transitionProperty/transitionDuration (web-only, crashes native)
 * - AccountTypeScreen buttons stack vertically on small screens
 * - All sub-screens wrapped in ScrollView
 * - Width uses percentage + maxWidth instead of fixed 80%
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, Platform, ActivityIndicator, Modal, FlatList,
  Image, ScrollView, useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStackNavigator } from "@react-navigation/stack";
import { auth, db } from "../firebaseConfig";
import {
  createUserWithEmailAndPassword, signInWithCredential,
  GoogleAuthProvider, signInWithPopup,
} from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs, getDoc } from "firebase/firestore";

const Stack = createStackNavigator();

const adjectives = ["Adventurous","Agile","Alert","Ambitious","Artistic","Blazing","Bold","Brave","Bright","Brilliant","Calm","Clever","Confident","Cool","Cosmic","Creative","Curious","Daring","Dynamic","Eager","Elegant","Energetic","Epic","Fearless","Fierce","Friendly","Graceful","Happy","Heroic","Keen","Lively","Majestic","Mighty","Noble","Playful","Powerful","Quick","Radiant","Sharp","Silent","Smart","Sparkling","Spirited","Swift","Vibrant","Witty"];
const nouns = ["Arrow","Bear","Blaze","Bolt","Castle","Cheetah","Cloud","Comet","Dragon","Eagle","Falcon","Flame","Fox","Galaxy","Ghost","Hawk","Horse","Island","Jaguar","Knight","Lake","Leopard","Lion","Meteor","Moon","Mountain","Ninja","Oak","Ocean","Owl","Panther","Phoenix","Puma","Raven","River","Rocket","Shark","Sky","Star","Storm","Tiger","Titan","Viper","Wave","Wolf"];

function generateRandomUsername() {
  return adjectives[Math.floor(Math.random()*adjectives.length)] + nouns[Math.floor(Math.random()*nouns.length)] + Math.floor(Math.random()*10000);
}

// ── Account Type ────────────────────────────────────────────────────────────
function AccountTypeScreen({ navigation }) {
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 500;

  const TYPES = [
    { id: "Student",  color: "#007BFF" },
    { id: "Teacher",  color: "#FF6200" },
    { id: "Personal", color: "#6F42C1" },
  ];

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.center}>
        <Text style={S.title}>Who are you?</Text>
        <View style={[S.typeRow, isMobile && { flexDirection: "column", width: "100%" }]}>
          {TYPES.map(t => (
            <TouchableOpacity
              key={t.id}
              style={[S.typeBtn, { backgroundColor: t.color }, isMobile && { width: "100%", aspectRatio: undefined, paddingVertical: 20 }]}
              onPress={() => navigation.navigate("DateOfBirthScreen", { accountType: t.id })}
              activeOpacity={0.8}
            >
              <Text style={S.typeBtnTxt}>{t.id === "Teacher" ? "Educator" : t.id}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <BottomHome navigation={navigation} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Date of Birth ───────────────────────────────────────────────────────────
function DateOfBirthScreen({ navigation, route }) {
  const today = new Date();
  const [day, setDay]     = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear]   = useState("");
  const [dateError, setDateError] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);

  const days   = Array.from({length:31},(_,i)=>({ value:(i+1).toString().padStart(2,"0"), label:(i+1).toString().padStart(2,"0") }));
  const months = [{value:"01",label:"January"},{value:"02",label:"February"},{value:"03",label:"March"},{value:"04",label:"April"},{value:"05",label:"May"},{value:"06",label:"June"},{value:"07",label:"July"},{value:"08",label:"August"},{value:"09",label:"September"},{value:"10",label:"October"},{value:"11",label:"November"},{value:"12",label:"December"}];
  const years  = Array.from({length:today.getFullYear()-1900+1},(_,i)=>({ value:(1900+i).toString(), label:(1900+i).toString() })).reverse();

  const validateDate = () => {
    if (!day||!month||!year) { setDateError("Please select day, month, and year"); return false; }
    const d = new Date(`${year}-${month}-${day}`);
    if (isNaN(d.getTime())) { setDateError("Invalid date"); return false; }
    const minDate = new Date(today.getFullYear()-13, today.getMonth(), today.getDate());
    if (d > minDate) { setDateError("You must be at least 13 years old"); return false; }
    setDateError(""); return true;
  };

  useEffect(() => { if (hasInteracted) validateDate(); }, [day, month, year]);

  const SimpleDropdown = ({ label, value, onValueChange, items, placeholder }) => {
    const [open, setOpen] = useState(false);
    return (
      <View style={S.ddWrapper}>
        <Text style={S.ddLabel}>{label}</Text>
        <TouchableOpacity style={[S.ddBtn, { borderColor: value ? "#00c781" : "#333" }]} onPress={() => setOpen(true)}>
          <Text style={[S.ddBtnTxt, !value && { color: "#666" }]}>{value ? (items.find(i=>i.value===value)?.label||value) : placeholder}</Text>
        </TouchableOpacity>
        <Modal visible={open} transparent animationType="fade">
          <TouchableOpacity style={S.ddOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
            <View style={S.ddModal}>
              <FlatList
                data={items} keyExtractor={i=>i.value}
                renderItem={({item}) => (
                  <TouchableOpacity style={S.ddItem} onPress={() => { onValueChange(item.value); setOpen(false); }}>
                    <Text style={S.ddItemTxt}>{item.label}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.center} keyboardShouldPersistTaps="handled">
        <Text style={S.title}>Date of Birth</Text>
        <View style={S.ddRow}>
          <SimpleDropdown label="Month" value={month} onValueChange={v=>{setMonth(v);setHasInteracted(true);}} items={months} placeholder="Month"/>
          <SimpleDropdown label="Day"   value={day}   onValueChange={v=>{setDay(v);setHasInteracted(true);}}   items={days}   placeholder="Day"/>
          <SimpleDropdown label="Year"  value={year}  onValueChange={v=>{setYear(v);setHasInteracted(true);}}  items={years}  placeholder="Year"/>
        </View>
        {!!dateError && <Text style={S.err}>{dateError}</Text>}
        <TouchableOpacity
          style={[S.btn, (!hasInteracted||!!dateError) && {opacity:0.5}]}
          onPress={() => { if(validateDate()) navigation.navigate("UsernameScreen",{accountType:route.params.accountType,dateOfBirth:new Date(`${year}-${month}-${day}`)}); }}
          disabled={!hasInteracted||!!dateError}
        >
          <Text style={S.btnTxt}>Next</Text>
        </TouchableOpacity>
        <BottomHome navigation={navigation}/>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Username ────────────────────────────────────────────────────────────────
function UsernameScreen({ navigation, route }) {
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");

  const validate = (v) => {
    const t = v.trim();
    if (!t) { setUsernameError(""); return false; }
    if (t.length < 3) { setUsernameError("Min 3 characters"); return false; }
    if (!/^[A-Za-z0-9]+$/.test(t)) { setUsernameError("Letters and numbers only"); return false; }
    setUsernameError(""); return true;
  };

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.center} keyboardShouldPersistTaps="handled">
        <Text style={S.title}>Choose a Username</Text>
        <View style={S.inputWrap}>
          <TextInput
            style={[S.input, { borderColor: !username?"#333":usernameError?"#ff4d4d":"#00c781" }]}
            placeholder="CoolPlayer123" placeholderTextColor="#666"
            autoCapitalize="none" value={username}
            onChangeText={v=>{setUsername(v);validate(v);}}
          />
          <TouchableOpacity style={S.rerollBtn} onPress={()=>{const n=generateRandomUsername();setUsername(n);validate(n);}}>
            <Text style={S.rerollTxt}>🔀 Random</Text>
          </TouchableOpacity>
        </View>
        {!!usernameError && <Text style={S.err}>{usernameError}</Text>}
        <TouchableOpacity
          style={[S.btn, (!username||!!usernameError)&&{opacity:0.5}]}
          onPress={() => { if(username&&!usernameError) navigation.navigate("EmailScreen",{...route.params,username}); }}
          disabled={!username||!!usernameError}
        >
          <Text style={S.btnTxt}>Next</Text>
        </TouchableOpacity>
        <BottomHome navigation={navigation}/>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Email & Password ─────────────────────────────────────────────────────────
function EmailScreen({ navigation, route }) {
  const [email,            setEmail]           = useState("");
  const [password,         setPassword]        = useState("");
  const [confirmPassword,  setConfirmPassword] = useState("");
  const [emailError,       setEmailError]      = useState("");
  const [passwordError,    setPasswordError]   = useState("");
  const [confirmError,     setConfirmError]    = useState("");
  const [serverError,      setServerError]     = useState("");
  const [isLoading,        setIsLoading]       = useState(false);
  const [isAgreed,         setIsAgreed]        = useState(false);
  const [showPw,           setShowPw]          = useState(false);
  const [showConfirmPw,    setShowConfirmPw]   = useState(false);

  const validateEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const validatePw    = v => v.length >= 8;

  const handleSignUp = async () => {
    if (!validateEmail(email))    { setEmailError("Valid email required"); return; }
    if (!validatePw(password))    { setPasswordError("Min 8 characters"); return; }
    if (password !== confirmPassword) { setConfirmError("Passwords do not match"); return; }
    if (!isAgreed) { setServerError("You must agree to the terms"); return; }
    setIsLoading(true); setServerError("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db,"users",cred.user.uid), {
        uid: cred.user.uid, accountType: route.params.accountType,
        username: route.params.username, email,
        dateOfBirth: route.params.dateOfBirth.toISOString(),
        createdAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem("userToken", cred.user.uid);
      navigation.replace("Dashboard");
    } catch (err) {
      const code = err.code || "";
      setServerError(code === "auth/email-already-in-use" ? "Email already in use. Please log in."
        : code === "auth/invalid-email" ? "Invalid email."
        : code === "auth/weak-password" ? "Password too weak."
        : err.message || "Sign-up failed");
    } finally { setIsLoading(false); }
  };

  const handleGoogleSignUp = async () => {
    setIsLoading(true); setServerError("");
    try {
      let user;
      if (Platform.OS === "web") {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        user = result.user;
      } else { setServerError("Google sign-up on mobile requires native setup."); setIsLoading(false); return; }
      const existing = await getDoc(doc(db,"users",user.uid));
      if (!existing.exists()) {
        await setDoc(doc(db,"users",user.uid), {
          uid: user.uid, accountType: route.params.accountType,
          username: route.params.username, email: user.email,
          dateOfBirth: route.params.dateOfBirth.toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
      await AsyncStorage.setItem("userToken", user.uid);
      navigation.replace("Dashboard");
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") setServerError(err.message || "Google sign-up failed");
    } finally { setIsLoading(false); }
  };

  const bc = (v,e) => !v?"#333":e?"#ff4d4d":"#00c781";
  const canSubmit = email&&password&&confirmPassword&&!emailError&&!passwordError&&!confirmError&&isAgreed;

  return (
    <SafeAreaView style={S.safe}>
      <ScrollView contentContainerStyle={S.center} keyboardShouldPersistTaps="handled">
        <Text style={S.title}>Email & Password</Text>
        <View style={S.inputWrap}>
          <TextInput style={[S.input,{borderColor:bc(email,emailError)}]} placeholder="Email" placeholderTextColor="#888" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={v=>{setEmail(v);setEmailError(validateEmail(v)?"":"Valid email required");}}/>
          {!!emailError&&<Text style={S.err}>{emailError}</Text>}

          <View style={{flexDirection:"row",alignItems:"center"}}>
            <TextInput style={[S.input,{borderColor:bc(password,passwordError),flex:1}]} placeholder="Password" placeholderTextColor="#888" secureTextEntry={!showPw} value={password} onChangeText={v=>{setPassword(v);setPasswordError(validatePw(v)?"":"Min 8 characters");}}/>
            <TouchableOpacity style={{paddingLeft:8,paddingBottom:10}} onPress={()=>setShowPw(p=>!p)}><Text>{showPw?"🙈":"👁️"}</Text></TouchableOpacity>
          </View>
          {!!passwordError&&<Text style={S.err}>{passwordError}</Text>}

          <View style={{flexDirection:"row",alignItems:"center"}}>
            <TextInput style={[S.input,{borderColor:bc(confirmPassword,confirmError),flex:1}]} placeholder="Confirm Password" placeholderTextColor="#888" secureTextEntry={!showConfirmPw} value={confirmPassword} onChangeText={v=>{setConfirmPassword(v);setConfirmError(v===password?"":"Passwords do not match");}}/>
            <TouchableOpacity style={{paddingLeft:8,paddingBottom:10}} onPress={()=>setShowConfirmPw(p=>!p)}><Text>{showConfirmPw?"🙈":"👁️"}</Text></TouchableOpacity>
          </View>
          {!!confirmError&&<Text style={S.err}>{confirmError}</Text>}

          {!!serverError&&<Text style={S.err}>{serverError}</Text>}

          <TouchableOpacity style={S.termsRow} onPress={()=>setIsAgreed(p=>!p)}>
            <View style={[S.checkbox,isAgreed&&{backgroundColor:"#00c781",borderColor:"#00c781"}]}>
              {isAgreed&&<Text style={{color:"#000",fontWeight:"bold",fontSize:12}}>✓</Text>}
            </View>
            <Text style={S.termsLbl}>I agree to the Terms and Conditions</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[S.btn,!canSubmit&&{opacity:0.5}]} onPress={handleSignUp} disabled={isLoading||!canSubmit}>
          {isLoading?<ActivityIndicator color="#fff"/>:<Text style={S.btnTxt}>Sign Up</Text>}
        </TouchableOpacity>

        <Text style={S.or}>or</Text>

        <TouchableOpacity style={[S.btn,S.googleBtn]} onPress={handleGoogleSignUp} disabled={isLoading}>
          {isLoading?<ActivityIndicator color="#fff"/>:<Text style={S.btnTxt}>Continue with Google</Text>}
        </TouchableOpacity>

        <View style={S.row}>
          <Text style={S.muted}>Already have an account? </Text>
          <TouchableOpacity onPress={()=>navigation.navigate("Login")}><Text style={S.link}>Log In</Text></TouchableOpacity>
        </View>
        <BottomHome navigation={navigation}/>
      </ScrollView>
    </SafeAreaView>
  );
}

function BottomHome({ navigation }) {
  return (
    <View style={S.row}>
      <Text style={S.muted}>Go to </Text>
      <TouchableOpacity onPress={()=>navigation.navigate("Home")}><Text style={S.link}>Home</Text></TouchableOpacity>
    </View>
  );
}

export default function SignUpScreen({ route }) {
  return (
    <Stack.Navigator initialRouteName={route.params?.startScreen||"AccountTypeScreen"} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AccountTypeScreen" component={AccountTypeScreen}/>
      <Stack.Screen name="DateOfBirthScreen" component={DateOfBirthScreen}/>
      <Stack.Screen name="UsernameScreen"    component={UsernameScreen}/>
      <Stack.Screen name="EmailScreen"       component={EmailScreen}/>
    </Stack.Navigator>
  );
}

const S = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#111" },
  center:  { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, paddingBottom: 40 },
  title:   { fontSize: 26, fontWeight: "bold", color: "#fff", marginBottom: 24, textAlign: "center" },

  typeRow: { flexDirection: "row", gap: 12, marginBottom: 24, justifyContent: "center", flexWrap: "wrap" },
  typeBtn: { flex: 1, minWidth: 100, maxWidth: 160, aspectRatio: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typeBtnTxt: { color: "#fff", fontSize: 18, fontWeight: "bold" },

  ddRow:    { flexDirection: "row", gap: 10, width: "100%", maxWidth: 400, marginBottom: 12 },
  ddWrapper:{ flex: 1 },
  ddLabel:  { color: "#888", fontSize: 12, marginBottom: 4 },
  ddBtn:    { backgroundColor: "#1e1e1e", borderRadius: 8, padding: 12, borderWidth: 2 },
  ddBtnTxt: { color: "#fff", fontSize: 14 },
  ddOverlay:{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  ddModal:  { backgroundColor: "#1e1e1e", borderRadius: 12, padding: 8, width: "80%", maxHeight: 300, maxWidth: 300 },
  ddItem:   { padding: 12, borderBottomWidth: 1, borderBottomColor: "#333" },
  ddItemTxt:{ color: "#fff", fontSize: 15 },

  inputWrap:{ width: "100%", maxWidth: 400, marginBottom: 12 },
  input:    { backgroundColor: "#1e1e1e", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontSize: 16, borderWidth: 2, marginBottom: 8, width: "100%" },
  rerollBtn:{ backgroundColor: "#9b59b6", padding: 12, borderRadius: 10, marginBottom: 8, alignItems: "center" },
  rerollTxt:{ color: "#fff", fontWeight: "bold" },

  btn:      { backgroundColor: "#00c781", paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10, alignItems: "center", width: "100%", maxWidth: 400, marginBottom: 8 },
  googleBtn:{ backgroundColor: "#4285F4" },
  btnTxt:   { color: "#fff", fontSize: 16, fontWeight: "bold" },
  or:       { color: "#666", fontSize: 14, marginVertical: 8 },
  err:      { color: "#ff4d4d", fontSize: 12, marginBottom: 6 },
  row:      { flexDirection: "row", alignItems: "center", marginTop: 12 },
  muted:    { color: "#aaa", fontSize: 14 },
  link:     { color: "#00c781", fontSize: 14, fontWeight: "bold" },

  termsRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: "#555", borderRadius: 5, alignItems: "center", justifyContent: "center", marginRight: 10 },
  termsLbl: { color: "#ccc", fontSize: 13, flex: 1 },
});