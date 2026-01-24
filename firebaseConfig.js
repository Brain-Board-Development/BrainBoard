// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth, inMemoryPersistence, setPersistence } from "firebase/auth"; // ← ADD these
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your Firebase config (unchanged)
const firebaseConfig = {
  apiKey: "AIzaSyDl7SDiJspL7O9BVYMWEqegfqm5Ux5vrIM",
  authDomain: "cs4-project-test.firebaseapp.com",
  projectId: "cs4-project-test",
  storageBucket: "cs4-project-test.firebasestorage.app",
  messagingSenderId: "1045244308839",
  appId: "1:1045244308839:web:76ce638e01a27c933f13c2",
  measurementId: "G-4VJECTZJ2F",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// TEMP FIX: Use in-memory persistence (no cross-tab sync, no localStorage)
const auth = getAuth(app);

// Force in-memory persistence (temporary dev mode)
setPersistence(auth, inMemoryPersistence)
  .then(() => {
    console.log("[DEV] Firebase Auth set to in-memory persistence (guest testing mode)");
  })
  .catch((err) => {
    console.error("Failed to set in-memory persistence:", err);
  });

export const db = getFirestore(app);
export const storage = getStorage(app);
export { auth }; // Export the modified auth instance