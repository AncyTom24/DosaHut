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

let app;
let db;

try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (e) {
  console.error("Firebase init failed:", e);
}

export { db };
