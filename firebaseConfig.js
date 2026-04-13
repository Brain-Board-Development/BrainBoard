// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
 
const firebaseConfig = {
  apiKey: "AIzaSyDl7SDiJspL7O9BVYMWEqegfqm5Ux5vrIM",
  authDomain: "cs4-project-test.firebaseapp.com",
  projectId: "cs4-project-test",
  storageBucket: "cs4-project-test.firebasestorage.app",
  messagingSenderId: "1045244308839",
  appId: "1:1045244308839:web:76ce638e01a27c933f13c2",
  measurementId: "G-4VJECTZJ2F",
};
 
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
 

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("[Auth] Failed to set persistence:", err);
});
 
export const db = getFirestore(app);
export const storage = getStorage(app);