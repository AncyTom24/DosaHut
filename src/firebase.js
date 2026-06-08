// 🔥 PASTE YOUR FIREBASE CONFIG HERE
// Get it from: Firebase Console → Project Settings → Your Apps → Web App
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDJdW6sPAZnMdAh47fb73P7xBXQijCuXeo",
  authDomain: "dosa-pos.firebaseapp.com",
  databaseURL: "https://dosa-pos-default-rtdb.firebaseio.com",
  projectId: "dosa-pos",
  storageBucket: "dosa-pos.firebasestorage.app",
  messagingSenderId: "779561478371",
  appId: "1:779561478371:web:549e7409e67d1b06fbbdd6",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
