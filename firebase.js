'use strict';

/* ============================================================================
  Firebase — inicialización y exports (módulo ES, CDN)
============================================================================ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA1hO86Y2IdWVbs7CzoGp9LyRedwbsoD7A',
  authDomain: 'prestamo-de-herramientas.firebaseapp.com',
  projectId: 'prestamo-de-herramientas',
  storageBucket: 'prestamo-de-herramientas.firebasestorage.app',
  messagingSenderId: '265982093120',
  appId: '1:265982093120:web:ac3300677796b880fbbca5',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// App secundaria: permite crear usuarios sin cerrar la sesión del admin
const secondaryApp = initializeApp(firebaseConfig, 'creador-usuarios');
const secondaryAuth = getAuth(secondaryApp);

export {
  auth,
  db,
  secondaryAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
};
