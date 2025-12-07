// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// ❌ REMOVE getAnalytics import

// Replace with your Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyDl7SDiJspL7O9BVYMWEqegfqm5Ux5vrIM",
  authDomain: "cs4-project-test.firebaseapp.com",
  projectId: "cs4-project-test",
  storageBucket: "cs4-project-test.firebasestorage.app",
  messagingSenderId: "1045244308839",
  appId: "1:1045244308839:web:76ce638e01a27c933f13c2",
  measurementId: "G-4VJECTZJ2F",
};

// ✅ Initialize Firebase safely
const app = initializeApp(firebaseConfig);

// ✅ Export Firebase modules
export const auth = getAuth(app);
export const db = getFirestore(app);
